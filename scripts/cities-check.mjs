// @ts-check
// Beyond Lagos, live: start a crew in each city, then check place search, weather, the
// sloth's pick and ride pods, with the real services (Gemma, Photon, Nominatim, Overpass,
// Wikidata, OSRM, Open-Meteo) and the app's own service code, in memory (nothing is saved
// and no server is needed).
//
// Light on purpose, to respect each service's usage policy: one crew per city, a few
// geocodes, one forecast, one Overpass and one Wikidata query, a few OSRM routes, and four
// Gemma calls per city with a pause between them. Results go to stdout as JSON.
//
// Run: node scripts/cities-check.mjs [city ...]   (needs GEMINI_API_KEY in .env)
//   cities: lagos london berlin nairobi bengaluru newyork (default: all)

import { loadDotEnv, config } from "../src/config.mjs";
import { createService } from "../src/app/service.mjs";
import { makeIds } from "../src/app/ids.mjs";
import { loadPrompts } from "../src/app/prompts.mjs";
import { createGemini } from "../src/adapters/gemini.mjs";
import { createGeocoder } from "../src/adapters/geocode.mjs";
import { memoryCache } from "../src/adapters/http.mjs";
import { createOpenMeteo } from "../src/adapters/openmeteo.mjs";
import { createOsrm } from "../src/adapters/osrm.mjs";
import { createOverpass } from "../src/adapters/overpass.mjs";
import { createWikidata } from "../src/adapters/wikidata.mjs";
import { fakePageMeta, fakePush } from "../src/adapters/fakes.mjs";
import { memoryStore } from "../src/adapters/store.mjs";
import { withEntries } from "../src/core/places.mjs";
import { localParts, addDays, weekdayOf } from "../src/core/time.mjs";
import fs from "node:fs";

loadDotEnv();
const cfg = config();

/** Each city: the visitor's zone, a crew sentence in local style, two friends' areas, a plan sentence. */
const CITIES = {
  lagos: { tz: "Africa/Lagos", sentence: "The uni guys, every other Saturday, somewhere outside and cheap, around Yaba and Lekki", friends: ["Surulere", "Ikeja"], plan: "suya at Glover Court friday 8pm, about 3k each" },
  london: { tz: "Europe/London", sentence: "The Peckham lot, every other Sunday, somewhere green, cheap, around Peckham and Brixton", friends: ["Camberwell", "Clapham"], plan: "pints at the Montague Arms saturday 7pm, a fiver each" },
  berlin: { tz: "Europe/Berlin", sentence: "the Kreuzberg lot, every other Sunday, somewhere green, cheap", friends: ["Neukölln", "Friedrichshain"], plan: "Späti hang at Görli on sunday 3pm, bring your own beer" },
  nairobi: { tz: "Africa/Nairobi", sentence: "Campus crew, every Saturday afternoon, somewhere outside, around Kilimani and Westlands", friends: ["Kileleshwa", "Lavington"], plan: "nyama choma at Kilimani saturday 2pm, 500 bob each" },
  bengaluru: { tz: "Asia/Kolkata", sentence: "Office gang, every other Saturday, somewhere green, around Indiranagar and Koramangala", friends: ["HSR Layout", "Jayanagar"], plan: "filter coffee at Brahmin's Coffee Bar sunday 8am" },
  newyork: { tz: "America/New_York", sentence: "The Brooklyn crew, every other Sunday, a park, cheap, around Park Slope and Williamsburg", friends: ["Bushwick", "Crown Heights"], plan: "rooftop drinks 10/31 at 7pm, $15 cover" },
};

const cache = memoryCache();
const gemini = createGemini({ key: cfg.gemini.key, model: cfg.gemini.model, fallbacks: cfg.gemini.fallbacks, visionModel: cfg.gemini.visionModel, timeoutMs: cfg.gemini.timeoutMs });
let lastGemma = 0;
/** Gemma with a gap of at least 5 s between calls (the free tier allows about 15 a minute). */
const ai = {
  ...gemini,
  available: gemini.available,
  async generate(/** @type {any} */ req) {
    const wait = lastGemma + 5000 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastGemma = Date.now();
    return gemini.generate(req);
  },
};
const geocoder = createGeocoder({ ...cfg.geocoder, contact: cfg.contact, cache });
const weather = createOpenMeteo({ url: cfg.openMeteoUrl, cache });
const lagosSpots = JSON.parse(fs.readFileSync(new URL("../data/lagos-spots.json", import.meta.url), "utf8")).spots;
const fees = JSON.parse(fs.readFileSync(new URL("../data/spot-entry-fees.json", import.meta.url), "utf8")).fees;
const store = memoryStore();
const svc = createService({
  store, ai, geocoder, weather,
  places: createOverpass({ urls: cfg.overpassUrls, contact: cfg.contact, cache }),
  wikidata: cfg.wikidataUrl ? createWikidata({ url: cfg.wikidataUrl, contact: cfg.contact, cache }) : null,
  routes: cfg.osrmUrl ? createOsrm({ url: cfg.osrmUrl, contact: cfg.contact, cache }) : null,
  pages: fakePageMeta(), push: fakePush({ enabled: false }), spots: withEntries(lagosSpots, fees), prompts: loadPrompts(), ids: makeIds(), now: Date.now,
  cfg: { publicUrl: "https://check.test", webUrl: "https://check.test", uidDomain: "check.test" },
  log: (e, f) => (/error/.test(e) ? console.error(JSON.stringify({ e, ...f })) : undefined),
});

