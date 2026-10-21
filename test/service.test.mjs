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

test("Overpass down: the curated spots carry the ritual, after one try (the heartbeat must answer within 100 s)", async () => {
  let tries = 0;
  const failing = { async greenNear() { tries++; throw new Error("at capacity"); } };
  const spots = [{ name: "Freedom Park", kind: "park", lat: 6.4488, lon: 3.3965, osm: { type: "way", id: 363761802, tags: { name: "Freedom Park", leisure: "park" } } }];
  const { store, svc } = make({ places: failing, spots });
  await store.put("crews", CREW);
  const r = await svc._internal.makeRitual(CREW, { date: "2026-10-24", window: { from: "15:00", to: "19:00" } }, []);
  assert.equal(r.plan?.place.name, "Freedom Park");
  assert.equal(tries, 1, "no wider search after a failure");
});

test("Gemma down while reading a crew: an empty draft to fill by hand, not an error", async () => {
  const { svc } = make({ ai: { available: true, model: "x", async generate() { throw Object.assign(new Error("busy"), { status: 503, hint: "Gemma is busy right now." }); } } });
  const r = await svc.draftCrew({ sentence: "the uni guys every saturday" });
  assert.equal(r.ai, false);
  assert.equal(r.draft.name, null);
  assert.match(r.notes[0], /^Gemma is busy right now\. Fill this in yourself\.$/);
});

test("an Instagram link on its own asks for the flyer picture, without a Gemma call", async () => {
  let calls = 0;
  const ai = { available: true, model: "x", async generate() { calls++; return { data: null, model: "x", wallSec: 0, jsonMode: true }; } };
  const { store, svc } = make({ ai });
  await store.put("crews", CREW);
  await store.put("members", { id: "m1", crewId: CREW.id, name: "Tolu", area: AREAS.yaba, token: "t1", calToken: "c1", joinedAt: "2026-10-21T08:00:00.000Z" });
  for (const input of [{ url: "https://www.instagram.com/p/DAbC/" }, { text: "https://instagr.am/p/x look" }]) {
    await assert.rejects(svc.parsePlan({ slug: CREW.slug, token: "t1", ...input }), (e) => /** @type {any} */ (e).code === "link_locked" && /Share the flyer picture instead/.test(/** @type {any} */ (e).message));
  }
  assert.equal(calls, 0);
  // with words of its own beside the link, the sentence is still read
  await svc.parsePlan({ slug: CREW.slug, token: "t1", text: "https://instagram.com/p/x rooftop party saturday 8pm" });
  assert.equal(calls, 1);
});

test("an address that is not on the map keeps its neighbourhood for ride times and weather", async () => {
  const { neighbourhoodsIn } = await import("../src/app/service.mjs");
  assert.deepEqual(neighbourhoodsIn("14 Adeyemo Close off Bode Thomas, Surulere"), ["Surulere"]);
  assert.deepEqual(neighbourhoodsIn("30 Mobolaji Bank Anthony Way, Ikeja, Lagos, LA 021189, Nigeria"), ["Ikeja"]);
  assert.deepEqual(neighbourhoodsIn("Freedom Park"), []);
  const answers = { "parse-plan": { kind: "found", title: "HIGHLIFE UNDER MANGOES", dateWords: "sat 31 oct", date: "2026-10-31", startTime: "5pm", endTime: null, atHost: false, venueName: "The Mango Yard", address: "14 Adeyemo Close off Bode Thomas, Surulere", outdoor: true, priceText: "GATE ₦3,000", free: false, hostName: "THE MANGO YARD", bring: [], confidence: { title: 0.9, date: 0.9, time: 0.9, place: 0.9, price: 0.9, host: 0.9 } } };
  const { store, svc } = make({ ai: fakeAi({ answers }) });
  await store.put("crews", CREW);
  await store.put("members", { id: "m1", crewId: CREW.id, name: "Seyi", area: AREAS.surulere, token: "t1", calToken: "c1", joinedAt: "2026-10-21T08:00:00.000Z" });
  const r = await svc.parsePlan({ slug: CREW.slug, token: "t1", text: "flyer" });
  assert.equal(r.draft.title, "Highlife Under Mangoes");
  assert.equal(r.draft.hostName, "The Mango Yard");
  assert.equal(r.draft.price?.text, "Gate ₦3,000");
  assert.equal(r.draft.place.lat, null);
  assert.equal(r.draft.place.near?.label, "Surulere");
  assert.ok(r.notes.some((n) => /guessed from Surulere/.test(n)), "the person is told the pin is a guess");
  const created = await svc.addPlan({ slug: CREW.slug, token: "t1", body: { plan: r.draft } });
  assert.equal(created.plan.place.near?.label, "Surulere");
  await svc.patchPlan({ id: created.plan.id, token: "t1", body: { rsvp: "going" } });
  const { pods } = await svc.getPods({ id: created.plan.id, token: "t1" });
  assert.ok(pods[0].travelMin != null && pods[0].estimate.approxTo === "Surulere");
  assert.equal(pods[0].uberUrl, null);
});

test("the ritual explanation sent to Gemma has neighbourhoods and minutes, never member names", async () => {
  /** @type {any[]} */
  const sent = [];
  const ai = { available: true, model: "x", async generate(/** @type {any} */ req) { sent.push(req); return { data: null, model: "x", wallSec: 0, jsonMode: true }; } };
  const { store, svc } = make({ ai, places: fakeOverpass([PLACES.freedom]) });
  await store.put("crews", CREW);
  for (const [id, name, area] of [["m1", "Tolu", AREAS.yaba], ["m2", "Amaka", AREAS.lekki]]) await store.put("members", { id, crewId: CREW.id, name, area, token: `t${id}`, calToken: `c${id}`, joinedAt: "2026-10-21T08:00:00.000Z" });
  await svc._internal.makeRitual(CREW, { date: "2026-10-24", window: { from: "15:00", to: "19:00" } }, []);
  const text = JSON.stringify(sent.map((r) => r.messages));
  assert.ok(sent.length >= 1);
  assert.ok(!/Tolu|Amaka/.test(text), "no member names reach Google");
  assert.match(text, /Yaba/);
});

test("a wet Saturday: the ritual moves to the dry morning and says so", async () => {
  const sat = { 8: 24, 9: 34, 10: 45, 11: 58, 12: 71, 13: 82, 14: 90, 15: 95, 16: 94, 17: 85, 18: 69, 19: 53, 20: 35 };
  const weather = fakeWeather({ rain: (_d, h) => /** @type {any} */ (sat)[h] ?? 60 });
  const { store, svc } = make({ weather, places: fakeOverpass([PLACES.freedom]) });
  await store.put("crews", CREW);
  const r = await svc._internal.makeRitual(CREW, { date: "2026-10-24", window: { from: "15:00", to: "19:00" } }, []);
  assert.equal(r.plan?.start, "2026-10-24T08:00:00+01:00");
  assert.equal(r.plan?.ritualFor, "2026-10-24");
  assert.equal(/** @type {any} */ (r.plan)?.rainPlan?.kind, "moved");
  assert.match(r.plan?.invite || "", /moved it to 8 am to 10 am/, "the plain invite carries the honest note");
  assert.equal(r.plan?.weather?.ok, true);
});
