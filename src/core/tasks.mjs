// @ts-check
// The Gemma tasks: for each, the messages (from a prompt in ./prompts/*.md), the JSON
// schema of the answer, and a reader that turns the answer into app data.
//
// The rule for every reader: nothing is silently invented. A field the model leaves out
// is null. Each output carries a confidence per field (0 to 1), and a field below 0.6 is
// listed in `low` so the confirm screen highlights it. Code does the arithmetic the model
// is bad at: day names become dates and "7" becomes 19:00 here, not in the model. For text
// input, a value that does not appear in the source (a price, a venue, a host) has its
// confidence cut, because a model reading a sentence should only copy from it.
//
// Prompt files are plain markdown with <!-- system --> and <!-- user --> sections and
// {{name}} slots (the format Selects uses). This module never reads files: the shell
// loads the prompts and passes their text in, so the core stays browser-safe.
//
// Nothing here assumes a city. Where a prompt or a reader needs local knowledge (the city
// and country, Pidgin hints, short names like "VI", the local currency, which way round
// "10/11" goes) it comes in as a `Local` object from the crew's city pack (src/packs).
// With no Local, the prompts name no place and the readers make no local guesses.

import { cleanConfidence, lowFields } from "./plans.mjs";
import { VIBE_MATCHERS } from "./places.mjs";
import { ENERGY, HIGH_RISK, NEEDS, PLACE_KIND_NAMES, UNSOURCED_CLAIM, cleanTaste, hasSensitive } from "./taste.mjs";
import { DAY_NAMES, DEFAULT_TZ, isAmbiguousTime, isDate, isTime, resolveDateWords, resolveTimeWords, toIsoLocal, zonedToMs, minutesOfDay, addDays, daysBetween, weekdayOf, weekdayInWords } from "./time.mjs";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "19:00" as people say it: "7pm", "7:30pm". */
export const clock12 = (/** @type {string} */ hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""}${h >= 12 ? "pm" : "am"}`;
};
/** "2026-10-23" as "Friday 23 October". */
const dayWords = (/** @type {string} */ date) => `${DAY_NAMES[weekdayOf(date)]} ${Number(date.slice(8, 10))} ${MONTH_NAMES[Number(date.slice(5, 7)) - 1]}`;

export const PROMPT_NAMES = ["parse-crew", "parse-plan", "explain-pick", "write-invite", "parse-feedback"];

/** @typedef {{ role: "system"|"user", content: string, images?: { mimeType: string, data: string }[] }} Message */
/** @typedef {{ system: string, user: string }} Prompt */

/** Split a prompt file into its system and user parts. */
export function splitPrompt(md, name = "prompt") {
  const system = md.split("<!-- system -->")[1]?.split("<!-- user -->")[0]?.trim();
  const user = md.split("<!-- user -->")[1]?.trim();
  if (!system || !user) throw new Error(`${name} must contain <!-- system --> and <!-- user --> sections`);
  return { system, user };
}

/** Fill {{name}} slots. Values are inserted as they are; unknown slots are left empty. */
export function fill(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ""));
}

/**
 * What a prompt and its reader may know about where the crew is. Every field is optional;
 * the city pack builds it (src/packs). Prompt slots take the strings as they are, so each
 * carries its own leading space ("" leaves the sentence as it would read anywhere).
 * @typedef {object} Local
 * @property {string} [inCity]          " in Lagos"
 * @property {string} [inCityCountry]   " in Lagos, Nigeria"
 * @property {string} [areaNoun]        "Lagos neighbourhoods"
 * @property {string} [areaNounOne]     "a Lagos neighbourhood"
 * @property {string} [areaExamples]    ' ("Yaba", "Lekki")'
 * @property {string} [areaExample]     '("for Lekki", "Ikeja GRA")'
 * @property {string} [priceExample]    '"N5,000"'
 * @property {string} [localNotes]      language hints (Pidgin for Lagos, Nigeria and Ghana)
 * @property {string} [crewNotes]       short names for the crew sentence (' "VI" is Victoria Island.')
 * @property {string} [tasteNotes]      cultural notes for reading a crew's taste (' In Lagos, "alte" is...')
 * @property {Record<string, string>} [areaFull]     a short name as the map knows it: { vi: "Victoria Island" }
 * @property {Record<string, string[]>} [areaShort]  the short names people write for an area
 * @property {string[]} [cityWords]     words that name the city itself, never an area ("lagos")
 * @property {string} [windowNote]      the note when a rhythm has no time
 * @property {string|null} [currency]   the local currency code ("NGN"), null when unknown
 * @property {string} [currencyName]    how notes name it ("naira")
 * @property {(s: string) => string} [fixPrice]  repairs a model's misreading of the local currency sign
 * @property {boolean} [monthFirst]     numeric dates are month first ("10/23"), as in the US
 */

/** The prompt slots a Local fills, and what they read as with no Local at all. */
export const LOCALE_SLOTS = {
  inCity: "",
  inCityCountry: "",
  areaNoun: "neighbourhoods or areas",
  areaNounOne: "a neighbourhood or area",
  areaExamples: ' ("Brixton", "Kreuzberg"; a neighbourhood in the group\'s name counts: "the Kreuzberg lot" is around Kreuzberg)',
  areaExample: '("in the old town", "near the market")',
  priceExample: '"15 at the door"',
  localNotes: "",
  crewNotes: "",
  tasteNotes: "",
};

/**
 * A prompt with its place slots filled for a crew, leaving every other slot ({{today}},
 * {{facts}}) for the task to fill.
 * @param {Prompt} prompt
 * @param {Local} [local]
 * @returns {Prompt}
 */
export function localisePrompt(prompt, local = {}) {
  /** @type {Record<string, any>} */
  const vars = { ...LOCALE_SLOTS, ...Object.fromEntries(Object.entries(local).filter(([k, v]) => k in LOCALE_SLOTS && typeof v === "string")) };
  const put = (/** @type {string} */ t) => t.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
  return { system: put(prompt.system), user: put(prompt.user) };
}

const S = (/** @type {string} */ description) => ({ type: ["string", "null"], description });
const conf = (/** @type {string[]} */ keys) => ({ type: "object", properties: Object.fromEntries(keys.map((k) => [k, { type: "number", minimum: 0, maximum: 1 }])), required: keys });
const words = { type: "array", items: { type: "string" } };

export const CREW_SCHEMA = {
  type: "object",
  properties: {
    name: S("text"),
    vibe: S("text"),
    vibeTags: words,
    budget: { type: ["string", "null"], enum: ["free", "cheap", "any", null] },
    every: { type: ["string", "null"], enum: ["1w", "2w", "4w", null] },
    day: S("day name"),
    from: S("time words"),
    to: S("time words"),
    areas: words,
    taste: {
      type: "object",
      properties: {
        basis: words,
        scenes: words,
        likes: words,
        placeKinds: { type: "array", items: { type: "string", enum: [...PLACE_KIND_NAMES] } },
        eventKeywords: words,
        avoid: words,
        needs: { type: "array", items: { type: "string", enum: [...NEEDS] } },
        ageBand: S("as said"),
        energy: { type: ["string", "null"], enum: [...ENERGY, null] },
      },
      required: ["basis", "scenes", "likes", "placeKinds", "eventKeywords", "avoid", "needs", "ageBand", "energy"],
    },
    confidence: conf(["name", "vibe", "rhythm", "areas"]),
  },
  required: ["name", "vibe", "vibeTags", "budget", "every", "day", "from", "to", "areas", "taste", "confidence"],
};

export const PLAN_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["found", "hosted", "quick"] },
    title: S("text"),
    dateWords: S("words"),
    date: S("YYYY-MM-DD"),
    startTime: S("time words"),
    endTime: S("time words"),
    atHost: { type: "boolean" },
    venueName: S("text"),
    address: S("text"),
    outdoor: { type: ["boolean", "null"] },
    priceText: S("text"),
    free: { type: ["boolean", "null"] },
    hostName: S("text"),
    bring: words,
    confidence: conf(["title", "date", "time", "place", "price", "host"]),
  },
  required: ["kind", "title", "dateWords", "date", "startTime", "endTime", "atHost", "venueName", "address", "outdoor", "priceText", "free", "hostName", "bring", "confidence"],
};

export const EXPLAIN_SCHEMA = { type: "object", properties: { why: { type: "string" } }, required: ["why"] };
export const INVITE_SCHEMA = { type: "object", properties: { invite: { type: "string" } }, required: ["invite"] };

export const FEEDBACK_SCHEMA = {
  type: "object",
  properties: {
    closerTo: S("neighbourhood"),
    avoid: words,
    prefer: words,
    budget: { type: ["string", "null"], enum: ["cheaper", "pricier", null] },
    time: { type: ["string", "null"], enum: ["earlier", "later", null] },
    confidence: conf(["closerTo", "avoid", "prefer", "budget", "time"]),
  },
  required: ["closerTo", "avoid", "prefer", "budget", "time", "confidence"],
};

/** Output budgets per task (tokens). */
export const MAX_TOKENS = { "parse-crew": 900, "parse-plan": 600, "explain-pick": 200, "write-invite": 250, "parse-feedback": 250 };

// ---------------------------------------------------------------- shared checks

/** Flyers shout: "GROOVE SESSIONS" reads better as "Groove Sessions" (short words like "DJ" stay). */
export function calmCaps(s) {
  if (!s || /[a-z]/.test(s) || !/[A-Z]{3}/.test(s)) return s;
  return s.toLowerCase().replace(/(^|[\s(/&+-])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase()).replace(/\b(Dj|Mc|Vip|Ft|Lgbt|Nyc|Uk|Usa|Vi)\b/g, (w) => w.toUpperCase())
    // small words stay small inside a title ("Amala and Palmwine"), never first
    .replace(/(?<=\S\s)(And|Of|The|At|In|On|For|With|To|A|An|Or)(?=\s)/g, (w) => w.toLowerCase());
}

/** "wine and monopoly" as "Wine and monopoly": a title typed all in lower case gets a capital. */
export function firstCap(s) {
  return s && !/\p{Lu}/u.test(s) ? s.replace(/^\p{Ll}/u, (c) => c.toUpperCase()) : s;
}

/** An address with its repeated parts removed ("Ikeja, Lagos, LA 021189, Lagos, LA" keeps one "Lagos"). */
export function tidyAddress(s) {
  if (!s) return s;
  const parts = s.split(",").map((x) => x.trim()).filter(Boolean);
  const seen = new Set();
  return parts.filter((x) => {
    const k = x.toLowerCase();
    if (seen.has(k) || parts.some((o) => o.toLowerCase() !== k && o.toLowerCase().startsWith(`${k} `))) return false;
    seen.add(k);
    return true;
  }).join(", ");
}

const text = (/** @type {any} */ v, max = 200) => (typeof v === "string" && v.trim() && !/^(null|none|n\/a|unknown)$/i.test(v.trim()) ? v.replace(/\s+/g, " ").trim().slice(0, max) : null);
const norm = (/** @type {string} */ s) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * The share of a value's words (3+ letters, or any number) found in the source. 1 when
 * the value has no such words.
 * @param {string|null} value
 * @param {string} source
 */
export function groundedShare(value, source) {
  if (!value) return 1;
  const src = ` ${norm(source)} `;
  const toks = norm(value).split(" ").filter((t) => t.length >= 3 || /\d/.test(t));
  if (!toks.length) return 1;
  return toks.filter((t) => src.includes(` ${t} `) || (/\d/.test(t) && norm(source).replace(/ /g, "").includes(t))).length / toks.length;
}

/** Remove dashes used as punctuation (em and en dashes, and spaced hyphens). */
export const noDashes = (/** @type {string} */ s) => s.replace(/\s*[—–]\s*/g, ", ").replace(/\s+-\s+/g, ", ").replace(/,\s*,/g, ",");

// ---------------------------------------------------------------- crew setup

/**
 * @param {Prompt} prompt
 * @param {{ sentence: string, into?: string|null }} input  into: the optional "what you're into" line
 * @returns {Message[]}
 */
export function crewSetupMessages(prompt, { sentence, into = null }) {
  const extra = typeof into === "string" && into.trim() ? into.trim().slice(0, 300) : "(nothing)";
  return [{ role: "system", content: prompt.system }, { role: "user", content: fill(prompt.user, { sentence: sentence.trim().slice(0, 500), into: extra }) }];
}

/** Time-of-day words to a window. */
export const DAYPARTS = { morning: ["09:00", "12:00"], afternoon: ["13:00", "17:00"], evening: ["17:00", "21:00"], night: ["19:00", "23:00"], daytime: ["11:00", "17:00"], "after work": ["17:30", "21:00"], "after church": ["13:00", "17:00"] };
/** The default window for a rhythm with no time: late afternoon (in Lagos, after the worst heat). */
export const DEFAULT_WINDOW = { from: "15:00", to: "19:00" };

/** Words in an area name that never identify it on their own. */
const AREA_FILLER = new Set(["phase", "estate", "road", "street", "area", "town", "the"]);

/**
 * @param {any} data  the parsed answer (or null)
 * @param {{ sentence: string, into?: string|null }} input  into: the optional "what you're into" line
 * @param {Local} [local]  the city pack's knowledge: short area names, the city's own name, the window note
 * The setup text is read here and never returned: who the crew is (docs/LOCAL-FACTS.md,
 * "Sensitive attributes") becomes `taste.needs`, and the words are dropped from the name,
 * the vibe and the taste.
 */
export function readCrewSetup(data, { sentence, into = null }, local = {}) {
  const AREA_FULL = local.areaFull || {};
  const AREA_SHORT = local.areaShort || {};
  const cityWords = (local.cityWords || []).map((w) => norm(w));
  const d = data && typeof data === "object" ? data : {};
  const c = cleanConfidence(d.confidence);
  /** @type {string[]} */
  const notes = [];
  /** @type {string[]} */
  const filled = [];
  const said = [sentence, into].filter((x) => typeof x === "string" && x.trim()).join(". ");
  let name = text(d.name, 60);
  // names travel: WhatsApp previews, calendars, push. A word for who the crew is stays out.
  if (name && hasSensitive(name, HIGH_RISK)) {
    name = null;
    notes.push("Pick a crew name that is fine for anyone to see: names show in WhatsApp previews and calendars.");
  }
  let vibe = text(d.vibe, 80);
  // the vibe is what they like doing, in their words: never who they are, never invented
  // (on 21 Oct 2026 "alte, mostly male, mid to late 20s" came back as "anything goes")
  if (vibe && (hasSensitive(vibe) || groundedShare(vibe, said) < 0.5)) vibe = null;
  const vibeTags = Array.isArray(d.vibeTags) ? [...new Set(d.vibeTags.map((/** @type {any} */ t) => String(t).toLowerCase().trim()).filter((/** @type {string} */ t) => VIBE_MATCHERS[t] || t === "games"))].slice(0, 6) : [];
  const budget = ["free", "cheap", "any"].includes(d.budget) ? d.budget : null;
  let dayIdx = typeof d.day === "string" ? DAY_NAMES.findIndex((n) => n.toLowerCase().startsWith(d.day.toLowerCase().trim().slice(0, 3))) : -1;
  // what the sentence plainly says wins when the model misses it ("every Saturday morning"
  // came back with no "every" on 21 Oct 2026): code reads the rhythm words too
  const plain = everyIn(sentence);
  const every = ["1w", "2w", "4w"].includes(d.every) ? d.every : plain.every;
  if (dayIdx < 0 && plain.day != null) dayIdx = plain.day;
  let rhythm = null;
  if (every && dayIdx >= 0) {
    const part = (/** @type {any} */ w) => (typeof w === "string" ? DAYPARTS[/** @type {keyof typeof DAYPARTS} */ (w.toLowerCase().trim())] : null);
    let from = part(d.from)?.[0] ?? resolveTimeWords(d.from);
    let to = part(d.from)?.[1] ?? resolveTimeWords(d.to);
    if (from && !to) to = addHours(from, 4);
    if (!from || !to || minutesOfDay(to) <= minutesOfDay(from)) {
      ({ from, to } = DEFAULT_WINDOW);
      filled.push("rhythm.window");
      notes.push(local.windowNote || "No time was given, so the window is 3 pm to 7 pm.");
    }
    rhythm = { every, day: dayIdx, window: { from, to } };
  } else if (every || d.day) {
    notes.push("The rhythm needs both how often and which day.");
  }
  // an area must be something the sentence actually says: one of its distinctive words at least
  // (the sentence says "Lekki", the model may say "Lekki Phase 1")
  const words = ` ${norm(sentence)} `;
  const areas = (Array.isArray(d.areas) ? d.areas : []).map((/** @type {any} */ a) => text(a, 60)).filter(Boolean).filter((/** @type {string} */ a) => {
    const short = AREA_SHORT[norm(a)];
    const ok = (short && short.some((x) => words.includes(` ${x} `))) || words.includes(` ${norm(a)} `) || norm(a).split(" ").some((w) => w.length >= 3 && !AREA_FILLER.has(w) && !cityWords.includes(w) && words.includes(` ${w} `));
    if (!ok) notes.push(`Left out "${a}": the sentence does not mention it.`);
    return ok;
  }).map((/** @type {string} */ a) => AREA_FULL[norm(a)] ?? a).slice(0, 6);
  const confidence = {
    name: name ? c.name ?? 0.5 : 0,
    vibe: vibe ? c.vibe ?? 0.5 : 0,
    rhythm: rhythm ? Math.min(c.rhythm ?? 0.5, filled.includes("rhythm.window") ? 0.55 : 1) : 0,
    areas: areas.length ? c.areas ?? 0.5 : 0,
  };
  if (name && groundedShare(name, sentence) < 0.5) confidence.name = Math.min(confidence.name, 0.4);
  // the budget falls back to a plain reading of the sentence, then to "any"
  const budgetOut = budget ?? (CHEAP_WORDS.test(said) ? "cheap" : /\bfree\b/i.test(said) ? "free" : "any");
  const taste = cleanTaste({ ...(d.taste && typeof d.taste === "object" ? d.taste : {}), budget: budget ?? (budgetOut === "any" ? null : budgetOut) }, { sentence: said });
  return { draft: { name, vibe, vibeTags, budget: budgetOut, rhythm, areaLabels: areas, taste }, confidence, low: lowFields(confidence, filled), notes };
}

/** Money words, in English and Pidgin, that mean the crew wants it cheap. */
export const CHEAP_WORDS = /\b(cheap|broke|budget|low.?key|no (?:get|too get|get much) money|nothing too (?:expensive|costly)|no (?:cost|go cost) (?:plenty|much|too much)|not too expensive|small money|make e no cost|e no too cost)\b/i;

/**
 * The rhythm words a sentence plainly says: "every other" (2w), "once a month" (4w),
 * "every Saturday" or "weekly" (1w), and the one weekday it names. In English and Pidgin.
 * @param {string} sentence
 * @returns {{ every: "1w"|"2w"|"4w"|null, day: number|null }}
 */
export function everyIn(sentence) {
  const t = ` ${String(sentence).toLowerCase()} `;
  const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const named = days.map((d, i) => (new RegExp(`\\b${d}(day|s|urday|nesday|sday|rsday|r)?\\b`).test(t) ? i : -1)).filter((i) => i >= 0);
  const day = named.length === 1 ? named[0] : null;
  if (/\bevery other\b|\bfortnight|\bevery two weeks\b|\bevery 2 weeks\b/.test(t)) return { every: "2w", day };
  if (/\bonce a month\b|\bmonthly\b|\bevery month\b|\bonce every month\b/.test(t)) return { every: "4w", day };
  if (/\bevery (sun|mon|tue|wed|thu|fri|sat)|\bweekly\b|\bevery week\b|\bevery weekend\b/.test(t)) return { every: "1w", day };
  return { every: null, day };
}

const addHours = (/** @type {string} */ t, /** @type {number} */ h) => {
  const m = Math.min(23 * 60 + 59, minutesOfDay(t) + h * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

// ---------------------------------------------------------------- plan reading

/**
 * @typedef {object} PageMeta
 * @property {string} [url]
 * @property {string|null} [title]
 * @property {string|null} [description]
 * @property {string|null} [siteName]
 * @property {string|null} [image]
 * @property {string|null} [text]
 * @property {{ name?: string|null, startDate?: string|null, endDate?: string|null, venue?: string|null, address?: string|null, price?: string|null, free?: boolean|null, currency?: string|null, organizer?: string|null, image?: string|null, status?: string|null }|null} [event]
 */

/**
 * @param {Prompt} prompt
 * @param {{ text?: string|null, url?: string|null, pageMeta?: PageMeta|null, image?: { mimeType: string, data: string }|null, today: string }} input
 * @returns {Message[]}
 */
export function planMessages(prompt, { text: t, url, pageMeta, image, today }) {
  /** @type {string[]} */
  const parts = [];
  if (t) parts.push(`Message: ${t.trim().slice(0, 1500)}`);
  if (url) parts.push(`Link: ${url}`);
  if (pageMeta) {
    if (pageMeta.siteName) parts.push(`Site: ${pageMeta.siteName}`);
    if (pageMeta.title) parts.push(`Page title: ${pageMeta.title}`);
    if (pageMeta.description) parts.push(`Page description: ${pageMeta.description}`);
    if (pageMeta.text) parts.push(`Page text: ${pageMeta.text.slice(0, 3000)}`);
  }
  if (image) parts.push("Flyer: the attached image.");
  const weekday = DAY_NAMES[weekdayOf(today)];
  const user = { role: /** @type {const} */ ("user"), content: fill(prompt.user, { source: parts.join("\n") || "(nothing)" }) };
  return [{ role: "system", content: fill(prompt.system, { today, weekday }) }, image ? { ...user, images: [image] } : user];
}

/**
 * Turn the model's reading into a plan draft (the shape validateDraft takes).
 * @param {any} data
 * @param {{ text?: string|null, url?: string|null, pageMeta?: PageMeta|null, image?: any, today: string, tz?: string, member: { id: string, name: string }, local?: Local }} input
 *   local: the city pack's knowledge (the local currency, the date order, a price-sign repair)
 */
export function readPlan(data, { text: t, url, pageMeta, image, today, tz = DEFAULT_TZ, member, local = {} }) {
  const d = data && typeof data === "object" ? data : {};
  const c = cleanConfidence(d.confidence);
  /** @type {string[]} */
  const notes = [];
  const source = [t, pageMeta?.title, pageMeta?.description, pageMeta?.text, pageMeta?.siteName].filter(Boolean).join("\n");
  // only text can be checked word for word; a flyer is read from pixels
  const checkable = !image && source.length > 0;
  const ground = (/** @type {string|null} */ v, /** @type {number} */ cv, /** @type {string} */ label) => {
    if (!v || !checkable) return cv;
    if (groundedShare(v, source) >= 0.6) return cv;
    notes.push(`Check the ${label}: "${v}" is not in what you shared.`);
    return Math.min(cv, 0.3);
  };

  // when: code resolves the words; the model's own date is a fallback
  let date = null;
  let dateConf = 0;
  const fromWords = resolveDateWords(d.dateWords, today, { monthFirst: !!local.monthFirst });
  if (fromWords) {
    date = fromWords;
    dateConf = c.date ?? 0.8;
    if (isDate(d.date) && d.date !== fromWords) notes.push(`Read "${d.dateWords}" as ${dayWords(fromWords)}.`);
  } else if (isDate(d.date)) {
    date = d.date;
    dateConf = Math.min(c.date ?? 0.5, 0.7);
  }
  // a flyer that says "SUN 25 OCT" must agree with itself; if the day and the date clash, ask
  const said = weekdayInWords(d.dateWords);
  if (date && said != null && /\d/.test(String(d.dateWords)) && weekdayOf(date) !== said) {
    notes.push(`"${d.dateWords}" names ${DAY_NAMES[said]}, but ${date} is a ${DAY_NAMES[weekdayOf(date)]}. Check the date.`);
    dateConf = Math.min(dateConf, 0.3);
  }
  if (date && daysBetween(today, date) < 0) {
    notes.push(`The date ${date} has passed.`);
    dateConf = Math.min(dateConf, 0.3);
  }
  let time = resolveTimeWords(d.startTime);
  let timeConf = time ? c.time ?? 0.8 : 0;
  // a typed message with one clear clock time ("Start 2pm") is read by code when the model
  // misses it (on 21 Oct 2026 Gemma answered "2nd" for that, from "Sat 31st")
  if (!time && t && !image) {
    const clock = [...t.matchAll(/\b(\d{1,2})(?:[:.](\d{2}))?\s?(am|pm)\b/gi)];
    if (clock.length === 1) {
      time = resolveTimeWords(clock[0][0]);
      if (time) {
        timeConf = 0.7;
        notes.push(`Read the time as ${clock12(time)} from "${clock[0][0]}".`);
      }
    }
  }
  if (time && isAmbiguousTime(d.startTime)) {
    timeConf = Math.min(timeConf, 0.55);
    notes.push(`Read "${d.startTime}" as ${clock12(time)}.`);
  }
  let start = date && time ? toIsoLocal(zonedToMs(date, time, tz), tz) : null;
  let end = null;
  const endTime = resolveTimeWords(d.endTime);
  if (start && date && endTime) {
    const endDate = minutesOfDay(endTime) <= minutesOfDay(/** @type {string} */ (time)) ? addDays(date, 1) : date;
    end = toIsoLocal(zonedToMs(endDate, endTime, tz), tz);
  }
  let startConf = start ? Math.min(dateConf, timeConf) : 0;
  let endConf = end ? Math.min(startConf, c.time ?? 0.7) : 0;

  let title = firstCap(calmCaps(text(d.title, 120)));
  let titleConf = title ? c.title ?? 0.6 : 0;
  let venue = calmCaps(text(d.venueName, 120));
  let address = calmCaps(text(d.address, 200));
  let priceText = calmCaps(text(d.priceText, 60));
  if (priceText && local.fixPrice) priceText = local.fixPrice(priceText);
  let free = d.free === true || (priceText ? /\bfree\b/i.test(priceText) : false);
  let hostName = calmCaps(text(d.hostName, 60));
  let placeConf = ground(venue || address, venue || address ? c.place ?? 0.6 : 0, "place");
  let priceConf = ground(priceText, priceText ? c.price ?? 0.6 : 0, "price");
  const hostConf = ground(hostName, hostName ? c.host ?? 0.6 : 0, "host");
  if (title && checkable && groundedShare(title, source) < 0.3) titleConf = Math.min(titleConf, 0.5);

  // a page's own event data beats any reading
  const ev = pageMeta?.event;
  if (ev) {
    const s = parseEventDate(ev.startDate, tz);
    if (s) {
      start = s;
      startConf = 0.95;
      const e = parseEventDate(ev.endDate, tz);
      if (e && e > s) {
        end = e;
        endConf = 0.95;
      }
    }
    if (ev.name) [title, titleConf] = [calmCaps(text(ev.name, 120)), 0.95];
    if (ev.venue || ev.address) [venue, address, placeConf] = [text(ev.venue, 120) ?? venue, tidyAddress(text(ev.address, 200)) ?? address, 0.95];
    if (ev.price || ev.free) [priceText, free, priceConf] = [text(ev.price, 60) ?? (ev.free ? "Free" : priceText), ev.free === true, 0.9];
    // the organiser picks the currency; a Lagos event priced in dollars (or, once seen, in
    // Norwegian kroner for naira tickets) is worth a second look. With no known local
    // currency there is nothing to compare, and nothing is assumed.
    if (!ev.free && ev.currency && local.currency && ev.currency !== local.currency) {
      priceConf = 0.5;
      notes.push(`The page lists the price in ${ev.currency}, not ${local.currencyName || `the local currency (${local.currency})`}. Check what you will pay with the organiser.`);
    }
    if (ev.status) notes.push(`The page marks this event as ${ev.status.replace(/^Event/, "").toLowerCase()}. Check with the organiser.`);
    if (ev.organizer && !hostName) hostName = text(ev.organizer, 60);
    notes.push("Read from the event page's own details.");
  }

  // what to bring must be in what was shared: on 21 Oct 2026 Gemma answered "a bottle" for
  // "carry your own drink", copying the prompt's own example
  const bring = (Array.isArray(d.bring) ? d.bring : []).map((/** @type {any} */ b) => text(b, 60)).filter(Boolean).filter((/** @type {string} */ b) => {
    if (!checkable || groundedShare(b, source) >= 0.5) return true;
    notes.push(`Left out "${b}" from what to bring: the message does not say it.`);
    return false;
  }).slice(0, 10);

  const atHost = d.atHost === true;
  let kind = ["found", "hosted", "quick"].includes(d.kind) ? d.kind : atHost ? "hosted" : url || image ? "found" : "quick";
  if (atHost) kind = "hosted";
  // "at mine" from the member who shared it: they host, and the address stays private
  const selfHosted = atHost && (!hostName || norm(hostName) === norm(member.name));
  const place = {
    name: venue ?? (selfHosted ? `${member.name}'s place` : atHost && hostName ? `${hostName}'s place` : null),
    address,
    lat: null,
    lon: null,
    outdoor: d.outdoor === true,
    private: atHost,
  };
  if (selfHosted && !address) notes.push("Add your address if the crew doesn't know it. Only the crew sees it.");
  if (!start) notes.push(date ? "What time does it start?" : "Which day is it?");

  const draft = {
    kind,
    title,
    start,
    end,
    tz,
    place,
    price: priceText || free ? { text: priceText ?? "Free", free } : null,
    host: selfHosted ? member.id : null,
    hostName: selfHosted ? null : hostName,
    bring,
    source: { ...(t ? { text: t.slice(0, 2000) } : {}), ...(url ? { url } : {}), ...(image ? { image: true } : {}) },
  };
  const confidence = {
    title: titleConf,
    start: startConf,
    end: end ? endConf : 0,
    place: selfHosted ? Math.max(placeConf, 0.8) : placeConf,
    price: priceConf,
    host: selfHosted ? 0.9 : hostConf,
  };
  // a field that is simply absent is not "low confidence": it is empty, and the UI asks
  const low = lowFields(Object.fromEntries(Object.entries(confidence).filter(([k, v]) => v > 0 || ["title", "start"].includes(k))), []);
  return { draft: { ...draft, confidence }, confidence, low, notes };
}

/** A schema.org date ("2026-10-24T20:00:00+01:00", "2026-10-24T20:00", "2026-10-24") to an ISO instant, or null. */
export function parseEventDate(s, tz = DEFAULT_TZ) {
  if (typeof s !== "string") return null;
  const m = s.trim().match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/);
  if (!m || !isDate(m[1])) return null;
  if (!m[2]) return null; // a date with no time is not a start time
  if (m[3]) {
    const ms = Date.parse(`${m[1]}T${m[2]}:00${m[3].length === 5 ? `${m[3].slice(0, 3)}:${m[3].slice(3)}` : m[3]}`);
    return Number.isFinite(ms) ? toIsoLocal(ms, tz) : null;
  }
  return isTime(m[2]) ? toIsoLocal(zonedToMs(m[1], m[2], tz), tz) : null;
}

// ---------------------------------------------------------------- explanation and invite

/** Every number in a text ("4pm" gives 4; "16:00" gives 16 and 0). */
const numbersIn = (/** @type {string} */ s) => (s.match(/\d+(?:\.\d+)?/g) || []).map(Number);

/**
 * True when every number in the output is one the facts contain (or the 12-hour form of
 * an hour in the facts), so the model cannot have invented a time, a price or a count.
 * @param {string} out
 * @param {any} facts
 */
export function numbersGrounded(out, facts) {
  const allowed = new Set(numbersIn(JSON.stringify(facts)));
  for (const n of [...allowed]) if (n > 12 && n < 24) allowed.add(n - 12);
  return numbersIn(out).every((n) => allowed.has(n) || n === 0);
}

/** The facts for explain-pick: a trimmed copy of the explanation object. */
export function explainFacts(explanation) {
  return {
    place: explanation.pick.name,
    kind: explanation.pick.kind,
    green: explanation.pick.green,
    free: explanation.pick.fee === "no",
    // neighbourhoods and minutes only: member names stay with Come Through
    trips: explanation.members.map((/** @type {any} */ m) => ({ from: m.from, minutes: m.minutes })),
    longestMinutes: explanation.maxMinutes,
    vibe: explanation.vibeMatched,
    lastVisitedDaysAgo: explanation.lastUsedDaysAgo,
    reasons: explanation.reasons,
    alternatives: explanation.notChosen,
    // what the crew is into that this place is (closed words from src/core/taste.mjs), and
    // whether it is a quiet, low-key spot; never who the crew is
    ...(explanation.taste ? { fitsTaste: explanation.taste.matched, lowKey: explanation.taste.lowKey } : {}),
  };
}

/** A reason or invite that names who people are, or says a venue is "friendly" or "safe" for someone without a source. */
export const unsafeText = (/** @type {string} */ s, /** @type {(string|null|undefined)[]} */ names = []) => {
  // a place's own name ("Church Street Garden") is a fact, not a claim about anyone
  const t = names.filter(Boolean).reduce((acc, n) => acc.split(/** @type {string} */ (n)).join(" "), s);
  return hasSensitive(t) || UNSOURCED_CLAIM.test(t);
};

/** @param {Prompt} prompt @param {any} explanation @returns {Message[]} */
export function explainMessages(prompt, explanation) {
  return [{ role: "system", content: prompt.system }, { role: "user", content: fill(prompt.user, { facts: JSON.stringify(explainFacts(explanation), null, 1) }) }];
}

/** A plain explanation built by code, used when Gemma is unavailable or strays from the facts. */
export function explainFallback(explanation) {
  const e = explanation;
  const fit = e.taste?.matched?.[0];
  if (fit) {
    const quiet = e.taste.lowKey ? ", quiet and easy to keep low-key" : "";
    return `${e.pick.name} is ${fit}${quiet}, and it keeps everyone within about ${e.maxMinutes} minutes.`;
  }
  const bits = [`${e.pick.name} keeps everyone within about ${e.maxMinutes} minutes`];
  const extras = [];
  if (e.taste?.lowKey) extras.push("it is quiet and easy to keep low-key");
  if (e.pick.green) extras.push(`it is ${e.pick.kind === "beach" ? "by the water" : "green and outdoors"}`);
  if (e.pick.fee === "no") extras.push("it is free");
  if (e.lastUsedDaysAgo == null) extras.push("the crew has not been there lately");
  return `${bits[0]}${extras.length ? `, and ${extras.join(", ")}` : ""}.`;
}

/**
 * The explanation sentence: Gemma's when it is grounded, else the code's.
 * @returns {{ why: string, by: "gemma"|"code" }}
 */
export function readExplain(data, explanation) {
  const why = text(data?.why, 300);
  if (why && !unsafeText(why, [explanation.pick.name, ...(explanation.notChosen || []).map((/** @type {any} */ n) => n.name)]) && numbersGrounded(why, explainFacts(explanation)) && why.includes(explanation.pick.name.split(" ")[0])) return { why: noDashes(why), by: "gemma" };
  return { why: explainFallback(explanation), by: "code" };
}

/**
 * @param {Prompt} prompt
 * @param {{ title: string, day: string, date: string, time: string, place: string, weather?: string|null, rain?: string|null, why?: string|null, vibe?: string|null }} facts
 * @returns {Message[]}
 */
export function inviteMessages(prompt, facts) {
  return [{ role: "system", content: fill(prompt.system, { vibe: facts.vibe || "easygoing friends" }) }, { role: "user", content: fill(prompt.user, { facts: JSON.stringify(facts, null, 1) }) }];
}

/** @returns {{ invite: string, by: "gemma"|"code" }} */
export function readInvite(data, facts, fallback) {
  const invite = text(data?.invite, 320);
  // the invite travels (calendar, push, the plain page): no taste, no needs, no claims
  if (invite && invite.length <= 320 && !unsafeText(invite, [facts.place, facts.title]) && !/\b(discreet|low-key|lowkey|private|safe)\b/i.test(invite) && numbersGrounded(invite, facts)) return { invite: noDashes(invite), by: "gemma" };
  return { invite: fallback, by: "code" };
}

// ---------------------------------------------------------------- feedback

/** @param {Prompt} prompt @param {{ text: string }} input @returns {Message[]} */
export function feedbackMessages(prompt, { text: t }) {
  return [{ role: "system", content: prompt.system }, { role: "user", content: fill(prompt.user, { text: t.trim().slice(0, 500) }) }];
}

export function readFeedback(data, { text: t }) {
  const d = data && typeof data === "object" ? data : {};
  const c = cleanConfidence(d.confidence);
  const closerTo = text(d.closerTo, 60);
  const okCloser = closerTo && groundedShare(closerTo, t) >= 0.5 ? closerTo : null;
  const list = (/** @type {any} */ xs) => (Array.isArray(xs) ? xs.map((x) => text(x, 60)).filter(Boolean) : []);
  const avoid = list(d.avoid).filter((/** @type {string} */ a) => groundedShare(a, t) >= 0.5);
  const prefer = list(d.prefer).map((/** @type {string} */ p) => p.toLowerCase()).filter((/** @type {string} */ p) => VIBE_MATCHERS[p] || ["shade", "indoors", "games"].includes(p));
  const out = {
    closerTo: okCloser,
    avoid,
    prefer,
    budget: ["cheaper", "pricier"].includes(d.budget) ? d.budget : null,
    time: ["earlier", "later"].includes(d.time) ? d.time : null,
  };
  const confidence = {
    closerTo: out.closerTo ? c.closerTo ?? 0.6 : 0,
    avoid: out.avoid.length ? c.avoid ?? 0.6 : 0,
    prefer: out.prefer.length ? c.prefer ?? 0.6 : 0,
    budget: out.budget ? c.budget ?? 0.6 : 0,
    time: out.time ? c.time ?? 0.6 : 0,
  };
  return { feedback: out, confidence, low: lowFields(Object.fromEntries(Object.entries(confidence).filter(([, v]) => v > 0)), []) };
}