const pick = process.argv.slice(2);
const names = pick.length ? pick : Object.keys(CITIES);
/** @type {Record<string, any>} */
const out = {};
for (const name of names) {
  const c = CITIES[/** @type {keyof typeof CITIES} */ (name)];
  if (!c) continue;
  const r = /** @type {any} */ ({ city: name });
  const t0 = Date.now();
  try {
    // 1. the crew sentence, read by Gemma, areas geocoded, region derived
    const d = await svc.draftCrew({ sentence: c.sentence, hint: { tz: c.tz } });
    r.draft = { name: d.draft.name, vibeTags: d.draft.vibeTags, budget: d.draft.budget, rhythm: d.draft.rhythm, areas: d.draft.areas, notes: d.notes, ai: d.ai };
    r.region = d.draft.region;
    r.pack = d.pack.id;
    // 2. the crew, with its organiser and two friends from nearby areas
    const made = /** @type {any} */ (await svc.createCrew({ confirm: d.draft, hint: { tz: c.tz }, organiser: { name: "Organiser", area: d.draft.areas[0]?.label || c.friends[0] } }));
    const crew = await store.get("crews", made.crew.id);
    const tokens = [made.memberToken];
    for (const [i, area] of c.friends.entries()) {
      const j = /** @type {any} */ (await svc.joinCrew({ slug: crew.slug, token: crew.inviteToken, body: { name: `Friend ${i + 1}`, area } }));
      tokens.push(j.memberToken);
    }
    const members = await store.find("members", { crewId: crew.id });
    r.members = members.map((m) => ({ area: m.area.label, lat: m.area.lat, lon: m.area.lon }));
    // 3. place search: the type-ahead near the crew, for the second friend's area
    const typed = c.friends[1].slice(0, 5);
    r.search = { q: typed, results: (await svc.searchAreas({ q: typed, near: crew.region.center, country: crew.region.countryCode })).results.slice(0, 3).map((x) => `${x.label} (${x.detail})`) };
    // 4. weather at the centre, in the crew's zone: the first hour should be local "now"
    const hours = await weather.hourly(crew.region.center, { tz: crew.tz, days: 3 });
    const nowLocal = localParts(Date.now(), crew.tz);
    r.weather = { tz: crew.tz, localNow: `${nowLocal.date} ${nowLocal.time}`, firstHour: `${hours[0]?.date} ${hours[0]?.time}`, hours: hours.length, sample: hours.filter((h) => h.time === "15:00").slice(0, 2) };
    // 5. what the sloth can pick from near the crew, by source, then its pick for the next rhythm day
    const cands = await svc._internal.candidatesNear(crew.region.center, (await import("../src/packs/index.mjs")).packFor(crew.region));
    r.candidates = { total: cands.length, wikidata: cands.filter((x) => x.wikidata).length, osm: cands.filter((x) => x.osm && !x.wikidata).length, curated: cands.filter((x) => !x.osm && !x.wikidata).length, some: cands.slice(0, 6).map((x) => x.name) };
    // 5. the sloth's pick for the next rhythm day
    const day = crew.rhythm?.day ?? 6;
    const today = nowLocal.date;
    const date = addDays(today, ((day - weekdayOf(today) + 7) % 7) || 7);
    const ritual = await svc._internal.makeRitual(crew, { date, window: crew.rhythm?.window || { from: "15:00", to: "19:00" } }, []);
    r.ritual = ritual.made ? { title: ritual.plan.title, place: ritual.plan.place.name, lat: ritual.plan.place.lat, lon: ritual.plan.place.lon, start: ritual.plan.start, end: ritual.plan.end, why: ritual.plan.why, invite: ritual.plan.invite, rain: ritual.plan.rainPlan?.kind ?? null, entry: null } : { made: false, reason: ritual.reason };
    // 6. a plan in local words, read by Gemma
    const parsed = await svc.parsePlan({ slug: crew.slug, token: tokens[0], text: c.plan });
    r.plan = { title: parsed.draft.title, start: parsed.draft.start, place: parsed.draft.place.name, address: parsed.draft.place.address, pinned: parsed.draft.place.lat != null, price: parsed.draft.price?.text ?? null, low: parsed.low, notes: parsed.notes, ai: parsed.ai };
    // 7. ride pods for the ritual: everyone going
    if (ritual.made) {
      for (const tk of tokens) await svc.patchPlan({ id: ritual.plan.id, token: tk, body: { rsvp: "going" } });
      const pods = await svc.getPods({ id: ritual.plan.id, token: tokens[0] });
      r.pods = { rides: pods.rides.map((x) => x.name), directions: pods.directions, pods: pods.pods.map((p) => ({ from: p.fromLabel, leaveBy: p.leaveBy, travelMin: p.travelMin, how: p.estimate?.text, copy: p.destinationText })) };
      const view = await svc.getPlan({ id: ritual.plan.id, token: tokens[0] });
      r.ritual.entry = view.plan.place.entry ?? null;
    }
  } catch (e) {
    r.error = String(/** @type {any} */ (e)?.stack || e).slice(0, 600);
  }
  r.sec = Math.round((Date.now() - t0) / 1000);
  out[name] = r;
  console.error(`${name}: done in ${r.sec} s${r.error ? ` with an error: ${r.error.split("\n")[0]}` : ""}`);
}
console.log(JSON.stringify(out, null, 1));
