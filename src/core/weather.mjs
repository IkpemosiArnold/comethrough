// @ts-check
// Weather windows from hourly forecasts (Open-Meteo's shape, requested in the plan's zone so
// hour labels are local). Pure: the adapter fetches, this decides.
//
// An outdoor hour in Lagos is spoiled by rain first, then by heat (the apparent
// temperature, which counts humidity, often passes 35 C at midday) and then by strong sun.
// The best window is the stretch with the least of each, in that order of weight.

import { DAY_NAMES, DEFAULT_TZ, addDays, localParts, minutesOfDay, hhmm, parseInstant, weekdayOf } from "./time.mjs";

/**
 * @typedef {object} Hour
 * @property {string} date      "YYYY-MM-DD" local
 * @property {string} time      "HH:00" local
 * @property {number|null} rainProb  0..100
 * @property {number|null} feelsC    apparent temperature
 * @property {number|null} uv
 * @property {number|null} precipMm
 */

/** Thresholds: a window is "ok" outdoors below RAIN_OK % and FEELS_OK C. */
export const RAIN_OK = 40;
export const FEELS_OK = 38;
const COMFORT_C = 30; // above this, each degree costs
const UV_OK = 6;

/**
 * Open-Meteo's hourly arrays to a list of hours. Missing values become null.
 * @param {any} json  the API response (hourly.time, precipitation_probability, apparent_temperature, uv_index, precipitation)
 * @returns {Hour[]}
 */
export function hoursFromOpenMeteo(json) {
  const h = json?.hourly;
  if (!h || !Array.isArray(h.time)) return [];
  const at = (/** @type {string} */ k, /** @type {number} */ i) => (Array.isArray(h[k]) && Number.isFinite(h[k][i]) ? h[k][i] : null);
  return h.time.map((/** @type {string} */ t, /** @type {number} */ i) => ({
    date: t.slice(0, 10),
    time: t.slice(11, 16),
    rainProb: at("precipitation_probability", i),
    feelsC: at("apparent_temperature", i),
    uv: at("uv_index", i),
    precipMm: at("precipitation", i),
  }));
}

/** How bad one hour is outdoors, from 0 (lovely) up. Unknown rain counts as a coin toss. */
export function hourCost(h) {
  const rain = (h.rainProb ?? 50) / 100;
  const heat = h.feelsC == null ? 0.2 : Math.min(1, Math.max(0, h.feelsC - COMFORT_C) / 8);
  const sun = h.uv == null ? 0 : Math.min(1, Math.max(0, h.uv - UV_OK) / 5);
  return rain + 0.5 * heat + 0.3 * sun;
}

const max = (/** @type {(number|null)[]} */ xs) => {
  const v = xs.filter((x) => x != null);
  return v.length ? Math.max(.../** @type {number[]} */ (v)) : null;
};

/**
 * The best window of `hours` hours on a date between from and to (local "HH:MM").
 * Returns null when the forecast has no hours for that stretch (too far ahead).
 * @param {Hour[]} hours
 * @param {{ date: string, from?: string, to?: string, hours?: number }} opts
 */
export function bestWindow(hours, { date, from = "09:00", to = "21:00", hours: len = 3 }) {
  const day = hours.filter((h) => h.date === date);
  const lo = minutesOfDay(from);
  const hi = minutesOfDay(to);
  const span = Math.max(1, Math.min(len, Math.floor((hi - lo) / 60)));
  /** @type {{ start: number, slice: Hour[], cost: number }|null} */
  let best = null;
  for (let s = Math.ceil(lo / 60) * 60; s + span * 60 <= hi; s += 60) {
    const slice = day.filter((h) => {
      const m = minutesOfDay(h.time);
      return m >= s && m < s + span * 60;
    });
    if (slice.length < span) continue;
    const costs = slice.map(hourCost);
    // the worst hour matters most: a dry afternoon with one stormy hour is not dry
    const cost = 0.6 * Math.max(...costs) + 0.4 * (costs.reduce((a, b) => a + b, 0) / costs.length);
    if (!best || cost < best.cost - 1e-9) best = { start: s, slice, cost };
  }
  if (!best) return null;
  const rainProb = max(best.slice.map((h) => h.rainProb));
  const feelsC = max(best.slice.map((h) => h.feelsC));
  const uv = max(best.slice.map((h) => h.uv));
  const ok = (rainProb ?? 50) < RAIN_OK && (feelsC ?? 0) < FEELS_OK;
  const whole = day.filter((h) => minutesOfDay(h.time) >= lo && minutesOfDay(h.time) < hi);
  return {
    date,
    from: hhmm(best.start),
    to: hhmm(best.start + span * 60),
    rainProb,
    feelsC: feelsC == null ? null : Math.round(feelsC),
    uv: uv == null ? null : Math.round(uv * 10) / 10,
    ok,
    cost: Math.round(best.cost * 1000) / 1000,
    reason: windowReason({ rainProb, feelsC, uv, ok, from: best.start, dayRainMax: max(whole.map((h) => h.rainProb)), dayFeelsMax: max(whole.map((h) => h.feelsC)) }),
  };
}

