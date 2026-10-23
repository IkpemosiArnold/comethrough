// @ts-check
// The awake window (src/core/warm.mjs, src/app/warm.mjs): what keeps the free server awake,
// for how long, and the monthly cap that protects the workspace's shared free hours.
import assert from "node:assert/strict";
import { test } from "node:test";
import { HOUR, MINUTE, WARM, extended, monthKey, pingDelay, planWindows, warmStep, warmTarget } from "../src/core/warm.mjs";
import { createWarm } from "../src/app/warm.mjs";
import { memoryStore } from "../src/adapters/store.mjs";
import { warmReason } from "../src/server/server.mjs";
import { clientIp, inCidrs } from "../src/server/http.mjs";

const T0 = Date.parse("2026-10-24T12:00:00Z");
const at = (/** @type {number} */ ms) => new Date(ms).toISOString().replace(".000Z", "+00:00");

test("a plan keeps the server awake from 2 hours before its start to 1 hour after; overlaps merge", () => {
  const plans = [
    { start: at(T0 + 6 * HOUR) },
    { start: at(T0 + 7 * HOUR) }, // overlaps the one before: one window
    { start: at(T0 + 10 * HOUR), status: "cancelled" }, // cancelled: none
    { start: at(T0 - 2 * HOUR) }, // its window ended an hour ago
    { start: "2026-10-24T13:30:00+01:00" }, // 12:30Z, inside its window now
    { start: null },
    { start: at(T0 + 72 * HOUR) }, // past the horizon
  ];
  assert.deepEqual(planWindows(plans, T0), [
    { from: T0 - 90 * MINUTE, to: T0 + 30 * MINUTE + HOUR },
    { from: T0 + 4 * HOUR, to: T0 + 8 * HOUR },
  ]);
});

test("until when, and why: an activity's 3 hours, or a plan's window, whichever ends later", () => {
  assert.deepEqual(warmTarget({ now: T0, warmUntil: 0, windows: [] }), { until: null, why: null });
  assert.deepEqual(warmTarget({ now: T0, warmUntil: T0 + HOUR, windows: [] }), { until: T0 + HOUR, why: "activity" });
  const win = [{ from: T0 - HOUR, to: T0 + 2 * HOUR }];
  assert.deepEqual(warmTarget({ now: T0, warmUntil: T0 + HOUR, windows: win }), { until: T0 + 2 * HOUR, why: "plan" });
  assert.deepEqual(warmTarget({ now: T0, warmUntil: T0 + 3 * HOUR, windows: win }), { until: T0 + 3 * HOUR, why: "activity" });
  // a window that has not opened yet does not hold the server now
  assert.deepEqual(warmTarget({ now: T0, warmUntil: 0, windows: [{ from: T0 + HOUR, to: T0 + 4 * HOUR }] }), { until: null, why: null });
});

test("the step: ping while the window holds, stop after it, and stop at the month's cap", () => {
  const capMs = 150 * HOUR;
  assert.equal(warmStep({ now: T0, until: T0 + MINUTE, monthMs: 0, capMs }), "ping");
  assert.equal(warmStep({ now: T0, until: T0, monthMs: 0, capMs }), "stop");
  assert.equal(warmStep({ now: T0, until: null, monthMs: 0, capMs }), "stop");
  assert.equal(warmStep({ now: T0, until: T0 + HOUR, monthMs: capMs, capMs }), "cap");
  // extending never shortens; the ping comes every 10 to 12 minutes, inside Render's 15
  assert.equal(extended(0, T0), T0 + 3 * HOUR);
  assert.equal(extended(T0 + 5 * HOUR, T0), T0 + 5 * HOUR);
  assert.equal(pingDelay(0), 10 * MINUTE);
  assert.ok(pingDelay(0.9999) <= 12 * MINUTE && pingDelay(0.9999) > 11.9 * MINUTE);
  assert.equal(monthKey(Date.parse("2026-10-31T23:59:59Z")), "2026-10");
  assert.equal(monthKey(Date.parse("2026-11-01T00:00:00Z")), "2026-11");
});

