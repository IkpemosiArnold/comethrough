// @ts-check
// Two lanes for every call to an outside service, so nobody waits behind the sloth.
//
//   user        someone is looking at a spinner: setting up a crew, reading or posting a
//               plan, an RSVP, the area type-ahead. The default.
//   background  nobody is waiting on it right now: the heartbeat (rituals, weather
//               watches), the sloth's first pick, the ideas card and the weekly guides.
//
// Background work runs inside inBackground(...), and AsyncLocalStorage carries the lane
// through every await below it, so the adapters only ask currentLane(). Each service that
// queues (Photon, Nominatim and OSRM, which ask for a gap between requests; Gemma, whose
// free tier has a small quota) gets a laneGate: per-lane concurrency, so a busy background
// lane never takes the user lane's slots; the shared gap a service's usage policy asks for;
// the user lane always served first when both are waiting; and an optional per-minute cap
// on a lane, so the background cannot spend the whole Gemma quota.
//
// Before 22 Oct 2026, Photon, Nominatim and OSRM each had one first-come-first-served queue
// shared by everyone, and background Gemma calls had no cap, so a busy background (the
// guides' venue lookups, two long guide reads at once) could hold a plan back. A link plan
// once took about 48 s while the ideas card read the guides (docs/NOTES.md, "Speed").

import { AsyncLocalStorage } from "node:async_hooks";

/** @typedef {"user"|"background"} Lane */
/** @type {Lane[]} */
export const LANES = ["user", "background"];

/** @type {AsyncLocalStorage<Lane>} */
const als = new AsyncLocalStorage();

/** The lane the current work runs in ("user" unless inside inBackground). */
export const currentLane = () => /** @type {Lane} */ (als.getStore() ?? "user");

/**
 * Run fn in a lane: every call it makes to an outside service queues in that lane.
 * @template T @param {Lane} lane @param {() => T} fn @returns {T}
 */
export const inLane = (lane, fn) => als.run(lane, fn);

/** @template T @param {() => T} fn @returns {T} */
export const inBackground = (fn) => als.run("background", fn);

/**
 * @typedef {object} GateOpts
 * @property {Partial<Record<Lane, number>>} [concurrency]  tasks running at once per lane (default user 2, background 1)
 * @property {number} [minGapMs]        at least this long between any two starts, across lanes (a service's rate rule)
 * @property {Partial<Record<Lane, number>>} [perMinute]  at most this many starts a minute in a lane
 * @property {number} [windowMs]        the "minute" of perMinute (tests shorten it)
 * @property {string} [name]            for the wait log
 * @property {(e: { gate: string, lane: Lane, waitMs: number, queued: number }) => void} [onWait]  called when a task waited 100 ms or more
 * @property {() => number} [now]
 */

/**
 * A two-lane gate. `gate(task)` runs the task in the current lane's queue; `gate(task, lane)`
 * names the lane.
 * @param {GateOpts} [opts]
 */
export function laneGate({ concurrency = {}, minGapMs = 0, perMinute = {}, windowMs = 60_000, name = "gate", onWait, now = Date.now } = {}) {
  const limit = { user: concurrency.user ?? 2, background: concurrency.background ?? 1 };
  /** @type {Record<Lane, { task: () => Promise<any>, resolve: (v: any) => void, reject: (e: any) => void, at: number }[]>} */
  const queues = { user: [], background: [] };
  const active = { user: 0, background: 0 };
  /** @type {Record<Lane, number[]>} */
  const started = { user: [], background: [] };
  let lastStart = -Infinity;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let timer = null;
  let timerAt = Infinity;

  /** Pump again in ms (the earliest of the asked times wins). */
  function later(/** @type {number} */ ms) {
    const at = now() + Math.max(1, ms);
    if (timer && timerAt <= at) return;
    if (timer) clearTimeout(timer);
    timerAt = at;
    timer = setTimeout(() => {
      timer = null;
      timerAt = Infinity;
      pump();
    }, Math.max(1, ms));
  }

  function pump() {
    for (;;) {
      const t = now();
      /** @type {Lane|null} */
      let pick = null;
      for (const lane of LANES) {
        if (!queues[lane].length || active[lane] >= limit[lane]) continue;
        const cap = perMinute[lane];
        if (cap) {
          while (started[lane].length && started[lane][0] <= t - windowMs) started[lane].shift();
          if (started[lane].length >= cap) {
            later(started[lane][0] + windowMs - t);
            continue;
          }
        }
        pick = lane;
        break;
      }
      if (!pick) return;
      const gap = lastStart + minGapMs - t;
      if (gap > 0) {
        // the gap is shared: whichever lane is first when it ends goes next (the user lane)
        later(gap);
        return;
      }
      const job = /** @type {(typeof queues)["user"][number]} */ (queues[pick].shift());
      active[pick]++;
      lastStart = t;
      if (perMinute[pick]) started[pick].push(t);
      const waited = t - job.at;
      if (onWait && waited >= 100) onWait({ gate: name, lane: pick, waitMs: waited, queued: queues[pick].length });
      const lane = pick;
      Promise.resolve()
        .then(job.task)
        .then(job.resolve, job.reject)
        .finally(() => {
          active[lane]--;
          pump();
        });
    }
  }

  /**
   * @template T
   * @param {() => Promise<T>} task
   * @param {Lane} [lane]
   * @returns {Promise<T>}
   */
  function gate(task, lane = currentLane()) {
    return new Promise((resolve, reject) => {
      queues[lane].push({ task, resolve, reject, at: now() });
      pump();
    });
  }
  gate.stats = () => ({ queued: { user: queues.user.length, background: queues.background.length }, active: { ...active } });
  return gate;
}

/**
 * The LLM port behind a lane gate: user calls (a crew sentence, a plan) never wait for the
 * background's (the first pick's explanation and invite, the guides, the ideas ranking).
 * The free Gemma quota is small (about 15 requests a minute, unpublished), so the background
 * lane runs one call at a time and starts at most `backgroundPerMinute` a minute.
 * @template {{ generate: (req: any) => Promise<any> }} P
 * @param {P} ai
 * @param {{ user?: number, background?: number, backgroundPerMinute?: number, windowMs?: number, onWait?: GateOpts["onWait"] }} [opts]
 * @returns {P}
 */
export function laneAi(ai, { user = 4, background = 1, backgroundPerMinute = 6, windowMs, onWait } = {}) {
  const gate = laneGate({ name: "gemma", concurrency: { user, background }, perMinute: { background: backgroundPerMinute }, windowMs, onWait });
  return { ...ai, generate: (/** @type {any} */ req) => gate(() => ai.generate(req)) };
}

/**
 * Resolve with the work's answer, or with `fallback` once ms have passed (the work goes on
 * and may still fill a cache). The timer is cleared as soon as the work answers.
 * @template T, F
 * @param {Promise<T>} work
 * @param {number} ms
 * @param {F} fallback
 * @returns {Promise<T|F>}
 */
export function within(work, ms, fallback) {
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let t;
  const timeout = new Promise((r) => {
    t = setTimeout(() => r(fallback), ms);
  });
  return Promise.race([work, /** @type {Promise<F>} */ (timeout)]).finally(() => clearTimeout(t));
}