/** The plain-words reason for a window, built only from the numbers. No dashes. */
function windowReason({ rainProb, feelsC, uv, ok, from, dayRainMax, dayFeelsMax }) {
  /** @type {string[]} */
  const parts = [];
  /** @type {string[]} */
  const codes = [];
  if (rainProb == null) parts.push("No rain forecast yet");
  else if (rainProb < 20) {
    parts.push(`Dry: rain chance ${rainProb}% at most`);
    codes.push("dry");
  } else if (rainProb < RAIN_OK) {
    parts.push(`Mostly dry: rain chance up to ${rainProb}%`);
    codes.push("mostly_dry");
  } else {
    parts.push(`Rain likely: up to ${rainProb}%`);
    codes.push("rain");
  }
  if (dayRainMax != null && rainProb != null && dayRainMax - rainProb >= 30) {
    parts.push(`the wettest hour that day is ${dayRainMax}%`);
    codes.push("avoids_rain");
  }
  if (feelsC != null) {
    if (dayFeelsMax != null && dayFeelsMax - feelsC >= 2 && from >= 15 * 60) {
      parts.push(`after the worst heat, feels like ${Math.round(feelsC)} C`);
      codes.push("after_heat");
    } else parts.push(`feels like ${Math.round(feelsC)} C`);
  }
  if (uv != null && uv >= 8) {
    parts.push(`strong sun (UV ${Math.round(uv)}), bring shade`);
    codes.push("strong_sun");
  }
  if (!ok) codes.push("not_ok");
  return { text: `${parts.join(", ")}.`.replace(/^./, (c) => c.toUpperCase()), codes };
}

/**
 * The weather over a plan's own hours, for the weather watch. Returns the Plan.weather shape.
 * @param {Hour[]} hours
 * @param {{ start: string, end: string, tz?: string }} plan
 * @param {number} now  ms, for checkedAt
 */
