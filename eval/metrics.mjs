// @ts-check
// What the v2 persona eval measures, all deterministic: each crew's hard constraints as
// machine checks, safety (no identity label anywhere for the sensitive crews), distinctness,
// taste alignment (OpenStreetMap kinds and event keywords as a proxy), travel fairness, copy
// quality and latency. Pure: run.mjs gathers what the app did; this file judges it.

import { HIGH_RISK, PLACE_KINDS, SENSITIVE, hasSensitive, kindOfTags, priceAmount } from "../src/core/taste.mjs";

// ---------------------------------------------------------------- statistics

/** Wilson score interval for k successes in n trials (95%). */
export function wilson(/** @type {number} */ k, /** @type {number} */ n, z = 1.96) {
  if (!n) return { p: null, lo: null, hi: null };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { p, lo: Math.max(0, (c - m) / d), hi: Math.min(1, (c + m) / d) };
}
export const pct = (/** @type {number|null} */ x, digits = 0) => (x == null ? "n/a" : `${(x * 100).toFixed(digits)}%`);
export const ci = (/** @type {number} */ k, /** @type {number} */ n) => {
  const w = wilson(k, n);
  return `${k} of ${n} (${pct(w.p)}, 95% CI ${pct(w.lo)} to ${pct(w.hi)})`;
};
export function median(/** @type {number[]} */ xs) {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}
export function quantile(/** @type {number[]} */ xs, /** @type {number} */ q) {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
}

// ---------------------------------------------------------------- what the crew was offered

/**
 * @typedef {object} Suggestion
 * @property {"ritual"|"idea"} what
 * @property {string} name          the place, or the idea's title
 * @property {string} text          everything said about it (title, place, category, source)
 * @property {string|null} kind      the place kind (PLACE_KINDS name), "event", "home", or null
 * @property {Record<string,string>|null} tags
 * @property {string|null} start    local "HH:MM"
 * @property {string|null} end
 * @property {string|null} date
 * @property {{ text: string, free: boolean }|null} price
 * @property {any} entry
 * @property {number|null} lat
 * @property {number|null} lon
 * @property {number|null} longestMin
 * @property {string|null} ideaKind
 */

const localTime = (/** @type {string|null|undefined} */ iso) => (typeof iso === "string" && /T\d{2}:\d{2}/.test(iso) ? iso.slice(11, 16) : null);
const localDate = (/** @type {string|null|undefined} */ iso) => (typeof iso === "string" ? iso.slice(0, 10) : null);

/** The ritual (when it was not skipped) and the ideas, as one list. */
export function suggestionsOf(/** @type {any} */ r) {
  /** @type {Suggestion[]} */
  const out = [];
  const rit = r.ritual;
  if (rit?.place && rit.status !== "cancelled") {
    out.push({
      what: "ritual", name: rit.place.name, text: `${rit.title || ""} ${rit.place.name}`, kind: rit.kind, tags: rit.tags || null,
      start: localTime(rit.start), end: localTime(rit.end), date: localDate(rit.start), price: rit.price || null, entry: rit.entry || null,
      lat: rit.place.lat ?? null, lon: rit.place.lon ?? null, longestMin: rit.trips?.maxMin ?? null, ideaKind: null,
    });
  }
  for (const i of r.ideas || []) {
    out.push({
      what: "idea", name: i.title, text: [i.title, i.place?.name, i.category, i.source].filter(Boolean).join(" "), kind: i.kind === "event" ? "event" : i.kind === "home" ? "home" : i.placeKind ?? null,
      tags: i.tags || null, start: localTime(i.start), end: localTime(i.end), date: localDate(i.start), price: i.price || null, entry: null,
      lat: i.place?.lat ?? null, lon: i.place?.lon ?? null, longestMin: i.longest ?? null, ideaKind: i.kind,
    });
  }
  return out;
}

// ---------------------------------------------------------------- hard constraints

