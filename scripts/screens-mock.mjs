// @ts-check
// Screenshots of the plan screens on the built-in demo data (?mock=1), at 390 x 844 (2x),
// in headless Chrome: the ritual plan, the plan after "I'm going" with the ride card, the
// rain plan in dark mode, the worst-case data and the laptop layout. Needs the built web app
// served (OFFLINE=1 npm run dev serves web/dist).
//
// Run: node scripts/screens-mock.mjs [base URL] [out dir]
//   defaults: http://localhost:3000, docs/screens

import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, sleep } from "./cdp.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/+$/, "");
const OUT = path.resolve(process.argv[3] || path.join(here, "../docs/screens"));
const chrome = await launch();
try {
  const shot = async (/** @type {any} */ p, /** @type {string} */ name) => console.log(await p.shot(path.join(OUT, `${name}.png`)));
  const plan = `${BASE}/c/yaba-lot/p/p-ritual?mock=1&reset=1`;

  const a = await chrome.page();
  await a.go(plan, 2500);
  await shot(a, "11-plan");
  await a.click("button", "I'm going");
  await sleep(3200);
  await a.scrollTo(".who");
  await sleep(400);
  await shot(a, "12-plan-going");

  const d = await chrome.page({ dark: true });
  await d.go(`${BASE}/c/yaba-lot/p/p-groove?mock=1&reset=1`, 2500);
  await shot(d, "13-plan-rain-dark");

  const w = await chrome.page();
  await w.go(`${BASE}/c/yaba-lot/p/p-ritual?mock=1&reset=1&data=worst`, 2500);
  await shot(w, "15-worst-case-plan");

  const l = await chrome.page({ width: 1280, height: 800, scale: 1 });
  await l.go(`${BASE}/c/yaba-lot/p/p-ritual?mock=1&reset=1`, 2500);
  await shot(l, "17-laptop-plan");
} finally {
  await chrome.close();
}
