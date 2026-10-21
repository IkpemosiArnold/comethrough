// @ts-check
// Web Push for real, on this machine: a headless Chrome with a fresh profile opens the app,
// subscribes with the server's VAPID key, and the server then pushes to it through Google's
// push service (FCM). Passes when the service worker shows the notification.
//
// Run against a server started with VAPID keys (not OFFLINE):
//   node scripts/push-check.mjs [base URL]        default http://localhost:3000
//   CHROME=/path/to/chrome to use another browser binary.
// Tokens are never printed.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/+$/, "");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9300 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ct-push-"));
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
/** @type {Record<string, any>} */
const report = { base: BASE };

async function api(method, p, { token, json } = /** @type {any} */ ({})) {
  const res = await fetch(BASE + p, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(json ? { "content-type": "application/json" } : {}) }, body: json ? JSON.stringify(json) : undefined });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

/** A tiny Chrome DevTools Protocol client over one page target. */
async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  /** @type {Map<number, (v: any) => void>} */
  const waiting = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)?.(m); waiting.delete(m.id); }
  };
  const send = (/** @type {string} */ method, params = {}, sessionId = undefined) => new Promise((resolve, reject) => {
    const n = ++id;
    waiting.set(n, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { send, close: () => ws.close() };
}

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
try {
  // a crew of two with no Gemma calls: Ada will get a push when Kene adds a plan
  const crew = await api("POST", "/api/crews", { json: { confirm: { name: "Push check", areas: [{ label: "Yaba" }] }, organiser: { name: "Ada", area: "Yaba" } } });
  if (crew.status !== 201) throw new Error(`create crew: ${crew.status}`);
  const kene = await api("POST", `/api/crews/${crew.data.crew.slug}/members`, { token: crew.data.inviteToken, json: { name: "Kene", area: "Surulere" } });
  const key = await api("GET", "/api/push/key");
  report.serverPush = !!key.data.publicKey;
  if (!key.data.publicKey) throw new Error("the server has no VAPID key (push is off)");

  let version;
  for (let i = 0; i < 40 && !version; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await sleep(250); }
  }
  if (!version) throw new Error("Chrome did not start");
  report.chrome = version.Browser;
  const browser = await cdp(version.webSocketDebuggerUrl);
  await browser.send("Browser.grantPermissions", { origin: new URL(BASE).origin, permissions: ["notifications"] });
  const { targetId } = /** @type {any} */ (await browser.send("Target.createTarget", { url: "about:blank" }));
  const { sessionId } = /** @type {any} */ (await browser.send("Target.attachToTarget", { targetId, flatten: true }));
  const run = async (/** @type {string} */ expression) => {
    const r = /** @type {any} */ (await browser.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId));
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await browser.send("Page.navigate", { url: `${BASE}${new URL(crew.data.memberUrl).pathname}${new URL(crew.data.memberUrl).search}` }, sessionId);
  await sleep(2500);

  // the same calls the app makes in enablePush (web/src/lib/platform.js)
  const sub = await run(`(async () => {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const { publicKey } = await (await fetch('/api/push/key')).json();
    const pad = '='.repeat((4 - publicKey.length % 4) % 4);
    const raw = atob((publicKey + pad).replace(/-/g, '+').replace(/_/g, '/'));
    const key = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    return s.toJSON();
  })()`);
  report.subscribed = { endpointHost: new URL(sub.endpoint).host, keys: Object.keys(sub.keys || {}) };
  const saved = await api("POST", `/api/members/${crew.data.member.id}/push-subscription`, { token: crew.data.memberToken, json: { subscription: sub } });
  report.saved = saved.status;

  const start = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const plan = await api("POST", `/api/crews/${crew.data.crew.slug}/plans`, { token: kene.data.memberToken, json: { plan: { kind: "quick", title: "Suya at Glover Court", start: `${start}T19:00:00+01:00`, place: { name: "Glover Court", outdoor: true, private: false } } } });
  report.planCreated = plan.status;

  let shown = [];
  for (let i = 0; i < 30 && !shown.length; i++) {
    await sleep(1000);
    shown = await run(`navigator.serviceWorker.ready.then((r) => r.getNotifications()).then((ns) => ns.map((n) => ({ title: n.title, body: n.body, tag: n.tag, url: n.data && n.data.url })))`);
  }
  report.notifications = shown.map((/** @type {any} */ n) => ({ ...n, url: n.url ? new URL(n.url).pathname : null }));
  report.ok = shown.length > 0;
  browser.close();
} catch (e) {
  report.ok = false;
  report.error = String(/** @type {any} */ (e)?.message || e);
} finally {
  chrome.kill();
  await sleep(300);
  fs.rmSync(profile, { recursive: true, force: true });
}
console.log(JSON.stringify(report, null, 1));
process.exit(report.ok ? 0 : 1);
