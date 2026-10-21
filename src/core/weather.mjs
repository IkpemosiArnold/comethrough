// @ts-check
// Weather windows from hourly forecasts (Open-Meteo's shape, requested in the plan's zone so
// hour labels are local). Pure: the adapter fetches, this decides.
//
// An outdoor hour is spoiled by rain first, then by heat (the apparent temperature, which
// counts humidity: in Lagos it often passes 35 C at midday) or cold, and then by strong
// sun. The best window is the stretch with the least of each, in that order of weight.

import { DAY_NAMES, DEFAULT_TZ, addDays, localParts, minutesOfDay, hhmm, parseInstant, weekdayOf } from "./time.mjs";

/**
 * @typedef {object} Hour
 * @property {string} date      "YYYY-MM-DD" local
 * @property {string} time      "HH:00" local
 * @property {number|null} rainProb  0..100
 * @property {number|null} feelsC    apparent temperature
 * @property {number|null} uv
 * @property {number|null} precipMm
 * @property {0|1} [isDay]      1 when the hour has daylight (Open-Meteo's is_day); absent when not asked for
 */

/** Thresholds: a window is "ok" outdoors below RAIN_OK % and FEELS_OK C. */
export const RAIN_OK = 40;
export const FEELS_OK = 38;
const COMFORT_C = 30; // above this, each degree costs
const CHILLY_C = 10; // below this, each degree costs (never reached in Lagos, so its picks are unchanged)
const UV_OK = 6;

/**
 * Open-Meteo's hourly arrays to a list of hours. Missing values become null.
 *
 * Open-Meteo labels a whole response with one UTC offset, the zone's offset at its start
 * (checked 21 Oct 2026: London from 24 to 26 Oct came back as 72 hours at +01:00, with
 * sunset on the 25th at "17:46", an hour after the clocks went back). So with a zone given,
 * each hour is put back on its true instant (label minus utc_offset_seconds) and labelled in
 * that zone again. For a zone with no daylight saving, such as Lagos, nothing changes.
 * @param {any} json  the API response (hourly.time, precipitation_probability, apparent_temperature, uv_index, precipitation)
 * @param {string|null} [tz]  the zone to label hours in
 * @returns {Hour[]}
 */
export function hoursFromOpenMeteo(json, tz = null) {
  const h = json?.hourly;
  if (!h || !Array.isArray(h.time)) return [];
  const at = (/** @type {string} */ k, /** @type {number} */ i) => (Array.isArray(h[k]) && Number.isFinite(h[k][i]) ? h[k][i] : null);
  const offset = Number.isFinite(json?.utc_offset_seconds) ? json.utc_offset_seconds : null;
  const label = (/** @type {string} */ t) => {
    if (!tz || offset == null) return t;
    const ms = Date.parse(`${t}:00Z`) - offset * 1000;
    if (!Number.isFinite(ms)) return t;
    const p = localParts(ms, tz);
    return `${p.date}T${p.time}`;
  };
  return h.time.map((/** @type {string} */ raw, /** @type {number} */ i) => {
    const t = label(raw);
    return {
      date: t.slice(0, 10),
      time: t.slice(11, 16),
      rainProb: at("precipitation_probability", i),
      feelsC: at("apparent_temperature", i),
      uv: at("uv_index", i),
      precipMm: at("precipitation", i),
      ...(Array.isArray(h.is_day) ? { isDay: /** @type {0|1} */ (h.is_day[i] === 1 ? 1 : 0) } : {}),
    };
  });
}

