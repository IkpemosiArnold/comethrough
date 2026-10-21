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

import { cleanConfidence, lowFields } from "./plans.mjs";
import { VIBE_MATCHERS } from "./places.mjs";
import { DAY_NAMES, DEFAULT_TZ, isAmbiguousTime, isDate, isTime, resolveDateWords, resolveTimeWords, toIsoLocal, zonedToMs, minutesOfDay, addDays, daysBetween, weekdayOf } from "./time.mjs";

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
    confidence: conf(["name", "vibe", "rhythm", "areas"]),
  },
  required: ["name", "vibe", "vibeTags", "budget", "every", "day", "from", "to", "areas", "confidence"],
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
export const MAX_TOKENS = { "parse-crew": 400, "parse-plan": 600, "explain-pick": 200, "write-invite": 250, "parse-feedback": 250 };

// ---------------------------------------------------------------- shared checks

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

/** @param {Prompt} prompt @param {{ sentence: string }} input @returns {Message[]} */
export function crewSetupMessages(prompt, { sentence }) {
  return [{ role: "system", content: prompt.system }, { role: "user", content: fill(prompt.user, { sentence: sentence.trim().slice(0, 500) }) }];
}

/** Time-of-day words to a window. */
export const DAYPARTS = { morning: ["09:00", "12:00"], afternoon: ["13:00", "17:00"], evening: ["17:00", "21:00"], night: ["19:00", "23:00"], daytime: ["11:00", "17:00"] };
/** The default window for a rhythm with no time: late afternoon, after the worst heat. */
export const DEFAULT_WINDOW = { from: "15:00", to: "19:00" };

/**
 * @param {any} data  the parsed answer (or null)
 * @param {{ sentence: string }} input
 */
