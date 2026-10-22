// @ts-check
// Speed work, 22 Oct 2026: the sloth's first pick as a background job (its state machine,
// retries by the heartbeat, restarts), the two lanes every outside call queues in, and the
// tile caches for Overpass and OSRM.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FIRST_PICK, beginPick, finishPick, pendingPick, shouldRun } from "../src/core/firstpick.mjs";
import { currentLane, inBackground, laneAi, laneGate, within } from "../src/adapters/lanes.mjs";
import { createService } from "../src/app/service.mjs";
import { makeIds } from "../src/app/ids.mjs";
import { loadPrompts } from "../src/app/prompts.mjs";
import { memoryCache } from "../src/adapters/http.mjs";
import { fakeAi, fakeGeocoder, fakeOverpass, fakePageMeta, fakePush, fakeWeather } from "../src/adapters/fakes.mjs";
import { memoryStore } from "../src/adapters/store.mjs";
import { PLACES } from "./fixtures/lagos.mjs";
import { CREW } from "./fixtures/plans.mjs";

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
const T = Date.parse("2026-10-21T09:00:00Z");

test("first pick state: pending, running, ready, failed with a backoff, and a cut-off start runs again", () => {
  const p = pendingPick(T);
  assert.deepEqual([p.status, p.attempts], ["pending", 0]);
  assert.equal(shouldRun(p, T, { running: false }), true, "a new crew's pick runs");
  assert.equal(shouldRun(p, T, { running: true }), false, "never twice in one process");
  assert.equal(shouldRun(undefined, T, { running: false }), false, "a crew with no job (no regular day)");
  const s = beginPick(p, T);
  assert.deepEqual([s.status, s.attempts, s.startedAt], ["pending", 1, new Date(T).toISOString()]);
  assert.equal(shouldRun(s, T + 60_000, { running: false }), false, "started a minute ago: still running somewhere");
  assert.equal(shouldRun(s, T + FIRST_PICK.staleMs, { running: false }), true, "started long ago and not running: cut off by a restart");

  const ready = finishPick(s, { planId: "p_r_1", reason: "made" }, T + 5000);
  assert.deepEqual([ready.status, ready.planId, ready.reason], ["ready", "p_r_1", "made"]);
  assert.equal(shouldRun(ready, T + 99 * 3_600_000, { running: false }), false, "done is done");
  const busy = finishPick(s, { reason: "busy" }, T);
  assert.deepEqual([busy.status, busy.planId], ["ready", null], "a plan already in the slot: nothing to pick, not a failure");

  const failed = finishPick(s, { reason: "no_places" }, T);
  assert.equal(failed.status, "failed");
  assert.equal(failed.nextTryAt, new Date(T + FIRST_PICK.backoffMs[0]).toISOString());
  assert.equal(shouldRun(failed, T + 1000, { running: false }), false, "waits for its backoff");
  assert.equal(shouldRun(failed, T + FIRST_PICK.backoffMs[0], { running: false }), true);
  // the backoff grows, and it stops after maxAttempts
  let x = failed;
  for (let i = 2; i <= FIRST_PICK.maxAttempts; i++) x = finishPick(beginPick(x, T), { reason: "no_places" }, T);
  assert.equal(x.attempts, FIRST_PICK.maxAttempts);
  assert.equal(x.nextTryAt, null);
  assert.equal(shouldRun(x, T + 365 * 86_400_000, { running: false }), false, "gives up; the heartbeat's own ritual still comes 3 days ahead");
});

/** A service on fakes whose clock the test moves. */
function rig(/** @type {any} */ over = {}) {
  let clock = T;
  const store = memoryStore();
  const svc = createService({ store, ai: fakeAi({ answers: {} }), geocoder: fakeGeocoder(), places: fakeOverpass([PLACES.freedom]), weather: fakeWeather(), pages: fakePageMeta(), push: fakePush(), spots: [], prompts: loadPrompts(), ids: makeIds(), now: () => clock, cfg: { publicUrl: "https://x.test", webUrl: "https://x.test", uidDomain: "x.test" }, ...over });
  return { store, svc, at: (/** @type {number} */ ms) => { clock = T + ms; } };
}
const ORGANISER = { name: "Tolu", area: "Yaba" };
const confirm = { name: "The uni guys", vibe: "outside", vibeTags: ["outside"], budget: "cheap", rhythm: CREW.rhythm, areas: CREW.areas, region: null };

