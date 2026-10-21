// @ts-check
// The MongoDB store against a real server. Skipped unless MONGODB_URI_TEST is set, for example
//   docker run -d --rm -p 127.0.0.1:27027:27017 mongo:8.0
//   MONGODB_URI_TEST=mongodb://127.0.0.1:27027 npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { mongoStore } from "../src/adapters/store.mjs";

const uri = process.env.MONGODB_URI_TEST;

test("mongo store: the same contract as memory and files, plus indexes and TTL dates", { skip: !uri && "set MONGODB_URI_TEST to run" }, async () => {
  const db = `comethrough_test_${Date.now()}`;
  const s = await mongoStore({ uri: /** @type {string} */ (uri), db });
  try {
    assert.equal(await s.ping(), true);
    await s.put("crews", { id: "c1", slug: "uni", inviteToken: "i1", n: 1 });
    await s.put("crews", { id: "c1", slug: "uni", inviteToken: "i1", n: 2 }); // replace, not duplicate
    assert.deepEqual(await s.get("crews", "c1"), { id: "c1", slug: "uni", inviteToken: "i1", n: 2 });
    assert.equal((await s.findOne("crews", { slug: "uni" }))?.id, "c1");
    await assert.rejects(s.put("crews", { id: "c2", slug: "uni", inviteToken: "i2" }), /duplicate key/, "slugs are unique");
    await s.put("plans", { id: "p1", crewId: "c1", expiresAt: "2026-11-22T22:00:00.000Z" });
    assert.deepEqual(await s.get("plans", "p1"), { id: "p1", crewId: "c1", expiresAt: "2026-11-22T22:00:00.000Z" }, "internal fields stay hidden");
    assert.equal((await s.find("plans", { crewId: "c1" })).length, 1);
    assert.equal(await s.delete("plans", "p1"), true);
    assert.equal(await s.get("plans", "p1"), null);
    // the TTL index exists and the hidden date is a real Date
    const { MongoClient } = await import("mongodb");
    const c = new MongoClient(/** @type {string} */ (uri));
    await c.connect();
    await s.put("cache", { id: "k", value: 1, expiresAt: "2030-01-01T00:00:00.000Z" });
    const raw = await c.db(db).collection("cache").findOne({ _id: /** @type {any} */ ("k") });
    assert.ok(raw?._expireAt instanceof Date);
    const idx = await c.db(db).collection("plans").indexes();
    assert.ok(idx.some((i) => i.key._expireAt === 1 && i.expireAfterSeconds === 0));
    await c.db(db).dropDatabase();
    await c.close();
  } finally {
    await s.close();
  }
});
