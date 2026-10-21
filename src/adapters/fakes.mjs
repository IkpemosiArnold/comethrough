// @ts-check
// Stand-ins for every external service, for tests and for offline development
// (OFFLINE=1 npm run dev: the web UI can be built with no keys and no network).
//
// The offline AI is not a model: it is a few regular expressions that give plausible
// answers for typical sentences, so the confirm screens have something to show. Tests
// pass their own canned answers instead.

/** @typedef {import("./gemini.mjs").AiPort} AiPort */
/** @typedef {import("./geocode.mjs").Geocoder} Geocoder */
/** @typedef {import("./push.mjs").PushPort} PushPort */

/** A few Lagos areas, and a few Berlin ones for a crew elsewhere (coordinates from OpenStreetMap, rounded). */
export const OFFLINE_AREAS = [
  { label: "Yaba", detail: "Lagos Mainland, Lagos", lat: 6.5095, lon: 3.3711, country: "NG", city: "Lagos" },
  { label: "Lekki Phase 1", detail: "Eti-Osa, Lagos", lat: 6.4474, lon: 3.4723, country: "NG", city: "Lagos" },
  { label: "Ikeja", detail: "Ikeja, Lagos", lat: 6.6018, lon: 3.3515, country: "NG", city: "Lagos" },
  { label: "Surulere", detail: "Surulere, Lagos", lat: 6.5, lon: 3.35, country: "NG", city: "Lagos" },
  { label: "Ikoyi", detail: "Eti-Osa, Lagos", lat: 6.452, lon: 3.435, country: "NG", city: "Lagos" },
  { label: "Victoria Island", detail: "Eti-Osa, Lagos", lat: 6.4281, lon: 3.4219, country: "NG", city: "Lagos" },
  { label: "Ajah", detail: "Eti-Osa, Lagos", lat: 6.4672, lon: 3.57, country: "NG", city: "Lagos" },
  { label: "Gbagada", detail: "Kosofe, Lagos", lat: 6.5536, lon: 3.3885, country: "NG", city: "Lagos" },
  { label: "Kreuzberg", detail: "Friedrichshain-Kreuzberg, Berlin", lat: 52.4986, lon: 13.4033, country: "DE", city: "Berlin" },
  { label: "Neukölln", detail: "Berlin", lat: 52.4811, lon: 13.4353, country: "DE", city: "Berlin" },
];

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Rough offline answers per task. */
export const OFFLINE_ANSWERS = {
  /** @param {string} s */
  "parse-crew": (s) => {
    const t = s.toLowerCase();
    const day = DAYS.find((d) => t.includes(d) || t.includes(`${d.slice(0, 3)} `));
    const every = /every other|fortnight|biweekly|every two weeks/.test(t) ? "2w" : /monthly|every month/.test(t) ? "4w" : /every|weekly/.test(t) ? "1w" : null;
    return {
      name: s.split(",")[0].trim() || null,
      vibe: /outside|outdoor/.test(t) ? "outside" : null,
      vibeTags: ["outside", "chill", "drinks", "food", "beach", "games"].filter((v) => t.includes(v)),
      budget: /cheap|broke/.test(t) ? "cheap" : null,
      every,
      day: day ?? null,
      from: t.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/)?.[1] ?? null,
      to: null,
      areas: OFFLINE_AREAS.map((a) => a.label).filter((l) => t.includes(l.toLowerCase().split(" ")[0])),
      confidence: { name: 0.6, vibe: 0.6, rhythm: 0.7, areas: 0.8 },
    };
  },
  /** @param {string} s */
  "parse-plan": (s) => {
    const t = s.toLowerCase();
    const dateWords = t.match(/\b(tonight|today|tomorrow|(?:next |this )?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat))\b/)?.[1] ?? null;
    const startTime = t.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b(?!\s*(?:k|,000))/)?.[1]?.trim() ?? null;
    const atHost = /\b(at mine|my place|my house|our place)\b/.test(t);
    const title = (s.split(/\bat\b|,|\bon\b/i)[0] || "").replace(/^message:\s*/i, "").trim().replace(/^./, (c) => c.toUpperCase()).slice(0, 60) || null;
    return {
      kind: atHost ? "hosted" : /http/.test(t) ? "found" : "quick",
      title, dateWords, date: null, startTime, endTime: null, atHost,
      venueName: null, address: null, outdoor: /beach|park|garden|outside/.test(t) ? true : null,
      priceText: /\bfree\b/.test(t) ? "free" : null, free: /\bfree\b/.test(t) ? true : null,
      hostName: null,
      bring: (t.match(/bring (?:a |some )?([a-z ]+?)(?:[,.!]|$)/)?.[1] ? [t.match(/bring ((?:a |some )?[a-z ]+?)(?:[,.!]|$)/)?.[1]] : []).filter(Boolean),
      confidence: { title: 0.6, date: 0.7, time: 0.7, place: 0.5, price: 0.5, host: 0.5 },
    };
  },
  "explain-pick": () => ({ why: "" }), // empty: the code's own sentence is used
  "write-invite": () => ({ invite: "" }),
  "parse-feedback": () => ({ closerTo: null, avoid: [], prefer: [], budget: null, time: null, confidence: {} }),
};

