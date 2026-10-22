// @ts-check
// Calendar feeds are read by calendar apps and Google's servers on their own schedule
// (Astra's review, P2): a read must not trigger routing work. Pods with road routes are
// worked out in the background (after an answer, and by the heartbeat) and kept; a feed
// read uses what was kept, or the straight-line estimate, and never asks OSRM.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createService } from "../src/app/service.mjs";
import { makeIds } from "../src/app/ids.mjs";
import { loadPrompts } from "../src/app/prompts.mjs";
import { fakeAi, fakeGeocoder, fakeOverpass, fakePageMeta, fakePush, fakeWeather } from "../src/adapters/fakes.mjs";
import { memoryStore } from "../src/adapters/store.mjs";
import { CREW, MEMBERS, makeRitual } from "./fixtures/plans.mjs";

const now = () => Date.parse("2026-10-21T09:00:00Z");
const cfg = { publicUrl: "https://x.test", webUrl: "https://x.test", uidDomain: "x.test" };

test("a calendar feed read asks OSRM nothing; the routed pods come from the background", async () => {
  let calls = 0;
  const routes = {
    async route(/** @type {any} */ a, /** @type {any} */ b) {
      calls++;
      return { km: 9.9, min: 21, bridges: [] };
    },
    async table() { return null; },
  };
  const store = memoryStore();
  const svc = createService({ store, ai: fakeAi({ answers: {} }), geocoder: fakeGeocoder(), places: fakeOverpass([]), weather: fakeWeather({ rain: () => 5 }), routes, pages: fakePageMeta(), push: fakePush({ enabled: false }), spots: [], prompts: loadPrompts(), ids: makeIds(), now, cfg });
  await store.put("crews", { ...CREW, rhythm: null });
  for (const m of MEMBERS) await store.put("members", m);
  await store.put("plans", makeRitual({ rsvps: { m1: "going", m2: "going", m3: "going" } }));
  const before = await svc.feed({ calToken: "cal_m1" });
  assert.equal(calls, 0, "the read asked OSRM nothing");
  assert.match(before, /BEGIN:VEVENT/);
  await svc.eventIcs({ id: "p_ritual", token: "tok_m1" });
  assert.equal(calls, 0, "nor does the one-event file");
  // the heartbeat works the pods out once, with road routes, and keeps them
  await svc.tick();
  const routed = calls;
  assert.ok(routed > 0, "the background asked");
  const after = await svc.feed({ calToken: "cal_m1" });
  assert.equal(calls, routed, "the next read uses what was kept");
  assert.ok(after.length > 0);
  const kept = await store.get("podcache", "p_ritual");
  assert.ok(kept?.result?.pods?.length, "the routed pods are kept");
  // an answer changes who rides: the answer's own pod check keeps the new pods, and reads still route nothing
  await svc.patchPlan({ id: "p_ritual", token: "tok_m2", body: { rsvp: null } });
  const c0 = calls;
  await svc.feed({ calToken: "cal_m1" });
  await svc.feed({ calToken: "cal_m3" });
  assert.equal(calls, c0, "reads did not route");
  assert.deepEqual((await store.get("podcache", "p_ritual"))?.result.pods.flatMap((/** @type {any} */ p) => p.memberIds).sort(), ["m1", "m3"]);
});
