// @ts-check
// The small signs of life, recorded: a strip of frames for each moment (the swing and the leaf,
// the danfo pulling into the pod, the sloth reading, a poke and the doze, rain on a wet plan,
// the Status card taped up, a blink), the frame timing of each with the CPU slowed 4x, how soon
// a tap shows on screen, and checks that reduced motion keeps every moment still (with its
// meaning) and that ambient motion pauses in a hidden tab. Headless Chrome via scripts/cdp.mjs
// (never the Playwright browser), on the demo data (?mock=1), so nothing reaches Gemma or a database.
//
// Run: npm --prefix web run build && MONGODB_URI= PORT=3700 node src/server/server.mjs
//      node scripts/screens-whimsy.mjs [base URL] [out dir]
//   base default http://localhost:3700, out dir default docs/screens/whimsy.
//   ONLY=swing,poke runs some of the moments.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, sleep } from "./cdp.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.argv[2] || "http://localhost:3700").replace(/\/+$/, "");
const OUT = path.resolve(process.argv[3] || path.join(here, "../docs/screens/whimsy"));
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
const NO_SHOTS = process.env.SHOTS === "0"; // timing only, e.g. against an older build
const VW = 390;
fs.mkdirSync(OUT, { recursive: true });

const browser = await launch();
/** @type {Record<string, any>} */
const report = { base: BASE, viewport: "390 x 844 at 2x, Android Chrome user agent", throttle: "4x CPU for the timing runs", moments: {} };

/** @typedef {Awaited<ReturnType<typeof browser.page>>} Page */

/** @returns {Promise<Page>} */
async function open(/** @type {string} */ url, { reduce = false, throttle = 1, wait = 2200 } = {}) {
  const p = await browser.page();
  await p.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }, { name: "prefers-reduced-motion", value: reduce ? "reduce" : "no-preference" }] });
  await p.go(url, wait);
  await p.run(`document.querySelectorAll(".data-toggle").forEach((e) => e.remove())`);
  if (throttle > 1) await p.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  return p;
}

/** A real tap (touch start and end) at the middle of the first element matching the selector. */
async function tap(/** @type {Page} */ p, /** @type {string} */ selector) {
  const r = await rect(p, selector);
  const pt = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  await p.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [pt] });
  await p.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function rect(/** @type {Page} */ p, /** @type {string} */ selector) {
  const r = await p.run(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
  if (!r) throw new Error(`no ${selector}`);
  return r;
}

/**
 * Record a moment in slow motion: every animation on the page (CSS and Web Animations) runs at
 * `rate` of its speed while screenshots are taken back to back, each labelled with the
 * animation time it shows (document.timeline, from the trigger). Headless screencasts skip
 * frames, so this is the honest way to see each step. Timers in the app's own code still run
 * at full speed, so a step that waits on one (a network answer) comes early in these strips.
 */
async function record(/** @type {Page} */ p, /** @type {number} */ ms, /** @type {() => Promise<any>} */ trigger, rate = 0.1) {
  /** @type {{ t: number, data: string }[]} */
  const frames = [];
  if (NO_SHOTS) return trigger().then(() => sleep(Math.min(ms, 1500))).then(() => frames);
  await p.send("Animation.enable");
  await p.send("Animation.setPlaybackRate", { playbackRate: rate });
  const t0 = await p.run("document.timeline.currentTime");
  await trigger();
  for (let t = 0; t < ms; ) {
    const { data } = await p.send("Page.captureScreenshot", { format: "jpeg", quality: 88 });
    t = Math.round((await p.run("document.timeline.currentTime")) - t0);
    frames.push({ t, data });
  }
  await p.send("Animation.setPlaybackRate", { playbackRate: 1 });
  return frames;
}

/** A contact sheet: the frame on screen at each moment in `times`, cut to `clip` (CSS px). */
async function sheet(/** @type {string} */ name, /** @type {{ t: number, data: string }[]} */ frames, /** @type {number[]} */ times, /** @type {{ x: number, y: number, w: number, h: number }} */ clip, zoom = 1, title = "") {
  if (NO_SHOTS || !frames.length) return null;
  const pick = [...new Set(times.map((t) => frames.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a), frames[0])))].filter(Boolean);
  const cell = (/** @type {any} */ f) => `<figure><div style="width:${clip.w * zoom}px;height:${clip.h * zoom}px;background:url(data:image/jpeg;base64,${f.data}) ${-clip.x * zoom}px ${-clip.y * zoom}px / ${VW * zoom}px auto no-repeat"></div><figcaption>${Math.max(0, f.t)} ms</figcaption></figure>`;
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#E3EBD2;font:600 13px/1.2 system-ui;color:#14302A}h1{font-size:15px;margin:0;padding:14px 14px 0}main{display:flex;flex-wrap:wrap;gap:12px;padding:12px 14px 16px}figure{margin:0}figure div{border-radius:8px;box-shadow:0 0 0 1px #14302a33}figcaption{padding-top:5px}</style><h1>${title}</h1><main>${pick.map(cell).join("")}</main>`;
  clip = { x: Math.round(clip.x), y: Math.round(clip.y), w: Math.round(clip.w), h: Math.round(clip.h) };
  const width = Math.round(Math.min(1180, Math.max(420, (clip.w * zoom + 12) * Math.min(pick.length, 6) + 30)));
  const s = await browser.page({ width, height: 400, scale: 1.5 });
  const { frameTree } = await s.send("Page.getFrameTree");
  await s.send("Page.setDocumentContent", { frameId: frameTree.frame.id, html });
  await sleep(300);
  const height = Math.ceil(await s.run("document.documentElement.scrollHeight"));
  await s.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1.5, mobile: false });
  await sleep(200);
  const file = await s.shot(path.join(OUT, `${name}.png`));
  await s.close();
  return path.relative(path.join(here, ".."), file);
}

