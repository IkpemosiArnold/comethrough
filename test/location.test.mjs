// @ts-check
// Where a crew is comes only from its areas on the map (Astra's review, P1.3 and P1.6; the
// persona eval v2 dev set). The visitor's zone says a country at most: "Africa/Lagos" is
// the zone of all Nigeria (and more), never the city of Lagos. When no area can be found,
// the app asks which city or area is meant and recommends nothing until it knows.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createService } from "../src/app/service.mjs";
import { createIdeas } from "../src/app/ideas.mjs";
import { makeIds } from "../src/app/ids.mjs";
import { loadPrompts } from "../src/app/prompts.mjs";
import { memoryCache } from "../src/adapters/http.mjs";
import { fakeAi, fakeOverpass, fakePageMeta, fakePush, fakeWeather } from "../src/adapters/fakes.mjs";
import { memoryStore } from "../src/adapters/store.mjs";
import { clusterAreas } from "../src/core/geo.mjs";
import { areaQueries } from "../src/packs/index.mjs";

const now = () => Date.parse("2026-10-22T11:00:00Z");
const cfg = { publicUrl: "https://x.test", webUrl: "https://x.test", uidDomain: "x.test" };

/**
 * A geocoder that answers as Nominatim did on 22 Oct 2026 (countrycodes=ng): a name with a
 * city added must be in that city ("Gwarinpa, Lagos" finds nothing), and "Lekki" is the
 * Ibeju-Lekki boundary 38 km east of Lekki Phase I.
 */
function nominatimLike() {
  const places = [
    { label: "Gwarinpa", detail: "Municipal Area Council, Federal Capital Territory", lat: 9.0994, lon: 7.408, country: "NG", city: "Abuja" },
    { label: "Kubwa", detail: "Municipal Area Council, Federal Capital Territory", lat: 9.1526, lon: 7.341, country: "NG", city: "Abuja" },
    { label: "Wuse", detail: "Abuja, Federal Capital Territory", lat: 9.062, lon: 7.4665, country: "NG", city: "Abuja" },
    { label: "Garki", detail: "Jigawa", lat: 12.43, lon: 9.113, country: "NG", city: "Garki" },
    { label: "Garki", detail: "Gudu, Abuja", lat: 9.0131, lon: 7.4813, country: "NG", city: "Abuja" },
    { label: "Ibeju Lekki", detail: "Lagos", lat: 6.4711, lon: 3.8147, country: "NG", city: "Lagos" },
    { label: "Lekki Phase I", detail: "Eti Osa, Lagos", lat: 6.4413, lon: 3.4704, country: "NG", city: "Lagos" },
    { label: "Victoria Island", detail: "Eti Osa, Lagos", lat: 6.43, lon: 3.4259, country: "NG", city: "Lagos" },
    { label: "Yaba", detail: "Lagos Mainland, Lagos", lat: 6.5095, lon: 3.3711, country: "NG", city: "Lagos" },
  ];
  /** @type {string[]} */
  const queries = [];
  /** @param {string} q @param {any} [opts] */
  const search = async (q, { limit = 5, country = null } = {}) => {
    queries.push(q);
    const [name, city] = String(q).toLowerCase().split(",").map((x) => x.trim());
    return places.filter((p) => (!country || p.country === country) && p.label.toLowerCase().includes(name) && (!city || String(p.city).toLowerCase() === city || p.detail.toLowerCase().includes(city))).slice(0, limit);
  };
  /** @param {string} q @param {any} [ctx] */
  const lookup = async (q, ctx = {}) => {
    const text = ctx.appendCity && !q.toLowerCase().includes(ctx.appendCity.toLowerCase()) ? `${q}, ${ctx.appendCity}` : q;
    // as the app's geocoder does: the first hit, kept only within 50 km of the crew
    const hit = (await search(text, { limit: 1, country: ctx.country ?? null }))[0] ?? null;
    if (!ctx.near || !hit) return hit;
    return Math.hypot((hit.lat - ctx.near.lat) * 111, (hit.lon - ctx.near.lon) * 111) <= 50 ? hit : null;
  };
  return { queries, search, lookup, lookupArea: lookup, cityAt: async (/** @type {any} */ at) => ({ city: at.lat > 8 ? "Abuja" : "Lagos", country: "NG" }) };
}

