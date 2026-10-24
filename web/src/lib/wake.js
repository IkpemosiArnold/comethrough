// The server naps. Come Through's API runs on Render's free plan, which sleeps after 15 quiet
// minutes and takes about a minute to wake. The pages come from a static site that never
// sleeps, so they open at once; this module knows whether the API behind /api is awake, and
// holds requests until it is.
//
// What a sleeping server answers (measured 23 Oct 2026, docs/DEPLOY.md): a page load gets
// Render's "Application loading" page (503, text/html, x-render-routing: hibernate-pending-wake);
// a fetch() through the static site's proxy is held until the server is up. So:
//   - the app asks /api/healthz the moment it loads, beside its real requests;
//   - if that has not answered in 1.5 s, the sloth is "waking" and the screen says so, with the
//     seconds counting;
//   - anything that is not our own JSON (Render's page, a 502, 503 or 504 from a proxy) means
//     "still waking": ask again, then send the request again. Such an answer never came from
//     our server, so sending it again is safe, a POST too;
//   - while waking, one /api/healthz is always on its way: a try that comes back "still waking"
//     is followed by the next one 1.5 s after it started (at once when it was held longer), with
//     no growing backoff, so the first try after the server is up lands within about 1.5 s
//     (24 Oct: a 1, 2, 3, 4, 5 s backoff left 8.8 s between "listening" and the first request);
//   - after about 90 s the sloth is "down": an honest message and a retry button. Once the
//     server is up nothing more is sent.

export const WAKE = {
  /** how long to keep trying before giving up */
  budgetMs: 90_000,
  /** a quick answer never shows the waking state */
  showAfterMs: 1500,
  /** while waking, a try starts at most this often (a try held longer is followed at once) */
  retryMs: 1500,
  /** one try of /api/healthz may be held this long while the server boots */
  tryMs: 30_000,
  /** once seen awake, trust it for this long */
  freshMs: 4 * 60_000,
};

/**
 * The wait before the next try, from how long the last one took: tries start every 1.5 s, and
 * a try that was held longer than that is followed at once. Never more than what is left.
 * @param {number} triedForMs
 * @param {number} [leftMs]
 */
export const retryWait = (triedForMs, leftMs = Infinity) => Math.max(0, Math.min(WAKE.retryMs - Math.max(0, triedForMs), leftMs));

/**
 * True when an answer came from Render's waking machinery, not from our server: our API
 * always answers JSON, so a non-JSON 502, 503 or 504, or any HTML, is "still waking".
 * @param {{ status: number, headers: { get(name: string): string|null } }} res
 */
export function wakingAnswer(res) {
  const routing = String(res.headers.get('x-render-routing') || '');
  if (/hibernate|wak/i.test(routing)) return true;
  const type = String(res.headers.get('content-type') || '');
  const json = /json/i.test(type);
  if (!json && (res.status === 502 || res.status === 503 || res.status === 504)) return true;
  return /text\/html/i.test(type);
}

/**
 * @param {object} o
 * @param {(url: string, init?: any) => Promise<any>} o.fetch
 * @param {() => number} [o.now]
 * @param {(ms: number) => Promise<void>} [o.sleep]
 * @param {(fn: () => void, ms: number) => any} [o.setTimer]
 * @param {(t: any) => void} [o.clearTimer]
 * @param {string} [o.healthUrl]
 * @param {Promise<any>|null} [o.early]  the same request, already sent by index.html before the app loaded
 */
