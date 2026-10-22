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
const cfg = { publicUrl: "https://x.test", webUrl: "https://x.test", uidDomain: "x.test" };
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
  // one of the code's phrasings, picked by the place (src/core/tasks.mjs, explainFallback)
  assert.match(r.plan?.why || "", /^(Freedom Park keeps everyone within about \d+ minutes|Nobody travels more than about \d+ minutes to Freedom Park|Freedom Park is about \d+ minutes for whoever is furthest)/);
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
  const { neighbourhoodsIn: core } = await import("../src/app/service.mjs");
  // which address parts name the city (Lagos, LA, Nigeria) comes from the Lagos city pack now
  const { LAGOS, LAGOS_REGION } = await import("../src/packs/index.mjs");
  const neighbourhoodsIn = (/** @type {string} */ a) => core(a, LAGOS.addressNoise(LAGOS_REGION));
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
  assert.ok(!("uberUrl" in pods[0]));
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

test("a wet Saturday afternoon: never an 8 am plan; the sloth skips it and says why", async () => {
  // the live forecast of 21 Oct 2026 for Saturday 24 Oct: a drier morning, storms from midday
  const sat = { 8: 24, 9: 34, 10: 45, 11: 58, 12: 71, 13: 82, 14: 90, 15: 95, 16: 94, 17: 85, 18: 69, 19: 53, 20: 35 };
  /** @type {any[]} */
  const sent = [];
  const ai = { available: true, model: "x", async generate(/** @type {any} */ req) { sent.push(req); return { data: null, model: "x", wallSec: 0, jsonMode: true }; } };
  const weather = fakeWeather({ rain: (_d, h) => /** @type {any} */ (sat)[h] ?? 60 });
  const { store, svc } = make({ ai, weather, places: fakeOverpass([PLACES.freedom]) });
  await store.put("crews", CREW);
  const r = await svc._internal.makeRitual(CREW, { date: "2026-10-24", window: { from: "15:00", to: "19:00" } }, []);
  const plan = /** @type {any} */ (r.plan);
  assert.equal(plan?.rainPlan?.kind, "skip");
  assert.equal(plan?.status, "cancelled");
  assert.equal(plan?.ritualFor, "2026-10-24", "the slot is settled, so the heartbeat does not retry it");
  const startHour = Number(plan?.start.slice(11, 13));
  assert.ok(startHour >= 11 && startHour <= 18, `inside social hours, got ${plan?.start}`);
  assert.match(plan?.invite || "", /^Rain all afternoon on Saturday \(up to 95% between 11 am and 6:30 pm\), and Sunday looks no better\. The sloth is skipping this one\./);
  assert.equal(sent.length, 0, "no Gemma call for a skipped ritual");
  assert.ok(!/[\u2014\u2013]/.test(plan?.invite || ""), "no dashes");
});

test("a wet Saturday with a known covered place: the sloth offers the roof instead", async () => {
  const weather = fakeWeather({ rain: () => 85 });
  const covered = { name: "Covered Hall", kind: "covered", lat: 6.45, lon: 3.40, covered: true, source: { url: "https://example.test" } };
  const { store, svc } = make({ weather, places: fakeOverpass([PLACES.freedom]), spots: [covered] });
  await store.put("crews", CREW);
  const r = await svc._internal.makeRitual(CREW, { date: "2026-10-24", window: { from: "15:00", to: "19:00" } }, []);
  const plan = /** @type {any} */ (r.plan);
  assert.equal(plan?.rainPlan?.kind, "covered");
  assert.equal(plan?.status, "on");
  assert.equal(plan?.place.name, "Covered Hall");
  assert.equal(plan?.place.outdoor, false);
  assert.match(plan?.rainPlan?.note, /so the sloth picked somewhere with a roof: Covered Hall, 3 pm to 6 pm\./);
});

test("a dry Saturday keeps the crew's window, cut to the social hours", async () => {
  const weather = fakeWeather({ rain: () => 10 });
  const { store, svc } = make({ weather, places: fakeOverpass([PLACES.freedom]) });
  await store.put("crews", CREW);
  const r = await svc._internal.makeRitual(CREW, { date: "2026-10-24", window: { from: "15:00", to: "19:00" } }, []);
  assert.equal(r.plan?.start, "2026-10-24T15:00:00+01:00");
  assert.equal(r.plan?.end, "2026-10-24T18:00:00+01:00");
  assert.equal(/** @type {any} */ (r.plan)?.rainPlan, undefined);
});

test("a ritual at a park with a sourced fee shows it; one without says check at the gate; no plan says free unsourced", async () => {
  const { withEntries } = await import("../src/core/places.mjs");
  const spots = withEntries([{ name: "Freedom Park", kind: "park", lat: PLACES.freedom.lat, lon: PLACES.freedom.lon }], [{ spot: "Freedom Park", free: false, note: "₦500 at the gate", source: { url: "https://example.test/fees", says: "Entry to Freedom Park is N500 per person" } }]);
  const { store, svc } = make({ places: fakeOverpass([]), spots });
  await store.put("crews", CREW);
  await store.put("members", { id: "m1", crewId: CREW.id, name: "Tolu", area: AREAS.yaba, token: "t1", calToken: "c1", joinedAt: "2026-10-21T08:00:00.000Z" });
  const r = await svc._internal.makeRitual(CREW, { date: "2026-10-24", window: { from: "15:00", to: "19:00" } }, []);
  assert.equal(r.plan?.price, null, "the sloth never writes a price");
  const view = (await svc.getCrew({ slug: CREW.slug, token: "t1" })).plans.find((/** @type {any} */ p) => p.kind === "ritual");
  assert.equal(view.place.entry.free, false);
  assert.equal(view.place.entry.note, "₦500 at the gate");
  // a park with no fee tag and no curated fee: unknown (the fixture's Freedom Park is tagged fee=yes)
  const noTag = { ...PLACES.freedom, osm: { type: /** @type {"way"} */ ("way"), id: 77, tags: { name: "Freedom Park", leisure: "park" } } };
  const bare = make({ places: fakeOverpass([noTag]) });
  await bare.store.put("crews", CREW);
  await bare.store.put("members", { id: "m1", crewId: CREW.id, name: "Tolu", area: AREAS.yaba, token: "t1", calToken: "c1", joinedAt: "2026-10-21T08:00:00.000Z" });
  await bare.svc._internal.makeRitual(CREW, { date: "2026-10-24", window: { from: "15:00", to: "19:00" } }, []);
  const v2 = (await bare.svc.getCrew({ slug: CREW.slug, token: "t1" })).plans.find((/** @type {any} */ p) => p.kind === "ritual");
  assert.deepEqual(v2.place.entry, { free: null, note: null, source: null });
});