export function readCrewSetup(data, { sentence }) {
  const d = data && typeof data === "object" ? data : {};
  const c = cleanConfidence(d.confidence);
  /** @type {string[]} */
  const notes = [];
  /** @type {string[]} */
  const filled = [];
  const name = text(d.name, 60);
  const vibe = text(d.vibe, 80);
  const vibeTags = Array.isArray(d.vibeTags) ? [...new Set(d.vibeTags.map((/** @type {any} */ t) => String(t).toLowerCase().trim()).filter((/** @type {string} */ t) => VIBE_MATCHERS[t] || t === "games"))].slice(0, 6) : [];
  const budget = ["free", "cheap", "any"].includes(d.budget) ? d.budget : null;
  const dayIdx = typeof d.day === "string" ? DAY_NAMES.findIndex((n) => n.toLowerCase().startsWith(d.day.toLowerCase().trim().slice(0, 3))) : -1;
  let rhythm = null;
  if (["1w", "2w", "4w"].includes(d.every) && dayIdx >= 0) {
    const part = (/** @type {any} */ w) => (typeof w === "string" ? DAYPARTS[/** @type {keyof typeof DAYPARTS} */ (w.toLowerCase().trim())] : null);
    let from = part(d.from)?.[0] ?? resolveTimeWords(d.from);
    let to = part(d.from)?.[1] ?? resolveTimeWords(d.to);
    if (from && !to) to = addHours(from, 4);
    if (!from || !to || minutesOfDay(to) <= minutesOfDay(from)) {
      ({ from, to } = DEFAULT_WINDOW);
      filled.push("rhythm.window");
      notes.push("No time was given, so the window is 3 pm to 7 pm, after the worst heat.");
    }
    rhythm = { every: d.every, day: dayIdx, window: { from, to } };
  } else if (d.every || d.day) {
    notes.push("The rhythm needs both how often and which day.");
  }
  // an area must be something the sentence actually says: one of its distinctive words at least
  // (the sentence says "Lekki", the model may say "Lekki Phase 1")
  const said = ` ${norm(sentence)} `;
  const areas = (Array.isArray(d.areas) ? d.areas : []).map((/** @type {any} */ a) => text(a, 60)).filter(Boolean).filter((/** @type {string} */ a) => {
    const ok = norm(a).split(" ").some((w) => w.length >= 3 && !/^(lagos|phase|estate|road|street|area|town|the)$/.test(w) && said.includes(` ${w} `));
    if (!ok) notes.push(`Left out "${a}": the sentence does not mention it.`);
    return ok;
  }).slice(0, 6);
  const confidence = {
    name: name ? c.name ?? 0.5 : 0,
    vibe: vibe ? c.vibe ?? 0.5 : 0,
    rhythm: rhythm ? Math.min(c.rhythm ?? 0.5, filled.includes("rhythm.window") ? 0.55 : 1) : 0,
    areas: areas.length ? c.areas ?? 0.5 : 0,
  };
  if (name && groundedShare(name, sentence) < 0.5) confidence.name = Math.min(confidence.name, 0.4);
  // the budget falls back to a plain reading of the sentence, then to "any"
  const budgetOut = budget ?? (/\b(cheap|broke|budget|low.?key)\b/i.test(sentence) ? "cheap" : /\bfree\b/i.test(sentence) ? "free" : "any");
  return { draft: { name, vibe, vibeTags, budget: budgetOut, rhythm, areaLabels: areas }, confidence, low: lowFields(confidence, filled), notes };
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
 * @property {{ name?: string|null, startDate?: string|null, endDate?: string|null, venue?: string|null, address?: string|null, price?: string|null, free?: boolean|null, organizer?: string|null }|null} [event]
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
 * @param {{ text?: string|null, url?: string|null, pageMeta?: PageMeta|null, image?: any, today: string, tz?: string, member: { id: string, name: string } }} input
 */
export function readPlan(data, { text: t, url, pageMeta, image, today, tz = DEFAULT_TZ, member }) {
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
  const fromWords = resolveDateWords(d.dateWords, today);
  if (fromWords) {
    date = fromWords;
    dateConf = c.date ?? 0.8;
    if (isDate(d.date) && d.date !== fromWords) notes.push(`Read "${d.dateWords}" as ${fromWords}.`);
  } else if (isDate(d.date)) {
    date = d.date;
    dateConf = Math.min(c.date ?? 0.5, 0.7);
  }
  if (date && daysBetween(today, date) < 0) {
    notes.push(`The date ${date} has passed.`);
    dateConf = Math.min(dateConf, 0.3);
  }
  let time = resolveTimeWords(d.startTime);
  let timeConf = time ? c.time ?? 0.8 : 0;
  if (time && isAmbiguousTime(d.startTime)) {
    timeConf = Math.min(timeConf, 0.55);
    notes.push(`Read "${d.startTime}" as ${time}.`);
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

  let title = text(d.title, 120);
  let titleConf = title ? c.title ?? 0.6 : 0;
  let venue = text(d.venueName, 120);
  let address = text(d.address, 200);
  let priceText = text(d.priceText, 60);
  let free = d.free === true || (priceText ? /\bfree\b/i.test(priceText) : false);
  let hostName = text(d.hostName, 60);
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
    if (ev.name) [title, titleConf] = [text(ev.name, 120), 0.95];
    if (ev.venue || ev.address) [venue, address, placeConf] = [text(ev.venue, 120) ?? venue, text(ev.address, 200) ?? address, 0.95];
    if (ev.price || ev.free) [priceText, free, priceConf] = [text(ev.price, 60) ?? (ev.free ? "Free" : priceText), ev.free === true, 0.9];
    if (ev.organizer && !hostName) hostName = text(ev.organizer, 60);
    notes.push("Used the event details the page publishes.");
  }

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
  if (selfHosted && !address) notes.push("Add your address if the crew does not know it; only members will see it.");
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
    bring: (Array.isArray(d.bring) ? d.bring : []).map((/** @type {any} */ b) => text(b, 60)).filter(Boolean).slice(0, 10),
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
    trips: explanation.members.map((/** @type {any} */ m) => ({ who: m.name, from: m.from, minutes: m.minutes })),
    longestMinutes: explanation.maxMinutes,
    vibe: explanation.vibeMatched,
    lastVisitedDaysAgo: explanation.lastUsedDaysAgo,
    reasons: explanation.reasons,
    alternatives: explanation.notChosen,
  };
}

/** @param {Prompt} prompt @param {any} explanation @returns {Message[]} */
export function explainMessages(prompt, explanation) {
  return [{ role: "system", content: prompt.system }, { role: "user", content: fill(prompt.user, { facts: JSON.stringify(explainFacts(explanation), null, 1) }) }];
}

/** A plain explanation built by code, used when Gemma is unavailable or strays from the facts. */
export function explainFallback(explanation) {
  const e = explanation;
  const bits = [`${e.pick.name} keeps everyone within about ${e.maxMinutes} minutes`];
  const extras = [];
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
  if (why && numbersGrounded(why, explainFacts(explanation)) && why.includes(explanation.pick.name.split(" ")[0])) return { why: noDashes(why), by: "gemma" };
  return { why: explainFallback(explanation), by: "code" };
}

/**
 * @param {Prompt} prompt
 * @param {{ title: string, day: string, date: string, window: { from: string, to: string }, place: string, weather?: string|null, why?: string|null, vibe?: string|null }} facts
 * @returns {Message[]}
 */
export function inviteMessages(prompt, facts) {
  return [{ role: "system", content: fill(prompt.system, { vibe: facts.vibe || "easygoing friends" }) }, { role: "user", content: fill(prompt.user, { facts: JSON.stringify(facts, null, 1) }) }];
}

/** @returns {{ invite: string, by: "gemma"|"code" }} */
export function readInvite(data, facts, fallback) {
  const invite = text(data?.invite, 320);
  if (invite && invite.length <= 320 && numbersGrounded(invite, facts)) return { invite: noDashes(invite), by: "gemma" };
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
