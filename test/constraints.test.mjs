// @ts-check
// Hard constraints before ranking, checked again before publishing (Astra's review, P1.4;
// persona eval v2: the night-shift crew got 4 pm to 7 pm ideas for a 2 pm to 6 pm window,
// and a three-area crew's ritual had a 101 minute trip). The crew's own window bounds the
// ideas and the ritual; the city pack's social hours only narrow it. Budget, trip length,
// step-free, no alcohol, no nightlife, kids and discretion are filters, not scores. "Nothing
// fits" is an honest answer.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createService } from "../src/app/service.mjs";
import { createIdeas } from "../src/app/ideas.mjs";
import { makeIds } from "../src/app/ids.mjs";
import { loadPrompts } from "../src/app/prompts.mjs";
import { memoryCache } from "../src/adapters/http.mjs";
import { fakeAi, fakeGeocoder, fakeOverpass, fakePageMeta, fakePush, fakeWeather } from "../src/adapters/fakes.mjs";
import { memoryStore } from "../src/adapters/store.mjs";
import { candidateViolations, crewConstraints } from "../src/core/constraints.mjs";
import { slotFor } from "../src/core/ideas.mjs";
import { cleanTaste } from "../src/core/taste.mjs";
import { clipToSocial, ritualWindow } from "../src/core/weather.mjs";
import { LAGOS } from "../src/packs/index.mjs";

const cfg = { publicUrl: "https://x.test", webUrl: "https://x.test", uidDomain: "x.test" };
const LAGOS_REGION = { center: { lat: 6.61, lon: 3.345 }, countryCode: "NG", city: "Lagos", timezone: "Africa/Lagos", tzSource: "open-meteo" };
const cafe = (/** @type {string} */ name, /** @type {number} */ lat, /** @type {number} */ lon, extra = {}) => ({ name, lat, lon, osm: { type: "node", id: Math.round(lat * 1e4), tags: { name, amenity: "cafe", ...extra } } });
const park = (/** @type {string} */ name, /** @type {number} */ lat, /** @type {number} */ lon) => ({ name, lat, lon, osm: { type: "way", id: Math.round(lon * 1e4), tags: { name, leisure: "park" } } });

const NIGHTSHIFT = {
  id: "c_ns", slug: "night-shift", name: "Night shift", vibe: null, vibeTags: [], budget: /** @type {"cheap"} */ ("cheap"),
  taste: cleanTaste({ placeKinds: ["cafe", "park", "cinema"], likes: ["hangout"] }),
  rhythm: { every: "2w", day: 6, window: { from: "14:00", to: "18:00" }, anchor: "2026-10-10" },
  areas: [{ label: "Ikeja", lat: 6.601, lon: 3.351 }, { label: "Ogba", lat: 6.627, lon: 3.339 }],
  tz: "Africa/Lagos", region: LAGOS_REGION, createdAt: "2026-10-01T10:00:00.000Z", inviteToken: "inv_ns",
};

test("the night-shift persona (lag-nightshift-ikeja): every idea is inside 2 pm to 6 pm, the crew's own window", async () => {
  const now = () => Date.parse("2026-10-22T11:00:00Z");
  const store = memoryStore();
  // rain all Saturday afternoon, so places go under a roof (the hours that broke it: 4 pm to 7 pm)
  const weather = fakeWeather({ rain: (d, h) => (h >= 11 && h <= 19 ? 80 : 10) });
  const places = fakeOverpass([park("Ikeja Park", 6.605, 3.35)], [cafe("Mugg & Bean", 6.61, 3.355), cafe("Casper & Gambini's", 6.6, 3.349)]);
  const svc = createService({ store, ai: fakeAi({ answers: {} }), geocoder: fakeGeocoder(), places, weather, pages: fakePageMeta(), push: fakePush(), spots: [], prompts: loadPrompts(), ids: makeIds(), now, cfg });
  await store.put("crews", NIGHTSHIFT);
  const ideas = createIdeas({ store, cache: memoryCache({ now }), ai: fakeAi({ answers: {} }), feeds: null, weather, geocoder: fakeGeocoder(), candidatesNear: svc._internal.candidatesNear, prompts: loadPrompts(), now });
  const card = await ideas.getIdeas({ slug: "night-shift", token: "inv_ns", when: "weekend" });
  assert.ok(card.ideas.length > 0, `some idea fits: ${card.notes.join(" | ")}`);
  for (const i of card.ideas) {
    const from = i.start.slice(11, 16);
    const to = i.end.slice(11, 16);
    assert.ok(from >= "14:00" && to <= "18:00", `${i.title} is ${from} to ${to}`);
  }
});

test("slotFor: the crew's window narrows the social hours and never widens them", () => {
  const sat = Date.parse("2026-10-24T08:00:00Z");
  const s = slotFor("weekend", sat, "Africa/Lagos", LAGOS.social, { from: "14:00", to: "18:00" });
  for (const d of s.days) for (const w of [d.outdoor, d.covered]) if (w) assert.ok(w.from >= "14:00" && w.to <= "18:00", JSON.stringify(w));
  // a window the social hours do not share an hour with: nothing, not the social hours
  assert.equal(clipToSocial("2026-10-24", { from: "07:00", to: "09:00" }, { social: LAGOS.social }), null);
  assert.deepEqual(clipToSocial("2026-10-24", { from: "14:00", to: "18:00" }, { social: LAGOS.social }), { from: "14:00", to: "18:00" });
});