test("which answers keep the server awake: a crew made, a join, a plan made, edited or answered, a share", () => {
  assert.equal(warmReason("POST", "/api/crews", 201), "crew");
  assert.equal(warmReason("POST", "/api/crews", 200), null, "a draft is not a crew yet");
  assert.equal(warmReason("POST", "/api/crews/uni-guys/members", 201), "join");
  assert.equal(warmReason("POST", "/api/crews/uni-guys/plans", 201), "plan");
  assert.equal(warmReason("POST", "/api/crews/uni-guys/plans/parse", 200), null);
  assert.equal(warmReason("PATCH", "/api/plans/p_1", 200), "plan_edit");
  assert.equal(warmReason("POST", "/api/crews/uni-guys/shared", 204), "share");
  assert.equal(warmReason("GET", "/api/crews/uni-guys", 200), null, "reading never extends it");
});

/** A runner on a fake clock: timers run when the test moves the clock past them. */
function rig({ capHours = 150, plans = /** @type {any[]} */ ([]), store = memoryStore() } = {}) {
  let t = T0;
  /** @type {{ at: number, fn: () => void, id: number }[]} */
  let timers = [];
  let ids = 0;
  /** @type {any[]} */
  const logs = [];
  /** @type {string[]} */
  const pings = [];
  const warm = createWarm({
    store,
    selfUrl: "https://comethrough.onrender.com",
    capHours,
    now: () => t,
    log: (event, fields = {}) => logs.push({ event, ...fields }),
    ping: async (url) => { pings.push(url); return { ok: true, status: 200 }; },
    setTimer: (fn, ms) => { const id = ++ids; timers.push({ at: t + ms, fn, id }); return id; },
    clearTimer: (id) => { timers = timers.filter((x) => x.id !== id); },
    random: () => 0.5,
  });
  const ready = Promise.all(plans.map((p, i) => store.put("plans", { id: `p_${i}`, crewId: "c_1", ...p })));
  /** move the clock, running timers on the way */
  async function advance(/** @type {number} */ ms) {
    const end = t + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      t = next.at;
      next.fn();
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
    }
    t = end;
  }
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
  return { warm, logs, pings, advance, settle, ready, store, timers: () => timers, now: () => t };
}

test("an activity keeps the server awake 3 hours with a self-ping every 11 minutes, then stops and counts the hours", async () => {
  const r = rig();
  await r.ready;
  await r.warm.extend("rsvp");
  assert.equal(r.logs.filter((l) => l.event === "warm_start").length, 1);
  assert.equal(r.logs[0].reason, "rsvp");
  assert.equal(r.pings.length, 0, "the activity itself was inbound traffic");
  await r.advance(3 * HOUR + 15 * MINUTE);
  await r.settle();
  // 3 hours at 11 minutes: 16 pings, all to the service's own public address
  assert.equal(r.pings.length, 16);
  assert.ok(r.pings.every((u) => u === "https://comethrough.onrender.com/healthz"));
  const stop = r.logs.find((l) => l.event === "warm_stop");
  assert.ok(stop, "a stop is logged");
  assert.equal(stop.why, "done");
  // counted from the start to the stop (the first step after the 3 hours) plus Render's 15 minutes
  assert.ok(stop.hours >= 3.25 && stop.hours <= 3.45, `hours ${stop.hours}`);
  assert.equal(stop.monthHours, stop.hours);
  assert.equal(r.timers().length, 0, "no more pings");
  // the month's hours are kept in the store, for the next restart
  const saved = await r.store.get("meta", "warm");
  assert.equal(saved.months["2026-10"].starts, 1);
  assert.ok(Math.abs(saved.months["2026-10"].ms / HOUR - stop.hours) < 0.01);
});

test("more activity moves the 3 hours on; it never starts a second stretch", async () => {
  const r = rig();
  await r.warm.extend("crew");
  await r.advance(2 * HOUR);
  await r.warm.extend("join");
  await r.advance(2 * HOUR + 50 * MINUTE);
  assert.equal(r.logs.filter((l) => l.event === "warm_start").length, 1);
  assert.equal(r.logs.filter((l) => l.event === "warm_stop").length, 0, "still awake: the join moved it to 5 hours");
  await r.advance(30 * MINUTE);
  assert.equal(r.logs.filter((l) => l.event === "warm_stop").length, 1);
});

test("the cap: once the month's warm hours reach it, no more pings until next month", async () => {
  const r = rig({ capHours: 2 });
  await r.warm.extend("plan");
  await r.advance(3 * HOUR);
  const stop = r.logs.find((l) => l.event === "warm_stop");
  assert.equal(stop?.why, "cap");
  assert.ok(r.logs.some((l) => l.event === "warm_cap" && l.month === "2026-10"));
  const pingsAtCap = r.pings.length;
  assert.ok(pingsAtCap <= 11, `${pingsAtCap} pings for a 2 hour cap`);
  // more activity this month starts nothing
  await r.warm.extend("rsvp");
  await r.advance(HOUR);
  assert.equal(r.pings.length, pingsAtCap);
  assert.equal(r.logs.filter((l) => l.event === "warm_start").length, 1);
  assert.equal(r.logs.filter((l) => l.event === "warm_cap").length, 1, "the cap is logged once a month");
});

