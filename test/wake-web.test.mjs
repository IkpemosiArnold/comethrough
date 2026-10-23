// @ts-check
// The phone's side of a napping server (web/src/lib/wake.js), tested from Node with a fake
// clock and a fake API that answers like Render does while a free service wakes: its
// "Application loading" page (503 HTML), then our JSON.
import assert from "node:assert/strict";
import { test } from "node:test";
import { WAKE, createWaker, wakingAnswer } from "../web/src/lib/wake.js";

const INTERSTITIAL = { status: 503, type: "text/html; charset=utf-8", routing: "hibernate-pending-wake", body: "<!doctype html><title>Render - Application loading</title>" };

/** A Response-like answer. */
function answer({ status = 200, type = "application/json; charset=utf-8", routing = "", body = "{}" }) {
  const headers = new Map([["content-type", type], ...(routing ? [["x-render-routing", routing]] : [])]);
  return { status, ok: status >= 200 && status < 300, headers: { get: (/** @type {string} */ k) => headers.get(k.toLowerCase()) ?? null }, json: async () => JSON.parse(body), text: async () => body };
}

/** A clock that moves only when the waker sleeps, and an API that is asleep until `wakesAt`. */
function rig({ wakesAt = 20_000, holdMs = 0, failAll = false } = {}) {
  let t = 0;
  /** @type {{ url: string, method: string, at: number, body: any }[]} */
  const calls = [];
  /** @type {{ at: number, fn: () => void }[]} */
  let timers = [];
  const fetch = async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
    calls.push({ url, method: init.method || "GET", at: t, body: init.body });
    if (holdMs) {
      // a held request: the proxy waits while the server boots, and the page's timers run meanwhile
      t += holdMs;
      for (const x of timers.filter((x) => x.at <= t)) x.fn();
      timers = timers.filter((x) => x.at > t);
    }
    if (failAll || t < wakesAt) return answer(INTERSTITIAL);
    if (url.endsWith("/api/healthz")) return answer({ body: JSON.stringify({ ok: true }) });
    return answer({ body: JSON.stringify({ url, method: init.method || "GET", body: init.body ?? null }) });
  };
  /** @type {string[]} */
  const phases = [];
  const w = createWaker({
    fetch,
    now: () => t,
    sleep: async (ms) => {
      t += ms;
      for (const x of timers.filter((x) => x.at <= t)) x.fn();
      timers = timers.filter((x) => x.at > t);
    },
    setTimer: (fn, ms) => { const x = { at: t + ms, fn }; timers.push(x); return x; },
    clearTimer: (x) => { timers = timers.filter((y) => y !== x); },
  });
  w.subscribe((s) => phases.push(s.phase));
  return { w, calls, phases, now: () => t };
}

test("Render's waking answers are told apart from ours", () => {
  assert.equal(wakingAnswer(answer(INTERSTITIAL)), true);
  assert.equal(wakingAnswer(answer({ status: 502, type: "text/plain" })), true, "a proxy's own 502");
  assert.equal(wakingAnswer(answer({ status: 504, type: "" })), true);
  assert.equal(wakingAnswer(answer({ status: 200, type: "text/html" })), true, "a page where JSON belongs");
  assert.equal(wakingAnswer(answer({ status: 503, type: "application/json", body: '{"error":{}}' })), false, "our own 503 is an answer");
  assert.equal(wakingAnswer(answer({ status: 404, type: "application/json" })), false);
  assert.equal(wakingAnswer(answer({ status: 200, type: "text/calendar" })), false);
});

test("a cold API: interstitial HTML, then JSON; the request is sent again once it is up, a POST too", async () => {
  const r = rig({ wakesAt: 20_000 });
  const res = await r.w.call("/api/plans/p_1", { method: "PATCH", body: '{"rsvp":"going"}' });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.method, "PATCH");
  assert.equal(data.body, '{"rsvp":"going"}', "the body went again, whole");
  assert.ok(r.now() >= 20_000 && r.now() < 30_000, `answered at ${r.now()} ms`);
  // the waking card showed, then the sloth was up
  assert.ok(r.phases.includes("waking"));
  assert.equal(r.phases.at(-1), "up");
  assert.ok(r.calls.some((c) => c.url === "/api/healthz"), "it asked /api/healthz while waiting");
  // the PATCH was sent twice: once into the interstitial (never reached the server), once for real
  assert.equal(r.calls.filter((c) => c.method === "PATCH").length, 2);
});

test("a warm API: no waking card at all", async () => {
  const r = rig({ wakesAt: 0 });
  const [up, res] = await Promise.all([r.w.wake(), r.w.call("/api/crews/uni-guys")]);
  assert.equal(up, true);
  assert.equal(res.status, 200);
  assert.ok(!r.phases.includes("waking"));
  assert.equal(r.phases.at(-1), "up");
});

test("a held request (the proxy waits while the server boots) shows the waking card after 1.5 s", async () => {
  const r = rig({ wakesAt: 25_000, holdMs: 25_000 });
  const up = await r.w.wake();
  assert.equal(up, true);
  assert.ok(r.phases.includes("waking"), "shown while held");
  assert.equal(r.phases.at(-1), "up");
});

test("it never wakes: after about 90 s an honest 'down', and the call says asleep", async () => {
  const r = rig({ failAll: true });
  await assert.rejects(r.w.call("/api/crews/uni-guys"), (e) => /** @type {any} */ (e).asleep === true);
  assert.equal(r.phases.at(-1), "down");
  assert.ok(r.now() >= WAKE.budgetMs && r.now() < WAKE.budgetMs + 10_000, `gave up at ${r.now()} ms`);
  // the backoff spreads the tries out: about twenty, not hundreds
  const tries = r.calls.filter((c) => c.url === "/api/healthz").length;
  assert.ok(tries >= 10 && tries <= 25, `${tries} tries`);
});

test("retry after 'down' starts over and comes back up", async () => {
  const r = rig({ wakesAt: 100_000 });
  assert.equal(await r.w.wake(), false);
  assert.equal(r.w.state.phase, "down");
  assert.equal(await r.w.retry(), true);
  assert.equal(r.w.state.phase, "up");
});
