// @ts-check
// The density check: words per screen (whole screen and above the fold), the contrast of the
// text that is on screen, and screenshots in light and dark, at 390 x 844 (2x) with an iPhone
// Safari user agent, in headless Chrome (scripts/cdp.mjs: never the Playwright browser).
// Every screen runs on the demo data (?mock=1), so nothing reaches Gemma or a database.
//
// Run: npm --prefix web run build && MONGODB_URI= PORT=3600 node src/server/server.mjs
//      node scripts/screens-density.mjs <label> [base URL] [out dir]
//   label: "before" or "after" (file names and the JSON), base default http://localhost:3600,
//   out dir default docs/screens/density

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, sleep } from "./cdp.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const LABEL = process.argv[2] || "after";
const BASE = (process.argv[3] || "http://localhost:3600").replace(/\/+$/, "");
const OUT = path.resolve(process.argv[4] || path.join(here, "../docs/screens/density"));
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
const SENTENCE = "The uni guys, every other Saturday, somewhere outside and cheap, around Yaba and Lekki";

// Runs in the page: counts the words a person sees (text, placeholders, button values) in
// `scope`, those inside the first viewport, and the contrast of each piece of text.
const MEASURE = `(${function measure(/** @type {string} */ scopeSel) {
  document.querySelectorAll(".data-toggle").forEach((e) => e.remove());
  const scope = document.querySelector(scopeSel) || document.body;
  const H = innerHeight;
  const parse = (/** @type {string} */ c) => {
    const m = c.match(/rgba?\(([^)]+)\)/) || c.match(/color\(srgb ([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    const srgb = c.startsWith("color(");
    const [r, g, b] = parts.slice(0, 3).map((v) => (srgb ? v * 255 : v));
    return { r, g, b, a: parts[3] ?? 1 };
  };
  const over = (/** @type {any} */ top, /** @type {any} */ bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const bgOf = (/** @type {Element} */ el) => {
    const layers = [];
    for (let e = /** @type {Element|null} */ (el); e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let out = parse(getComputedStyle(document.documentElement).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    for (const l of layers.reverse()) out = over(l, out);
    return out;
  };
  const lum = (/** @type {any} */ c) => {
    const f = (/** @type {number} */ v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (/** @type {any} */ a, /** @type {any} */ b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const visible = (/** @type {Element} */ el) => {
    for (let e = /** @type {Element|null} */ (el); e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
      if (e.classList.contains("sr-only")) return false;
    }
    return el.getClientRects().length > 0;
  };
  let words = 0, fold = 0;
  /** @type {{ text: string, ratio: number, size: number, words: number }[]} */
  const pieces = [];
  const count = (/** @type {string} */ t) => (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) || []).length;
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || !n.textContent || !n.textContent.trim() || !visible(el) || el.closest("svg,script,style,noscript")) continue;
    const re = /[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu;
    let m, here = 0;
    while ((m = re.exec(n.textContent))) {
      const r = document.createRange();
      r.setStart(n, m.index);
      r.setEnd(n, m.index + m[0].length);
      const box = r.getBoundingClientRect();
      if (!box.width) continue;
      here++;
      if (box.top + scrollY < H) fold++;
    }
    words += here;
    const s = getComputedStyle(el);
    const fg = parse(s.color);
    if (fg && here) pieces.push({ text: n.textContent.trim().slice(0, 40), ratio: Math.round(ratio(over(fg, bgOf(el)), bgOf(el)) * 10) / 10, size: parseFloat(s.fontSize), words: here });
  }
  for (const f of scope.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=file]), textarea")) {
    const i = /** @type {HTMLInputElement} */ (f);
    if (!visible(i)) continue;
    const t = count(i.value || i.placeholder || "");
    words += t;
    if (i.getBoundingClientRect().top + scrollY < H) fold += t;
  }
  const bodyWords = pieces.filter((p) => p.size >= 15);
  const share7 = pieces.reduce((a, p) => a + (p.ratio >= 7 ? p.words : 0), 0) / Math.max(1, pieces.reduce((a, p) => a + p.words, 0));
  return {
    words, fold,
    minRatio: Math.min(...pieces.map((p) => p.ratio)),
    minBodyRatio: bodyWords.length ? Math.min(...bodyWords.map((p) => p.ratio)) : null,
    share7: Math.round(share7 * 100),
    under45: pieces.filter((p) => p.ratio < 4.5).map((p) => `${p.text} (${p.ratio})`),
    under7: pieces.filter((p) => p.ratio < 7).map((p) => `${p.text} (${p.ratio})`),
    bodySize: parseFloat(getComputedStyle(document.body).fontSize),
  };
}})`;