/**
 * A fake AI port. `answers[task]` is an object or a function of the user message text;
 * a function that throws simulates an outage.
 * @param {{ answers?: Record<string, any>, model?: string }} [opts]
 * @returns {AiPort & { calls: any[] }}
 */
export function fakeAi({ answers = OFFLINE_ANSWERS, model = "offline-stand-in" } = {}) {
  /** @type {any[]} */
  const calls = [];
  return {
    available: true,
    model,
    calls,
    async generate(req) {
      calls.push(req);
      const user = req.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
      const a = answers[req.task || ""];
      if (a === undefined) throw Object.assign(new Error(`no fake answer for ${req.task}`), { status: 503, transient: true, hint: "Gemma is slow or busy right now." });
      const data = typeof a === "function" ? a(user.replace(/^(Sentence|Message|Comment): /m, ""), req) : a;
      return { data, text: JSON.stringify(data), model, wallSec: 0, jsonMode: true };
    },
  };
}

/**
 * A geocoder over a fixed list. It honours the context's country, and a city name added to
 * the query (", Lagos") is ignored, as Photon would.
 * @param {{ areas?: typeof OFFLINE_AREAS }} [opts]
 * @returns {Geocoder & { calls: any[] }}
 */
export function fakeGeocoder({ areas = OFFLINE_AREAS } = {}) {
  /** @type {any[]} */
  const calls = [];
  /** @type {Geocoder["search"]} */
  const search = async (q, { limit = 5, country = null } = {}) => {
    const t = String(q).toLowerCase().replace(/,\s*[^,]+$/, "").trim();
    if (t.length < 2) return [];
    return areas.filter((a) => (!country || a.country === country.toUpperCase()) && (a.label.toLowerCase().startsWith(t) || a.label.toLowerCase().includes(t))).slice(0, limit);
  };
  /** @type {Geocoder["lookup"]} */
  const lookup = async (q, ctx = {}) => {
    calls.push({ q, ctx });
    return (await search(q, { limit: 1, country: ctx.country ?? null }))[0] ?? null;
  };
  return { calls, search, lookup, lookupArea: lookup };
}

/** @param {any[]} [spots] Wikidata candidates to return */
export function fakeWikidata(spots = []) {
  return { calls: /** @type {any[]} */ ([]), async spotsNear(at, radiusKm) {
    this.calls.push({ at, radiusKm });
    return spots;
  } };
}

/** @param {any[]} [candidates] */
export function fakeOverpass(candidates = []) {
  return { calls: /** @type {any[]} */ ([]), async greenNear(at, radiusM) {
    this.calls.push({ at, radiusM });
    return candidates;
  } };
}

/**
 * A fake forecast: dry evenings, a hot middle of the day, for any date asked.
 * @param {{ rain?: (date: string, hour: number) => number }} [opts]
 */
export function fakeWeather({ rain = (_d, h) => (h >= 12 && h <= 14 ? 60 : 10) } = {}) {
  return {
    /** Lagos for points in Lagos, Berlin for points in Berlin, else null (unknown). */
    async timezoneAt(/** @type {{lat:number,lon:number}} */ at) {
      if (at.lat > 6.3 && at.lat < 6.8 && at.lon > 2.6 && at.lon < 4.5) return "Africa/Lagos";
      if (at.lat > 52.3 && at.lat < 52.7 && at.lon > 13 && at.lon < 13.8) return "Europe/Berlin";
      return null;
    },
    /** @param {{lat:number,lon:number}} _at */
    async hourly(_at, { days = 7 } = {}) {
      const hours = [];
      const start = Date.UTC(2026, 9, 20);
      for (let d = 0; d < 30 + days; d++) {
        const date = new Date(start + d * 86400000).toISOString().slice(0, 10);
        for (let h = 0; h < 24; h++) hours.push({ date, time: `${String(h).padStart(2, "0")}:00`, rainProb: rain(date, h), feelsC: h >= 11 && h <= 16 ? 37 : 30, uv: h >= 10 && h <= 15 ? 9 : 2, precipMm: 0 });
      }
      return hours;
    },
  };
}

/** @param {Record<string, any>} [pages] url -> PageResult */
export function fakePageMeta(pages = {}) {
  return { async fetchPage(url) {
    if (pages[url]) return pages[url];
    return { meta: { url, title: null, description: null, text: null, event: null }, image: null, note: null };
  } };
}

/** @returns {PushPort & { sent: any[] }} */
export function fakePush({ enabled = true } = {}) {
  /** @type {any[]} */
  const sent = [];
  return {
    enabled,
    publicKey: enabled ? "BFakePublicKeyForTests" : null,
    sent,
    async send(sub, msg) {
      sent.push({ endpoint: sub.endpoint, ...msg });
      return { ok: true, gone: sub.endpoint.includes("gone") };
    },
  };
}
