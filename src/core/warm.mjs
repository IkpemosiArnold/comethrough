// @ts-check
// The awake window (docs/DEPLOY.md, "Staying awake"): pure rules, no clock. Render's free web
// service sleeps after 15 minutes without inbound traffic and takes about a minute to wake,
// and its 750 free instance hours a month are shared by every free service in the workspace.
// So the server keeps itself awake only while it is useful, and never past a monthly cap:
//   - for 3 hours after something happens (a crew made, a plan made, edited or shared, an
//     answer, a join): friends tap the link in the group chat soon after;
//   - from 2 hours before to 1 hour after each coming plan's start, when people check where
//     and when, and ask for rides.
// The runner (src/app/warm.mjs) asks its own public address for /healthz every 10 to 12
// minutes while one of these holds, and stops when none does or the month's cap is reached.

import { parseInstant } from "./time.mjs";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export const WARM = {
  /** how long an activity keeps the server awake */
  extendMs: 3 * HOUR,
  /** a plan's window: from 2 hours before its start to 1 hour after */
  beforeMs: 2 * HOUR,
  afterMs: 1 * HOUR,
  /** a self-ping every 10 to 12 minutes (Render sleeps after 15) */
  pingMinMs: 10 * MINUTE,
  pingMaxMs: 12 * MINUTE,
  /** Render keeps an instance up this long after its last request; counted with each warm stretch */
  tailMs: 15 * MINUTE,
  /** the default monthly cap on warm hours (WARM_CAP_HOURS) */
  capHours: 150,
};

/** "2026-10" for an instant: Render counts instance hours per calendar month (UTC). */
export const monthKey = (/** @type {number} */ t) => new Date(t).toISOString().slice(0, 7);

/**
 * Each coming plan's window, merged where they overlap, as ms: [{ from, to }], oldest first.
 * Cancelled plans and plans whose window is over are left out; so are windows that open after
 * the horizon.
 * @param {{ start?: string|null, status?: string }[]} plans
 * @param {number} now
 * @param {{ beforeMs?: number, afterMs?: number, horizonMs?: number }} [opts]
 */
export function planWindows(plans, now, { beforeMs = WARM.beforeMs, afterMs = WARM.afterMs, horizonMs = 48 * HOUR } = {}) {
  /** @type {{ from: number, to: number }[]} */
  const raw = [];
  for (const p of plans || []) {
    if (!p || p.status === "cancelled") continue;
    const start = parseInstant(p.start ?? "");
    if (!Number.isFinite(start)) continue;
    const w = { from: start - beforeMs, to: start + afterMs };
    if (w.to <= now || w.from > now + horizonMs) continue;
    raw.push(w);
  }
  raw.sort((a, b) => a.from - b.from);
  /** @type {{ from: number, to: number }[]} */
  const out = [];
  for (const w of raw) {
    const last = out.at(-1);
    if (last && w.from <= last.to) last.to = Math.max(last.to, w.to);
    else out.push({ ...w });
  }
  return out;
}

/**
 * Until when the server should stay awake, and why: an activity's 3 hours, a plan's window,
 * or nothing (null).
 * @param {{ now: number, warmUntil: number, windows: { from: number, to: number }[] }} p
 * @returns {{ until: number|null, why: "activity"|"plan"|null }}
 */
export function warmTarget({ now, warmUntil, windows }) {
  let until = null;
  /** @type {"activity"|"plan"|null} */
  let why = null;
  if (Number.isFinite(warmUntil) && warmUntil > now) {
    until = warmUntil;
    why = "activity";
  }
  for (const w of windows || []) {
    if (w.from <= now && now < w.to && (until == null || w.to > until)) {
      until = w.to;
      why = "plan";
    }
  }
  return { until, why };
}

/**
 * What the runner does now: ping (stay awake), stop (nothing needs it), or cap (the month's
 * warm hours are used up).
 * @param {{ now: number, until: number|null, monthMs: number, capMs: number }} p
 * @returns {"ping"|"stop"|"cap"}
 */
export function warmStep({ now, until, monthMs, capMs }) {
  if (until == null || until <= now) return "stop";
  if (monthMs >= capMs) return "cap";
  return "ping";
}

/**
 * The next activity deadline: now plus 3 hours, never earlier than one already set.
 * @param {number} warmUntil
 * @param {number} now
 * @param {number} [extendMs]
 */
export const extended = (warmUntil, now, extendMs = WARM.extendMs) => Math.max(Number.isFinite(warmUntil) ? warmUntil : 0, now + extendMs);

/** The wait before the next ping: 10 to 12 minutes, from a number in [0, 1). */
export const pingDelay = (/** @type {number} */ r) => Math.round(WARM.pingMinMs + Math.min(Math.max(r, 0), 0.999) * (WARM.pingMaxMs - WARM.pingMinMs));
