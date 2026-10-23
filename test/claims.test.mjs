// @ts-check
// Stale workers (external review of d01a23b, P1 and P2): a worker that stalls past its lease
// must not overwrite what the worker that took over recorded. Two service instances share
// one store (two Render instances during a deploy, or one that slept mid-job); the older one
// stalls, its lease or start runs out, the newer one finishes, then the older one wakes up.
// Every background job with a lease goes through one helper (src/app/claims.mjs): a claim
// writes a fresh attempt token, and only the holder of that token and attempt can record
// the outcome.
//
// The Mongo half runs against a real server only when MONGODB_URI_TEST is set; it uses a
// throwaway database and drops it.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { claimedJobs } from "../src/app/claims.mjs";
import { DELIVERY, createService } from "../src/app/service.mjs";
import { makeIds } from "../src/app/ids.mjs";
import { loadPrompts } from "../src/app/prompts.mjs";
import { fakeAi, fakeGeocoder, fakeOverpass, fakePageMeta, fakePush, fakeWeather } from "../src/adapters/fakes.mjs";
import { fileStore, memoryStore, mongoStore } from "../src/adapters/store.mjs";
import { FIRST_PICK } from "../src/core/firstpick.mjs";
import { PLACES } from "./fixtures/lagos.mjs";
import { CREW, MEMBERS } from "./fixtures/plans.mjs";

const mongoUri = process.env.MONGODB_URI_TEST || "";
const T = Date.parse("2026-10-21T09:00:00Z");
const cfg = { publicUrl: "https://x.test", webUrl: "https://x.test", uidDomain: "x.test" };

