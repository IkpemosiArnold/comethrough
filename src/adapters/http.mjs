// @ts-check
// Shared plumbing for the adapters that call public services: a fetch with a timeout, a
// size cap and retries with backoff; a polite throttle (one request at a time, a minimum
// gap); and caches (in memory, and layered over the store so they survive restarts).

/** @typedef {{ get(key: string): Promise<any>, set(key: string, value: any, ttlMs: number): Promise<void> }} Cache */

export class HttpError extends Error {
  /** @param {string} message @param {{ status?: number, transient?: boolean, url?: string }} [info] */
  constructor(message, { status = 0, transient = false, url } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.transient = transient;
    this.url = url;
  }
}

const sleepReal = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** The User-Agent for OpenStreetMap services, which require one that identifies the app. */
export const userAgent = (/** @type {string} */ contact) => `ComeThrough/0.1 (+${contact})`;

/**
 * fetch with a timeout, a response size cap and retries for transient failures (network
 * errors, timeouts, 429 and 5xx). Returns { status, headers, text }.
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string,string>, body?: string, timeoutMs?: number, maxBytes?: number,
 *           retries?: number, backoffMs?: number, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<any> }} [opts]
 */
export async function fetchText(url, { method = "GET", headers = {}, body, timeoutMs = 15000, maxBytes = 2_000_000, retries = 0, backoffMs = 1500, fetchImpl = globalThis.fetch, sleep = sleepReal } = {}) {
  /** @type {any} */
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(backoffMs * 2 ** (attempt - 1));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { method, headers, body, signal: ctl.signal });
      const text = await readCapped(res, maxBytes);
      if (res.ok) return { status: res.status, headers: res.headers, text };
      const transient = res.status === 429 || res.status >= 500;
      last = new HttpError(`${new URL(url).host} answered ${res.status}`, { status: res.status, transient, url });
      if (!transient) throw last;
    } catch (e) {
      if (e instanceof HttpError && !e.transient) throw e;
      last = e instanceof HttpError ? e : new HttpError(ctl.signal.aborted ? `${new URL(url).host} did not answer within ${Math.round(timeoutMs / 1000)} s` : `Could not reach ${new URL(url).host}: ${e?.message || e}`, { transient: true, url });
    } finally {
      clearTimeout(timer);
    }
  }
  throw last;
}

/** Read a response body as text, refusing more than maxBytes. */
async function readCapped(res, maxBytes) {
  const len = Number(res.headers?.get?.("content-length"));
  if (Number.isFinite(len) && len > maxBytes) throw new HttpError(`The response is larger than ${maxBytes} bytes`, { status: res.status });
  if (!res.body?.getReader) return (await res.text()).slice(0, maxBytes);
  const reader = res.body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new HttpError(`The response is larger than ${maxBytes} bytes`, { status: res.status });
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** fetchText, parsed as JSON. */
export async function fetchJson(url, opts = {}) {
  const r = await fetchText(url, opts);
  try {
    return JSON.parse(r.text);
  } catch {
    throw new HttpError(`${new URL(url).host} did not send JSON`, { status: r.status, url });
  }
}

/**
 * Run tasks one at a time with at least minGapMs between starts (Nominatim's policy is
 * one request a second).
 * @param {number} minGapMs
 * @param {{ now?: () => number, sleep?: (ms: number) => Promise<any> }} [clock]
 */
export function throttle(minGapMs, { now = Date.now, sleep = sleepReal } = {}) {
  let chain = Promise.resolve();
  let lastStart = -Infinity;
  /** @template T @param {() => Promise<T>} task @returns {Promise<T>} */
  return (task) => {
    const run = chain.then(async () => {
      const wait = lastStart + minGapMs - now();
      if (wait > 0) await sleep(wait);
      lastStart = now();
      return task();
    });
    chain = run.then(() => {}, () => {});
    return run;
  };
}

/**
 * A small in-memory cache with a time to live and a size cap (oldest entries go first).
 * @param {{ max?: number, now?: () => number }} [opts]
 * @returns {Cache}
 */
export function memoryCache({ max = 2000, now = Date.now } = {}) {
  /** @type {Map<string, { value: any, until: number }>} */
  const m = new Map();
  return {
    async get(key) {
      const e = m.get(key);
      if (!e) return undefined;
      if (e.until <= now()) {
        m.delete(key);
        return undefined;
      }
      return e.value;
    },
    async set(key, value, ttlMs) {
      m.delete(key);
      m.set(key, { value, until: now() + ttlMs });
      while (m.size > max) m.delete(/** @type {string} */ (m.keys().next().value));
    },
  };
}

/**
 * A cache kept in the store's "cache" collection, so geocodes and place lists survive a
 * restart (the free Render service restarts often).
 * @param {import("./store.mjs").Store} store
 * @param {{ now?: () => number }} [opts]
 * @returns {Cache}
 */
export function storeCache(store, { now = Date.now } = {}) {
  return {
    async get(key) {
      const doc = await store.get("cache", key);
      if (!doc || Date.parse(doc.expiresAt) <= now()) return undefined;
      return doc.value;
    },
    async set(key, value, ttlMs) {
      await store.put("cache", { id: key, value, expiresAt: new Date(now() + ttlMs).toISOString() });
    },
  };
}

/** Memory in front of a slower cache. @param {Cache} fast @param {Cache} slow @returns {Cache} */
export function layeredCache(fast, slow) {
  return {
    async get(key) {
      const v = await fast.get(key);
      if (v !== undefined) return v;
      const s = await slow.get(key).catch(() => undefined);
      if (s !== undefined) await fast.set(key, s, 10 * 60_000);
      return s;
    },
    async set(key, value, ttlMs) {
      await fast.set(key, value, ttlMs);
      await slow.set(key, value, ttlMs).catch(() => {});
    },
  };
}

/**
 * Get from the cache or compute and store. Concurrent calls for the same key share one
 * computation.
 * @template T
 * @param {Cache} cache
 * @param {string} key
 * @param {number} ttlMs
 * @param {() => Promise<T>} compute
 * @returns {Promise<T>}
 */
export async function cached(cache, key, ttlMs, compute) {
  const hit = await cache.get(key);
  if (hit !== undefined) return hit;
  let pending = inflight.get(cache);
  if (!pending) inflight.set(cache, (pending = new Map()));
  const flights = pending;
  let p = flights.get(key);
  if (!p) {
    p = compute().then(async (v) => {
      await cache.set(key, v, ttlMs);
      return v;
    });
    flights.set(key, p);
    p.finally(() => flights.delete(key)).catch(() => {});
  }
  return p;
}
/** @type {WeakMap<Cache, Map<string, Promise<any>>>} */
const inflight = new WeakMap();
