// @ts-check
// Push subscriptions and server-side request forgery (the external review of d01a23b, P2):
// a member hands the server a URL to POST to. Only the known push services are accepted, when
// the subscription is saved and again at send time, and the send resolves the host itself,
// refuses private addresses, follows no redirect, and caps the time and the answer.
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { SEND_LIMITS, createWebPush, isSubscription, vetPushEndpoint } from "../src/adapters/push.mjs";
import { checkPushEndpoint } from "../src/core/netguard.mjs";

const keys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };
const sub = (/** @type {string} */ endpoint) => ({ endpoint, keys });
const FCM = "https://fcm.googleapis.com/fcm/send/dX1abc:APA91bExample";
const msg = { title: "New plan", body: "Suya tonight", url: "https://x.test/p/1", tag: "p_1" };

test("only known push services are accepted when a subscription is saved", () => {
  for (const bad of [
    "https://127.0.0.1/push", "https://10.0.0.8/push", "https://169.254.169.254/latest/meta-data/", "https://[::1]/push",
    "https://192.168.1.1/x", "https://localhost/x", "http://fcm.googleapis.com/fcm/send/x", "https://fcm.googleapis.com:8443/fcm/send/x",
    "https://user:pw@fcm.googleapis.com/fcm/send/x", "https://fcm.googleapis.com.evil.test/x", "https://evilpush.apple.com/x",
    "https://push.apple.com.evil.test/x", "https://example.com/push", "https://metadata.google.internal/x", "not a url",
  ]) {
    assert.equal(isSubscription(sub(bad)), false, bad);
  }
  for (const good of [
    FCM, "https://updates.push.services.mozilla.com/wpush/v2/gAAAAABexample", "https://web.push.apple.com/QGuQyavXutnMH7example",
    "https://wns2-par02p.notify.windows.com/w/?token=BQYAAAexample", "https://fcm.googleapis.com:443/wp/abc",
  ]) {
    assert.equal(isSubscription(sub(good)), true, good);
  }
  assert.equal(checkPushEndpoint("https://169.254.169.254/").reason, "not a known push service");
});

test("at send time the host is resolved and a private address is refused", async () => {
  const to = (/** @type {string} */ ip) => async () => [{ address: ip, family: ip.includes(":") ? 6 : 4 }];
  assert.deepEqual(await vetPushEndpoint(FCM, { resolve: to("10.1.2.3") }), { ok: false, reason: "private address" });
  assert.deepEqual(await vetPushEndpoint(FCM, { resolve: to("169.254.169.254") }), { ok: false, reason: "private address" });
  assert.deepEqual(await vetPushEndpoint(FCM, { resolve: to("::1") }), { ok: false, reason: "private address" });
  assert.deepEqual(await vetPushEndpoint(FCM, { resolve: async () => [{ address: "142.250.200.10", family: 4 }, { address: "127.0.0.1", family: 4 }] }), { ok: false, reason: "private address" }, "every address must be public");
  assert.deepEqual(await vetPushEndpoint(FCM, { resolve: async () => [] }), { ok: false, reason: "no address" });
  const ok = await vetPushEndpoint(FCM, { resolve: to("142.250.200.10") });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.ok && ok.addr, { address: "142.250.200.10", family: 4 });
  for (const bad of ["https://127.0.0.1/push", "https://10.0.0.8/push", "https://169.254.169.254/latest/meta-data/", "https://[::1]/push"]) {
    assert.equal((await vetPushEndpoint(bad, { resolve: to("142.250.200.10") })).ok, false, bad);
  }
});

/** A local server that counts requests; `answer` handles each. */
async function server(/** @type {(req: http.IncomingMessage, res: http.ServerResponse) => void} */ answer) {
  let hits = 0;
  /** @type {string[]} */
  const paths = [];
  const s = http.createServer((req, res) => {
    hits++;
    paths.push(String(req.url));
    answer(req, res);
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", () => r(undefined)));
  const port = /** @type {import("node:net").AddressInfo} */ (s.address()).port;
  return { port, hits: () => hits, paths, close: () => new Promise((r) => { s.closeAllConnections(); s.close(() => r(undefined)); }) };
}

async function port(/** @type {any} */ opts) {
  const webpush = (await import("web-push")).default;
  const vapid = webpush.generateVAPIDKeys();
  return createWebPush({ publicKey: vapid.publicKey, privateKey: vapid.privateKey, subject: "mailto:test@x.test", ...opts });
}

test("a send never reaches a private address: an IP endpoint, or a push host whose DNS answer is private", async () => {
  const srv = await server((_q, res) => { res.statusCode = 201; res.end(); });
  try {
    const p = await port({ limits: { port: srv.port, request: http.request } });
    // stored before the check existed: not a push service, so the subscription goes
    for (const e of ["https://127.0.0.1/push", "https://10.0.0.8/push", "https://169.254.169.254/latest/meta-data/", "https://[::1]/push"]) {
      const r = await p.send(sub(e), msg);
      assert.deepEqual([r.ok, r.gone, r.permanent, r.blocked], [false, true, true, "not a known push service"], e);
    }
    // a known push host whose DNS answers with a private address (rebinding, a poisoned resolver)
    const rebound = await port({ resolve: async () => [{ address: "127.0.0.1", family: 4 }], limits: { port: srv.port, request: http.request } });
    const r = await rebound.send(sub(FCM), msg);
    assert.deepEqual([r.ok, r.gone, r.permanent, r.blocked], [false, false, true, "private address"]);
    assert.equal(srv.hits(), 0, "no connection was made");
  } finally {
    await srv.close();
  }
});

test("a valid FCM endpoint is sent to the vetted address; no redirect is followed; time and answer are capped", async () => {
  // the test server is local, so the address rule is loosened here and only here
  const loose = { resolve: async () => [{ address: "127.0.0.1", family: 4 }], allowIp: () => true };
  let mode = "ok";
  const srv = await server((req, res) => {
    if (mode === "ok") {
      assert.equal(req.method, "POST");
      assert.match(String(req.headers.authorization), /^vapid t=/);
      assert.equal(req.headers.ttl, String(12 * 3600));
      res.statusCode = 201;
      res.end();
    } else if (mode === "redirect") {
      res.statusCode = 307;
      res.setHeader("location", "http://169.254.169.254/latest/meta-data/");
      res.end();
    } else if (mode === "big") {
      res.statusCode = 201;
      res.write(Buffer.alloc(SEND_LIMITS.maxBytes * 4, 97));
      // never ends: the cap, not the end, settles the send
    }
    // "hang": no answer at all
  });
  try {
    const p = await port({ ...loose, limits: { port: srv.port, request: http.request, timeoutMs: 1500 } });
    assert.deepEqual(await p.send(sub(FCM), msg), { ok: true, gone: false, status: 201 });
    assert.deepEqual(srv.paths, ["/fcm/send/dX1abc:APA91bExample"]);
    mode = "redirect";
    const r = await p.send(sub(FCM), msg);
    assert.deepEqual([r.ok, r.permanent, r.status], [false, true, 307]);
    assert.equal(srv.hits(), 2, "the redirect was not followed");
    mode = "hang";
    const t0 = performance.now();
    const h = await p.send(sub(FCM), msg);
    assert.deepEqual([h.ok, h.permanent, h.status], [false, false, 0], "no answer: tried again later");
    assert.ok(performance.now() - t0 < 5000, "cut off at the deadline");
    mode = "big";
    const b = await p.send(sub(FCM), msg);
    assert.equal(b.ok, true, "the status is enough; the rest of the answer is not read");
  } finally {
    await srv.close();
  }
});
