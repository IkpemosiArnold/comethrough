// @ts-check
// The sloth is waking up, in a real browser. Starts the API offline (fakes for every outside
// service) and, in front of it, a stand-in for the static site that answers like Render does
// while a free service wakes: the app's pages at once, and for /api either Render's
// "Application loading" page (503 HTML) or a request held until the server is up. Then, in
// headless Chrome at iPhone size (dark first, then light, reduced motion on):
//   1. a friend opens a crew link for the first time while the API is asleep;
//   2. a member comes back while it is asleep: the crew this phone saw last shows at once,
//      marked as refreshing;
//   3. it never wakes: after about 90 s, an honest message and a retry button.
// Screenshots go to docs/screens/wake/. Prints a JSON report; exits 1 when a check fails.
//
// Run: npm --prefix web run build && CDP_PORT=9655 node scripts/wake-check.mjs [--quick]
//   --quick skips the 90 s "never wakes" case.

import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, sleep } from "./cdp.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const DIST = path.join(ROOT, "web/dist");
const OUT = path.join(ROOT, "docs/screens/wake");
const QUICK = process.argv.includes("--quick");
const API_PORT = 3990 + Math.floor(Math.random() * 9);
const FRONT_PORT = 4090 + Math.floor(Math.random() * 9);
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1";

if (!fs.existsSync(path.join(DIST, "index.html"))) throw new Error("build the web app first: npm --prefix web run build");

/** @type {{ step: string, ok: boolean, info?: any }[]} */
const steps = [];
let failed = 0;
async function check(/** @type {string} */ step, /** @type {() => Promise<any>} */ fn) {
  try {
    steps.push({ step, ok: true, info: await fn() });
  } catch (e) {
    failed++;
    steps.push({ step, ok: false, info: String(/** @type {any} */ (e)?.message || e).slice(0, 400) });
  }
}
const must = (/** @type {any} */ c, /** @type {string} */ m) => { if (!c) throw new Error(m); };

// ---------------------------------------------------------------- the API, offline
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ct-wake-"));
const api = spawn(process.execPath, ["src/server/server.mjs"], { cwd: ROOT, env: { ...process.env, OFFLINE: "1", PORT: String(API_PORT), DATA_DIR: dataDir, STATIC_DIR: path.join(dataDir, "none"), MONGODB_URI: "", PUBLIC_URL: `http://localhost:${FRONT_PORT}`, TRUST_PROXY_HOPS: "0", WARM_CAP_HOURS: "0" }, stdio: "ignore" });
for (let i = 0; i < 80; i++) {
  try { if ((await fetch(`http://127.0.0.1:${API_PORT}/healthz`)).ok) break; } catch {}
  await sleep(250);
}

// ---------------------------------------------------------------- the static site, with a napping API behind it
/** "up", "interstitial" (Render's loading page) or "hold" (the proxy waits until up) */
let mode = "up";
let wakesAt = 0;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".json": "application/json" };
const INTERSTITIAL = "<!doctype html><html><head><title>Render - Application loading</title></head><body>Loading</body></html>";
/** @type {{ at: number, path: string, answered: string }[]} */
const apiLog = [];
const front = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://x");
  const toApi = /^\/(api|cal|basic)\//.test(url.pathname) || url.pathname === "/healthz";
  if (toApi) {
    const asleep = mode !== "up" && Date.now() < wakesAt;
    if (asleep && mode === "interstitial") {
      apiLog.push({ at: Date.now(), path: url.pathname, answered: "interstitial" });
      res.writeHead(503, { "content-type": "text/html; charset=utf-8", "retry-after": "5", "x-render-routing": "hibernate-pending-wake" }).end(INTERSTITIAL);
      return;
    }
    if (asleep && mode === "hold") await sleep(Math.max(0, wakesAt - Date.now()));
    apiLog.push({ at: Date.now(), path: url.pathname, answered: "api" });
    const body = await new Promise((r) => { /** @type {Buffer[]} */ const c = []; req.on("data", (x) => c.push(x)); req.on("end", () => r(Buffer.concat(c))); });
    const up = await fetch(`http://127.0.0.1:${API_PORT}${url.pathname}${url.search}`, { method: req.method, headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => !["host", "connection", "content-length"].includes(k)).map(([k, v]) => [k, String(v)])), body: ["GET", "HEAD"].includes(req.method || "GET") ? undefined : /** @type {any} */ (body) });
    const buf = Buffer.from(await up.arrayBuffer());
    res.writeHead(up.status, { "content-type": up.headers.get("content-type") || "application/octet-stream" }).end(buf);
    return;
  }
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.extname(url.pathname) ? "" : path.join(DIST, "index.html");
  if (!file) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": TYPES[/** @type {keyof typeof TYPES} */ (path.extname(file))] || "application/octet-stream", "cache-control": "no-cache" }).end(await fsp.readFile(file));
});
await new Promise((r) => front.listen(FRONT_PORT, () => r(null)));
const BASE = `http://localhost:${FRONT_PORT}`;