// Frame timing: requestAnimationFrame stamps on the main thread, and long animation frames.
const MON_START = `(() => {
  window.__f = []; window.__on = true; window.__loaf = [];
  const loop = (t) => { if (!window.__on) return; window.__f.push(t); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__loaf.push(Math.round(e.duration)))).observe({ type: "long-animation-frame" }); } catch {}
})()`;
const MON_STOP = `(() => {
  window.__on = false;
  const f = window.__f;
  const d = f.slice(1).map((t, i) => t - f[i]);
  const s = [...d].sort((a, b) => a - b);
  const q = (x) => s[Math.min(s.length - 1, Math.floor(x * s.length))] || 0;
  const dropped = d.reduce((n, x) => n + Math.max(0, Math.round(x / 16.667) - 1), 0);
  return { frames: f.length, ms: Math.round(f[f.length - 1] - f[0]), medianMs: +q(0.5).toFixed(1), p95Ms: +q(0.95).toFixed(1), worstMs: +Math.max(0, ...d).toFixed(1), dropped, droppedPct: +(100 * dropped / Math.max(1, f.length + dropped)).toFixed(1), longAnimationFrames: window.__loaf.length };
})()`;

async function timing(/** @type {Page} */ p, /** @type {number} */ ms, /** @type {() => Promise<any>} */ trigger) {
  await p.run(MON_START);
  await sleep(100);
  await trigger();
  await sleep(ms);
  return p.run(MON_STOP);
}

// How long from the tap until the first frame in which the tap's own animation runs.
const LATENCY = (/** @type {string} */ inside) => `(() => {
  window.__lat = [];
  document.addEventListener("pointerdown", (e) => {
    const t0 = e.timeStamp;
    const check = (t) => {
      const on = document.getAnimations().some((a) => a.playState === "running" && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest(${JSON.stringify(inside)}) && (a.currentTime || 0) > 0);
      if (on) window.__lat.push(Math.round(t - t0)); else if (t - t0 < 2000) requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }, true);
})()`;

/** Which properties the running animations move, and on what. */
const MOVING = `document.getAnimations().filter((a) => a.playState === "running").map((a) => {
  const k = a.effect && a.effect.getKeyframes ? a.effect.getKeyframes() : [];
  const props = [...new Set(k.flatMap((f) => Object.keys(f).filter((x) => !["offset", "easing", "composite", "computedOffset"].includes(x))))];
  const t = a.effect && a.effect.target;
  return { on: t ? (t.getAttribute("class") || t.tagName) : "?", props, name: a.animationName || "" };
})`;