const parseCrew = (/** @type {string[]} */ areas, extra = {}) => ({
  "parse-crew": { name: "Gwarinpa families", vibe: "kid-friendly and cheap", vibeTags: [], budget: "cheap", every: "2w", day: "Saturday", from: null, to: null, areas, confidence: { name: 0.9, vibe: 0.9, rhythm: 0.9, areas: 0.9 }, ...extra },
});

function make(/** @type {string[]} */ areas, geocoder = nominatimLike()) {
  const store = memoryStore();
  // a Lagos park the old fallback would offer an Abuja crew
  const places = fakeOverpass([{ name: "Freedom Park", lat: 6.4488, lon: 3.3965, osm: { type: "way", id: 1, tags: { name: "Freedom Park", leisure: "park" } } }, { name: "Millennium Park", lat: 9.0702, lon: 7.5004, osm: { type: "way", id: 2, tags: { name: "Millennium Park", leisure: "park" } } }]);
  const svc = createService({ store, ai: fakeAi({ answers: parseCrew(areas) }), geocoder, places, weather: fakeWeather({ rain: () => 5 }), pages: fakePageMeta(), push: fakePush(), spots: [{ name: "Freedom Park", kind: "park", lat: 6.4488, lon: 3.3965 }], prompts: loadPrompts(), ids: makeIds(), now, cfg });
  return { store, svc, geocoder, places };
}

test("the Abuja families persona (abj-families-gwarinpa): a Lagos zone does not put an Abuja crew in Lagos", async () => {
  const { store, svc, geocoder } = make(["Gwarinpa", "Kubwa"]);
  const d = await svc.draftCrew({ sentence: "Families from Gwarinpa and Kubwa with young kids, every other Saturday, kid-friendly and cheap", hint: { tz: "Africa/Lagos" } });
  assert.ok(!geocoder.queries.some((q) => /, lagos$/i.test(q)), `no city is added from the zone: ${geocoder.queries.join(" | ")}`);
  assert.deepEqual(d.draft.areas.map((a) => [a.label, a.lat]), [["Gwarinpa", 9.0994], ["Kubwa", 9.1526]]);
  assert.equal(d.draft.region.city, "Abuja");
  assert.ok(d.draft.region.center && d.draft.region.center.lat > 9, "the centre is in Abuja");
  assert.equal(d.pack.id, "default", "not the Lagos pack");
  assert.equal(d.needsLocation, null);
  const made = await svc.createCrew({ confirm: d.draft, hint: { tz: "Africa/Lagos" }, organiser: { name: "Ngozi", area: "Gwarinpa" } });
  assert.equal(made.crew.region.city, "Abuja");
  const crew = await store.get("crews", made.crew.id);
  const r = await svc._internal.makeRitual(crew, { date: "2026-10-24", window: { from: "15:00", to: "19:00" } }, []);
  assert.notEqual(r.plan?.place.name, "Freedom Park", "never a Lagos park for an Abuja crew");
});

test("the Muslim sisters persona (abj-sisters-garki): Garki is the Abuja one, next to Wuse, not the Jigawa town", async () => {
  const { svc } = make(["Garki", "Wuse"]);
  const d = await svc.draftCrew({ sentence: "Muslim sisters in Abuja, every other Saturday afternoon around Garki and Wuse", hint: { tz: "Africa/Lagos" } });
  assert.deepEqual(d.draft.areas.map((a) => a.lat), [9.0131, 9.062]);
});

