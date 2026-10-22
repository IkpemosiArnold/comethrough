// @ts-check
// Push delivery bookkeeping (Astra's review, P1.2). The old dedupe marker was written before
// the send, so a push service hiccup was recorded as done and nobody was ever told. Now each
// push is a delivery record (pending, leased, succeeded, retryable-failed, expired,
// permanent-failed), claimed with an atomic lease, marked a success only after the push
// service said 2xx, and retried by the heartbeat. At least once: a crash between the send
// and the mark can repeat one push, which the phone folds into one by its notification tag.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DELIVERY, createService } from "../src/app/service.mjs";
import { makeIds } from "../src/app/ids.mjs";
import { loadPrompts } from "../src/app/prompts.mjs";
import { fakeAi, fakeGeocoder, fakeOverpass, fakePageMeta, fakeWeather } from "../src/adapters/fakes.mjs";
import { memoryStore } from "../src/adapters/store.mjs";
import { CREW, MEMBERS } from "./fixtures/plans.mjs";

const cfg = { publicUrl: "https://x.test", webUrl: "https://x.test", uidDomain: "x.test" };
const sub = (/** @type {string} */ memberId, /** @type {string} */ n) => ({ id: `e_${n}`, memberId, crewId: "c1", endpoint: `https://push.example/${n}`, keys: { p256dh: "BKey", auth: "auth" }, createdAt: "2026-10-21T08:00:00.000Z" });
const msg = { title: "New plan: Suya", body: "Tolu added tonight at 7pm.", url: "https://x.test/c/uni-guys/p/p_1", tag: "p_1" };

/** A push port whose answers are scripted per call: a status number, or a function. */
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
      if (status >= 200 && status < 300) sent.push({ endpoint: s.endpoint, ...m });
      return { ok: status >= 200 && status < 300, gone: status === 404 || status === 410, permanent: [400, 403, 404, 410, 413].includes(status), status };
    },
  };
}

async function setup(/** @type {any} */ push) {
  let t = Date.parse("2026-10-21T09:00:00Z");
  const store = memoryStore();
  const svc = createService({ store, ai: fakeAi({ answers: {} }), geocoder: fakeGeocoder(), places: fakeOverpass([]), weather: fakeWeather(), pages: fakePageMeta(), push, spots: [], prompts: loadPrompts(), ids: makeIds(), now: () => t, cfg });
  await store.put("crews", { ...CREW, rhythm: null });
  for (const m of MEMBERS) await store.put("members", m);
  return { store, svc, advance: (/** @type {number} */ ms) => { t += ms; } };
}

test("a push that fails for a moment is retried by the heartbeat and then succeeds (not recorded as sent before it was)", async () => {
  const push = scriptedPush([503, 201]);
  const { store, svc, advance } = await setup(push);
  await store.put("push", sub("m2", "ada"));
  assert.equal(await svc._internal.notify(["m2"], msg, "p_1:new"), 0, "the push service said 503");
  const [d] = await store.find("deliveries");
  assert.equal(d.state, "retryable-failed");
  assert.equal(d.attempts, 1);
  // the same news again (a retried request) does not make a second delivery
  await svc._internal.notify(["m2"], msg, "p_1:new");
  assert.equal((await store.find("deliveries")).length, 1);
  // the heartbeat before the backoff is over leaves it be; after, it sends it
  await svc.tick();
  assert.equal(push.sent.length, 0);
  advance(DELIVERY.backoffMs[0] + 1000);
  const out = await svc.tick();
  assert.equal(push.sent.length, 1);
  assert.equal(out.pushes, 1);
  const done = await store.get("deliveries", d.id);
  assert.equal(done.state, "succeeded");
  assert.equal(done.attempts, 2);
  // and it is never sent again
  advance(DELIVERY.backoffMs[1] * 2);
  await svc.tick();
  assert.equal(push.sent.length, 1);
});

test("two heartbeats at once do not send the same push twice: the lease holds", async () => {
  const slow = () => new Promise((r) => setTimeout(() => r(201), 30));
  const push = scriptedPush([503, slow]);
  const { store, svc, advance } = await setup(push);
  await store.put("push", sub("m2", "ada"));
  await svc._internal.notify(["m2"], msg, "p_1:new");
  advance(DELIVERY.backoffMs[0] + 1000);
  await Promise.all([svc.tick(), svc.tick(), svc._internal.retryDeliveries()]);
  assert.equal(push.sent.length, 1);
});

test("a lease left by a crashed worker expires, and the delivery is picked up again", async () => {
  const push = scriptedPush([201]);
  const { store, svc, advance } = await setup(push);
  await store.put("push", sub("m2", "ada"));
  await store.put("deliveries", { id: "p_1:new:m2:e_ada", key: "p_1:new:m2", memberId: "m2", subId: "e_ada", msg, state: "leased", attempts: 1, nextAt: "2026-10-21T09:00:00.000Z", leaseUntil: "2026-10-21T09:00:30.000Z", sendBy: "2026-10-21T21:00:00.000Z", createdAt: "2026-10-21T09:00:00.000Z", expiresAt: "2026-11-04T09:00:00.000Z" });
  await svc.tick();
  assert.equal(push.sent.length, 0, "the lease is still held");
  advance(DELIVERY.leaseMs + 1000);
  await svc.tick();
  assert.equal(push.sent.length, 1);
  assert.equal((await store.get("deliveries", "p_1:new:m2:e_ada")).state, "succeeded");
});

test("410 Gone removes the subscription and is not retried; a stale push expires unsent", async () => {
  const push = scriptedPush([410, 503]);
  const { store, svc, advance } = await setup(push);
  await store.put("push", sub("m2", "ada"));
  await svc._internal.notify(["m2"], msg, "p_1:new");
  const [d] = await store.find("deliveries");
  assert.equal(d.state, "permanent-failed");
  assert.equal(await store.get("push", "e_ada"), null, "the browser unsubscribed");
  // a push that keeps failing stops once it would be stale
  await store.put("push", sub("m3", "kene"));
  await svc._internal.notify(["m3"], msg, "p_1:changed:2");
  advance(DELIVERY.ttlMs + 1000);
  await svc.tick();
  const k = (await store.find("deliveries", { memberId: "m3" }))[0];
  assert.equal(k.state, "expired");
  assert.equal(push.sent.length, 0);
});

test("a delivery that keeps failing gives up after the last attempt", async () => {
  const push = scriptedPush([503]);
  const { store, svc, advance } = await setup(push);
  await store.put("push", sub("m2", "ada"));
  await svc._internal.notify(["m2"], msg, "p_1:new");
  for (let i = 0; i < DELIVERY.maxAttempts + 2; i++) {
    advance(DELIVERY.backoffMs[Math.min(i, DELIVERY.backoffMs.length - 1)] + 1000);
    await svc._internal.retryDeliveries();
  }
  const [d] = await store.find("deliveries");
  assert.ok(["permanent-failed", "expired"].includes(d.state), d.state);
  assert.ok(d.attempts <= DELIVERY.maxAttempts);
});
