// @ts-check
// The awake window's runner (the rules are in src/core/warm.mjs). While an activity's 3 hours
// or a plan's window holds, it asks the service's own public address for /healthz every 10 to
// 12 minutes, which Render counts as inbound traffic, so the free instance does not sleep.
// It keeps the month's warm hours in the store (meta/warm) and stops at the cap, so Come
// Through can never use up the workspace's shared 750 free hours. Every start and stop is
// logged with the month's total: warm_start, warm_stop, warm_cap.
//
// Warm hours are counted from a stretch's start to its stop, plus the 15 minutes Render keeps
// the instance up after the last ping, so the count errs high.

import { HOUR, MINUTE, WARM, extended, monthKey, pingDelay, planWindows, warmStep, warmTarget } from "../core/warm.mjs";

const DOC = "warm";
const hours = (/** @type {number} */ ms) => Math.round((ms / HOUR) * 100) / 100;
const iso = (/** @type {number|null} */ t) => (t == null ? null : new Date(t).toISOString());

/**
 * @param {object} o
 * @param {import("../adapters/store.mjs").Store} o.store
 * @param {string} o.selfUrl  the service's own public address (RENDER_EXTERNAL_URL); "" never pings
 * @param {number} [o.capHours]  0 turns the window off
 * @param {() => number} [o.now]
 * @param {(event: string, fields?: Record<string, any>) => void} [o.log]
 * @param {(url: string) => Promise<{ ok: boolean, status: number }>} [o.ping]
 * @param {(fn: () => void, ms: number) => any} [o.setTimer]
 * @param {(t: any) => void} [o.clearTimer]
 * @param {() => number} [o.random]
 */