/** A crew to open, made through the API while it is up. */
async function call(/** @type {string} */ method, /** @type {string} */ p, /** @type {any} */ json, token = "") {
  const r = await fetch(`http://127.0.0.1:${API_PORT}${p}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: json ? JSON.stringify(json) : undefined });
  return r.json();
}
const made = await call("POST", "/api/crews", { confirm: { name: "The Yaba Lot", vibe: "chill", vibeTags: [], budget: "cheap", rhythm: null, areas: [{ label: "Yaba", lat: 6.5095, lon: 3.3711 }], taste: null }, organiser: { name: "Tolu", area: "Yaba" } });
const slug = made.crew.slug;
const invite = made.inviteToken;

const chrome = await launch();
fs.mkdirSync(OUT, { recursive: true });
// the first page a freshly started Chrome opens is slow on a busy machine (5 s against 0.5 s,
// 24 Oct): open one first so the checks measure the app, not Chrome's own start
{
  const warm = await chrome.page();
  await warm.go(`${BASE}/how`, 1500);
  await warm.close();
}
/** what the page shows: the waking card, its words and colours, the crew's name, the refreshing line */
const LOOK = `(() => {
  const card = document.querySelector('.wake-card');
  const rgb = (c) => (c.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const x = lum(rgb(a)), y = lum(rgb(b)); return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 10) / 10; };
  const bg = card ? getComputedStyle(card).backgroundColor : null;
  const texts = card ? [...card.querySelectorAll('p, span, button')].map((e) => ratio(getComputedStyle(e).color, bg)) : [];
  // the words a person reads (the sloth's drawn "z z z" is not text)
  const said = card ? [...card.querySelectorAll('.wake-text, button')].map((e) => e.innerText).join(' ').replace(/\\s+/g, ' ').trim() : null;
  return {
    card: card ? card.className : null,
    words: said ? said.split(' ').filter((w) => /[A-Za-z]/.test(w)).length : 0,
    text: said,
    clock: card?.querySelector('.wake-clock')?.textContent || null,
    lowestContrast: texts.length ? Math.min(...texts) : null,
    crew: document.querySelector('.crew-head h1, .crew-name, h1')?.textContent || null,
    refreshing: !!document.querySelector('.refreshing'),
    error: document.querySelector('.error-note')?.innerText || null,
    retry: !!document.querySelector('.wake-retry'),
    wordsAboveFold: document.body.innerText.split(/\\s+/).filter((w) => /[A-Za-z]/.test(w)).length,
  };
})()`;

async function phone(/** @type {boolean} */ dark) {
  const p = await chrome.page({ dark });
  await p.send("Emulation.setUserAgentOverride", { userAgent: IPHONE, platform: "iPhone" });
  return p;
}
const timeline = async (/** @type {any} */ p, /** @type {number} */ ms, step = 500) => {
  const out = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    out.push({ ms: Date.now() - t0, ...(await p.run(LOOK)) });
    await sleep(step);
  }
  return out;
};

try {
  for (const dark of [true, false]) {
    const theme = dark ? "dark" : "light";
    // ------------------------------------------------ 1. a friend's first visit, API asleep (Render's loading page)
    await check(`${theme}: a friend opens the crew link while the API sleeps (interstitial)`, async () => {
      mode = "interstitial";
      wakesAt = Date.now() + 12_000;
      const p = await phone(dark);
      const t0 = Date.now();
      await p.send("Page.navigate", { url: `${BASE}/c/${slug}?t=${encodeURIComponent(invite)}` });
      await p.waitFor(".crew-head", { timeoutMs: 5000 });
      const shell = Date.now() - t0;
      const early = await timeline(p, 2000, 250);
      try {
        await p.waitFor(".wake-card", { text: "waking up", timeoutMs: 4000 });
      } catch (e) {
        throw new Error(`no waking card: ${JSON.stringify(early.map((x) => [x.ms, x.card, x.error]))} ${JSON.stringify(apiLog.slice(-6))}`);
      }
      const card = Date.now() - t0;
      await sleep(2500);
      const during = await p.run(LOOK);
      await p.shot(path.join(OUT, `${theme}-1-waking.png`));
      await p.waitFor("h1", { text: "The Yaba Lot", timeoutMs: 30_000 });
      const crew = Date.now() - t0;
      const after = await p.run(LOOK);
      await p.shot(path.join(OUT, `${theme}-1-awake.png`));
      await sleep(2000);
      const gone = await p.run(LOOK);
      await p.close();
      must(shell < 2500, `the page took ${shell} ms`);
      must(during.clock && /^0:0\d$/.test(during.clock), `clock ${during.clock}`);
      must(during.words <= 14, `${during.words} words on the card`);
      must(during.lowestContrast >= 7, `contrast ${during.lowestContrast}`);
      must(!gone.card, "the card stays after the server woke");
      return { shellMs: shell, cardMs: card, crewMs: crew, during, afterCard: after.card, gone: !gone.card };
    });

    // ------------------------------------------------ 2. a member comes back: cached crew at once, refreshing; the request is held
    await check(`${theme}: a member comes back while the API sleeps (held request), cached crew shows at once`, async () => {
      mode = "up";
      const p = await phone(dark);
      await p.go(`${BASE}/c/${slug}?t=${encodeURIComponent(invite)}`, 2500); // this phone sees the crew once
      await p.waitFor("h1", { text: "The Yaba Lot", timeoutMs: 10_000 });
      mode = "hold";
      wakesAt = Date.now() + 10_000;
      const t0 = Date.now();
      await p.send("Page.navigate", { url: `${BASE}/c/${slug}` });
      await p.waitFor("h1", { text: "The Yaba Lot", timeoutMs: 3000 });
      const cachedMs = Date.now() - t0;
      await sleep(2200);
      const during = await p.run(LOOK);
      await p.shot(path.join(OUT, `${theme}-2-cached-refreshing.png`));
      const tl = await timeline(p, 10_000, 1000);
      const after = await p.run(LOOK);
      await p.close();
      must(cachedMs < 2000, `the cached crew took ${cachedMs} ms`);
      must(during.refreshing, "no refreshing mark on the cached crew");
      must(during.card && /waking/.test(during.card), "no waking card while the request is held");
      must(!after.refreshing && !after.card, "still refreshing after the server woke");
      return { cachedMs, during, clocks: tl.map((x) => x.clock).filter(Boolean), after: { refreshing: after.refreshing, card: after.card } };
    });
  }

  // ------------------------------------------------ 3. it never wakes
  if (!QUICK) {
    await check("dark: the API never wakes: after about 90 s an honest message and a retry", async () => {
      mode = "interstitial";
      wakesAt = Date.now() + 10 * 60_000;
      const p = await phone(true);
      const t0 = Date.now();
      await p.send("Page.navigate", { url: `${BASE}/c/${slug}?t=${encodeURIComponent(invite)}` });
      await p.waitFor(".wake-retry", { timeoutMs: 110_000 });
      const downMs = Date.now() - t0;
      await sleep(500);
      const down = await p.run(LOOK);
      await p.shot(path.join(OUT, "dark-3-down.png"));
      const tries = apiLog.filter((x) => x.at >= t0 && x.path === "/api/healthz").length;
      // the retry button: the server is up now, so the sloth wakes and the screen loads by itself
      wakesAt = 0;
      mode = "up";
      await p.click(".wake-retry");
      await p.waitFor("h1", { text: "The Yaba Lot", timeoutMs: 15_000 });
      const back = await p.run(LOOK);
      await p.close();
      must(downMs > 85_000 && downMs < 105_000, `down after ${downMs} ms`);
      must(down.retry, "no retry button");
      must(down.lowestContrast >= 7, `contrast ${down.lowestContrast}`);
      return { downMs, down, healthTries: tries, afterRetry: { crew: back.crew, card: back.card, error: back.error } };
    });
  }
} finally {
  await chrome.close();
  front.close();
  api.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
console.log(JSON.stringify({ at: new Date().toISOString(), failed, steps }, null, 1));
process.exit(failed ? 1 : 0);