test("pods use the road route when OSRM answers, and say so when it does not", async () => {
  const calls = [];
  const routes = {
    async route(/** @type {any} */ from, /** @type {any} */ to) { calls.push([from, to]); return { km: 12.4, min: 16, bridges: ["Eko Bridge"] }; },
    async table() { return null; },
  };
  const { store, svc } = make({ routes });
  await store.put("crews", CREW);
  await store.put("members", { id: "m1", crewId: CREW.id, name: "Seyi", area: AREAS.surulere, token: "t1", calToken: "c1", joinedAt: "2026-10-21T08:00:00.000Z" });
  const plan = { kind: "found", title: "Show", start: "2026-10-24T16:00:00+01:00", end: "2026-10-24T19:00:00+01:00", tz: "Africa/Lagos", place: { name: "Freedom Park", address: null, lat: PLACES.freedom.lat, lon: PLACES.freedom.lon, outdoor: false, private: false }, price: null, host: null, hostName: null, bring: [], source: {} };
  const created = await svc.addPlan({ slug: CREW.slug, token: "t1", body: { plan } });
  await svc.patchPlan({ id: created.plan.id, token: "t1", body: { rsvp: "going" } });
  const { pods } = await svc.getPods({ id: created.plan.id, token: "t1" });
  assert.equal(pods[0].bridge, "Eko Bridge");
  assert.equal(pods[0].estimate.source, "road");
  assert.ok(calls.length >= 1);
  const down = make({ routes: { async route() { return null; }, async table() { return null; } } });
  await down.store.put("crews", CREW);
  await down.store.put("members", { id: "m1", crewId: CREW.id, name: "Seyi", area: AREAS.surulere, token: "t1", calToken: "c1", joinedAt: "2026-10-21T08:00:00.000Z" });
  const c2 = await down.svc.addPlan({ slug: CREW.slug, token: "t1", body: { plan } });
  await down.svc.patchPlan({ id: c2.plan.id, token: "t1", body: { rsvp: "going" } });
  const p2 = (await down.svc.getPods({ id: c2.plan.id, token: "t1" })).pods[0];
  assert.equal(p2.estimate.source, "straight");
  assert.equal(p2.bridge, null);
  assert.match(p2.estimate.text, /the road route was not available/);
});

test("setting your own area from a rough location keeps only the neighbourhood, never the point", async () => {
  const geo = fakeGeocoder();
  const { store, svc } = make({ geocoder: geo });
  await store.put("crews", CREW);
  await store.put("members", { id: "m1", crewId: CREW.id, name: "Bayo", area: null, token: "t1", calToken: "c1", joinedAt: "2026-10-21T08:00:00.000Z" });
  const r = await svc.setMyArea({ memberId: "m1", token: "t1", body: { near: { lat: 6.60412, lon: 3.35077 } } });
  assert.equal(r.you.area.label, "Ikeja");
  const saved = await store.get("members", "m1");
  assert.deepEqual([saved.area.lat, saved.area.lon], [6.6018, 3.3515], "the neighbourhood's own centre");
  const asked = geo.calls.find((c) => c.reverse);
  assert.deepEqual(asked.reverse, { lat: 6.6, lon: 3.35 }, "the point is rounded before it is looked up");
  await assert.rejects(svc.setMyArea({ memberId: "m2", token: "t1", body: { area: "Yaba" } }), /link/i);
  const typed = await svc.setMyArea({ memberId: "m1", token: "t1", body: { area: "Surulere" } });
  assert.equal(typed.you.area.label, "Surulere");
});

test("the first pick: asked for, it runs once, and asking again returns the same plan", async () => {
  const { store, svc } = make({ places: fakeOverpass([PLACES.freedom]) });
  await store.put("crews", CREW); // a crew from before the first pick was a job: it gets one when asked
  const a = await svc.firstPick({ slug: CREW.slug, token: CREW.inviteToken });
  assert.equal(a.status, "ready");
  assert.equal(a.reason, "made");
  assert.equal(a.plan?.kind, "ritual");
  const b = await svc.firstPick({ slug: CREW.slug, token: CREW.inviteToken, waitMs: 0 });
  assert.equal(b.status, "ready");
  assert.equal(b.plan?.id, a.plan?.id);
  assert.equal((await store.find("plans", { crewId: CREW.id })).length, 1);
  const t = await svc.tick();
  assert.equal(t.rituals, 0, "the heartbeat leaves the first pick be");
  assert.equal(t.firstPicks, 0);
  await store.put("crews", { ...CREW, id: "c_norhythm", slug: "no-rhythm", inviteToken: "inv2", rhythm: null });
  const none = await svc.firstPick({ slug: "no-rhythm", token: "inv2" });
  assert.deepEqual([none.status, none.reason, none.plan], ["ready", "no_rhythm", null]);
});