/** How bad one hour is outdoors, from 0 (lovely) up. Unknown rain counts as a coin toss. */
export function hourCost(h) {
  const rain = (h.rainProb ?? 50) / 100;
  const heat = h.feelsC == null ? 0.2 : Math.min(1, Math.max(0, h.feelsC - COMFORT_C) / 8) + Math.min(1, Math.max(0, CHILLY_C - h.feelsC) / 10);
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

/**
 * @typedef {{ weekendOutdoor: TimeWindow, weekendCovered: TimeWindow, weekdayOutdoor: TimeWindow, weekdayEvening: TimeWindow }} SocialHours
 * @typedef {{ from: string, to: string }} TimeWindow
 */

/**
 * When people actually meet up, by kind of plan, for a city with no pack: weekends 11:00 to
 * 19:00 and weekday evenings 17:30 to 21:00, local time. The sloth never plans outside these
 * hours, whatever the weather does. A city pack can bring its own (Lagos ends outdoor
 * weekends at 18:30, before dark; see src/packs/lagos).
 * @type {SocialHours}
 */
export const GENERIC_SOCIAL_HOURS = Object.freeze({
  weekendOutdoor: { from: "11:00", to: "19:00" },
  weekendCovered: { from: "11:00", to: "19:00" },
  weekdayOutdoor: { from: "17:30", to: "21:00" },
  weekdayEvening: { from: "17:30", to: "21:00" },
});

export const isWeekend = (/** @type {string} */ date) => [0, 6].includes(weekdayOf(date));

/**
 * The acceptable hours for a plan on a date.
 * @param {string} date  "YYYY-MM-DD"
 * @param {{ outdoor?: boolean, social?: SocialHours }} [opts]
 */
export function socialWindow(date, { outdoor = true, social = GENERIC_SOCIAL_HOURS } = {}) {
  if (isWeekend(date)) return outdoor ? social.weekendOutdoor : social.weekendCovered;
  return outdoor ? social.weekdayOutdoor : social.weekdayEvening;
}

/**
 * The crew's own window cut to the social hours. When the two share less than an hour
 * (a crew that said "Saturday 8am"), the social hours win.
 * @param {string} date
 * @param {{ from: string, to: string }} want
 * @param {{ outdoor?: boolean, social?: SocialHours }} [opts]
 */
export function clipToSocial(date, want, opts = {}) {
  const ok = socialWindow(date, opts);
  const lo = Math.max(minutesOfDay(want.from), minutesOfDay(ok.from));
  const hi = Math.min(minutesOfDay(want.to), minutesOfDay(ok.to));
  return hi - lo >= 60 ? { from: hhmm(lo), to: hhmm(hi) } : { ...ok };
}

/** "15:00" as "3 pm", "08:30" as "8:30 am". */
export function clockWords(t) {
  const m = minutesOfDay(t);
  const h = Math.floor(m / 60);
  const mi = m % 60;
  return `${h % 12 || 12}${mi ? `:${String(mi).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

/**
 * Where and when a ritual goes when it rains. Every window considered is inside the social
 * hours (the city pack's, or GENERIC_SOCIAL_HOURS): the sloth never moves a Saturday
 * hangout to 8 am. The crew's own
 * window (cut to those hours) comes first; when its best stretch is wet (not ok), the sloth
 * looks, in order, for:
 *   1. a dry stretch of at least two hours in the same day's social hours ("moved");
 *   2. a dry stretch in the crew's window on the next day, when that day is the same kind of
 *      day (Saturday to Sunday, not Sunday to Monday) ("next_day");
 *   3. nothing acceptable: "skip". The caller may offer a covered place instead ("covered");
 *      otherwise the sloth skips this one and says why.
 * Every note is built from the forecast numbers, never guessed.
 * @param {Hour[]} hours
 * @param {{ date: string, from: string, to: string, hours: number }} slot
 * @param {SocialHours} [social]
 * @returns {null | { date: string, window: { from: string, to: string }, win: NonNullable<ReturnType<typeof bestWindow>>, rainPlan: null | RainPlan }}
 *   null when the forecast does not reach the date
 */
export function ritualWindow(hours, { date, from, to, hours: span }, social = GENERIC_SOCIAL_HOURS) {
  // an outdoor hangout ends when the light does: in London on the last Sunday of October the
  // sun sets before 5 pm, inside any "3 pm to 7 pm". Lagos's sunsets (18:25 at the earliest)
  // come after its own 18:30 cut-off at the hour, so its windows do not change.
  const lit = (/** @type {string} */ d) => litHours(social, hours, d);
  const mine = clipToSocial(date, { from, to }, { social: lit(date) });
  const own = bestWindow(hours, { date, from: mine.from, to: mine.to, hours: span });
  if (!own) return null;
  if (own.ok) return { date, window: { from: own.from, to: own.to }, win: own, rainPlan: null };
  const inWindow = hours.filter((h) => h.date === date && minutesOfDay(h.time) >= minutesOfDay(mine.from) && minutesOfDay(h.time) < minutesOfDay(mine.to));
  const wanted = { date, from: mine.from, to: mine.to, rainProb: max(inWindow.map((h) => h.rainProb)) ?? own.rainProb };
  const wet = `Rain is likely from ${clockWords(mine.from)} to ${clockWords(mine.to)} (up to ${wanted.rainProb ?? "?"}%)`;
  const day = socialWindow(date, { social: lit(date) });
  const short = Math.min(span, 2);
  const moved = bestWindow(hours, { date, from: day.from, to: day.to, hours: span });
  const movedShort = moved?.ok ? moved : bestWindow(hours, { date, from: day.from, to: day.to, hours: short });
  if (movedShort?.ok) {
    return {
      date, window: { from: movedShort.from, to: movedShort.to }, win: movedShort,
      rainPlan: { kind: "moved", wanted, note: `${wet}, so the sloth moved it to ${clockWords(movedShort.from)} to ${clockWords(movedShort.to)}, the driest stretch that day (rain chance up to ${movedShort.rainProb}%). Forecasts change; the sloth checks again before then.` },
    };
  }
  const next = addDays(date, 1);
  const nextOk = isWeekend(next) === isWeekend(date);
  const nextMine = clipToSocial(next, { from, to }, { social: lit(next) });
  const nextWin = nextOk ? bestWindow(hours, { date: next, from: nextMine.from, to: nextMine.to, hours: span }) : null;
  if (nextWin?.ok) {
    return {
      date: next, window: { from: nextWin.from, to: nextWin.to }, win: nextWin,
      rainPlan: { kind: "next_day", wanted, note: `${wet} on ${DAY_NAMES[weekdayOf(date)]}, so the sloth moved it to ${DAY_NAMES[weekdayOf(next)]}, ${clockWords(nextWin.from)} to ${clockWords(nextWin.to)} (rain chance up to ${nextWin.rainProb}%). Forecasts change; the sloth checks again before then.` },
    };
  }
  const daySocial = hours.filter((h) => h.date === date && minutesOfDay(h.time) >= minutesOfDay(day.from) && minutesOfDay(h.time) < minutesOfDay(day.to));
  const allWet = daySocial.length > 0 && daySocial.every((h) => (h.rainProb ?? 50) >= RAIN_OK);
  const part = minutesOfDay(day.from) >= 17 * 60 ? "evening" : "afternoon";
  const peak = max(daySocial.map((h) => h.rainProb));
  const nextWords = nextWin ? `, and ${DAY_NAMES[weekdayOf(next)]} looks no better` : "";
  const head = allWet ? `Rain all ${part}` : `No dry two hours this ${part}`;
  return {
    date, window: { from: own.from, to: own.to }, win: own,
    rainPlan: {
      kind: "skip", wanted,
      note: `${head} on ${DAY_NAMES[weekdayOf(date)]} (up to ${peak ?? "?"}% between ${clockWords(day.from)} and ${clockWords(day.to)})${nextWords}. The sloth is skipping this one. If it clears up, anyone can still add a plan.`,
    },
  };
}

/**
 * The social hours for a date with the outdoor ones cut to daylight, when the forecast says
 * which hours are light (Open-Meteo's is_day). An hour counts as light when it starts in
 * daylight. Without is_day, or with fewer than two light hours left, the hours are unchanged.
 * @param {SocialHours} social
 * @param {Hour[]} hours
 * @param {string} date
 * @returns {SocialHours}
 */
export function litHours(social, hours, date) {
  const light = hours.filter((h) => h.date === date && h.isDay === 1).map((h) => minutesOfDay(h.time));
  if (!light.length) return social;
  const first = Math.min(...light);
  const last = Math.max(...light) + 60;
  const cut = (/** @type {TimeWindow} */ w) => {
    const lo = Math.max(minutesOfDay(w.from), first);
    const hi = Math.min(minutesOfDay(w.to), last);
    return hi - lo >= 120 && (lo !== minutesOfDay(w.from) || hi !== minutesOfDay(w.to)) ? { from: hhmm(lo), to: hhmm(hi) } : w;
  };
  return { ...social, weekendOutdoor: cut(social.weekendOutdoor), weekdayOutdoor: cut(social.weekdayOutdoor) };
}

/**
 * @typedef {{ kind: "moved"|"next_day"|"covered"|"skip", note: string, wanted: { date: string, from: string, to: string, rainProb: number|null } }} RainPlan
 */

/**
 * The note for a covered alternative, when the rain blocks every outdoor window but a place
 * with a roof is known.
 * @param {RainPlan} skip  what ritualWindow returned
 * @param {string} placeName
 * @param {{ from: string, to: string }} window
 */
export function coveredNote(skip, placeName, window) {
  const w = skip.wanted;
  return `Rain is likely from ${clockWords(w.from)} to ${clockWords(w.to)} (up to ${w.rainProb ?? "?"}%), so the sloth picked somewhere with a roof: ${placeName}, ${clockWords(window.from)} to ${clockWords(window.to)}.`;
}
