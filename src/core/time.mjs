// @ts-check
// Wall-clock time in a named zone, without Node: Intl does the zone arithmetic, so this
// works the same in the browser. Lagos (Africa/Lagos, WAT) is UTC+01:00 all year with no
// daylight saving, but nothing here assumes that, so a crew in another city also works.
//
// Conventions: a "date" is "YYYY-MM-DD" and a "time" is "HH:MM", both local to the zone;
// an instant is milliseconds since the epoch or an ISO string with an offset.

export const DEFAULT_TZ = "Africa/Lagos";
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** @type {Map<string, Intl.DateTimeFormat>} */
const formatters = new Map();
function fmt(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", weekday: "short",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (/** @type {number} */ n, w = 2) => String(n).padStart(w, "0");

/** True when the zone name is one Intl knows. */
export function isValidZone(tz) {
  try {
    fmt(tz);
    return true;
  } catch {
    return false;
  }
}

/**
 * The local calendar fields of an instant in a zone.
 * @param {number} ms
 * @param {string} [tz]
 */
export function localParts(ms, tz = DEFAULT_TZ) {
  /** @type {Record<string,string>} */
  const p = {};
  for (const { type, value } of fmt(tz).formatToParts(new Date(ms))) p[type] = value;
  const y = Number(p.year), m = Number(p.month), d = Number(p.day), h = Number(p.hour), mi = Number(p.minute), s = Number(p.second);
  return { y, m, d, h, mi, s, weekday: WEEKDAYS.indexOf(p.weekday), date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** The zone's offset from UTC at an instant, in minutes (Lagos: 60). */
export function zoneOffsetMinutes(ms, tz = DEFAULT_TZ) {
  const p = localParts(ms, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MINUTE);
}

/**
 * The instant of a local date and time in a zone.
 * @param {string} date "YYYY-MM-DD"
 * @param {string} time "HH:MM"
 * @param {string} [tz]
 */
export function zonedToMs(date, time, tz = DEFAULT_TZ) {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, h, mi);
  let ms = naive - zoneOffsetMinutes(naive, tz) * MINUTE;
  // a second pass settles instants near a daylight-saving change
  ms = naive - zoneOffsetMinutes(ms, tz) * MINUTE;
  return ms;
}

/** "2026-10-23T19:00:00+01:00" for an instant in a zone. */
export function toIsoLocal(ms, tz = DEFAULT_TZ) {
  const p = localParts(ms, tz);
  const off = zoneOffsetMinutes(ms, tz);
  const sign = off < 0 ? "-" : "+";
  const a = Math.abs(off);
  return `${p.date}T${p.time}:${pad(p.s)}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** Parse an ISO instant to ms; NaN when it is not one. A bare date-time without an offset is rejected. */
export function parseInstant(iso) {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(iso)) return NaN;
  return Date.parse(iso);
}

/** Add days to a "YYYY-MM-DD" date (calendar arithmetic, no zone involved). */
export function addDays(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Whole days from date a to date b (b - a). */
export function daysBetween(a, b) {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / DAY);
}

/** 0 (Sunday) to 6 for a "YYYY-MM-DD" date. */
export function weekdayOf(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** True for a real "YYYY-MM-DD" calendar date. */
export function isDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return addDays(s, 0) === s;
}

/** True for "HH:MM" from 00:00 to 23:59. */
export function isTime(s) {
  return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** "19:00" -> 1140 */
export const minutesOfDay = (/** @type {string} */ hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** 1140 -> "19:00" (wraps past midnight) */
export function hhmm(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Resolve the date words a person wrote ("friday", "tonight", "tomorrow", "next sat",
 * "23 Oct", "Oct 23rd", "23/10") against today's local date. Gemma reports the words it
 * read the date from; this function does the arithmetic, because models get weekday maths
 * wrong. Returns "YYYY-MM-DD", or null when the words are not a date it understands.
 * A bare weekday means the next one on or after today ("friday" on a Friday is today);
 * "next friday" skips the coming one only when it is within the current week (Mon to Sun),
 * which is how people in Lagos use it.
 * @param {string|null|undefined} text
 * @param {string} today "YYYY-MM-DD"
 */
export function resolveDateWords(text, today) {
  if (!text) return null;
  const t = String(text).toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  if (/^(today|tonight|this evening|this night|later today|later)$/.test(t)) return today;
  if (/^(tomorrow|tmrw|tmr|2moro|tomorrow night|tomorrow evening)$/.test(t)) return addDays(today, 1);
  // only real weekday words: "fri" and "friday", never "monopoly" or "saturated"
  const wd = t.match(/^(this |next |coming |on )?(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)( night| evening| morning| afternoon)?$/);
  if (wd) {
    const target = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(wd[2].slice(0, 3));
    const now = weekdayOf(today);
    let ahead = (target - now + 7) % 7;
    if (wd[1] === "next ") {
      // "next friday" said on Monday to Thursday means the Friday after this week's
      const isoNow = (now + 6) % 7; // Monday 0 .. Sunday 6
      const isoTarget = (target + 6) % 7;
      if (isoTarget > isoNow) ahead += 7;
      else if (ahead === 0) ahead = 7;
    }
    return addDays(today, ahead);
  }
  const year = Number(today.slice(0, 4));
  /** @param {number} d @param {number} m */
  const pick = (d, m) => {
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    let s = `${year}-${pad(m)}-${pad(d)}`;
    if (!isDate(s)) return null;
    // a date more than 60 days in the past means next year ("3 Jan" said in December)
    if (daysBetween(today, s) < -60) s = `${year + 1}-${pad(m)}-${pad(d)}`;
    return isDate(s) ? s : null;
  };
  const dm = t.match(/^(?:(?:sun|mon|tue|wed|thu|fri|sat)[a-z]{0,6} )?(\d{1,2})(?:st|nd|rd|th)?(?: of)? ([a-z]{3})[a-z]*(?: (\d{4}))?$/);
  if (dm && MONTHS.includes(dm[2])) return withYear(pick(Number(dm[1]), MONTHS.indexOf(dm[2]) + 1), dm[3]);
  const md = t.match(/^(?:(?:sun|mon|tue|wed|thu|fri|sat)[a-z]{0,6} )?([a-z]{3})[a-z]* (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/);
  if (md && MONTHS.includes(md[1])) return withYear(pick(Number(md[2]), MONTHS.indexOf(md[1]) + 1), md[3]);
  // Nigeria writes day first: 23/10 is 23 October
  const num = t.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (num) return withYear(pick(Number(num[1]), Number(num[2])), num[3] && (num[3].length === 2 ? `20${num[3]}` : num[3]));
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso && isDate(t)) return t;
  return null;
}

/** @param {string|null} date @param {string|undefined} y */
function withYear(date, y) {
  if (!date || !y) return date;
  const s = `${y}${date.slice(4)}`;
  return isDate(s) ? s : null;
}

/**
 * Resolve time words ("7", "7pm", "7:30", "19:00", "noon", "8ish") to "HH:MM". An hour
 * from 1 to 11 with no am/pm is read as evening (a social plan at "7" or "7:30" is in the
 * evening), and 12 as noon; isAmbiguousTime says when that guess was made, so the confirm
 * screen can highlight it. Returns null when it cannot tell.
 * @param {string|null|undefined} text
 */
export function resolveTimeWords(text) {
  if (!text) return null;
  const t = String(text).toLowerCase().replace(/\s+/g, "").replace(/ish$/, "");
  if (t === "noon" || t === "midday") return "12:00";
  if (t === "midnight") return "00:00";
  const m = t.match(/^(\d{1,2})(?:[:.](\d{2}))?(am|pm|a|p)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const mi = Number(m[2] || 0);
  if (h > 23 || mi > 59) return null;
  const ap = m[3]?.[0];
  if (ap === "p" && h < 12) h += 12;
  else if (ap === "a" && h === 12) h = 0;
  else if (!ap && h >= 1 && h <= 11) h += 12;
  if (h > 23) return null;
  return `${pad(h)}:${pad(mi)}`;
}

/** True when time words name an hour from 1 to 11 without am/pm (read as evening). */
export function isAmbiguousTime(text) {
  const t = String(text || "").toLowerCase().replace(/\s+/g, "").replace(/ish$/, "");
  const m = t.match(/^(\d{1,2})(?:[:.](\d{2}))?$/);
  return !!m && Number(m[1]) >= 1 && Number(m[1]) <= 11;
}

/** The weekday (0 to 6) named in date words ("SUN 25 OCT" gives 0), or null. */
export function weekdayInWords(text) {
  const m = String(text || "").toLowerCase().match(/\b(sun|mon|tue|wed|thu|fri|sat)(?:day|s|n|nes|rs|ur|urday|sday|nesday|day)?\b/);
  return m ? ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(m[1]) : null;
}
