// @ts-check
// Where the crew's areas are decides its country, never the browser's zone: a member in
// London sets up a Lagos crew naming Yaba and Surulere. The London zone says GB, and a
// London shop called "Surulere" is a place in GB, so the old lookup pinned that label in
// London and asked about the other. Now the country the named areas land in is where the
// rest are looked up, and a shop in the zone's country never beats an area elsewhere.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createService } from "../src/app/service.mjs";
import { makeIds } from "../src/app/ids.mjs";
import { loadPrompts } from "../src/app/prompts.mjs";
import { fakeAi, fakeOverpass, fakePageMeta, fakePush, fakeWeather } from "../src/adapters/fakes.mjs";
import { memoryStore } from "../src/adapters/store.mjs";

const now = () => Date.parse("2026-10-22T11:00:00Z");
const cfg = { publicUrl: "https://x.test", webUrl: "https://x.test", uidDomain: "x.test" };

/** A geocoder with areas (place=*) and other places (a shop), filtered by country as Nominatim's countrycodes is. */
function world() {
  const places = [
    { label: "Yaba", detail: "Lagos Mainland, Lagos", lat: 6.5095, lon: 3.3711, country: "NG", city: "Lagos", area: true },
    { label: "Surulere", detail: "Ogbomosho, Oyo", lat: 8.13, lon: 4.24, country: "NG", city: "Ogbomosho", area: true },
    { label: "Surulere", detail: "Lagos", lat: 6.5, lon: 3.35, country: "NG", city: "Lagos", area: true },
    { label: "Lekki Phase I", detail: "Eti Osa, Lagos", lat: 6.4413, lon: 3.4704, country: "NG", city: "Lagos", area: true },
    // a Nigerian restaurant in south London
    { label: "Surulere Kitchen", detail: "Peckham, London", lat: 51.4693, lon: -0.0692, country: "GB", city: "London", area: false },
    { label: "London", detail: "Greater London, England", lat: 51.5074, lon: -0.1278, country: "GB", city: "London", area: true },
    { label: "Peckham", detail: "Southwark, London", lat: 51.4741, lon: -0.0691, country: "GB", city: "London", area: true },
    { label: "Brixton", detail: "Lambeth, London", lat: 51.4613, lon: -0.1156, country: "GB", city: "London", area: true },
  ];
  /** @type {{ q: string, country: string|null, areas: boolean }[]} */
  const asked = [];
  /** @param {string} q @param {any} [opts] */
  const search = async (q, { limit = 5, country = null, areas = false } = {}) => {
    asked.push({ q, country, areas });
    const [name, city] = String(q).toLowerCase().split(",").map((x) => x.trim());
    return places.filter((p) => (!country || p.country === country) && (!areas || p.area) && p.label.toLowerCase().includes(name) && (!city || String(p.city).toLowerCase() === city || p.detail.toLowerCase().includes(city))).slice(0, limit);
  };
  /** @param {string} q @param {any} [ctx] */
  const lookup = async (q, ctx = {}) => {
    const hit = (await search(q, { limit: 1, country: ctx.country ?? null, areas: true }))[0] ?? null;
    if (!ctx.near || !hit) return hit;
    return Math.hypot((hit.lat - ctx.near.lat) * 111, (hit.lon - ctx.near.lon) * 111) <= 50 ? hit : null;
  };
  return { asked, search, lookup, lookupArea: lookup, cityAt: async (/** @type {any} */ at) => (at.lat > 50 ? { city: "London", country: "GB" } : { city: "Lagos", country: "NG" }) };
}

function make(/** @type {string[]} */ areas, { zones = true } = {}) {
  const geocoder = world();
  const weather = { ...fakeWeather(), async timezoneAt(/** @type {any} */ at) { return zones ? (at.lat > 50 ? "Europe/London" : "Africa/Lagos") : null; } };
  const svc = createService({ store: memoryStore(), ai: fakeAi({ answers: { "parse-crew": { name: "Old school", vibe: null, vibeTags: [], budget: null, every: "2w", day: "Saturday", from: null, to: null, areas, taste: {}, confidence: {} } } }), geocoder, places: fakeOverpass([]), weather, pages: fakePageMeta(), push: fakePush(), spots: [], prompts: loadPrompts(), ids: makeIds(), now, cfg });
  return { svc, geocoder };
}

for (const order of [["Surulere", "Yaba"], ["Yaba", "Surulere"]]) {
  test(`a Lagos crew set up from London (${order.join(", ")}): both areas in Lagos, the crew in Nigeria`, async () => {
    const { svc } = make(order);
    const d = await svc.draftCrew({ sentence: `Old school friends, every other Saturday around ${order.join(" and ")}`, hint: { tz: "Europe/London" } });
    for (const a of d.draft.areas) {
      assert.ok(a.lat != null && a.lat > 6 && a.lat < 7, `${a.label} pinned at ${a.lat}, ${a.lon}`);
    }
    assert.equal(d.draft.region.countryCode, "NG");
    assert.equal(d.draft.region.city, "Lagos");
    assert.equal(d.draft.region.timezone, "Africa/Lagos", "the zone of the areas, not the browser's");
    assert.equal(d.needsLocation, null);
  });
}

test("the zone at the areas unknown (Open-Meteo down): the areas' country's zone, not the browser's", async () => {
  const { svc } = make(["Yaba", "Surulere"], { zones: false });
  const d = await svc.draftCrew({ sentence: "Old school friends, every other Saturday around Yaba and Surulere", hint: { tz: "Europe/London" } });
  assert.equal(d.draft.region.countryCode, "NG");
  assert.equal(d.draft.region.timezone, "Africa/Lagos");
});

