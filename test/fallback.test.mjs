// @ts-check
// The rain (covered) fallback, from the persona eval v2 dev set: it ignored taste (KFC for
// the church youth, community centres for the gamers, one of them an Islamic centre), and a
// single failed Overpass query left nothing. Now the crew's own kinds of place come before
// generic covered spots, places of worship and religious centres are never suggested, fast
// food chains come last unless the budget or the taste wants them, and the last good
// Overpass answer for a tile stands in when Overpass fails.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createService } from "../src/app/service.mjs";
import { makeIds } from "../src/app/ids.mjs";
import { loadPrompts } from "../src/app/prompts.mjs";
import { memoryCache } from "../src/adapters/http.mjs";
import { createOverpass } from "../src/adapters/overpass.mjs";
import { fakeAi, fakeGeocoder, fakeOverpass, fakePageMeta, fakePush, fakeWeather } from "../src/adapters/fakes.mjs";
import { memoryStore } from "../src/adapters/store.mjs";
import { scorePlaces } from "../src/core/places.mjs";
import { cleanTaste } from "../src/core/taste.mjs";

const now = () => Date.parse("2026-10-21T09:00:00Z");
const cfg = { publicUrl: "https://x.test", webUrl: "https://x.test", uidDomain: "x.test" };
const node = (/** @type {string} */ name, /** @type {number} */ lat, /** @type {number} */ lon, /** @type {Record<string, string>} */ tags) => ({ name, lat, lon, osm: { type: /** @type {"node"} */ ("node"), id: Math.round((lat + lon) * 1e4), tags: { name, ...tags } } });
const YABA = { label: "Yaba", lat: 6.5095, lon: 3.3711 };
const SURULERE = { label: "Surulere", lat: 6.5, lon: 3.35 };
const crewOf = (/** @type {any} */ taste, budget = "any") => ({ id: "c_rain", slug: "rain", name: "Rain crew", vibe: null, vibeTags: [], budget, taste, rhythm: { every: "1w", day: 6, window: { from: "15:00", to: "19:00" } }, areas: [YABA, SURULERE], tz: "Africa/Lagos", region: { center: { lat: 6.505, lon: 3.36 }, countryCode: "NG", city: "Lagos", timezone: "Africa/Lagos", tzSource: "open-meteo" }, createdAt: "2026-10-01T00:00:00.000Z", inviteToken: "inv_rain" });

async function ritualInRain(/** @type {any} */ crew, /** @type {any[]} */ kinds, /** @type {any[]} */ spots = []) {
  const store = memoryStore();
  const svc = createService({ store, ai: fakeAi({ answers: {} }), geocoder: fakeGeocoder(), places: fakeOverpass([node("Yaba Park", 6.506, 3.365, { leisure: "park" })], kinds), weather: fakeWeather({ rain: () => 90 }), pages: fakePageMeta(), push: fakePush(), spots, prompts: loadPrompts(), ids: makeIds(), now, cfg });
  await store.put("crews", crew);
  return svc._internal.makeRitual(crew, { date: "2026-10-24", window: { from: "15:00", to: "19:00" } }, []);
}

test("rain: the crew's own kind of place comes before a generic covered spot", async () => {
  const gamers = cleanTaste({ placeKinds: ["arcade", "bowling"], likes: ["games"] });
  const spots = [{ name: "Covered Hall", kind: "venue", covered: true, lat: 6.505, lon: 3.36 }];
  const r = await ritualInRain(crewOf(gamers), [node("Game Arena", 6.52, 3.38, { leisure: "amusement_arcade" })], spots);
  assert.equal(r.plan?.place.name, "Game Arena");
  assert.equal(r.plan?.rainPlan?.kind, "covered");
});