test("the ritual's rain move stays inside the crew's window", () => {
  const hours = [];
  for (const date of ["2026-10-24", "2026-10-25"]) for (let h = 0; h < 24; h++) hours.push({ date, time: `${String(h).padStart(2, "0")}:00`, rainProb: h < 14 ? 10 : 85, feelsC: 30, uv: 3, precipMm: 0 });
  const r = ritualWindow(hours, { date: "2026-10-24", from: "15:00", to: "19:00", hours: 3 }, LAGOS.social);
  assert.notEqual(r?.rainPlan?.kind, "moved", "not moved to the dry morning the crew did not offer");
  assert.ok(r && r.window.from >= "15:00" && r.window.to <= "19:00", JSON.stringify(r?.window));
});

test("the ritual: no trip over 90 minutes (lag-lagoon-three-areas had 101), and nothing outside the window", async () => {
  const now = () => Date.parse("2026-10-21T09:00:00Z");
  const store = memoryStore();
  // Badagry and Ajah, 76 km apart: every place between them is a long trip for someone
  const far = { ...NIGHTSHIFT, id: "c_far", slug: "far", rhythm: { every: "1w", day: 6, window: { from: "15:00", to: "19:00" } }, taste: null, areas: [{ label: "Badagry", lat: 6.415, lon: 2.88 }, { label: "Ajah", lat: 6.469, lon: 3.57 }] };
  const svc = createService({ store, ai: fakeAi({ answers: {} }), geocoder: fakeGeocoder(), places: fakeOverpass([park("Middle Park", 6.44, 3.22), park("Ajah Green", 6.47, 3.56)]), weather: fakeWeather({ rain: () => 5 }), pages: fakePageMeta(), push: fakePush(), spots: [], prompts: loadPrompts(), ids: makeIds(), now, cfg });
  await store.put("crews", far);
  const r = await svc._internal.makeRitual(far, { date: "2026-10-24", window: { from: "15:00", to: "19:00" } }, []);
  assert.equal(r.made, false, `not made: ${r.plan?.place?.name}`);
  assert.equal(r.reason, "too_far");
  // a Saturday-night crew: the ritual is at night or not at all, never the afternoon
  const night = { ...NIGHTSHIFT, id: "c_night", slug: "night", taste: cleanTaste({ placeKinds: ["cafe", "park"] }) };
  await store.put("crews", night);
  const svc2 = createService({ store, ai: fakeAi({ answers: {} }), geocoder: fakeGeocoder(), places: fakeOverpass([park("Ikeja Park", 6.605, 3.35)], [cafe("Mugg & Bean", 6.61, 3.355)]), weather: fakeWeather({ rain: () => 5 }), pages: fakePageMeta(), push: fakePush(), spots: [], prompts: loadPrompts(), ids: makeIds(), now, cfg });
  const n = await svc2._internal.makeRitual(night, { date: "2026-10-24", window: { from: "20:00", to: "23:00" } }, []);
  if (n.made) {
    assert.ok(/** @type {string} */ (n.plan?.start).slice(11, 16) >= "20:00", n.plan?.start);
    assert.ok(/** @type {string} */ (n.plan?.end).slice(11, 16) <= "23:00", n.plan?.end);
  } else assert.equal(n.reason, "no_window");
});

test("candidateViolations: budget, trips, step-free, no alcohol, no nightlife, kids, discretion and the window", () => {
  const taste = cleanTaste({ needs: ["no alcohol", "kid-friendly", "step-free", "discreet"] });
  const k = crewConstraints({ budget: "free", taste, rhythm: { window: { from: "14:00", to: "18:00" } } }, { cheapMax: 5000 });
  const base = { kind: "place", title: "Ikeja Park", label: "park", date: "2026-10-24", time: { from: "15:00", to: "17:00" }, price: null, travel: { maxMin: 30, trips: [] }, place: { name: "Ikeja Park", outdoor: true, osm: { tags: { leisure: "park" } } } };
  assert.deepEqual(candidateViolations(/** @type {any} */ (base), k), []);
  const v = (/** @type {any} */ over) => candidateViolations(/** @type {any} */ ({ ...base, ...over }), k);
  assert.match(v({ time: { from: "16:00", to: "19:00" } }).join(), /hours/);
  assert.match(v({ travel: { maxMin: 101, trips: [] } }).join(), /far/);
  assert.match(v({ price: { text: "₦3,000", free: false } }).join(), /budget/);
  assert.match(v({ place: { name: "Steps Cafe", outdoor: false, osm: { tags: { amenity: "cafe", wheelchair: "no" } } } }).join(), /step-free/);
  assert.match(v({ place: { name: "Bar 9", outdoor: false, osm: { tags: { amenity: "bar" } } } }).join(), /alcohol|kids/);
  assert.match(v({ kind: "event", title: "Wine and paint night", label: "party", place: { name: "Studio", outdoor: false } }).join(), /drinks|party/);
  assert.match(v({ kind: "event", title: "Queer brunch", label: null, place: { name: "Studio", outdoor: false } }).join(), /discreet/);
  const late = crewConstraints({ budget: "any", taste: cleanTaste({ needs: ["daytime"] }), rhythm: null });
  assert.match(candidateViolations(/** @type {any} */ ({ ...base, kind: "event", title: "Club night", time: { from: "22:00", to: "23:59" }, place: { name: "Club", outdoor: false, osm: { tags: { amenity: "nightclub" } } } }), late).join(), /night/);
});