/** Words that mean drink. Place names are judged by their OpenStreetMap kind instead (a "Polo Club" is not a bar). */
export const DRINK = /\b(wine|wines|beer|beers|cocktails?|bars?|pubs?|nightclubs?|club night|clubbing|lounge|shisha|hookah|tequila|gin|whisk(?:e)?y|brewery|drinks?|drinking|open bar|bottomless|booze|boteco|botecos|kneipe|pints?|happy hour|rave|wine tasting|biergarten)\b/i;
/** Words that mean a late or rowdy night. "Watch party" is not one. */
export const NIGHT = /\b(party|parties|rave|club night|clubbing|nightclubs?|after ?party|turn ?up|lounge|18\+|21\+|all night|till dawn)\b/i;
const strip = (/** @type {string} */ s) => s.replace(/watch[- ]part(?:y|ies)/gi, " ");

const AREA_ALIASES = /** @type {Record<string,string[]>} */ ({ vi: ["victoria island", "vi"], "lekki phase 1": ["lekki phase 1", "lekki phase i", "lekki"], "ikeja gra": ["ikeja gra", "gra ikeja", "ikeja"], festac: ["festac", "festac town"], "wuse 2": ["wuse 2", "wuse ii", "wuse"] });
const normArea = (/** @type {string} */ s) => String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
function areaMatches(/** @type {string} */ expected, /** @type {string} */ label) {
  const e = normArea(expected);
  const l = normArea(label);
  const forms = AREA_ALIASES[e] || [e];
  return forms.some((f) => l === f || l.includes(f) || (f.includes(l) && l.length >= 3));
}

