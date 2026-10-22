// @ts-check
// Timing logs for the slow flows (creating a crew, the first pick, reading and posting a
// plan, the ideas card). Off by default; TIMING=1 turns them on. Each flow logs one
// `timing` line when it ends: its total, and how long each stage took (stages that run at
// the same time each keep their own duration, so they can add up to more than the total).
// Never logs input text or tokens: only stage names and milliseconds.

/** @typedef {(event: string, fields?: Record<string, any>) => void} Log */

/**
 * @typedef {object} Stopwatch
 * @property {<T>(stage: string, work: Promise<T>|(() => Promise<T>)) => Promise<T>} time  await something and record how long it took
 * @property {(stage: string) => void} lap      record the time since the last lap (or the start)
 * @property {(fields?: Record<string, any>) => void} end  log the flow (once)
 */

/** A stopwatch that records nothing, for when timing is off. @type {Stopwatch} */
const OFF = {
  time: (_stage, work) => (typeof work === "function" ? work() : work),
  lap: () => {},
  end: () => {},
};

/**
 * A stopwatch for one flow.
 * @param {string} flow
 * @param {{ on: boolean, log: Log, clock?: () => number }} opts
 * @returns {Stopwatch}
 */
export function stopwatch(flow, { on, log, clock = () => performance.now() }) {
  if (!on) return OFF;
  const t0 = clock();
  let last = t0;
  /** @type {Record<string, number>} */
  const stages = {};
  let ended = false;
  const put = (/** @type {string} */ stage, /** @type {number} */ ms) => {
    stages[stage] = Math.round((stages[stage] || 0) + ms);
  };
  return {
    async time(stage, work) {
      const s = clock();
      try {
        return await (typeof work === "function" ? work() : work);
      } finally {
        put(stage, clock() - s);
        last = clock();
      }
    },
    lap(stage) {
      const t = clock();
      put(stage, t - last);
      last = t;
    },
    end(fields = {}) {
      if (ended) return;
      ended = true;
      log("timing", { flow, ms: Math.round(clock() - t0), stages, ...fields });
    },
  };
}