test("making a crew does not wait for the pick; the job makes it once, even when started twice", async () => {
  let slow = 0;
  const places = { calls: 0, async greenNear() { this.calls++; await sleep(150); slow++; return [PLACES.freedom]; } };
  const { store, svc } = rig({ places });
  const made = await svc.createCrew({ confirm, organiser: ORGANISER });
  assert.deepEqual(made.crew.firstPick, { status: "pending", planId: null });
  assert.deepEqual([places.calls, slow], [0, 0], "the answer does not wait for the places, or even start them");
  // the HTTP layer kicks it after the answer; kicking twice shares one run
  const a = svc.kickFirstPick(made.crew.id);
  const b = svc.kickFirstPick(made.crew.id);
  assert.equal(a, b);
  const done = await a;
  assert.equal(done.status, "ready");
  const plans = await store.find("plans", { crewId: made.crew.id });
  assert.equal(plans.length, 1);
  assert.equal(done.planId, plans[0].id);
  // run again directly (a second process, a retried heartbeat): no second plan, no new state
  await svc._internal.firstPickJob(made.crew.id, true);
  assert.equal((await store.find("plans", { crewId: made.crew.id })).length, 1);
  const crew = await store.get("crews", made.crew.id);
  assert.equal(crew.firstPick.planId, plans[0].id);
  // the invite screen's question
  const r = await svc.firstPick({ slug: made.crew.slug, token: made.inviteToken, waitMs: 0 });
  assert.equal(r.plan?.id, plans[0].id);
});

test("a failed first pick is retried by the heartbeat after its backoff; one cut off by a restart runs again", async () => {
  let up = false;
  const places = { async greenNear() { if (!up) throw new Error("at capacity"); return [PLACES.freedom]; } };
  const { store, svc, at } = rig({ places });
  const made = await svc.createCrew({ confirm, organiser: ORGANISER });
  const first = await svc.kickFirstPick(made.crew.id);
  assert.deepEqual([first.status, first.reason, first.attempts], ["failed", "no_places", 1], "no curated spots and no map: nothing to pick yet");
  const asked = await svc.firstPick({ slug: made.crew.slug, token: made.inviteToken, waitMs: 0 });
  assert.deepEqual([asked.status, asked.plan], ["failed", null], "the invite screen shares without a plan");
  up = true;
  at(10_000);
  assert.equal((await svc.tick()).firstPicks, 0, "not before its backoff");
  at(FIRST_PICK.backoffMs[0] + 1000);
  const t = await svc.tick();
  assert.equal(t.firstPicks, 1);
  assert.equal(t.rituals, 0, "the first pick's plan stands for this slot");
  const crew = await store.get("crews", made.crew.id);
  assert.deepEqual([crew.firstPick.status, crew.firstPick.attempts], ["ready", 2]);

  // a pick cut off half way (the free instance slept): pending, started, not running here
  const other = await svc.createCrew({ confirm: { ...confirm, name: "Second crew" }, organiser: ORGANISER });
  const stuck = { ...(await store.get("crews", other.crew.id)), firstPick: beginPick(pendingPick(T), T) };
  await store.put("crews", stuck);
  at(FIRST_PICK.backoffMs[0] + 2000);
  assert.equal((await svc.tick()).firstPicks, 0, "a recent start may still be running");
  at(FIRST_PICK.backoffMs[0] + FIRST_PICK.staleMs + 5000);
  assert.equal((await svc.tick()).firstPicks, 1, "a stale one runs again");
  assert.equal((await store.get("crews", other.crew.id)).firstPick.status, "ready");
});

test("the first pick does not wait forever for the map or the forecast", async () => {
  const places = { async greenNear() { await sleep(3000); return [PLACES.freedom]; } };
  const weather = { ...fakeWeather(), async hourly() { await sleep(3000); return []; } };
  const spots = [{ name: "Muri Okunola Park", kind: "park", lat: 6.4333, lon: 3.4251, osm: { type: "way", id: 5, tags: { name: "Muri Okunola Park", leisure: "park" } } }];
  const { svc } = rig({ places, weather, spots, budgets: { pickPlacesMs: 50, pickWeatherMs: 50 } });
  const made = await svc.createCrew({ confirm, organiser: ORGANISER });
  const t0 = performance.now();
  const done = await svc.kickFirstPick(made.crew.id);
  assert.ok(performance.now() - t0 < 2000, `took ${Math.round(performance.now() - t0)} ms, not the map's 3 s`);
  const r = await svc.firstPick({ slug: made.crew.slug, token: made.inviteToken, waitMs: 0 });
  assert.equal(done.status, "ready");
  assert.equal(r.plan?.place.name, "Muri Okunola Park", "the curated spots carry it");
  assert.equal(r.plan?.weather, null, "no forecast in time: no weather line, rather than a made-up one");
});

test("lanes: background work runs in its lane through every await; user is the default", async () => {
  assert.equal(currentLane(), "user");
  const seen = await inBackground(async () => {
    await sleep(1);
    return Promise.all([currentLane(), (async () => { await sleep(1); return currentLane(); })()]);
  });
  assert.deepEqual(seen, ["background", "background"]);
  assert.equal(currentLane(), "user");
});

test("lanes: a user task never waits for the background queue, and goes first through a shared gap", async () => {
  const gate = laneGate({ concurrency: { user: 1, background: 1 } });
  /** @type {string[]} */
  const order = [];
  const bg = [1, 2, 3, 4].map((i) => gate(async () => { await sleep(300); order.push(`bg${i}`); }, "background"));
  await sleep(5);
  const t0 = performance.now();
  await gate(async () => { order.push("user"); });
  assert.ok(performance.now() - t0 < 250, "the user lane has its own slot (the background queue holds 1.2 s)");
  assert.equal(order[0], "user");
  await Promise.all(bg);

  // a gap between any two starts (a usage policy): the user task jumps the background queue
  const polite = laneGate({ minGapMs: 30, concurrency: { user: 1, background: 1 } });
  /** @type {string[]} */
  const seen = [];
  const jobs = [1, 2, 3].map((i) => polite(async () => { seen.push(`bg${i}`); }, "background"));
  jobs.push(polite(async () => { seen.push("user"); }, "user"));
  await Promise.all(jobs);
  assert.deepEqual(seen, ["bg1", "user", "bg2", "bg3"]);
});