const STORES = [
  { kind: "memory", skip: false, open: async () => ({ store: memoryStore(), done: async () => {} }) },
  {
    kind: "file",
    skip: false,
    open: async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ct-claims-"));
      const store = await fileStore(dir);
      return { store, done: async () => { await store.close(); await fs.rm(dir, { recursive: true, force: true }); } };
    },
  },
  {
    kind: "mongo",
    skip: !mongoUri && "set MONGODB_URI_TEST to run",
    open: async () => {
      const db = `comethrough_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const store = await mongoStore({ uri: mongoUri, db });
      return {
        store,
        done: async () => {
          const { MongoClient } = await import("mongodb");
          const c = new MongoClient(mongoUri);
          await c.connect();
          await c.db(db).dropDatabase();
          await c.close();
          await store.close();
        },
      };
    },
  },
];

/** A promise the test resolves by hand, and one that says the work reached it. */
function gate() {
  /** @type {(v?: any) => void} */
  let open = () => {};
  /** @type {() => void} */
  let reached = () => {};
  const opened = new Promise((r) => { open = r; });
  const arrived = new Promise((r) => { reached = () => r(undefined); });
  return { open, opened, arrived, reached };
}

/** Two services on one store and one clock: worker A and worker B. */
function twoWorkers(/** @type {any} */ store, /** @type {any} */ a, /** @type {any} */ b) {
  let clock = T;
  const base = { store, ai: fakeAi({ answers: {} }), geocoder: fakeGeocoder(), weather: fakeWeather(), pages: fakePageMeta(), spots: [], prompts: loadPrompts(), ids: makeIds(), now: () => clock, cfg };
  const A = createService({ ...base, places: fakeOverpass([PLACES.freedom]), push: fakePush(), ...a });
  const B = createService({ ...base, places: fakeOverpass([PLACES.freedom]), push: fakePush(), ...b });
  return { A, B, advance: (/** @type {number} */ ms) => { clock += ms; } };
}

/** A push port with a scripted answer per call: a status, or a function that returns one. */
function scriptedPush(/** @type {(number|(() => Promise<number>))[]} */ script) {
  /** @type {any[]} */
  const sent = [];
  let n = 0;
  return {
    enabled: true,
    publicKey: "BFake",
    sent,
    async send(/** @type {any} */ s, /** @type {any} */ m) {
      const step = script[Math.min(n++, script.length - 1)];
      const status = typeof step === "function" ? await step() : step;
      sent.push({ endpoint: s.endpoint, status, ...m });
      return { ok: status >= 200 && status < 300, gone: status === 404 || status === 410, permanent: [400, 403, 404, 410, 413].includes(status), status };
    },
  };
}

const SUB = { id: "e_ada", memberId: "m2", crewId: "c1", endpoint: "https://fcm.googleapis.com/fcm/send/ada", keys: { p256dh: "BKey", auth: "auth" }, createdAt: "2026-10-21T08:00:00.000Z" };
const MSG = { title: "New plan: Suya", body: "Tolu added tonight at 7pm.", url: "https://x.test/c/uni-guys/p/p_1", tag: "p_1" };

async function seed(/** @type {any} */ store) {
  await store.put("crews", { ...CREW, rhythm: null });
  for (const m of MEMBERS) await store.put("members", m);
  await store.put("push", SUB);
}

for (const s of STORES) {
  test(`${s.kind} store: the claim helper lets only the current claim record an outcome`, { skip: s.skip }, async () => {
    const { store, done } = await s.open();
    try {
      await store.put("jobs", { id: "j1", state: "pending", attempts: 0, nested: { attempts: 0, status: "pending" } });
      let n = 0;
      const top = claimedJobs({ store, coll: "jobs", newToken: () => `tok${++n}` });
      const a = await top.claim("j1", { when: { state: "pending" }, set: { state: "leased" } });
      assert.ok(a);
      assert.equal(a.attempts, 1);
      assert.equal(await top.claim("j1", { when: { state: "pending" }, set: { state: "leased" } }), null, "a second worker cannot claim what is held");
      const b = await top.claim("j1", { when: { state: "leased" }, set: { state: "leased" } });
      assert.ok(b, "a takeover (the lease ran out) is a new claim");
      assert.equal(b.attempts, 2);
      assert.equal(await top.fail(a, { state: "retryable-failed" }), null, "the old claim records nothing");
      assert.equal((await top.complete(b, { state: "succeeded" }))?.state, "succeeded");
      assert.equal(await top.fail(a, { state: "retryable-failed" }), null);
      assert.equal((await store.get("jobs", "j1")).state, "succeeded");
      // a job kept inside a document (the crew's first pick): the claim lives under its path,
      // and the rest of the document stays free for other writers
      const inner = claimedJobs({ store, coll: "jobs", at: "nested", newToken: () => `in${++n}` });
      const c = await inner.claim("j1", { when: { "nested.status": "pending" }, set: { status: "pending", startedAt: "x" } });
      assert.ok(c);
      await store.update("jobs", "j1", { set: { name: "renamed meanwhile" } });
      const d = await inner.claim("j1", { when: { "nested.status": "pending" }, set: { status: "pending", startedAt: "y" } });
      assert.ok(d);
      assert.equal((await inner.complete(d, { status: "ready" }))?.nested.status, "ready", "a rename meanwhile does not void the claim");
      assert.equal(await inner.fail(c, { status: "failed" }), null);
      const end = await store.get("jobs", "j1");
      assert.deepEqual([end.nested.status, end.nested.attempts, end.name], ["ready", 2, "renamed meanwhile"]);
    } finally {
      await done();
    }
  });

  test(`${s.kind} store: a push worker that stalls past its lease cannot undo the success of the worker that took over`, { skip: s.skip }, async () => {
    const { store, done } = await s.open();
    try {
      const g = gate();
      const pushA = scriptedPush([async () => { g.reached(); await g.opened; return 503; }]);
      const pushB = scriptedPush([201]);
      const { A, B, advance } = twoWorkers(store, { push: pushA }, { push: pushB });
      await seed(store);
      const runA = A._internal.notify(["m2"], MSG, "p_1:new");
      await g.arrived;
      // A is stuck in the send; its lease runs out and B's heartbeat takes the delivery over
      advance(DELIVERY.leaseMs + 1000);
      assert.equal(await B._internal.retryDeliveries(), 1);
      const id = "p_1:new:m2:e_ada";
      assert.equal((await store.get("deliveries", id)).state, "succeeded");
      // A wakes up with its 503
      g.open();
      assert.equal(await runA, 0);
      const d = await store.get("deliveries", id);
      assert.equal(d.state, "succeeded", "the stale failure did not overwrite the success");
      assert.ok(d.sentAt);
      // and nobody sends it again
      advance(DELIVERY.backoffMs.at(-1) + 1000);
      assert.equal(await B._internal.retryDeliveries(), 0);
      assert.equal(await A._internal.retryDeliveries(), 0);
      assert.equal(pushB.sent.length, 1);
    } finally {
      await done();
    }
  });

  test(`${s.kind} store: a stale worker's late success is kept, so the push is not sent a third time`, { skip: s.skip }, async () => {
    const { store, done } = await s.open();
    try {
      const g = gate();
      const pushA = scriptedPush([async () => { g.reached(); await g.opened; return 201; }]);
      const pushB = scriptedPush([503, 201]);
      const { A, B, advance } = twoWorkers(store, { push: pushA }, { push: pushB });
      await seed(store);
      const runA = A._internal.notify(["m2"], MSG, "p_1:new");
      await g.arrived;
      advance(DELIVERY.leaseMs + 1000);
      assert.equal(await B._internal.retryDeliveries(), 0, "B's try got a 503");
      const id = "p_1:new:m2:e_ada";
      assert.equal((await store.get("deliveries", id)).state, "retryable-failed");
      // A's send was accepted after all: the push went out, so that is recorded
      g.open();
      assert.equal(await runA, 1);
      assert.equal((await store.get("deliveries", id)).state, "succeeded");
      advance(DELIVERY.backoffMs.at(-1) + 1000);
      assert.equal(await B._internal.retryDeliveries(), 0);
      assert.equal(pushB.sent.length, 1, "no further send");
    } finally {
      await done();
    }
  });

  test(`${s.kind} store: a first pick that stalls past its start cannot overwrite the newer worker's ready pick`, { skip: s.skip }, async () => {
    const { store, done } = await s.open();
    try {
      const g = gate();
      let flaky = false;
      const placesA = { async greenNear() { g.reached(); await g.opened; flaky = true; throw new Error("at capacity"); }, async kindsNear() { return []; } };
      // worker A's connection to the store drops its reads once it wakes up: its pick errors
      const storeA = { ...store, kind: store.kind, async find(/** @type {string} */ c, /** @type {any} */ f, /** @type {any} */ o) { if (flaky && c === "plans") throw new Error("connection reset"); return store.find(c, f, o); } };
      const { A, B, advance } = twoWorkers(store, { store: storeA, places: placesA, budgets: { pickPlacesMs: 20_000 } }, {});
      const made = await A.createCrew({ confirm: { name: "The uni guys", vibe: "outside", vibeTags: ["outside"], budget: "cheap", rhythm: CREW.rhythm, areas: CREW.areas, region: null }, organiser: { name: "Tolu", area: "Yaba" } });
      const jobA = A.kickFirstPick(made.crew.id);
      await g.arrived;
      // A's start looks cut off to B (not running in B's process, older than staleMs)
      advance(FIRST_PICK.staleMs + 5000);
      const b = await B._internal.firstPickJob(made.crew.id);
      assert.equal(b?.status, "ready");
      assert.ok(b?.planId);
      // A wakes up with nothing found
      g.open();
      await jobA;
      const crew = await store.get("crews", made.crew.id);
      assert.equal(crew.firstPick.status, "ready", "the stale failure did not overwrite the ready pick");
      assert.equal(crew.firstPick.planId, b?.planId);
      assert.equal(crew.firstPick.attempts, 2);
      const asked = await B.firstPick({ slug: made.crew.slug, token: made.inviteToken, waitMs: 0 });
      assert.equal(asked.plan?.id, b?.planId);
      assert.ok(!("claim" in (await B.getCrew({ slug: made.crew.slug, token: /** @type {string} */ (made.memberToken) })).crew.firstPick), "the attempt token stays on the server");
    } finally {
      await done();
    }
  });
}

test("a push send that never answers is cut off at its deadline, inside the lease, and retried later", async () => {
  const store = memoryStore();
  const hang = { enabled: true, publicKey: "BFake", calls: 0, async send() { this.calls++; return new Promise(() => {}); } };
  const { A } = twoWorkers(store, { push: hang, budgets: { pushSendMs: 50 } }, {});
  await seed(store);
  assert.ok(DELIVERY.sendMs < DELIVERY.leaseMs, "the send's deadline is inside the lease");
  const t0 = performance.now();
  assert.equal(await A._internal.notify(["m2"], MSG, "p_1:new"), 0);
  assert.ok(performance.now() - t0 < 2000);
  const d = await store.get("deliveries", "p_1:new:m2:e_ada");
  assert.deepEqual([d.state, d.error, d.leaseUntil], ["retryable-failed", "status_0", null]);
});