/**
 * Frame timing and tap latency for one moment, at full speed and with the CPU slowed 4x
 * (about a cheap Android phone): a fresh page each time, `prep` gets it ready, `trigger` plays it.
 */
async function measure(/** @type {string} */ url, /** @type {(p: Page) => Promise<any>} */ prep, /** @type {(p: Page) => Promise<any>} */ trigger, /** @type {number} */ ms, /** @type {string|null} */ inside, wait = 2400) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const throttle of [1, 4]) {
    const p = await open(url, { throttle, wait });
    await prep(p);
    if (inside) await p.run(LATENCY(inside));
    const perf = await timing(p, ms, () => trigger(p));
    if (inside) perf.tapToFirstFrameMs = await p.run("window.__lat");
    await p.close();
    out[`cpu${throttle}x`] = perf;
  }
  return out;
}

const want = (/** @type {string} */ k) => !ONLY || ONLY.includes(k);
const plan = (/** @type {string} */ id) => `${BASE}/c/yaba-lot/p/${id}?mock=1&reset=1`;

// ---------- the swing, the leaf and the danfo ----------
if (want("swing")) {
  const p = await open(plan("p-ritual"), { wait: 2600 });
  await p.waitFor(".branch");
  await p.run(`(() => { const b = document.querySelector(".branch"); window.scrollTo(0, b.getBoundingClientRect().top + scrollY - 150); })()`);
  await sleep(500);
  const branch = await rect(p, ".branch");
  const frames = await record(p, 3400, () => tap(p, ".going-btn"));
  const pod = await rect(p, ".pod-mine .pod-top").catch(() => null);
  const shots = {
    swing: await sheet("swing", frames, [0, 50, 100, 160, 240, 340, 480, 660, 900, 1200, 1600, 2200], { x: 0, y: branch.y, w: VW, h: branch.h }, 1, "I'm going: the face swings on, the branch dips and settles, a leaf falls"),
    danfo: pod ? await sheet("danfo", frames, [700, 900, 1000, 1100, 1200, 1300, 1400, 1550, 1700, 1900, 2200, 2800], { x: pod.x, y: pod.y - 4, w: pod.w + 20, h: pod.h + 8 }, 1, "The ride pod forms: the danfo pulls in and brakes") : null,
  };
  await p.close();
  const timings = await measure(plan("p-ritual"), async (t) => {
    await t.waitFor(".branch");
    await t.run(`(() => { const b = document.querySelector(".branch"); window.scrollTo(0, b.getBoundingClientRect().top + scrollY - 150); })()`);
    await sleep(500);
  }, (t) => tap(t, ".going-btn"), 3200, ".branch", 2600);
  report.moments.swing = { shots, ...timings };
  console.log("swing", JSON.stringify(report.moments.swing));
}

// ---------- the sloth reads the sentence ----------
if (want("reading")) {
  const go = async (/** @type {Page} */ p) => {
    await p.type("textarea", "The uni guys, every other Saturday, somewhere outside and cheap, around Yaba and Lekki");
    await tap(p, 'button[type="submit"]');
  };
  const p = await open(`${BASE}/?mock=1&reset=1`, { wait: 1800 });
  const s = await rect(p, ".start-branch .sloth");
  const frames = await record(p, 2000, () => go(p));
  const shots = { reading: await sheet("reading", frames, [300, 500, 700, 900, 1100, 1300, 1500, 1700], { x: s.x + s.w * 0.25, y: s.y + s.h * 0.4, w: s.w * 0.5, h: s.h * 0.3 }, 3, "While Gemma reads: the sloth's open eye follows the line") };
  await p.close();
  const timings = await measure(`${BASE}/?mock=1&reset=1`, async () => {}, go, 2000, null, 1800);
  report.moments.reading = { shots, ...timings };
  console.log("reading", JSON.stringify(report.moments.reading));
}