test("no area on the map: needsLocation asks which city, and nothing location-dependent is recommended", async () => {
  const { store, svc, geocoder } = make(["Nowhereville", "Placeholder Close"]);
  const d = await svc.draftCrew({ sentence: "the uni guys every saturday around Nowhereville and Placeholder Close", hint: { tz: "Africa/Lagos" } });
  assert.equal(d.draft.region.center, null, "no centre from the zone");
  assert.equal(d.draft.region.city, null, "the zone is not a city");
  assert.equal(d.draft.region.countryCode, "NG", "the zone says a country at most");
  assert.ok(d.needsLocation, "the app asks");
  assert.deepEqual(d.needsLocation.unresolved, ["Nowhereville", "Placeholder Close"]);
  assert.ok(d.needsLocation.cities.includes("Abuja") && d.needsLocation.cities.includes("Lagos"));
  assert.match(d.needsLocation.message, /Which city/);
  const made = await svc.createCrew({ confirm: d.draft, hint: { tz: "Africa/Lagos" } });
  assert.ok(made.needsLocation, "still asking after the crew is made");
  const crew = await store.get("crews", made.crew.id);
  const r = await svc._internal.makeRitual(crew, { date: "2026-10-24", window: { from: "15:00", to: "19:00" } }, []);
  assert.equal(r.made, false);
  assert.equal(r.reason, "no_location");
  const ideas = createIdeas({ store, cache: memoryCache({ now }), ai: fakeAi({ answers: {} }), feeds: null, weather: fakeWeather(), geocoder, candidatesNear: svc._internal.candidatesNear, prompts: loadPrompts(), now });
  const card = await ideas.getIdeas({ slug: crew.slug, token: crew.inviteToken, when: "weekend" });
  assert.equal(card.ideas.length, 0, "no ideas from the zone's city");
  // the answer: the city, then the areas are found there
  const again = make(["Gwarinpa"]);
  const d2 = await again.svc.draftCrew({ sentence: "families every other saturday in gwarinpa", hint: { tz: "Africa/Lagos", city: "Abuja" } });
  assert.equal(d2.draft.region.city, "Abuja");
  assert.ok(again.geocoder.queries.some((q) => /gwarinpa, abuja/i.test(q)), "the city the user named is the context");
});

test("Lekki is Lekki Phase I, not Ibeju-Lekki 38 km east; an area far from the others is asked about, not pinned", async () => {
  const { svc } = make(["VI", "Lekki"]);
  const d = await svc.draftCrew({ sentence: "Na we be the turn up squad, 8 of us for VI and Lekki, every Saturday night", hint: { tz: "Africa/Lagos" } });
  assert.deepEqual(d.draft.areas.map((a) => [a.label, a.lat, a.lon]), [["Victoria Island", 6.43, 3.4259], ["Lekki", 6.4413, 3.4704]]);
  assert.equal(d.pack.id, "lagos", "the coordinates are in Lagos");
  assert.equal(d.draft.region.city, "Lagos");
  // a name whose only match is 38 km from the rest: a question, not a pin
  const far = make(["Yaba", "Ibeju"]);
  const f = await far.svc.draftCrew({ sentence: "crew around Yaba and Ibeju", hint: { tz: "Africa/Lagos" } });
  const ibeju = f.draft.areas.find((a) => a.label === "Ibeju");
  assert.equal(ibeju?.lat, null, "not pinned");
  assert.ok(f.needsLocation?.unresolved.includes("Ibeju"));
  assert.match(f.needsLocation?.suggestions?.Ibeju?.[0]?.label ?? "", /Ibeju Lekki/);
  assert.ok(f.notes.some((n) => /Did you mean Ibeju Lekki/.test(n)), f.notes.join(" | "));
});

test("area names people write, as the map knows them (Lagos and Abuja)", () => {
  assert.deepEqual(areaQueries("Lekki", "NG"), ["Lekki Phase I", "Lekki Phase 1", "Lekki"]);
  assert.deepEqual(areaQueries("VI", "NG"), ["Victoria Island"]);
  assert.deepEqual(areaQueries("Gwarimpa", "NG"), ["Gwarinpa"]);
  assert.deepEqual(areaQueries("Wuse 2", "NG"), ["Wuse II", "Wuse"]);
  assert.deepEqual(areaQueries("Yaba", "NG"), ["Yaba"]);
  assert.deepEqual(areaQueries("Lekki", "DE"), ["Lekki"], "only in Nigeria");
});