test("lanes: Gemma's background lane runs one call at a time and a few a minute; user calls pass", async () => {
  let running = 0;
  let peak = 0;
  const slowAi = { available: true, model: "x", async generate(/** @type {any} */ req) { running++; peak = Math.max(peak, running); await sleep(req.ms); running--; return { data: req.task }; } };
  const ai = laneAi(slowAi, { user: 4, background: 1, backgroundPerMinute: 2, windowMs: 1000 });
  const bg = inBackground(() => Promise.all([1, 2, 3].map(() => ai.generate({ task: "bg", ms: 200 }))));
  await sleep(5);
  const t0 = performance.now();
  assert.deepEqual(await ai.generate({ task: "user", ms: 5 }), { data: "user" });
  assert.ok(performance.now() - t0 < 150, "a user call does not wait for the background's");
  assert.equal(peak, 2, "one background call and the user call");
  assert.equal(await within(bg, 600, "capped"), "capped", "the third background call waits for the next minute");
  assert.deepEqual(await bg, [{ data: "bg" }, { data: "bg" }, { data: "bg" }], "and then runs");
  assert.equal(await within(new Promise(() => {}), 10, "fallback"), "fallback");
});

test("Overpass is cached by tile: crews whose middles share a tile share one query, cut back to each radius", async () => {
  const { createOverpass, tileOf } = await import("../src/adapters/overpass.mjs");
  /** @type {string[]} */
  const bodies = [];
  const els = [{ type: "way", id: 1, center: { lat: 6.5005, lon: 3.3801 }, tags: { name: "Near Park", leisure: "park" } }, { type: "way", id: 2, center: { lat: 6.56, lon: 3.38 }, tags: { name: "Far Park", leisure: "park" } }];
  const fetchImpl = /** @type {any} */ (async (/** @type {string} */ _u, /** @type {any} */ init) => {
    bodies.push(decodeURIComponent(init.body));
    return new Response(JSON.stringify({ elements: els }), { status: 200 });
  });
  const op = createOverpass({ urls: ["https://overpass.test/api"], contact: "test", cache: memoryCache(), fetchImpl });
  assert.equal(tileOf({ lat: 6.501, lon: 3.381 }).key, tileOf({ lat: 6.506, lon: 3.376 }).key);
  const a = await op.greenNear({ lat: 6.501, lon: 3.381 }, 3000);
  const b = await op.greenNear({ lat: 6.506, lon: 3.376 }, 3000);
  assert.equal(bodies.length, 1, "one query for both");
  assert.match(bodies[0], /around:4600,6\.50000,3\.38000/, "around the tile's centre, reaching past the radius");
  assert.deepEqual(a.map((c) => c.name), ["Near Park"], "only what is within the radius");
  assert.deepEqual(b.map((c) => c.name), ["Near Park"]);
});

test("OSRM tables are cached a row per source and a cell per destination tile: only new places are asked for", async () => {
  const { createOsrm } = await import("../src/adapters/osrm.mjs");
  /** @type {string[]} */
  const urls = [];
  const fetchImpl = /** @type {any} */ (async (/** @type {string} */ u) => {
    urls.push(u);
    const q = new URL(u);
    const n = q.searchParams.get("sources")?.split(";").length || 0;
    const m = q.searchParams.get("destinations")?.split(";").length || 0;
    return new Response(JSON.stringify({ code: "Ok", distances: Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => 1000 * (i + 1) * (j + 1))), durations: Array.from({ length: n }, () => Array.from({ length: m }, () => 600)) }), { status: 200 });
  });
  const osrm = createOsrm({ contact: "test", cache: memoryCache(), fetchImpl });
  const yaba = { lat: 6.5068, lon: 3.3755 }, lekki = { lat: 6.4474, lon: 3.4721 };
  const p1 = { lat: 6.4497, lon: 3.3972 }, p2 = { lat: 6.4333, lon: 3.4251 }, p3 = { lat: 6.6, lon: 3.35 };
  const t1 = await osrm.table([yaba, lekki], [p1, p2]);
  assert.deepEqual(t1?.km, [[1, 2], [2, 4]]);
  assert.equal(urls.length, 1);
  const t2 = await osrm.table([{ lat: 6.5069, lon: 3.3756 }, lekki], [p2, p3, p1]);
  assert.equal(urls.length, 2);
  assert.match(urls[1], /\?sources=0;1&destinations=2&/, "only the new place is asked for");
  assert.deepEqual(t2?.km, [[2, 1, 1], [4, 2, 2]], "the cached cells, and the new column");
  await osrm.table([yaba], [p3, p1]);
  assert.equal(urls.length, 2, "all cached");
});