// ---------- poke the sloth; five pokes and it dozes ----------
if (want("poke")) {
  const sel = ".start-branch .sloth";
  const p = await open(`${BASE}/?mock=1&reset=1`, { wait: 1800 });
  const s = await rect(p, sel);
  const box = { x: Math.max(0, s.x - 30), y: Math.max(0, s.y - 10), w: Math.min(VW - Math.max(0, s.x - 30), s.w + 50), h: s.h + 20 };
  const one = await record(p, 900, () => tap(p, sel));
  await sleep(1600); // a fresh count: pokes count as a run only when they come close together
  const five = await record(p, 3800, async () => { for (let i = 0; i < 5; i++) { await tap(p, sel); await sleep(150); } });
  const asleep = await p.run(`!!document.querySelector(".start-branch .sloth-zzz")`);
  const wake = await record(p, 900, () => tap(p, sel));
  const awake = await p.run(`!document.querySelector(".start-branch .sloth-zzz")`);
  const shots = {
    poke: await sheet("poke", one, [0, 30, 60, 100, 160, 240, 360, 520, 800], box, 1.5, "A poke: the sloth swings from its hands on the first frame"),
    doze: await sheet("doze", five, [0, 400, 800, 1000, 1400, 1800, 2400, 3000, 3600], box, 1.5, "Five quick pokes: it dozes off"),
    wake: await sheet("wake", wake, [0, 40, 100, 200, 400, 800], box, 1.5, "The next poke wakes it"),
  };
  await p.close();
  const timings = await measure(`${BASE}/?mock=1&reset=1`, async () => {}, async (t) => { for (let i = 0; i < 5; i++) { await tap(t, sel); await sleep(200); } }, 3000, ".sloth", 1800);
  report.moments.poke = { shots, asleepAfterFive: asleep, awakeAfterNext: awake, ...timings };
  console.log("poke", JSON.stringify(report.moments.poke));
}

// ---------- rain on a wet plan ----------
if (want("rain")) {
  const p = await open(plan("p-groove"), { wait: 1200 });
  await p.waitFor(".rain-warn");
  await p.run(`window.scrollTo(0, document.querySelector(".rain-warn").getBoundingClientRect().top + scrollY - 200)`);
  await sleep(200);
  // reload the moment: restart the drip from its first drop
  const frames = await record(p, 1500, () => p.run(`document.querySelectorAll(".rain-warn .drop").forEach((d) => d.getAnimations().forEach((a) => { a.currentTime = 0; a.play(); }))`));
  const r = await rect(p, ".rain-warn > svg");
  const shots = { rain: await sheet("rain", frames, [0, 150, 300, 450, 600, 750, 900, 1050, 1200, 1350], { x: r.x - 2, y: r.y - 2, w: r.w + 4, h: r.h + 4 }, 5, "Rain on a wet plan: a few drops, four times, then still") };
  await p.close();
  report.moments.rain = { shots };
  console.log("rain", JSON.stringify(report.moments.rain));
}

// ---------- the Status card is taped up ----------
if (want("status")) {
  const go = async (/** @type {Page} */ p) => {
    await p.waitFor(".status-prompt");
    await p.click(".status-prompt button", "Make the card");
    await p.waitFor(".status-sheet");
    await sleep(500);
  };
  const p = await open(`${BASE}/c/yaba-lot?mock=1&data=came`, { wait: 2500 });
  await go(p);
  const frames = await record(p, 1600, () => p.click(".status-sheet button", "without photos"));
  const r = await rect(p, ".status-drop, .status-preview");
  const shots = { status: await sheet("status-card", frames, [0, 150, 250, 350, 450, 550, 650, 800, 1100], { x: r.x - 20, y: r.y - 30, w: r.w + 40, h: r.h + 50 }, 0.6, "We came through: the card drops onto the wall and is taped") };
  await p.close();
  const timings = await measure(`${BASE}/c/yaba-lot?mock=1&data=came`, go, (t) => t.click(".status-sheet button", "without photos"), 1500, null, 2500);
  report.moments.status = { shots, ...timings };
  console.log("status", JSON.stringify(report.moments.status));
}

