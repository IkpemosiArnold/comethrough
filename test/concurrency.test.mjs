// @ts-check
// Lost updates (Astra's review, P1.1): two people answering at the same moment, or the
// heartbeat's weather refresh landing beside an answer, must never undo each other. The
// store has targeted commands (update with $set, $unset and a version guard; insert only
// when new), and every use case writes only the fields it changed.
//
// The Mongo half runs against a real server when MONGODB_URI_TEST (or MONGODB_URI) is set;
// it uses a throwaway database and drops it.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createService } from "../src/app/service.mjs";
import { makeIds } from "../src/app/ids.mjs";
import { loadPrompts } from "../src/app/prompts.mjs";
import { fakeAi, fakeGeocoder, fakeOverpass, fakePageMeta, fakePush, fakeWeather } from "../src/adapters/fakes.mjs";
import { fileStore, memoryStore, mongoStore } from "../src/adapters/store.mjs";
import { CREW, MEMBERS, makePlan, makeRitual } from "./fixtures/plans.mjs";

const mongoUri = process.env.MONGODB_URI_TEST || process.env.MONGODB_URI || "";
const now = () => Date.parse("2026-10-21T09:00:00Z");
const cfg = { publicUrl: "https://x.test", webUrl: "https://x.test", uidDomain: "x.test" };