test("rain: never a place of worship or a religious centre (the gamers got an Islamic centre)", async () => {
  const gamers = cleanTaste({ placeKinds: ["arcade", "community centre"], likes: ["games"] });
  const r = await ritualInRain(crewOf(gamers), [
    node("Ikeja Islamic Centre", 6.505, 3.36, { amenity: "community_centre" }),
    node("St Dominic's Hall", 6.506, 3.361, { amenity: "community_centre", religion: "christian" }),
    node("Game Arena", 6.53, 3.39, { leisure: "amusement_arcade" }),
  ]);
  assert.equal(r.plan?.place.name, "Game Arena");
  const s = scorePlaces({ members: [{ id: "a", name: "A", area: YABA }], candidates: [node("Central Mosque", 6.51, 3.37, { amenity: "place_of_worship", religion: "muslim" }), node("Yaba Park", 6.506, 3.365, { leisure: "park" })] });
  assert.equal(s.pick?.candidate.name, "Yaba Park", "not for anyone, taste or none");
  assert.equal(s.ranked.length, 1);
});

test("rain: a fast food chain comes after a restaurant, unless the budget or the taste wants it", async () => {
  const youth = cleanTaste({ placeKinds: ["restaurant", "cafe"], needs: ["no alcohol"] });
  const kinds = [node("KFC", 6.505, 3.36, { amenity: "fast_food", brand: "KFC" }), node("Mama's Kitchen", 6.515, 3.375, { amenity: "restaurant" })];
  // the KFC is the fairer trip, as on 22 Oct; the restaurant still wins
  const r = await ritualInRain(crewOf(youth), [...kinds]);
  assert.equal(r.plan?.place.name, "Mama's Kitchen");
  const members = [{ id: "a", name: "A", area: YABA }, { id: "b", name: "B", area: SURULERE }];
  const chain = node("Chicken Republic", 6.505, 3.36, { amenity: "fast_food" });
  const resto = node("Mama's Kitchen", 6.515, 3.375, { amenity: "restaurant" });
  assert.equal(scorePlaces({ members, candidates: [chain, resto], taste: youth }).pick?.candidate.name, "Mama's Kitchen");
  assert.equal(scorePlaces({ members, candidates: [chain, resto], taste: cleanTaste({ placeKinds: ["street food"] }) }).pick?.candidate.name, "Chicken Republic", "a crew into street food");
});

test("Overpass down after the week's answer expired: the last good answer for the tile stands in", async () => {
  let t = Date.parse("2026-10-01T00:00:00Z");
  const cache = memoryCache({ now: () => t });
  let up = true;
  const f = /** @type {any} */ (async () => {
    if (!up) return new Response("busy", { status: 504 });
    return new Response(JSON.stringify({ elements: [{ type: "node", id: 1, lat: 6.506, lon: 3.365, tags: { name: "Yaba Park", leisure: "park" } }] }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const op = createOverpass({ urls: ["https://a.test/api"], contact: "t", cache, fetchImpl: f, now: () => t, sleep: async () => {} });
  assert.equal((await op.greenNear({ lat: 6.505, lon: 3.365 }, 6000)).length, 1);
  t += 10 * 24 * 3600_000; // the week is over
  up = false;
  const stale = await op.greenNear({ lat: 6.505, lon: 3.365 }, 6000);
  assert.deepEqual(stale.map((c) => c.name), ["Yaba Park"]);
});

test("rain: a crew whose taste grounding dropped every kind of place still gets a covered option", async () => {
  // the pinned run of d1770d0: two crews were left with no kinds, and a wet Saturday skipped
  const free = cleanTaste({ likes: ["free events"], placeKinds: ["bar", "cinema"], budget: "free" }, { sentence: "Abeg we no get money, free things only, around Yaba" });
  assert.ok(free.placeKinds.length > 0, JSON.stringify(free));
  const r = await ritualInRain(crewOf(free, "free"), [node("Yaba Library", 6.51, 3.37, { amenity: "library" }), node("Mainland Community Hall", 6.508, 3.366, { amenity: "community_centre" })]);
  assert.ok(r.made, JSON.stringify({ reason: r.reason }));
  assert.equal(r.plan?.rainPlan?.kind, "covered");
  assert.ok(["Yaba Library", "Mainland Community Hall"].includes(String(r.plan?.place.name)));
  const odd = cleanTaste({ likes: ["origami"], placeKinds: ["nightclub"] }, { sentence: "We fold origami, around Yaba" });
  const r2 = await ritualInRain(crewOf(odd), [node("Book Cafe", 6.51, 3.37, { amenity: "cafe" })]);
  assert.equal(r2.plan?.place.name, "Book Cafe");
});
