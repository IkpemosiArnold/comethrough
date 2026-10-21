// @ts-check
// A live smoke test against the real services, a few calls only:
//   1. geocode "Yaba, Lagos" (Photon, then Nominatim for comparison)
//   2. one Overpass query for green spaces near the Yaba and Lekki midpoint
//   3. one Open-Meteo forecast, and the best Saturday window from it
//   4. one Gemma call reading the sample sentence (JSON mode tried first)
//   5. one Gemma call reading a flyer image (test/fixtures/flyer.png)
// Prints a JSON report with latencies. Needs GEMINI_API_KEY in the environment or .env.
// The key is never printed.
//
// Run: npm run smoke

import fs from "node:fs";
import { config, loadDotEnv } from "../src/config.mjs";
import { createGemini } from "../src/adapters/gemini.mjs";
import { createGeocoder } from "../src/adapters/geocode.mjs";
import { memoryCache } from "../src/adapters/http.mjs";
import { createOpenMeteo } from "../src/adapters/openmeteo.mjs";
import { createOverpass } from "../src/adapters/overpass.mjs";
import { loadPrompts } from "../src/app/prompts.mjs";
import { PLAN_SCHEMA, localisePrompt, planMessages, readPlan } from "../src/core/tasks.mjs";
import { LAGOS_LOCAL } from "../src/packs/lagos/index.mjs";
import { centroid } from "../src/core/geo.mjs";
import { bestWindow } from "../src/core/weather.mjs";
import { localParts, addDays, weekdayOf } from "../src/core/time.mjs";

loadDotEnv();
const cfg = config();
const cache = memoryCache();
const report = /** @type {Record<string, any>} */ ({ at: new Date().toISOString(), node: process.version });
const timed = async (/** @type {string} */ name, /** @type {() => Promise<any>} */ fn) => {
  const t0 = performance.now();
  try {
    const out = await fn();
    report[name] = { ms: Math.round(performance.now() - t0), ...out };
  } catch (e) {
    report[name] = { ms: Math.round(performance.now() - t0), error: String(/** @type {any} */ (e).message || e).slice(0, 300) };
  }
};

const geo = (/** @type {"photon"|"nominatim"} */ provider) => createGeocoder({ ...cfg.geocoder, provider, contact: cfg.contact, cache });
await timed("geocodePhoton", async () => ({ result: await geo("photon").lookup("Yaba, Lagos") }));
await timed("geocodeNominatim", async () => ({ result: await geo("nominatim").lookup("Yaba, Lagos") }));

const yaba = { lat: 6.5095, lon: 3.3711 };
const lekki = { lat: 6.4474, lon: 3.4723 };
const mid = /** @type {{lat:number,lon:number}} */ (centroid([yaba, lekki]));
await timed("overpass", async () => {
  const r = await createOverpass({ urls: cfg.overpassUrls, contact: cfg.contact, cache }).greenNear(mid, 5000);
  return { midpoint: mid, radiusM: 5000, count: r.length, named: r.slice(0, 12).map((c) => `${c.name} (${Object.entries(c.osm?.tags || {}).filter(([k]) => ["leisure", "natural", "landuse"].includes(k)).map(([k, v]) => `${k}=${v}`).join(",")})`) };
});

const today = localParts(Date.now(), "Africa/Lagos").date;
const saturday = addDays(today, (6 - weekdayOf(today) + 7) % 7 || 7);
await timed("openMeteo", async () => {
  const hours = await createOpenMeteo({ url: cfg.openMeteoUrl, cache }).hourly(mid, { days: 7 });
  const w = bestWindow(hours, { date: saturday, from: "15:00", to: "19:00", hours: 3 });
  return { hours: hours.length, fields: hours[12], saturday, bestWindow: w && { from: w.from, to: w.to, ok: w.ok, rainProb: w.rainProb, feelsC: w.feelsC, uv: w.uv, reason: w.reason.text } };
});

const ai = createGemini({ key: cfg.gemini.key, model: cfg.gemini.model, fallbacks: cfg.gemini.fallbacks, visionModel: cfg.gemini.visionModel, timeoutMs: 60000 });
// the smoke test reads Lagos inputs, so the prompts get the Lagos city pack's locale
const prompts = Object.fromEntries(Object.entries(loadPrompts()).map(([k, v]) => [k, localisePrompt(v, LAGOS_LOCAL)]));
const member = { id: "m_smoke", name: "Tolu" };
const sentence = "wine and monopoly at mine friday 7, bring a bottle";
await timed("gemmaSentence", async () => {
  const input = { text: sentence, today, tz: "Africa/Lagos" };
  const r = await ai.generate({ task: "parse-plan", messages: planMessages(prompts["parse-plan"], input), schema: PLAN_SCHEMA, maxTokens: 600 });
  const read = readPlan(r.data, { ...input, member, tz: "Africa/Lagos", local: LAGOS_LOCAL });
  return { model: r.model, jsonMode: r.jsonMode, gemmaSec: r.wallSec, parsed: r.data != null, raw: r.text.slice(0, 800), draft: { kind: read.draft.kind, title: read.draft.title, start: read.draft.start, place: read.draft.place, bring: read.draft.bring, host: read.draft.host }, low: read.low, notes: read.notes };
});

const flyer = new URL("../test/fixtures/flyer.png", import.meta.url);
await timed("gemmaFlyer", async () => {
  const image = { mimeType: "image/png", data: fs.readFileSync(flyer).toString("base64") };
  const input = { image, today, tz: "Africa/Lagos" };
  const r = await ai.generate({ task: "parse-plan", messages: planMessages(prompts["parse-plan"], input), schema: PLAN_SCHEMA, maxTokens: 600 });
  const read = readPlan(r.data, { ...input, member, tz: "Africa/Lagos", local: LAGOS_LOCAL });
  return { model: r.model, jsonMode: r.jsonMode, gemmaSec: r.wallSec, parsed: r.data != null, raw: r.text.slice(0, 800), draft: { kind: read.draft.kind, title: read.draft.title, start: read.draft.start, place: read.draft.place, price: read.draft.price, bring: read.draft.bring, hostName: read.draft.hostName }, low: read.low, notes: read.notes };
});

console.log(JSON.stringify(report, null, 1));