/** Each store kind, fresh, with a cleanup. */
const STORES = [
  { kind: "memory", open: async () => ({ store: memoryStore(), done: async () => {} }) },
  {
    kind: "file",
    open: async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ct-store-"));
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

const ninePeople = Array.from({ length: 9 }, (_, i) => ({ id: `m${i + 1}`, crewId: "c1", name: `P${i + 1}`, area: MEMBERS[i % 3].area, token: `tok_m${i + 1}`, calToken: `cal_m${i + 1}`, joinedAt: "2026-10-21T08:00:00.000Z" }));

for (const s of STORES) {
  test(`${s.kind} store: update sets and unsets fields by path, bumps the version, and honours its guard`, { skip: s.skip }, async () => {
    const { store, done } = await s.open();
    try {
      await store.put("plans", makePlan({ rsvps: { m1: "going" } }));
      const a = await store.update("plans", "p_wine", { set: { "rsvps.m2": "maybe", title: "Wine night" } });
      assert.equal(a?.title, "Wine night");
      assert.deepEqual(a?.rsvps, { m1: "going", m2: "maybe" });
      assert.equal(a?.version, 1);
      const b = await store.update("plans", "p_wine", { unset: ["rsvps.m1"], inc: { seq: 1 } }, { ifMatch: { version: 1 } });
      assert.deepEqual(b?.rsvps, { m2: "maybe" });
      assert.equal(b?.seq, 1);
      assert.equal(b?.version, 2);
      // a stale version: nothing is written
      assert.equal(await store.update("plans", "p_wine", { set: { title: "stale" } }, { ifMatch: { version: 1 } }), null);
      assert.equal((await store.get("plans", "p_wine"))?.title, "Wine night");
      // a missing version matches null (documents written before versions existed)
      await store.put("plans", makePlan({ id: "p_old" }));
      assert.ok(await store.update("plans", "p_old", { set: { title: "x" } }, { ifMatch: { version: null } }));
      assert.equal(await store.update("nope", "x", { set: { a: 1 } }), null, "no document, no update");
      // insert only when new
      assert.equal(await store.insert("plans", makePlan({ id: "p_new" })), true);
      assert.equal(await store.insert("plans", makePlan({ id: "p_new", title: "second" })), false);
      assert.equal((await store.get("plans", "p_new"))?.title, "Wine and monopoly");
      // operators in filters: $in, $lte, $exists
      assert.equal((await store.find("plans", { id: { $in: ["p_old", "p_new"] } })).length, 2);
      assert.equal((await store.find("plans", { version: { $lte: 1 } })).length, 1);
      assert.equal((await store.find("plans", { version: { $exists: false } })).length, 1);
    } finally {
      await done();
    }
  });

  test(`${s.kind} store: twenty truly concurrent targeted updates all land`, { skip: s.skip }, async () => {
    const { store, done } = await s.open();
    try {
      await store.put("plans", makePlan({ rsvps: {} }));
      await Promise.all(Array.from({ length: 20 }, (_, i) => store.update("plans", "p_wine", { set: { [`rsvps.m${i}`]: "going" }, inc: { seq: 1 } })));
      const p = await store.get("plans", "p_wine");
      assert.equal(Object.keys(p.rsvps).length, 20);
      assert.equal(p.seq, 20);
      assert.equal(p.version, 20);
    } finally {
      await done();
    }
  });

  test(`${s.kind} store: concurrent RSVPs through the service all land (no lost update)`, { skip: s.skip }, async () => {
    const { store, done } = await s.open();
    try {
      const svc = createService({ store, ai: fakeAi({ answers: {} }), geocoder: fakeGeocoder(), places: fakeOverpass([]), weather: fakeWeather(), pages: fakePageMeta(), push: fakePush(), spots: [], prompts: loadPrompts(), ids: makeIds(), now, cfg });
      await store.put("crews", CREW);
      for (const m of ninePeople) await store.put("members", m);
      await store.put("plans", makePlan({ rsvps: {}, host: null, createdBy: "m1" }));
      await Promise.all(ninePeople.map((m, i) => svc.patchPlan({ id: "p_wine", token: m.token, body: { rsvp: i % 2 ? "maybe" : "going" } })));
      const p = await store.get("plans", "p_wine");
      assert.equal(Object.keys(p.rsvps).length, 9, `every answer is kept: ${JSON.stringify(p.rsvps)}`);
      assert.equal(p.seq, 9);
      // and taking an answer back at the same time as others answer
      await Promise.all([
        svc.patchPlan({ id: "p_wine", token: "tok_m1", body: { rsvp: null } }),
        svc.patchPlan({ id: "p_wine", token: "tok_m2", body: { rsvp: "going" } }),
      ]);
      const q = await store.get("plans", "p_wine");
      assert.equal(q.rsvps.m1, undefined);
      assert.equal(q.rsvps.m2, "going");
      assert.equal(Object.keys(q.rsvps).length, 8);
    } finally {
      await done();
    }
  });
}

test("the heartbeat's weather refresh does not undo an RSVP made while it waited for the forecast", async () => {
  const store = memoryStore();
  /** @type {any} */
  let svc;
  let answered = false;
  const base = fakeWeather();
  const weather = {
    async hourly(/** @type {any} */ at, /** @type {any} */ opts) {
      // someone answers while the forecast is on its way
      if (!answered) {
        answered = true;
        await svc.patchPlan({ id: "p_ritual", token: "tok_m3", body: { rsvp: "going" } });
      }
      return base.hourly(at, opts);
    },
  };
  svc = createService({ store, ai: fakeAi({ answers: {} }), geocoder: fakeGeocoder(), places: fakeOverpass([]), weather, pages: fakePageMeta(), push: fakePush(), spots: [], prompts: loadPrompts(), ids: makeIds(), now, cfg });
  await store.put("crews", { ...CREW, rhythm: null });
  for (const m of MEMBERS) await store.put("members", m);
  await store.put("plans", makeRitual({ rsvps: { m1: "going" } }));
  await svc.tick();
  const p = await store.get("plans", "p_ritual");
  assert.ok(answered);
  assert.ok(p.weather, "the forecast is attached");
  assert.deepEqual(p.rsvps, { m1: "going", m3: "going" }, "the answer made meanwhile is kept");
});

test("an edit and an RSVP at the same time both land; a whole-plan edit retries on a version conflict", async () => {
  const store = memoryStore();
  const svc = createService({ store, ai: fakeAi({ answers: {} }), geocoder: fakeGeocoder(), places: fakeOverpass([]), weather: fakeWeather(), pages: fakePageMeta(), push: fakePush(), spots: [], prompts: loadPrompts(), ids: makeIds(), now, cfg });
  await store.put("crews", CREW);
  for (const m of MEMBERS) await store.put("members", m);
  await store.put("plans", makePlan({ rsvps: { m1: "going" } }));
  await Promise.all([
    svc.patchPlan({ id: "p_wine", token: "tok_m1", body: { title: "Wine, monopoly and suya" } }),
    svc.patchPlan({ id: "p_wine", token: "tok_m2", body: { rsvp: "going" } }),
    svc.patchPlan({ id: "p_wine", token: "tok_m3", body: { rsvp: "maybe" } }),
  ]);
  const p = await store.get("plans", "p_wine");
  assert.equal(p.title, "Wine, monopoly and suya");
  assert.deepEqual(p.rsvps, { m1: "going", m2: "going", m3: "maybe" });
});

test("crews and members: a rename, a taste save and the first pick's bookkeeping at once keep each other's changes", async () => {
  const store = memoryStore();
  const svc = createService({ store, ai: fakeAi({ answers: {} }), geocoder: fakeGeocoder(), places: fakeOverpass([]), weather: fakeWeather(), pages: fakePageMeta(), push: fakePush(), spots: [], prompts: loadPrompts(), ids: makeIds(), now, cfg });
  await store.put("crews", CREW);
  for (const m of MEMBERS) await store.put("members", m);
  await Promise.all([
    svc.growth.renameCrew({ slug: CREW.slug, token: "tok_m1", body: { name: "Yaba linkup" } }),
    svc.crewTaste({ slug: CREW.slug, token: "tok_m2", body: { taste: { placeKinds: ["gallery"], needs: [], eventKeywords: [], avoid: [] } } }),
    svc.firstPick({ slug: CREW.slug, token: "tok_m3", waitMs: 0 }),
  ]);
  const c = await store.get("crews", "c1");
  assert.equal(c.name, "Yaba linkup");
  assert.deepEqual(c.taste?.placeKinds, ["gallery"]);
  assert.ok(c.firstPick, "the first pick's state is kept");
  // a member's area and a seen card at once
  await Promise.all([
    svc.setMyArea({ memberId: "m1", token: "tok_m1", body: { area: "Ikeja" } }),
    svc.growth.markSeen({ memberId: "m1", token: "tok_m1", body: { key: "another-crew" } }),
  ]);
  const m = await store.get("members", "m1");
  assert.equal(m.area.label, "Ikeja");
  assert.deepEqual(m.seen, ["another-crew"]);
});