// ---------- a blink, and the sleeping sloth on an empty page ----------
if (want("ambient")) {
  const p = await open(`${BASE}/how?mock=1`, { wait: 1500 });
  const s = await rect(p, ".how-sloth .sloth");
  const frames = await record(p, 900, () => p.run(`document.querySelector(".how-sloth .sloth-eyes").getAnimations().forEach((a) => { a.currentTime = 6700; })`));
  const blink = await sheet("blink", frames, [0, 60, 120, 180, 240, 300, 400, 500], { x: s.x + s.w * 0.25, y: s.y + s.h * 0.42, w: s.w * 0.5, h: s.h * 0.25 }, 3, "An awake sloth blinks, slowly, about every 7 seconds");
  await p.close();
  const z = await open(`${BASE}/nowhere?mock=1`, { wait: 1500 });
  const zs = await rect(z, ".empty-page .sloth");
  const zf = await record(z, 3700, async () => {});
  const zzz = await sheet("asleep", zf, [0, 600, 1200, 1800, 2400, 3000, 3600], { x: zs.x, y: zs.y - 10, w: zs.w + 30, h: zs.h * 0.7 }, 1.5, "Nothing here: the sloth is asleep");
  await z.close();
  // ambient cost on the most visited screen: the crew home, with the sloth swaying, for 5 s
  const crewHomeIdle = await measure(`${BASE}/c/yaba-lot?mock=1&reset=1`, async () => {}, async () => {}, 5000, null, 2500);
  const howIdle = await measure(`${BASE}/how?mock=1`, async () => {}, async () => {}, 5000, null, 1500);
  report.moments.ambient = { shots: { blink, asleep: zzz }, crewHomeIdle, howIdle };
  console.log("ambient", JSON.stringify(report.moments.ambient));
}

// ---------- reduced motion: every moment still, the meaning kept ----------
if (want("reduced")) {
  const out = {};
  let p = await open(plan("p-ritual"), { reduce: true, wait: 2600 });
  await tap(p, ".going-btn");
  await sleep(60);
  out.swing = await p.run(MOVING);
  await sleep(1500);
  out.swingOnBranch = await p.run(`!!document.querySelector('[data-hanger="m0"]')`);
  out.danfoParked = await p.run(`(() => { const d = document.querySelector(".danfo"); return !!d && d.getAnimations().length === 0; })()`);
  await p.close();
  p = await open(`${BASE}/?mock=1&reset=1`, { reduce: true, wait: 1800 });
  for (let i = 0; i < 5; i++) { await tap(p, ".start-branch .sloth"); await sleep(120); }
  out.poke = await p.run(MOVING);
  out.pokeAsleep = await p.run(`(() => { const z = document.querySelector(".start-branch .sloth-zzz text"); return !!z && getComputedStyle(z).opacity === "1"; })()`);
  await p.close();
  p = await open(plan("p-groove"), { reduce: true, wait: 1500 });
  out.rain = await p.run(MOVING);
  await p.close();
  p = await open(`${BASE}/how?mock=1`, { reduce: true, wait: 1500 });
  out.how = await p.run(MOVING);
  await p.close();
  const moving = Object.values(out).filter(Array.isArray).flat().filter((a) => a.props.some((x) => /transform|translate|rotate|scale/i.test(x)));
  report.moments.reducedMotion = { ...out, movingAnimations: moving.length };
  console.log("reduced", JSON.stringify(report.moments.reducedMotion));
}

// ---------- a hidden tab: ambient motion pauses ----------
if (want("hidden")) {
  const p = await open(`${BASE}/how?mock=1`, { wait: 1500 });
  const before = await p.run(`document.getAnimations().filter((a) => a.playState === "running").length`);
  await p.run(`Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange"))`);
  await sleep(100);
  const hidden = await p.run(`document.getAnimations().filter((a) => a.playState === "running").length`);
  await p.run(`Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange"))`);
  await sleep(100);
  const back = await p.run(`document.getAnimations().filter((a) => a.playState === "running").length`);
  await p.close();
  report.moments.hiddenTab = { runningBefore: before, runningWhileHidden: hidden, runningAfter: back };
  console.log("hidden", JSON.stringify(report.moments.hiddenTab));
}

await browser.close();
const file = path.join(OUT, NO_SHOTS ? "whimsy-timing-only.json" : "whimsy.json");
const prev = fs.existsSync(file) && ONLY ? JSON.parse(fs.readFileSync(file, "utf8")) : { moments: {} };
fs.writeFileSync(file, JSON.stringify({ ...report, moments: { ...prev.moments, ...report.moments } }, null, 2) + "\n");
console.log("wrote", path.relative(process.cwd(), file));