export function weatherForPlan(hours, { start, end, tz = DEFAULT_TZ }, now) {
  const s = parseInstant(start);
  const e = parseInstant(end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
  const a = localParts(s, tz);
  const b = localParts(Math.max(s, e - 1), tz);
  const inPlan = hours.filter((h) => {
    const k = `${h.date}T${h.time}`;
    return k >= `${a.date}T${a.time.slice(0, 2)}:00` && k <= `${b.date}T${b.time}`;
  });
  if (!inPlan.length) return null;
  const rainProb = max(inPlan.map((h) => h.rainProb));
  const tempC = max(inPlan.map((h) => h.feelsC));
  const ok = (rainProb ?? 0) < RAIN_OK && (tempC ?? 0) < FEELS_OK;
  return {
    checkedAt: new Date(now).toISOString(),
    summary: summarise(rainProb, tempC),
    rainProb,
    tempC: tempC == null ? null : Math.round(tempC),
    ok,
  };
}

function summarise(rainProb, tempC) {
  const t = tempC == null ? "" : `, feels like ${Math.round(tempC)} C`;
  if (rainProb == null) return `Forecast pending${t}`;
  if (rainProb >= 60) return `Rain likely (${rainProb}%)${t}`;
  if (rainProb >= RAIN_OK) return `Showers possible (${rainProb}%)${t}`;
  if (rainProb >= 20) return `Mostly dry (${rainProb}%)${t}`;
  return `Dry${t}`;
}

/** True when the weather turned: it was fine (or unknown) and now it is not. */
export function rainMovedIn(prev, next) {
  return !!next && !next.ok && (!prev || prev.ok);
}

/** Daylight hours a ritual may move into when its own window is wet (sunset in Lagos is near 18:45 all year). */
export const DAYLIGHT = { from: "08:00", to: "19:00" };

/** "15:00" as "3 pm", "08:30" as "8:30 am". */
export function clockWords(t) {
  const m = minutesOfDay(t);
  const h = Math.floor(m / 60);
  const mi = m % 60;
  return `${h % 12 || 12}${mi ? `:${String(mi).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

/**
 * Where and when a ritual goes when it rains. The crew's own window comes first; when its
 * best stretch is wet (not ok), the sloth looks, in order, for:
 *   1. a dry stretch of at least two hours in daylight on the same day ("moved");
 *   2. a dry stretch in the crew's window on the next day ("next_day");
 *   3. nothing dry: it keeps the least wet stretch of the crew's window and says so
 *      plainly, suggesting a roof ("wet").
 * Every note is built from the forecast numbers, never guessed.
 * @param {Hour[]} hours
 * @param {{ date: string, from: string, to: string, hours: number }} slot
 * @returns {null | { date: string, window: { from: string, to: string }, win: NonNullable<ReturnType<typeof bestWindow>>, rainPlan: null | { kind: "moved"|"next_day"|"wet", note: string, wanted: { date: string, from: string, to: string, rainProb: number|null } } }}
 *   null when the forecast does not reach the date
 */
export function ritualWindow(hours, { date, from, to, hours: span }) {
  const own = bestWindow(hours, { date, from, to, hours: span });
  if (!own) return null;
  if (own.ok) return { date, window: { from: own.from, to: own.to }, win: own, rainPlan: null };
  const inWindow = hours.filter((h) => h.date === date && minutesOfDay(h.time) >= minutesOfDay(from) && minutesOfDay(h.time) < minutesOfDay(to));
  const wanted = { date, from, to, rainProb: max(inWindow.map((h) => h.rainProb)) ?? own.rainProb };
  const wet = `Rain is likely from ${clockWords(from)} to ${clockWords(to)} (up to ${wanted.rainProb ?? "?"}%)`;
  const short = Math.min(span, 2);
  const moved = bestWindow(hours, { date, from: DAYLIGHT.from, to: DAYLIGHT.to, hours: span }) ?? null;
  const movedShort = moved?.ok ? moved : bestWindow(hours, { date, from: DAYLIGHT.from, to: DAYLIGHT.to, hours: short });
  if (movedShort?.ok) {
    return {
      date, window: { from: movedShort.from, to: movedShort.to }, win: movedShort,
      rainPlan: { kind: "moved", wanted, note: `${wet}, so the sloth moved it to ${clockWords(movedShort.from)} to ${clockWords(movedShort.to)}, the driest stretch that day (rain chance up to ${movedShort.rainProb}%). Forecasts change; the sloth checks again before then.` },
    };
  }
  const next = addDays(date, 1);
  const nextWin = bestWindow(hours, { date: next, from, to, hours: span });
  if (nextWin?.ok) {
    return {
      date: next, window: { from: nextWin.from, to: nextWin.to }, win: nextWin,
      rainPlan: { kind: "next_day", wanted, note: `${wet} on ${DAY_NAMES[weekdayOf(date)]}, so the sloth moved it to ${DAY_NAMES[weekdayOf(next)]}, ${clockWords(nextWin.from)} to ${clockWords(nextWin.to)} (rain chance up to ${nextWin.rainProb}%). Forecasts change; the sloth checks again before then.` },
    };
  }
  const dayMin = moved?.rainProb ?? own.rainProb;
  return {
    date, window: { from: own.from, to: own.to }, win: own,
    rainPlan: { kind: "wet", wanted, note: `No dry stretch this weekend: the driest few hours on ${DAY_NAMES[weekdayOf(date)]} still have a ${dayMin ?? "high"}% chance of rain. Bring an umbrella, or move it somewhere with a roof: anyone in the crew can change the place.` },
  };
}
