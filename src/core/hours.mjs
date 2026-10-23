// @ts-check
// When a crew meets, and when places are open. Pure.
//
// A crew's own stated time wins (Arnold, 23 Oct 2026): when the crew said when it meets
// ("Saturday mornings around 7am", "a 10pm night crew", "2-6pm"), the ritual and the ideas
// are planned inside that window. The city pack's social hours (weekends 11:00 to 18:30 in
// Lagos, and so on) apply only when the crew gave no time. The safety and weather rules stay:
//   - outdoor plans in a stated window keep to daylight, by the forecast's own is_day (from
//     Open-Meteo's sunrise and sunset, never a guess); a crew with a safety need gets no
//     outdoor pick in the dark, and when the forecast does not say where daylight is, it
//     keeps to the pack's outdoor social hours, which end before dark by design;
//   - rain is handled as before (src/core/weather.mjs, ritualWindow);
//   - a place whose OpenStreetMap opening_hours say it is closed is never offered, and in a
//     stated window outside the usual hours (7 am, 10 pm) a roofed place is offered only when
//     its hours say it is open: an outdoor spot (a park) is fine at that hour, weather allowing.

import { minutesOfDay, hhmm, weekdayOf } from "./time.mjs";

/** @typedef {{ from: string, to: string }} TimeWindow */
/** @typedef {import("./weather.mjs").SocialHours} SocialHours */

/** The default window a rhythm gets when no time was given (src/core/tasks.mjs, DEFAULT_WINDOW). */
const DEFAULT_FROM = "15:00";
const DEFAULT_TO = "19:00";

/**
 * Whether a crew said when it meets. `rhythm.said` when it is recorded (readCrewSetup sets
 * it); for a crew made before it was, any window other than the default 3 pm to 7 pm.
 * @param {{ window?: TimeWindow|null, said?: boolean }|null|undefined} rhythm
 */
export function timeSaid(rhythm) {
  if (!rhythm?.window) return false;
  if (typeof rhythm.said === "boolean") return rhythm.said;
  return !(rhythm.window.from === DEFAULT_FROM && rhythm.window.to === DEFAULT_TO);
}

/**
 * The hours a crew's plans may take: its own window for every kind of plan when it said
 * when it meets, else the pack's social hours.
 * @param {SocialHours} social
 * @param {TimeWindow|null|undefined} window
 * @param {boolean} stated
 * @returns {SocialHours}
 */
export function crewHours(social, window, stated) {
  if (!stated || !window) return social;
  const w = { from: window.from, to: window.to };
  return { weekendOutdoor: w, weekendCovered: w, weekdayOutdoor: w, weekdayEvening: w };
}

/** Needs that keep a crew out of the dark outdoors. */
export const DAYLIGHT_NEEDS = Object.freeze(["safe", "women-friendly", "kid-friendly", "daytime"]);

/** True when a crew's needs keep it out of the dark outdoors. @param {{ needs?: string[] }|null|undefined} taste */
export function needsDaylight(taste) {
  return !!taste?.needs?.some((n) => DAYLIGHT_NEEDS.includes(n));
}

/**
 * The part of a window in daylight on a date, by the forecast's is_day (an hour is light
 * when it starts in daylight). Null when less than an hour of it is light; undefined when the
 * forecast says nothing about daylight that day.
 * @param {{ date: string, time: string, isDay?: 0|1 }[]|null|undefined} hours
 * @param {string} date
 * @param {TimeWindow} window
 * @returns {TimeWindow|null|undefined}
 */
export function daylightPart(hours, date, window) {
  const day = (hours || []).filter((h) => h.date === date && (h.isDay === 0 || h.isDay === 1));
  if (!day.length) return undefined;
  const light = day.filter((h) => h.isDay === 1).map((h) => minutesOfDay(h.time));
  if (!light.length) return null;
  const lo = Math.max(minutesOfDay(window.from), Math.min(...light));
  const hi = Math.min(minutesOfDay(window.to), Math.max(...light) + 60);
  return hi - lo >= 60 ? { from: hhmm(lo), to: hhmm(hi) } : null;
}

/**
 * An outdoor window in a stated time, kept to daylight: the forecast's light part of it;
 * when the forecast does not say, the window as it is, or for a crew with a safety need the
 * part inside the pack's own outdoor hours (they end before dark). Null when none is left.
 * @param {TimeWindow} window
 * @param {{ hours: any[]|null, date: string, daylight: boolean, usual: TimeWindow }} ctx  usual: the pack's outdoor social window that day
 * @returns {TimeWindow|null}
 */
