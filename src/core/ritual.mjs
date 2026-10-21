// @ts-check
// The ritual: when a crew has a rhythm ("every other Saturday, somewhere outside") and
// nothing is planned around the next slot, Come Through makes a plan 2 to 3 days ahead.
//
// ritualDue decides whether that is now and for which date. It is idempotent by design,
// because the heartbeat (a GitHub Actions schedule) can run late, twice or not at all:
// - a slot is a date; a ritual plan records it in ritualFor, and a slot that has one is done;
// - the crew is left alone when it already has this cycle's meetup: a live plan in the
//   slot's own hours (a brunch that ends before the 3 pm window does not count), or an
//   outdoor plan within half a cycle of the slot (1w: 3 days either side; 2w: a week; 4w:
//   two weeks). The rhythm is about getting outside together, so an indoor wine night on
//   the Friday does not cancel Saturday in the park, but a beach day on the Sunday does;
// - the lead is 3 days down to 1 day: normally the plan appears 3 days ahead, and if the
//   heartbeat missed those runs it still appears the day before, never on the day.

import { DEFAULT_TZ, DAY_NAMES, addDays, daysBetween, localParts, parseInstant, weekdayOf, isDate, zonedToMs, toIsoLocal } from "./time.mjs";

/** @typedef {import("./types.mjs").Rhythm} Rhythm */
/** @typedef {import("./types.mjs").Plan} Plan */

export const PERIOD_DAYS = { "1w": 7, "2w": 14, "4w": 28 };
export const LEAD = { min: 1, max: 3 };

/**
 * The first rhythm slot on or after `from`.
 * @param {Rhythm} rhythm
 * @param {string} from      "YYYY-MM-DD"
 * @param {string} anchor    "YYYY-MM-DD": slots for 2w and 4w are counted from the first rhythm day on or after it
 */
export function nextSlot(rhythm, from, anchor) {
  const period = PERIOD_DAYS[/** @type {keyof typeof PERIOD_DAYS} */ (rhythm.every)];
  if (!period) return null;
  const first = addDays(anchor, (rhythm.day - weekdayOf(anchor) + 7) % 7);
  const ahead = (rhythm.day - weekdayOf(from) + 7) % 7;
  let d = addDays(from, ahead);
  // step whole weeks until d is on the cycle (at most period/7 - 1 steps)
  for (let i = 0; i < 4 && ((daysBetween(first, d) % period) + period) % period !== 0; i++) d = addDays(d, 7);
  return d;
}

/**
 * Whether a ritual is due now, and for which date.
 * @param {object} input
 * @param {{ id: string, rhythm: Rhythm|null, createdAt: string, tz?: string }} input.crew
 * @param {number} input.now
 * @param {Plan[]} input.plans   the crew's plans
 * @param {{ min: number, max: number }} [input.lead]
 * @returns {{ due: boolean, reason: "no_rhythm"|"not_yet"|"exists"|"busy"|"quiet", date?: string, leadDays?: number, window?: { from: string, to: string }, blockers?: string[] }}
 */
export function ritualDue({ crew, now, plans, lead = LEAD }) {
  const r = crew.rhythm;
  if (!r || !r.every || !PERIOD_DAYS[r.every]) return { due: false, reason: "no_rhythm" };
  const tz = crew.tz || DEFAULT_TZ;
  const today = localParts(now, tz).date;
  const anchor = r.anchor && isDate(r.anchor) ? r.anchor : localParts(Date.parse(crew.createdAt), tz).date;
  // the slot we act on: the next one at least lead.min days away
  const date = /** @type {string} */ (nextSlot(r, addDays(today, lead.min), anchor));
  const leadDays = daysBetween(today, date);
  if (leadDays > lead.max) return { due: false, reason: "not_yet", date, leadDays };
  const mine = plans.filter((p) => p.crewId === crew.id);
  if (mine.some((p) => p.ritualFor === date)) return { due: false, reason: "exists", date, leadDays };
  const half = Math.floor(PERIOD_DAYS[r.every] / 2);
  const blockers = mine
    .filter((p) => p.status !== "cancelled")
    .filter((p) => {
      const d = localParts(parseInstant(p.start), tz).date;
      const winFrom = zonedToMs(date, r.window?.from || "15:00", tz);
      const winTo = zonedToMs(date, r.window?.to || "19:00", tz);
      if (parseInstant(p.start) < winTo && parseInstant(p.end) > winFrom) return true;
      const gap = daysBetween(date, d);
      return !!p.place?.outdoor && gap >= -half && gap < PERIOD_DAYS[r.every] - half;
    })
    .map((p) => p.id);
  if (blockers.length) return { due: false, reason: "busy", date, leadDays, blockers };
  return { due: true, reason: "quiet", date, leadDays, window: r.window };
}

/**
 * The plan draft for a ritual once a place and a time are chosen. The invite and the
 * explanation are added by the caller (Gemma writes them; a plain fallback exists).
 * @param {object} input
 * @param {string} input.date
 * @param {{ from: string, to: string }} input.window  the chosen hours, local
 * @param {{ name: string, lat: number, lon: number, address?: string, osm?: any }} input.place
 * @param {string} [input.tz]
 */
export function ritualDraft({ date, window, place, tz = DEFAULT_TZ }) {
  return {
    kind: "ritual",
    title: `${DAY_NAMES[weekdayOf(date)]} at ${place.name}`,
    start: toIsoLocal(zonedToMs(date, window.from, tz), tz),
    end: toIsoLocal(zonedToMs(date, window.to, tz), tz),
    tz,
    place: { name: place.name, address: place.address || null, lat: place.lat, lon: place.lon, osm: place.osm, outdoor: true, private: false },
    price: null,
    host: null,
    hostName: null,
    bring: [],
    source: {},
    confidence: {},
  };
}

/** A plain invite for when Gemma is unavailable. No dashes. */
export function fallbackInvite({ title, window, weatherText }) {
  return `${title}, ${window.from} to ${window.to}. ${weatherText ? `${weatherText} ` : ""}Come through if you can. No need to reply.`;
}