export function createWarm({ store, selfUrl, capHours = WARM.capHours, now = Date.now, log = () => {}, ping, setTimer = setTimeout, clearTimer = clearTimeout, random = Math.random }) {
  const capMs = Math.max(0, capHours) * HOUR;
  /** @type {{ warmUntil: number, months: Record<string, { ms: number, starts: number }> }} */
  let state = { warmUntil: 0, months: {} };
  /** @type {Promise<void>|null} */
  let loaded = null;
  /** @type {any} */
  let timer = null;
  /** the stretch in progress: when it started and when its time was last counted */
  /** @type {{ since: number, lastAt: number } | null} */
  let stretch = null;
  let savedUntil = 0;
  /** @type {{ at: number, list: { from: number, to: number }[] }} */
  let cache = { at: -Infinity, list: [] };
  /** @type {string|null} */
  let capLogged = null;
  /** one step at a time */
  let running = Promise.resolve();

  const doPing =
    ping ??
    (async (/** @type {string} */ url) => {
      const r = await fetch(url, { headers: { "user-agent": "ComeThrough-warm/1" }, signal: AbortSignal.timeout(20_000) });
      await r.arrayBuffer().catch(() => null);
      return { ok: r.ok, status: r.status };
    });

  function load() {
    loaded ??= (async () => {
      try {
        const d = await store.get("meta", DOC);
        if (d) state = { warmUntil: Number(d.warmUntil) || 0, months: d.months && typeof d.months === "object" ? d.months : {} };
        savedUntil = state.warmUntil;
      } catch (e) {
        log("warm_error", { message: String(/** @type {any} */ (e)?.message).slice(0, 160) });
      }
    })();
    return loaded;
  }

  async function save() {
    // keep the last three months only
    const keys = Object.keys(state.months).sort();
    for (const k of keys.slice(0, -3)) delete state.months[k];
    const fields = { warmUntil: state.warmUntil, months: state.months, updatedAt: iso(now()) };
    try {
      const done = await store.update("meta", DOC, { set: fields });
      if (!done && !(await store.insert("meta", { id: DOC, ...fields }))) await store.update("meta", DOC, { set: fields });
      savedUntil = state.warmUntil;
    } catch (e) {
      log("warm_error", { message: String(/** @type {any} */ (e)?.message).slice(0, 160) });
    }
  }

  const month = (/** @type {number} */ t) => (state.months[monthKey(t)] ??= { ms: 0, starts: 0 });

  /** Count the stretch's time up to t. */
  function count(/** @type {number} */ t) {
    if (!stretch) return;
    month(t).ms += Math.max(0, t - stretch.lastAt);
    stretch.lastAt = t;
  }

  /**
   * The coming plans' windows (cached a few minutes; plans move rarely).
   * @param {number} t
   * @param {number} [maxAgeMs]
   */
  async function windows(t, maxAgeMs = 5 * MINUTE) {
    if (t - cache.at < maxAgeMs) return cache.list;
    // a cheap prefilter on the start's date (any offset fits inside a day either side); the exact window is worked out after
    const since = new Date(t - 2 * 24 * HOUR).toISOString().slice(0, 10);
    const plans = await store.find("plans", { start: { $gte: since }, status: { $ne: "cancelled" } });
    cache = { at: t, list: planWindows(plans, t) };
    return cache.list;
  }

  function schedule(/** @type {number} */ ms) {
    if (timer) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      step("timer").catch((e) => log("warm_error", { message: String(e?.message).slice(0, 160) }));
    }, ms);
    timer?.unref?.();
  }

  /**
   * Decide, and ping when the window holds. `reason` says what asked: boot, an activity
   * (crew, join, plan, plan_edit, rsvp, share, basic), the heartbeat (tick) or the timer.
   * @param {string} reason
   */
  function step(reason, { fresh = false } = {}) {
    const run = running.then(async () => {
      await load();
      const t = now();
      let wins = cache.list;
      try {
        wins = await windows(t, fresh ? 0 : undefined);
      } catch (e) {
        log("warm_error", { message: String(/** @type {any} */ (e)?.message).slice(0, 160) });
      }
      const { until, why } = warmTarget({ now: t, warmUntil: state.warmUntil, windows: wins });
      count(t);
      const m = month(t);
      const act = capMs > 0 ? warmStep({ now: t, until, monthMs: m.ms, capMs }) : "stop";
      if (act === "ping") {
        if (!stretch) {
          stretch = { since: t, lastAt: t };
          m.starts++;
          log("warm_start", { why, reason, until: iso(until), monthHours: hours(m.ms), capHours });
          await save();
        } else if (reason === "timer" || state.warmUntil - savedUntil >= 30 * MINUTE) await save(); // a restart loses at most one interval of the count
        // an activity is itself inbound traffic; the timer's turn pings
        if (reason === "timer" && selfUrl) {
          const t0 = now();
          doPing(`${selfUrl}/healthz`)
            .then((r) => log("warm_ping", { status: r.status, ms: now() - t0, until: iso(until), why }))
            .catch((e) => log("warm_ping", { error: String(e?.message).slice(0, 120) }));
        }
        if (!timer) schedule(pingDelay(random()));
      } else {
        if (stretch) {
          m.ms += WARM.tailMs;
          log("warm_stop", { why: act === "cap" ? "cap" : capMs > 0 ? "done" : "off", reason, hours: hours(t - stretch.since + WARM.tailMs), monthHours: hours(m.ms), capHours, starts: m.starts });
          stretch = null;
          await save();
        }
        if (act === "cap" && capLogged !== monthKey(t)) {
          capLogged = monthKey(t);
          log("warm_cap", { month: monthKey(t), monthHours: hours(m.ms), capHours });
        }
        if (timer) clearTimer(timer);
        timer = null;
      }
      return { act, until, why, monthMs: m.ms };
    });
    running = run.catch(() => undefined);
    return run;
  }

  /**
   * Something happened that friends will follow soon: stay awake for the next 3 hours.
   * @param {string} reason
   */
  function extend(reason) {
    return load()
      .then(async () => {
        state.warmUntil = extended(state.warmUntil, now());
        // a stretch in progress keeps its timer; otherwise start one
        if (!stretch) await step(reason);
        else if (state.warmUntil - savedUntil >= 30 * MINUTE) await save();
      })
      .catch((e) => log("warm_error", { message: String(e?.message).slice(0, 160) }));
  }

  /**
   * The windows the heartbeat should wake the server for (GitHub Actions keeps these between
   * its runs), as ISO strings.
   * @param {number} [horizonMs]
   */
  async function upcoming(horizonMs = 30 * HOUR) {
    const t = now();
    const wins = await windows(t, 0);
    return wins.filter((w) => w.from < t + horizonMs).map((w) => ({ from: iso(w.from), to: iso(w.to) }));
  }

  /** What the window looks like now (for tests and the logs). */
  async function status() {
    await load();
    const t = now();
    return { warmUntil: iso(state.warmUntil || null), warm: !!stretch, month: monthKey(t), monthHours: hours(month(t).ms), capHours };
  }

  function stop() {
    if (timer) clearTimer(timer);
    timer = null;
  }

  return { start: () => step("boot", { fresh: true }), step, extend, upcoming, status, stop };
}