export function createWaker({ fetch, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), setTimer = setTimeout, clearTimer = clearTimeout, healthUrl = '/api/healthz', early = null }) {
  /** phase: idle (not asked yet), checking, waking (shown), up, down */
  let state = { phase: 'idle', since: now(), upAt: 0 };
  const listeners = new Set();
  /** @type {Promise<boolean>|null} */
  let probe = null;

  function set(patch) {
    state = { ...state, ...patch };
    for (const fn of listeners) fn(state);
  }

  async function tryHealth() {
    let timer;
    try {
      let res;
      if (early) {
        // index.html asked already, before the app had loaded: use that answer once
        const first = early;
        early = null;
        res = await first;
      } else {
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        timer = ctl ? setTimer(() => ctl.abort(), WAKE.tryMs) : null;
        res = await fetch(healthUrl, { cache: 'no-store', ...(ctl ? { signal: ctl.signal } : {}) });
      }
      if (wakingAnswer(res)) return false;
      const data = await res.json().catch(() => null);
      return !!(data && data.ok);
    } catch {
      return false;
    } finally {
      if (timer) clearTimer(timer);
    }
  }

  /**
   * Resolves true once the server answers, false after the budget. One probe at a time.
   * @param {{ force?: boolean }} [o]
   */
  function wake({ force = false } = {}) {
    if (!force && state.phase === 'up' && now() - state.upAt < WAKE.freshMs) return Promise.resolve(true);
    if (probe) return probe;
    const started = now();
    set({ phase: state.phase === 'waking' ? 'waking' : 'checking', since: started });
    // a quick answer never shows the waking state
    const show = setTimer(() => { if (state.phase === 'checking') set({ phase: 'waking' }); }, WAKE.showAfterMs);
    probe = (async () => {
      for (;;) {
        const tryStart = now();
        if (await tryHealth()) {
          clearTimer(show);
          set({ phase: 'up', upAt: now() });
          return true;
        }
        if (state.phase === 'checking') set({ phase: 'waking' });
        const left = WAKE.budgetMs - (now() - started);
        if (left <= 0) break;
        const wait = retryWait(now() - tryStart, left);
        if (wait > 0) await sleep(wait);
        if (now() - started >= WAKE.budgetMs) break;
      }
      clearTimer(show);
      set({ phase: 'down' });
      return false;
    })().finally(() => { probe = null; });
    return probe;
  }

  /**
   * fetch(), held while the server wakes: an answer that is not ours is asked again once the
   * server is up. Throws { asleep: true } when it does not wake in time.
   * @param {string} url
   * @param {any} [init]
   */
  async function call(url, init) {
    const started = now();
    // not seen awake lately: check beside this request, so a held request shows the sloth waking
    if (state.phase !== 'up' || now() - state.upAt > WAKE.freshMs) wake().catch(() => false);
    for (let attempt = 0; ; attempt++) {
      let res = null;
      let failed = false;
      try {
        res = await fetch(url, init);
      } catch (e) {
        if (e?.name === 'AbortError') throw e;
        // no answer at all: offline, unless the server was not known to be up (a proxy may drop a held request)
        if (state.phase === 'up' || (attempt > 0 && state.phase === 'down')) throw e;
        failed = true;
      }
      if (res && !wakingAnswer(res)) {
        if (state.phase !== 'up') set({ phase: 'up', upAt: now() });
        else state = { ...state, upAt: now() };
        return res;
      }
      if (now() - started > WAKE.budgetMs || attempt >= 6) throw Object.assign(new Error('asleep'), { asleep: true });
      if (state.phase === 'up') set({ phase: 'checking', since: now() });
      const up = await wake({ force: true });
      if (!up) {
        if (failed && typeof navigator !== 'undefined' && navigator.onLine === false) throw new TypeError('offline');
        throw Object.assign(new Error('asleep'), { asleep: true });
      }
    }
  }

  return {
    wake,
    call,
    /** start over after "down" (the retry button) */
    retry: () => wake({ force: true }),
    get state() { return state; },
    /** @param {(s: any) => void} fn */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

/** The app's one waker (the browser's fetch). */
let shared = null;
export function waker() {
  shared ??= createWaker({ fetch: (u, i) => fetch(u, i), early: typeof window !== 'undefined' ? window.__ctWake || null : null });
  return shared;
}
