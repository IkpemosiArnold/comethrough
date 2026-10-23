// @ts-check
// The sloth's first pick as a background job: its state, kept on the crew, and the rules
// for when to run it. Pure: the caller passes the time and says whether it is running.
//
// A crew with a regular day is made with `firstPick: { status: "pending" }`, and the pick
// starts right after the answer is sent, so making the crew takes only as long as reading
// the sentence. The pick (places, the weather, routes, Gemma's explanation and invite) takes
// from a few seconds to most of a minute, and the free Render instance sleeps and restarts,
// so the job must survive being cut off:
//
//   pending  not started, or running (attempts counts the starts)
//   ready    done: planId is the plan, or null when there is nothing to pick (the crew
//            already has a plan in that slot, or no regular day)
//   failed   this attempt found nothing (no places answered, no area on the map, an error);
//            tried again after a backoff, by the heartbeat or the next person who asks
//
// It is idempotent: the plan's id comes from the crew and the date, and a pick that finds
// the plan already made is "ready" with that plan. A pending job whose start is older than
// STALE_MS and is not running in this process was cut off by a restart, and runs again.

/** @typedef {{ status: "pending"|"ready"|"failed", planId?: string|null, reason?: string|null, attempts: number, startedAt?: string|null, updatedAt: string, nextTryAt?: string|null, claim?: string|null }} FirstPick */

export const FIRST_PICK = Object.freeze({
  /** starts before giving up (the heartbeat's own ritual still comes 3 days ahead) */
  maxAttempts: 4,
  /** waits after the 1st, 2nd and 3rd failed attempt */
  backoffMs: Object.freeze([60_000, 15 * 60_000, 3 * 3_600_000]),
  /** a pending start older than this, not running here, was cut off by a restart */
  staleMs: 3 * 60_000,
});

/** Reasons that mean "nothing to pick", not "try again". */
const SETTLED = new Set(["no_rhythm", "busy", "not_yet", "exists"]);

const iso = (/** @type {number} */ ms) => new Date(ms).toISOString();

/** A new crew's job: pending, never started. @param {number} now @returns {FirstPick} */
export function pendingPick(now) {
  return { status: "pending", planId: null, reason: null, attempts: 0, startedAt: null, updatedAt: iso(now), nextTryAt: null };
}

/**
 * Whether the job should start now.
 * @param {FirstPick|null|undefined} s
 * @param {number} now
 * @param {{ running: boolean }} here  whether it is running in this process
 */
export function shouldRun(s, now, { running }) {
  if (!s || running || s.status === "ready") return false;
  if (s.attempts >= FIRST_PICK.maxAttempts) return false;
  if (s.status === "pending") return s.attempts === 0 || !s.startedAt || now - Date.parse(s.startedAt) >= FIRST_PICK.staleMs;
  return !s.nextTryAt || now >= Date.parse(s.nextTryAt);
}

/** The job starting. @param {FirstPick|null|undefined} s @param {number} now @returns {FirstPick} */
export function beginPick(s, now) {
  const base = s ?? pendingPick(now);
  return { ...base, status: "pending", attempts: (base.attempts || 0) + 1, startedAt: iso(now), updatedAt: iso(now), nextTryAt: null };
}

/**
 * The job ending: a plan, a settled "nothing to pick", or a failure to try again later.
 * @param {FirstPick} s  the state beginPick returned
 * @param {{ planId?: string|null, reason: string }} outcome
 * @param {number} now
 * @returns {FirstPick}
 */
export function finishPick(s, outcome, now) {
  const at = iso(now);
  if (outcome.planId) return { ...s, status: "ready", planId: outcome.planId, reason: outcome.reason, updatedAt: at, nextTryAt: null };
  if (SETTLED.has(outcome.reason)) return { ...s, status: "ready", planId: null, reason: outcome.reason, updatedAt: at, nextTryAt: null };
  const wait = FIRST_PICK.backoffMs[Math.min(s.attempts, FIRST_PICK.backoffMs.length) - 1] ?? FIRST_PICK.backoffMs[0];
  return { ...s, status: "failed", planId: null, reason: outcome.reason || "error", updatedAt: at, nextTryAt: s.attempts < FIRST_PICK.maxAttempts ? iso(now + wait) : null };
}

/** What the web app sees. @param {FirstPick|null|undefined} s */
export function pickView(s) {
  return s ? { status: s.status, planId: s.planId ?? null } : null;
}
