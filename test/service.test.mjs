// @ts-check
// Service behaviour that the API tests do not reach directly.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createService } from "../src/app/service.mjs";
import { makeIds } from "../src/app/ids.mjs";
import { loadPrompts } from "../src/app/prompts.mjs";
import { fakeAi, fakeGeocoder, fakeOverpass, fakePageMeta, fakePush, fakeWeather } from "../src/adapters/fakes.mjs";
import { memoryStore } from "../src/adapters/store.mjs";
import { AREAS, PLACES } from "./fixtures/lagos.mjs";
import { CREW } from "./fixtures/plans.mjs";

const now = () => Date.parse("2026-10-21T09:00:00Z");
const cfg = { publicUrl: "https://x.test", webUrl: "https://x.test", uidDomain: "x.test", uberLinkStyle: /** @type {"looking"} */ ("looking") };
const make = (/** @type {any} */ over = {}) => {
  const store = memoryStore();
  return {
    store,
    svc: createService({ store, ai: fakeAi({ answers: {} }), geocoder: fakeGeocoder(), places: fakeOverpass([]), weather: fakeWeather(), pages: fakePageMeta(), push: fakePush(), spots: [], prompts: loadPrompts(), ids: makeIds(), now, cfg, ...over }),
  };
};
const nearYaba = { name: "Yaba Green", lat: 6.512, lon: 3.372, osm: { type: /** @type {"way"} */ ("way"), id: 9, tags: { name: "Yaba Green", leisure: "park" } } };

test("with one member joined, the ritual still centres on the crew's declared areas", async () => {
  const { store, svc } = make({ places: fakeOverpass([nearYaba, PLACES.freedom]) });
  await store.put("crews", CREW); // areas: Yaba and Lekki
  await store.put("members", { id: "m1", crewId: CREW.id, name: "Tolu", area: AREAS.yaba, token: "t1", calToken: "c1", joinedAt: "2026-10-21T08:00:00.000Z" });
  const r = await svc._internal.makeRitual(CREW, { date: "2026-10-24", window: { from: "15:00", to: "19:00" } }, []);
  assert.equal(r.made, true);
  assert.equal(r.plan?.place.name, "Freedom Park", "not the park next to the one member in Yaba");
});

test("Gemma down: the ritual goes out with the code's explanation and invite", async () => {
  const { store, svc } = make({ places: fakeOverpass([PLACES.freedom]) });
  await store.put("crews", CREW);
  const r = await svc._internal.makeRitual(CREW, { date: "2026-10-24", window: { from: "15:00", to: "19:00" } }, []);
  assert.match(r.plan?.why || "", /^Freedom Park keeps everyone within about \d+ minutes/);
  assert.match(r.plan?.invite || "", /Come through if you can\. No need to reply\.$/);
});

test("Overpass down: the curated spots carry the ritual", async () => {
  const failing = { async greenNear() { throw new Error("at capacity"); } };
  const spots = [{ name: "Freedom Park", kind: "park", lat: 6.4488, lon: 3.3965, osm: { type: "way", id: 363761802, tags: { name: "Freedom Park", leisure: "park" } } }];
  const { store, svc } = make({ places: failing, spots });
  await store.put("crews", CREW);
  const r = await svc._internal.makeRitual(CREW, { date: "2026-10-24", window: { from: "15:00", to: "19:00" } }, []);
  assert.equal(r.plan?.place.name, "Freedom Park");
});

test("Gemma down while reading a crew: an empty draft to fill by hand, not an error", async () => {
  const { svc } = make({ ai: { available: true, model: "x", async generate() { throw Object.assign(new Error("busy"), { status: 503, hint: "Gemma is busy right now." }); } } });
  const r = await svc.draftCrew({ sentence: "the uni guys every saturday" });
  assert.equal(r.ai, false);
  assert.equal(r.draft.name, null);
  assert.match(r.notes[0], /^Gemma is busy right now\. Fill this in yourself\.$/);
});