/** @typedef {{ name: string, scope?: string, open: (p: any) => Promise<void> }} Screen */
/** @type {Screen[]} */
const SCREENS = [
  { name: "landing", open: async (p) => { await p.go(`${BASE}/?mock=1&reset=1`, 1500); await p.waitFor("form"); } },
  {
    name: "preview",
    open: async (p) => {
      await p.go(`${BASE}/?mock=1&reset=1&fast=1`, 1500);
      await p.type("#crew-sentence", SENTENCE);
      await p.click('button[type="submit"]');
      await p.waitFor(".preview");
      await sleep(500);
    },
  },
  {
    name: "invite",
    open: async (p) => {
      await p.go(`${BASE}/?mock=1&reset=1&fast=1`, 1500);
      await p.type("#crew-sentence", SENTENCE);
      await p.click('button[type="submit"]');
      await p.waitFor(".preview");
      await p.type('input[autocomplete="given-name"]', "Tolu");
      await p.click("button", "Make the crew");
      await p.waitFor(".invite");
      await sleep(1500);
      await p.waitFor(".first-pick.landed", { timeoutMs: 8000 }).catch(() => {});
      await sleep(600);
    },
  },
  {
    name: "where",
    open: async (p) => {
      await p.go(`${BASE}/?mock=1&reset=1&fast=1`, 1500);
      await p.type("#crew-sentence", "The book club, every Saturday, around Zazzau");
      await p.click('button[type="submit"]');
      await p.waitFor(".where");
      await sleep(500);
    },
  },
  { name: "crew-home", open: async (p) => { await p.go(`${BASE}/c/yaba-lot?mock=1&reset=1`, 2200); await p.waitFor(".plan-list"); } },
  { name: "plan", open: async (p) => { await p.go(`${BASE}/c/yaba-lot/p/p-ritual?mock=1&reset=1`, 2400); await p.waitFor(".plan-h1"); await sleep(800); } },
  { name: "add-plan", open: async (p) => { await p.go(`${BASE}/c/yaba-lot/add?mock=1&reset=1`, 1800); await p.waitFor("form"); } },
  { name: "one-tap", open: async (p) => { await p.go(`${BASE}/c/yaba-lot/p/p-ritual/in?mock=1&reset=1&guest=1`, 2400); await p.waitFor("form"); } },
  {
    name: "one-tap-done",
    open: async (p) => {
      await p.go(`${BASE}/c/yaba-lot/p/p-ritual/in?mock=1&reset=1`, 3500);
      await p.waitFor(".ot-done");
      await sleep(800);
    },
  },
  {
    name: "ideas",
    scope: ".ideas",
    open: async (p) => {
      await p.go(`${BASE}/c/yaba-lot?mock=1&data=quiet`, 2500);
      await p.waitFor(".ideas-list");
      await p.scrollTo(".ideas", "center");
    },
  },
  {
    name: "status-sheet",
    scope: ".status-sheet",
    open: async (p) => {
      await p.go(`${BASE}/c/yaba-lot?mock=1&data=came`, 2500);
      await p.waitFor(".status-prompt");
      await p.click(".status-prompt button", "Make the card");
      await p.waitFor(".status-sheet");
      await sleep(700);
    },
  },
  { name: "how", open: async (p) => { await p.go(`${BASE}/how?mock=1`, 1500); await p.waitFor("h1"); } },
];

const only = process.env.SCREENS ? process.env.SCREENS.split(",") : null;
const chrome = await launch();
/** @type {Record<string, any>} */
const results = {};
try {
  for (const s of SCREENS.filter((x) => !only || only.includes(x.name))) {
    for (const dark of [false, true]) {
      const p = await chrome.page({ dark });
      await p.send("Emulation.setUserAgentOverride", { userAgent: IPHONE, platform: "iPhone" });
      await p.send("Page.bringToFront");
      try {
        await s.open(p);
        // finish every entrance animation: a page in the background never runs them
        await p.run(`(() => { const st = document.createElement("style"); st.textContent = "*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; transition-duration: 0s !important; }"; document.head.appendChild(st); })()`);
        if (!s.scope) await p.run("window.scrollTo(0, 0)");
        await sleep(600);
        const m = await p.run(`${MEASURE}(${JSON.stringify(s.scope || "body")})`);
        const theme = dark ? "dark" : "light";
        await p.shot(path.join(OUT, `${LABEL}-${s.name}-${theme}.png`));
        results[s.name] = { ...(results[s.name] || {}), [theme]: m };
        console.log(`${s.name} ${theme}: ${m.words} words, ${m.fold} above the fold, min contrast ${m.minRatio}, body min ${m.minBodyRatio}, ${m.share7}% of words at 7:1+${m.under45.length ? `, under 4.5: ${m.under45.join("; ")}` : ""}`);
      } catch (e) {
        console.error(`${s.name}: ${/** @type {Error} */ (e).message}`);
      }
      await p.close();
    }
  }
} finally {
  await chrome.close().catch(() => {});
}
fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, `${LABEL}.json`);
const prev = fs.existsSync(file) && only ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
fs.writeFileSync(file, JSON.stringify({ ...prev, ...results }, null, 1) + "\n");
console.log(file);