test("clusterAreas: the candidates that sit together win, within 25 km", () => {
  const lists = [
    [{ lat: 12.43, lon: 9.113 }, { lat: 9.0131, lon: 7.4813 }],
    [{ lat: 9.062, lon: 7.4665 }],
  ];
  const c = clusterAreas(lists, 25);
  assert.deepEqual(c.picks.map((p) => p?.lat), [9.0131, 9.062]);
  const apart = clusterAreas([[{ lat: 6.5095, lon: 3.3711 }], [{ lat: 6.4711, lon: 3.8147 }]], 25);
  assert.equal(apart.picks.filter(Boolean).length, 1, "38 km apart: only one is kept");
});

test("Photon, then Nominatim: a lookup survives Photon being down; the type-ahead never falls back (Nominatim forbids autocomplete)", async () => {
  const { createGeocoder } = await import("../src/adapters/geocode.mjs");
  /** @type {string[]} */
  const calls = [];
  const fetchImpl = /** @type {any} */ (async (/** @type {string} */ url) => {
    calls.push(url);
    if (url.startsWith("https://photon.test")) throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const body = [{ name: "Gwarinpa", display_name: "Gwarinpa, Municipal Area Council, Federal Capital Territory, Nigeria", lat: "9.0994", lon: "7.4080", category: "place", type: "town", osm_type: "node", osm_id: 1 }];
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
  const geo = createGeocoder({ provider: "photon", photonUrl: "https://photon.test", nominatimUrl: "https://nominatim.test", contact: "t", cache: memoryCache(), fetchImpl });
  const hit = await geo.lookupArea("Gwarinpa", { country: "NG" });
  assert.equal(hit?.lat, 9.0994);
  assert.equal(hit?.country, "NG", "the country asked for");
  assert.ok(calls.some((u) => u.startsWith("https://nominatim.test/search")));
  const rs = await geo.search("Gwarinpa", { limit: 5, areas: true, country: "NG", fallback: true });
  assert.equal(rs[0]?.label, "Gwarinpa");
  calls.length = 0;
  await assert.rejects(geo.search("Gwar", { limit: 5, areas: true }), /ECONNREFUSED/, "the type-ahead does not fall back");
  assert.ok(!calls.some((u) => u.startsWith("https://nominatim.test")));
});

test("the city at a point: Abuja is not \"Municipal Area Council\", and a Lagos LGA is in Lagos", async () => {
  const { createGeocoder } = await import("../src/adapters/geocode.mjs");
  const answers = /** @type {Record<string, any>} */ ({
    "9.06": { address: { county: "Municipal Area Council", state: "Federal Capital Territory", country_code: "ng" } },
    "6.43": { address: { county: "Eti Osa", state: "Lagos", country_code: "ng" } },
    "52.50": { address: { city: "Berlin", state: "Berlin", country_code: "de" } },
  });
  const fetchImpl = /** @type {any} */ (async (/** @type {string} */ url) => {
    const lat = Number(new URL(url).searchParams.get("lat")).toFixed(2);
    return new Response(JSON.stringify(answers[lat]), { status: 200, headers: { "content-type": "application/json" } });
  });
  const geo = createGeocoder({ provider: "nominatim", photonUrl: "", nominatimUrl: "https://nominatim.test", contact: "t", cache: memoryCache(), fetchImpl });
  assert.deepEqual(await geo.cityAt?.({ lat: 9.06, lon: 7.47 }), { city: "Abuja", country: "NG" });
  assert.deepEqual(await geo.cityAt?.({ lat: 6.43, lon: 3.42 }), { city: "Lagos", country: "NG" });
  assert.deepEqual(await geo.cityAt?.({ lat: 52.5, lon: 13.4 }), { city: "Berlin", country: "DE" });
});