test("the cap holds across a restart: the month's hours come back from the store", async () => {
  const store = memoryStore();
  await store.put("meta", { id: "warm", warmUntil: 0, months: { "2026-10": { ms: 150 * HOUR, starts: 40 } } });
  const r = rig({ store });
  await r.warm.extend("crew");
  await r.advance(HOUR);
  assert.equal(r.pings.length, 0);
  assert.ok(r.logs.some((l) => l.event === "warm_cap"));
  // a new month starts from zero
  const s = await r.warm.status();
  assert.equal(s.monthHours, 150);
});

test("a plan's window wakes the stretch at boot, and the heartbeat learns when to come back", async () => {
  const r = rig({ plans: [{ start: at(T0 + HOUR) }, { start: at(T0 + 20 * HOUR) }] });
  await r.ready;
  await r.warm.start();
  assert.equal(r.logs[0].event, "warm_start");
  assert.equal(r.logs[0].why, "plan");
  assert.equal(r.logs[0].until, new Date(T0 + 2 * HOUR).toISOString());
  const wake = await r.warm.upcoming();
  assert.deepEqual(wake, [
    { from: new Date(T0 - HOUR).toISOString(), to: new Date(T0 + 2 * HOUR).toISOString() },
    { from: new Date(T0 + 18 * HOUR).toISOString(), to: new Date(T0 + 21 * HOUR).toISOString() },
  ]);
  await r.advance(2 * HOUR + 12 * MINUTE);
  assert.ok(r.logs.some((l) => l.event === "warm_stop" && l.why === "done"));
});

test("no plan and no activity: the server is left to sleep, with no timer at all", async () => {
  const r = rig();
  const out = await r.warm.start();
  assert.equal(out.act, "stop");
  assert.equal(r.timers().length, 0);
  assert.equal(r.logs.length, 0);
});

test("WARM_CAP_HOURS=0 turns the window off", async () => {
  const r = rig({ capHours: 0 });
  await r.warm.extend("crew");
  await r.advance(HOUR);
  assert.equal(r.pings.length, 0);
  assert.equal(r.logs.filter((l) => l.event === "warm_start").length, 0);
});

test("the client address behind the static site's proxy: the real client, never a spoofed one", () => {
  const front = { cidrs: ["74.220.48.0/20"], hops: 3 };
  const req = (/** @type {string} */ xff) => /** @type {any} */ ({ headers: { "x-forwarded-for": xff }, socket: { remoteAddress: "10.0.0.1" } });
  // direct: "client, cloudflare-edge, render-internal"
  assert.equal(clientIp(req("105.115.5.52, 172.70.1.1, 10.1.2.3"), 3, front), "105.115.5.52");
  assert.equal(clientIp(req("1.2.3.4, 105.115.5.52, 172.70.1.1, 10.1.2.3"), 3, front), "105.115.5.52", "a spoofed entry is ignored");
  // through the static site: the proxy adds "client, cf, cf" and connects from Render's 74.220.48.0/20
  const via = "105.115.5.52, 104.22.160.63, 104.22.160.63, 74.220.48.249, 172.70.1.1, 10.1.2.3";
  assert.equal(clientIp(req(via), 3, front), "105.115.5.52");
  assert.equal(clientIp(req(`1.2.3.4, 5.6.7.8, ${via}`), 3, front), "105.115.5.52", "a spoofed entry is still ignored");
  // someone faking the proxy's entries directly cannot: the trusted entry is their own address
  assert.equal(clientIp(req("9.9.9.9, 104.22.160.63, 104.22.160.63, 74.220.48.249, 203.0.113.7, 172.70.1.1, 10.1.2.3"), 3, front), "203.0.113.7");
  // with the front proxy off, the old rule
  assert.equal(clientIp(req(via), 3, { cidrs: [], hops: 3 }), "74.220.48.249");
  assert.ok(inCidrs("74.220.63.255", ["74.220.48.0/20"]));
  assert.ok(!inCidrs("74.220.64.0", ["74.220.48.0/20"]));
  assert.ok(!inCidrs("not an ip", ["74.220.48.0/20"]));
});