test("a city the sentence names counts whatever the browser's zone (Lagos named from London)", async () => {
  const { svc, geocoder } = make(["Surulere"]);
  const d = await svc.draftCrew({ sentence: "Old school friends in Lagos, every other Saturday around Surulere", hint: { tz: "Europe/London" } });
  assert.equal(d.draft.areas[0].lat, 6.5, "Lagos's Surulere, not Ogbomosho's or the London kitchen");
  assert.equal(d.draft.region.countryCode, "NG");
  assert.ok(geocoder.asked.some((a) => /surulere, lagos/i.test(a.q)), JSON.stringify(geocoder.asked));
});

// The held-out test-2 run of 8584126: "VI" typed with a Houston browser zone became the US
// Virgin Islands (America/St_Thomas). A short name with no city or country in the sentence
// never takes its country from the zone alone.
function viWorld() {
  const places = [
    { label: "United States Virgin Islands", detail: "", lat: 18.34, lon: -64.93, country: "VI", kind: "territory", area: true, q: "vi" },
    { label: "Victoria Island", detail: "Eti Osa, Lagos", lat: 6.43, lon: 3.4259, country: "NG", city: "Lagos", kind: "suburb", area: true, q: "victoria island" },
    { label: "Yaba", detail: "Lagos Mainland, Lagos", lat: 6.5095, lon: 3.3711, country: "NG", city: "Lagos", kind: "suburb", area: true, q: "yaba" },
    { label: "Houston", detail: "Texas", lat: 29.76, lon: -95.37, country: "US", city: "Houston", kind: "city", area: true, q: "chicago" },
  ];
  /** @param {string} q @param {any} [opts] */
  const search = async (q, { limit = 5, country = null, areas = false } = {}) => {
    const name = String(q).toLowerCase().split(",")[0].trim();
    return places.filter((p) => (!country || p.country === country) && (!areas || p.area) && p.q === name).slice(0, limit);
  };
  /** @param {string} q @param {any} [ctx] */
  const lookup = async (q, ctx = {}) => (await search(q, { country: ctx.country ?? null, areas: true }))[0] ?? null;
  return { search, lookup, lookupArea: lookup, cityAt: async (/** @type {any} */ at) => (at.lat < 10 && at.lat > 6 ? { city: "Lagos", country: "NG" } : null) };
}

function makeVi(/** @type {string[]} */ areas) {
  const weather = { ...fakeWeather(), async timezoneAt(/** @type {any} */ at) { return at.lat > 6 && at.lat < 7 ? "Africa/Lagos" : at.lat > 18 && at.lat < 19 ? "America/St_Thomas" : null; } };
  return createService({ store: memoryStore(), ai: fakeAi({ answers: { "parse-crew": { name: "Crew", vibe: null, vibeTags: [], budget: null, every: "2w", day: "Saturday", from: null, to: null, areas, taste: {}, confidence: {} } } }), geocoder: viWorld(), places: fakeOverpass([]), weather, pages: fakePageMeta(), push: fakePush(), spots: [], prompts: loadPrompts(), ids: makeIds(), now, cfg });
}

test("\"VI\" from a Houston browser, alone: never the US Virgin Islands by the zone; the organiser is asked which", async () => {
  const d = await makeVi(["VI"]).draftCrew({ sentence: "Our crew, every other Saturday around VI", hint: { tz: "America/Chicago" } });
  assert.notEqual(d.draft.region.timezone, "America/St_Thomas");
  assert.equal(d.draft.areas[0].lat, null, "not pinned on a guess");
  assert.deepEqual(d.needsLocation?.unresolved, ["VI"]);
  const labels = (d.needsLocation?.suggestions.VI ?? []).map((/** @type {any} */ s) => s.label);
  assert.ok(labels.includes("Victoria Island") && labels.includes("United States Virgin Islands"), labels.join(", "));
  assert.equal(labels[0], "Victoria Island", "an area in a city before a territory");
  assert.ok(d.notes.some((n) => /^Which VI\?/.test(n)), d.notes.join(" | "));
});

test("\"VI\" placed by what else the sentence says, or by a pack's name for it in the visitor's own country", async () => {
  const withYaba = await makeVi(["VI", "Yaba"]).draftCrew({ sentence: "Our crew, every other Saturday around VI and Yaba", hint: { tz: "America/Chicago" } });
  assert.equal(withYaba.draft.areas[0].lat, 6.43, "Yaba puts VI in Lagos");
  assert.equal(withYaba.draft.region.countryCode, "NG");
  assert.equal(withYaba.needsLocation, null);
  const lagos = await makeVi(["VI"]).draftCrew({ sentence: "Our crew, every other Saturday around VI", hint: { tz: "Africa/Lagos" } });
  assert.equal(lagos.draft.areas[0].lat, 6.43, "typed in Lagos: Victoria Island");
  const named = await makeVi(["VI"]).draftCrew({ sentence: "Our crew in Lagos, every other Saturday around VI", hint: { tz: "America/Chicago" } });
  assert.equal(named.draft.areas[0].lat, 6.43, "the sentence names Lagos");
});

test("a London crew from a Lagos zone, and a London crew from London, stay in London", async () => {
  for (const tz of ["Africa/Lagos", "Europe/London"]) {
    const { svc } = make(["Peckham", "Brixton"]);
    const d = await svc.draftCrew({ sentence: "Naija crew in London, around Peckham and Brixton, every other Saturday", hint: { tz } });
    assert.equal(d.draft.region.countryCode, "GB", tz);
    assert.ok(d.draft.areas.every((a) => a.lat != null && a.lat > 51), `${tz}: ${JSON.stringify(d.draft.areas)}`);
  }
});