export function outdoorInLight(window, { hours, date, daylight, usual }) {
  const lit = daylightPart(hours, date, window);
  if (lit !== undefined) return lit;
  if (!daylight) return window;
  const lo = Math.max(minutesOfDay(window.from), minutesOfDay(usual.from));
  const hi = Math.min(minutesOfDay(window.to), minutesOfDay(usual.to));
  return hi - lo >= 60 ? { from: hhmm(lo), to: hhmm(hi) } : null;
}

/** True when a window lies inside another. @param {TimeWindow} w @param {TimeWindow} inside */
export function within(w, inside) {
  return minutesOfDay(w.from) >= minutesOfDay(inside.from) && minutesOfDay(w.to) <= minutesOfDay(inside.to);
}

const DAYS = ["su", "mo", "tu", "we", "th", "fr", "sa"];

/**
 * The open intervals (minutes from midnight; an end past midnight runs on) an OpenStreetMap
 * opening_hours value gives for a weekday, or null when it cannot be read with confidence.
 * Reads the common forms: "24/7", "Mo-Fr 08:00-18:00; Sa 09:00-14:00", "Mo,We 10:00-14:00",
 * "10:00-22:00", "Su off", several times "08:00-12:00,13:00-17:00", and a later rule for the
 * same day replacing an earlier one. Anything else (months, dates, sunrise, holidays only,
 * "||") is not guessed at.
 * @param {string} spec
 * @param {number} weekday  0 Sunday to 6 Saturday
 * @returns {[number, number][]|null}
 */
export function openIntervals(spec, weekday) {
  const s = String(spec ?? "").trim().toLowerCase();
  if (!s || s.includes("||")) return null;
  if (s === "24/7") return [[0, 24 * 60]];
  /** @type {[number, number][]|null} */
  let today = [];
  let ruled = false;
  for (const raw of s.split(";").map((x) => x.trim()).filter(Boolean)) {
    if (/^ph\b/.test(raw)) continue; // public holidays: not this rule
    const m = raw.match(/^((?:(?:mo|tu|we|th|fr|sa|su)(?:\s*-\s*(?:mo|tu|we|th|fr|sa|su))?\s*,?\s*)+)?\s*(.*)$/);
    if (!m) return null;
    const daysPart = (m[1] || "").replace(/\s+/g, "");
    const rest = m[2].trim().replace(/^:\s*/, "");
    /** @type {Set<number>} */
    const days = new Set();
    if (!daysPart) for (let i = 0; i < 7; i++) days.add(i);
    else {
      for (const piece of daysPart.split(",").filter(Boolean)) {
        const [a, b] = piece.split("-");
        const ia = DAYS.indexOf(a);
        const ib = b ? DAYS.indexOf(b) : ia;
        if (ia < 0 || ib < 0) return null;
        for (let i = ia; ; i = (i + 1) % 7) {
          days.add(i);
          if (i === ib) break;
        }
      }
    }
    /** @type {[number, number][]} */
    let spans = [];
    if (rest === "off" || rest === "closed") spans = [];
    else if (rest === "24/7" || rest === "00:00-24:00") spans = [[0, 24 * 60]];
    else {
      for (const t of rest.split(",").map((x) => x.trim())) {
        const tm = t.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\+?$/);
        if (!tm) return null;
        const a = Number(tm[1]) * 60 + Number(tm[2]);
        let b = Number(tm[3]) * 60 + Number(tm[4]);
        if (a > 24 * 60 || b > 48 * 60) return null;
        if (b <= a) b += 24 * 60;
        spans.push([a, b]);
      }
    }
    if (days.has(weekday)) {
      today = spans;
      ruled = true;
    }
  }
  return ruled ? today : [];
}

/**
 * Whether a place is open for a whole window on a date: true, false, or null when its hours
 * are not known or cannot be read.
 * @param {string|null|undefined} spec  the opening_hours tag
 * @param {string} date
 * @param {TimeWindow} window
 */
export function openDuring(spec, date, window) {
  if (!spec) return null;
  const spans = openIntervals(spec, weekdayOf(date));
  if (!spans) return null;
  const from = minutesOfDay(window.from);
  const to = minutesOfDay(window.to);
  return spans.some(([a, b]) => a <= from && b >= to);
}

/**
 * Whether a place may be offered for a window: never when its hours say it is closed; when
 * its hours are unknown, only when the window is inside the usual hours or the place is out
 * in the open (a park needs no opening time at 7 am).
 * @param {{ tags: Record<string, string>, outdoor: boolean }} place
 * @param {string} date
 * @param {TimeWindow} window
 * @param {{ usual: boolean }} ctx  usual: the window is inside the pack's social hours
 */
export function mayOffer(place, date, window, { usual }) {
  const open = openDuring(place.tags?.opening_hours, date, window);
  if (open === false) return false;
  if (open === true) return true;
  return usual || place.outdoor;
}