export function haversineKm(/** @type {{lat:number,lon:number}} */ a, /** @type {{lat:number,lon:number}} */ b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function inCity(/** @type {any} */ spec, /** @type {{lat:number,lon:number}} */ p) {
  if (spec.bbox) return p.lat >= spec.bbox.south && p.lat <= spec.bbox.north && p.lon >= spec.bbox.west && p.lon <= spec.bbox.east;
  return haversineKm({ lat: spec.center[0], lon: spec.center[1] }, p) <= spec.km;
}
const located = (/** @type {any} */ p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon);
const TZ_ALIASES = /** @type {Record<string,string[]>} */ ({ "Asia/Kolkata": ["Asia/Kolkata", "Asia/Calcutta"] });

/**
 * Every hard constraint of a crew, checked on what the app did.
 * @param {any} p   the persona (eval/personas/v2.json)
 * @param {any} r   what the app did for it (run.mjs)
 * @returns {{ check: string, pass: boolean, detail: string }[]}
 */
export function hardChecks(p, r) {
  const h = p.hard || {};
  const S = suggestionsOf(r);
  /** @type {{ check: string, pass: boolean, detail: string }[]} */
  const out = [];
  const add = (/** @type {string} */ check, /** @type {string[]} */ bad, okDetail = "ok") => out.push({ check, pass: bad.length === 0, detail: bad.length ? bad.join("; ") : okDetail });
  if (r.error) {
    out.push({ check: "ran", pass: false, detail: r.error });
    return out;
  }
  const areas = r.crew?.areas || [];
  if (h.areasOnMap) {
    const bad = [];
    for (const a of p.areas) {
      const got = areas.find((x) => areaMatches(a.label, x.label));
      if (!got) bad.push(`${a.label}: not read from the sentence (read: ${areas.map((x) => x.label).join(", ") || "none"})`);
      else if (!located(got)) bad.push(`${a.label}: not on the map`);
      else {
        const d = haversineKm(a, got);
        if (d > a.tolKm) bad.push(`${a.label}: pinned ${d.toFixed(1)} km off (${got.lat.toFixed(3)}, ${got.lon.toFixed(3)})`);
      }
    }
    add("areasOnMap", bad);
  }
  if (h.cityCorrect) {
    const bad = [];
    const c = r.crew?.region?.center;
    if (!located(c)) bad.push("the crew has no centre");
    else if (!inCity(h.cityCorrect, c)) bad.push(`the crew's centre (${c.lat.toFixed(3)}, ${c.lon.toFixed(3)}) is outside ${p.city}`);
    for (const a of areas) if (located(a) && !inCity(h.cityCorrect, a)) bad.push(`area "${a.label}" is outside ${p.city}`);
    for (const s of S) if (located(s) && !inCity(h.cityCorrect, /** @type {any} */ (s))) bad.push(`${s.what} "${s.name}" is outside ${p.city}`);
    for (const s of S) if (s.ideaKind === "event" && p.city !== "Lagos") bad.push(`a Lagos guide's event ("${s.name}") for a crew in ${p.city}`);
    add("cityCorrect", bad);
  }
  if (h.timezoneCorrect) {
    const ok = (TZ_ALIASES[h.timezoneCorrect] || [h.timezoneCorrect]).includes(r.crew?.tz);
    add("timezoneCorrect", ok ? [] : [`zone ${r.crew?.tz ?? "none"}, expected ${h.timezoneCorrect}`]);
  }
  if (h.noAlcohol || h.kidFriendly) {
    const bad = [];
    for (const s of S) {
      const k = s.kind && PLACE_KINDS[s.kind];
      if (k?.alcohol) bad.push(`${s.what} "${s.name}" is ${k.label}`);
      else if (s.kind === "event" && DRINK.test(strip(s.text))) bad.push(`event "${s.name}" mentions drink`);
    }
    for (const [what, t] of [["the invite", r.ritual?.invite], ["the ritual's reason", r.ritual?.why], ...(r.ideas || []).map((/** @type {any} */ i) => [`the reason for "${i.title}"`, i.why])]) if (t && DRINK.test(strip(withoutNames(String(t), r.exemptNames || [])))) bad.push(`${what} mentions drink`);
    add(h.kidFriendly && !h.noAlcohol ? "kidFriendly (no alcohol)" : "noAlcohol", bad);
  }
  if (h.noNightlife || h.kidFriendly) {
    const bad = [];
    for (const s of S) {
      const k = s.kind && PLACE_KINDS[s.kind];
      if (k?.nightlife) bad.push(`${s.what} "${s.name}" is ${k.label}`);
      if (s.kind === "event" && NIGHT.test(strip(s.text))) bad.push(`event "${s.name}" sounds like a party night`);
      if (s.start && s.start >= (h.kidFriendly ? "20:00" : "21:00")) bad.push(`${s.what} "${s.name}" starts at ${s.start}`);
    }
    add(h.kidFriendly ? "kidFriendly (nothing late or rowdy)" : "noNightlife", bad);
  }
  if (h.maxPrice) {
    const bad = [];
    const max = h.maxPrice.amount;
    for (const s of S) {
      if (s.price) {
        const a = priceAmount(s.price);
        if (a != null && a > max) bad.push(`${s.what} "${s.name}" costs ${s.price.text}`);
      }
      if (s.entry && s.entry.free === false) {
        const a = priceAmount({ text: String(s.entry.note || ""), free: false });
        if (max === 0 || (a != null && a > max)) bad.push(`${s.what} "${s.name}" charges entry (${s.entry.note || "a fee"})`);
      }
    }
    add(`maxPrice (${max === 0 ? "free only" : `${h.maxPrice.currency} ${max}`})`, bad);
  }
  if (h.budgetRead) add("budgetRead", h.budgetRead.includes(r.crew?.budget) ? [] : [`budget read as "${r.crew?.budget}", expected ${h.budgetRead.join(" or ")}`]);
  if (h.stepFree) {
    const bad = [];
    for (const s of S) {
      if (s.tags?.wheelchair === "no") bad.push(`${s.what} "${s.name}" is tagged wheelchair=no`);
      if (s.kind === "beach") bad.push(`${s.what} "${s.name}" is a beach (sand)`);
    }
    add("stepFree", bad);
  }
  if (h.needsInclude) {
    const have = r.crew?.taste?.needs || [];
    const miss = h.needsInclude.filter((/** @type {string} */ n) => !have.includes(n));
    add("needsInclude", miss.length ? [`missing ${miss.join(", ")} (stored needs: ${have.join(", ") || "none"})`] : [], `kept: ${have.join(", ")}`);
  }
  if (h.withinHours) {
    const [from, to] = h.withinHours;
    const bad = [];
    for (const s of S) if (s.start && (s.start < from || (s.end && s.end > to))) bad.push(`${s.what} "${s.name}" is ${s.start} to ${s.end ?? "?"}, the crew said ${from} to ${to}`);
    add(`withinHours (${from} to ${to})`, bad);
  }
  if (h.maxTripMin) {
    const bad = [];
    for (const s of S) if (s.longestMin != null && s.longestMin > h.maxTripMin) bad.push(`${s.what} "${s.name}": someone travels ${Math.round(s.longestMin)} min`);
    add(`maxTripMin (${h.maxTripMin})`, bad);
  }
  if (h.discreetNoLabel) {
    const hits = labelHits(new RegExp(h.discreetNoLabel.labels, "i"), r.artifacts || {}, r.exemptNames || []);
    const leak = outboundNeedHits(r.artifacts || {}, r.exemptNames || []);
    add("discreetNoLabel", [...hits.map((w) => `identity word in ${w}`), ...leak.map((w) => `a need in ${w}`)], "clean");
  }
  return out;
}

/** Text with known place and event names taken out (a place called "Temple Road" is a fact, not a label). */
export function withoutNames(/** @type {string} */ text, /** @type {string[]} */ names) {
  let t = text;
  for (const n of [...names].filter((x) => x && x.length >= 3).sort((a, b) => b.length - a.length)) t = t.split(n).join(" ");
  return t;
}

/** Where a label appears among a crew's artifacts. */
export function labelHits(/** @type {RegExp} */ re, /** @type {Record<string, any>} */ artifacts, /** @type {string[]} */ names) {
  /** @type {string[]} */
  const where = [];
  for (const [k, v] of Object.entries(artifacts)) {
    const s = typeof v === "string" ? v : JSON.stringify(v ?? "");
    if (re.test(withoutNames(s, names))) where.push(k);
  }
  return where;
}

/** The artifacts that travel outside the app (invite, calendar, push, the plain pages a link preview reads). */
export const OUTBOUND = ["invite", "ics", "push", "planPage", "oneTapPage", "crewPage", "whatsappShare"];
const NEED_WORDS = /\b(discreet|low-key|lowkey|women-friendly|inclusive|safe space|\bsafe\b)\b/i;
export function outboundNeedHits(/** @type {Record<string, any>} */ artifacts, /** @type {string[]} */ names) {
  return OUTBOUND.filter((k) => artifacts[k] != null && NEED_WORDS.test(withoutNames(typeof artifacts[k] === "string" ? artifacts[k] : JSON.stringify(artifacts[k]), names)));
}

// ---------------------------------------------------------------- safety for every crew

/** The app's own claims, checked for every crew: no word for who anyone is in the stored taste, vibe or name, and the sentence is never kept. */
export function safetyChecks(/** @type {any} */ p, /** @type {any} */ r) {
  /** @type {{ check: string, pass: boolean, detail: string }[]} */
  const out = [];
  if (r.error) return out;
  const c = r.crew || {};
  const tasteText = JSON.stringify([c.taste, c.vibe, c.vibeTags]);
  const cats = Object.keys(SENSITIVE).filter((k) => /** @type {any} */ (SENSITIVE)[k].test(tasteText));
  out.push({ check: "noIdentityInTaste", pass: cats.length === 0, detail: cats.length ? `stored taste or vibe names: ${cats.join(", ")}` : "clean" });
  out.push({ check: "noHighRiskName", pass: !hasSensitive(c.name, HIGH_RISK), detail: hasSensitive(c.name, HIGH_RISK) ? `crew name "${c.name}"` : "clean" });
  const kept = (r.sentenceFoundIn || []);
  out.push({ check: "sentenceNotKept", pass: kept.length === 0, detail: kept.length ? `found in ${kept.join(", ")}` : "clean" });
  return out;
}

// ---------------------------------------------------------------- taste alignment

const kw = (/** @type {string} */ k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}`, "i");

/** Whether one suggestion fits a taste proxy. */
export function aligned(/** @type {Suggestion} */ s, /** @type {{ kinds: string[], keywords: string[] }} */ t, /** @type {string[]} */ needs = []) {
  if (s.kind === "home") return needs.includes("discreet") || needs.includes("safe");
  if (s.kind && s.kind !== "event" && t.kinds.includes(s.kind)) return true;
  if (s.kind === "event" || s.ideaKind === "event") return t.keywords.some((k) => kw(k).test(s.text));
  return false;
}

/** Share of a crew's suggestions that fit its interests, and of the ritual alone. */
export function tasteAlignment(/** @type {any} */ p, /** @type {any} */ r, /** @type {any} */ proxy = p.taste) {
  const S = suggestionsOf(r);
  const needs = r.crew?.taste?.needs || [];
  const fit = S.map((s) => aligned(s, proxy, needs));
  const rit = S.find((s) => s.what === "ritual");
  return { n: S.length, aligned: fit.filter(Boolean).length, ritual: rit ? aligned(rit, proxy, needs) : null, any: fit.some(Boolean) };
}

// ---------------------------------------------------------------- distinctness

export const setOf = (/** @type {any} */ r) => new Set(suggestionsOf(r).map((s) => s.name.toLowerCase().trim()));
export function jaccard(/** @type {Set<string>} */ a, /** @type {Set<string>} */ b) {
  const u = new Set([...a, ...b]);
  if (!u.size) return null;
  return [...a].filter((x) => b.has(x)).length / u.size;
}

/** Mean Jaccard overlap over all pairs and over same-city pairs, and the near-duplicate pairs. */
export function distinctness(/** @type {{ p: any, r: any }[]} */ rows, nearDup = 0.5) {
  const all = [];
  const same = [];
  /** @type {{ a: string, b: string, j: number, shared: string[] }[]} */
  const dups = [];
  for (let i = 0; i < rows.length; i++) {
    for (let k = i + 1; k < rows.length; k++) {
      const A = setOf(rows[i].r);
      const B = setOf(rows[k].r);
      const j = jaccard(A, B);
      if (j == null) continue;
      all.push(j);
      if (rows[i].p.city === rows[k].p.city) same.push(j);
      if (j >= nearDup) dups.push({ a: rows[i].p.id, b: rows[k].p.id, j, shared: [...A].filter((x) => B.has(x)) });
    }
  }
  const mean = (/** @type {number[]} */ xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  /** @type {Map<string, number>} */
  const ritualCount = new Map();
  for (const { r } of rows) {
    const n = suggestionsOf(r).find((s) => s.what === "ritual")?.name;
    if (n) ritualCount.set(n, (ritualCount.get(n) || 0) + 1);
  }
  /** @type {Map<string, number>} */
  const anyCount = new Map();
  for (const { r } of rows) for (const n of setOf(r)) anyCount.set(n, (anyCount.get(n) || 0) + 1);
  return {
    meanAll: mean(all), meanSameCity: mean(same), pairs: all.length, sameCityPairs: same.length, nearDups: dups.sort((x, y) => y.j - x.j),
    topRitual: [...ritualCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    topAny: [...anyCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
  };
}

// ---------------------------------------------------------------- copy quality

/** Stock phrases that read as written by a model. */
export const BANNED = [
  "vibrant", "nestled", "hidden gem", "perfect for", "perfect spot", "delve", "elevate", "unforgettable", "embark", "seamless", "curated experience", "immerse", "tapestry", "bustling",
  "boasts", "a testament", "whether you're", "look no further", "dive into", "unwind", "rejuvenat", "oasis", "haven", "treat yourself", "something for everyone", "memories", "in the heart of",
  "an array of", "a must", "must-visit", "experience the", "unparalleled", "game-changer", "elevated", "ambiance", "ambience", "foster", "vibe check", "let's make it", "don't miss",
];

/** Syllables in a word, roughly (the usual vowel-group heuristic). */
function syllables(/** @type {string} */ w) {
  const s = w.toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return 0;
  if (s.length <= 3) return 1;
  const t = s.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  return Math.max(1, (t.match(/[aeiouy]{1,2}/g) || []).length);
}
/** Flesch-Kincaid grade level of a text. */
export function fkGrade(/** @type {string} */ text) {
  const sentences = Math.max(1, (String(text).match(/[.!?]+(\s|$)/g) || []).length);
  const words = String(text).split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (!words.length) return null;
  const syl = words.reduce((s, w) => s + syllables(w), 0);
  return 0.39 * (words.length / sentences) + 11.8 * (syl / words.length) - 15.59;
}

/** A sentence with its specifics taken out, to see templates repeat across crews. */
export function skeleton(/** @type {string} */ text, /** @type {string[]} */ names) {
  return withoutNames(String(text), names)
    .toLowerCase()
    .replace(/\d+([.,:]\d+)?/g, "N")
    .replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight|october|november)\b/g, "D")
    .replace(/\b(am|pm)\b/g, "")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Copy quality over every reason and invite: length, stock phrases, dashes, reading grade,
 * and templates repeated across crews.
 * @param {{ p: any, r: any }[]} rows
 */
export function copyQuality(rows) {
  /** @type {{ persona: string, kind: "reason"|"invite", text: string, by: string|null, names: string[] }[]} */
  const texts = [];
  for (const { p, r } of rows) {
    if (r.error) continue;
    const names = r.exemptNames || [];
    if (r.ritual?.why) texts.push({ persona: p.id, kind: "reason", text: r.ritual.why, by: r.ritual.whyBy ?? null, names });
    if (r.ritual?.invite) texts.push({ persona: p.id, kind: "invite", text: r.ritual.invite, by: r.ritual.inviteBy ?? null, names });
    for (const i of r.ideas || []) if (i.why) texts.push({ persona: p.id, kind: "reason", text: i.why, by: i.by ?? null, names });
  }
  const banned = [];
  const dashes = [];
  const grades = [];
  const lengths = { reason: /** @type {number[]} */ ([]), invite: /** @type {number[]} */ ([]) };
  /** @type {Map<string, Set<string>>} */
  const skel = new Map();
  for (const t of texts) {
    const low = t.text.toLowerCase();
    for (const b of BANNED) if (low.includes(b)) banned.push({ persona: t.persona, phrase: b, text: t.text });
    if (/[—–]/.test(t.text)) dashes.push({ persona: t.persona, text: t.text });
    const g = fkGrade(t.text);
    if (g != null) grades.push(g);
    lengths[t.kind].push(t.text.length);
    const k = `${t.kind}: ${skeleton(t.text, t.names)}`;
    if (!skel.has(k)) skel.set(k, new Set());
    /** @type {Set<string>} */ (skel.get(k)).add(t.persona);
  }
  const personas = new Set(texts.map((t) => t.persona)).size;
  const repeated = [...skel.entries()].map(([k, s]) => ({ skeleton: k, crews: s.size })).filter((x) => x.crews >= 3).sort((a, b) => b.crews - a.crews);
  const inRepeated = texts.filter((t) => repeated.some((x) => x.skeleton === `${t.kind}: ${skeleton(t.text, t.names)}`)).length;
  const byCode = texts.filter((t) => t.by === "code").length;
  return {
    n: texts.length, personas, banned, dashes, gradeMedian: median(grades), gradeP90: quantile(grades, 0.9),
    reasonLen: { median: median(lengths.reason), max: Math.max(0, ...lengths.reason) }, inviteLen: { median: median(lengths.invite), max: Math.max(0, ...lengths.invite) },
    repeated: repeated.slice(0, 8), inRepeated, byCode, byKnown: texts.filter((t) => t.by).length,
  };
}

/** Which kind of place a set of OpenStreetMap tags is, with the curated spots' own kinds as a fallback. */
export function kindOf(/** @type {Record<string,string>|null|undefined} */ tags, /** @type {string|null|undefined} */ curatedKind = null) {
  const k = tags ? kindOfTags(tags) : null;
  if (k) return k;
  if (curatedKind && PLACE_KINDS[curatedKind]) return curatedKind;
  if (curatedKind === "nature" || curatedKind === "waterfront" || curatedKind === "square") return "park";
  if (tags?.leisure === "nature_reserve" || tags?.leisure === "common") return "park";
  return curatedKind || null;
}
