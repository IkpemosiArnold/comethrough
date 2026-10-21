// @ts-check
// Screenshots of every main screen on real data, at 390 x 844 (2x), in headless Chrome.
// The crew is made through the UI (Gemma reads the sentence), one member joins through the
// UI, the rest through the API; plans arrive by sentence and flyer (UI) and by an event
// link (API); then the heartbeat makes the ritual. Needs a running server that is not
// OFFLINE, and TICK_SECRET in the environment or .env.
//
// Run: node scripts/screens-real.mjs [base URL] [out dir] [event URL]
//   defaults: http://localhost:3000, docs/screens/real, no event link

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "../src/config.mjs";
import { launch, sleep } from "./cdp.mjs";

loadDotEnv();
const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/+$/, "");
const OUT = path.resolve(process.argv[3] || path.join(here, "../docs/screens/real"));
const EVENT_URL = process.argv[4] || "";
const FLYER = path.join(here, "../test/fixtures/flyer-mango-yard.png");
/** @type {string[]} */
const shots = [];

async function api(method, p, { token, json } = /** @type {any} */ ({})) {
  const res = await fetch(BASE + p, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(json ? { "content-type": "application/json" } : {}) }, body: json ? JSON.stringify(json) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

const chrome = await launch();
try {
  const shot = async (/** @type {any} */ page, /** @type {string} */ name) => shots.push(path.basename(await page.shot(path.join(OUT, `${name}.png`))));

  // ---------------------------------------------------------------- Tolu starts the crew
  const tolu = await chrome.page();
  await tolu.go(`${BASE}/`);
  await shot(tolu, "01-start");
  await tolu.type("#crew-sentence", "the uni guys, every other Saturday, somewhere outside and cheap, around Yaba, Lekki and Surulere");
  await tolu.click('button[type="submit"]', "Set up my crew");
  await tolu.waitFor("h1", { text: "Did Gemma get it right?" });
  await sleep(600);
  await shot(tolu, "02-crew-confirm");
  await tolu.type('input[autocomplete="given-name"]', "Tolu");
  await tolu.type("#me-area", "Yaba");
  await sleep(1200);
  await tolu.run(`document.querySelector('.area-list, [role=listbox]') && document.activeElement.blur()`);
  await tolu.click("button", "Make the crew");
  await tolu.waitFor("button", { text: "Copy link" });
  await sleep(600);
  await shot(tolu, "03-invite");
  const stored = await tolu.run(`JSON.parse(localStorage.getItem('ct.crews.v1'))`);
  const crew = /** @type {any} */ (Object.values(stored)[0]);
  const slug = crew.slug;
  const invite = crew.invite;
  const toluToken = crew.memberToken;
  if (!toluToken) throw new Error("the organiser did not join");

  // ---------------------------------------------------------------- Bayo joins through the UI
  const bayo = await chrome.page();
  await bayo.go(`${BASE}/c/${slug}?t=${encodeURIComponent(invite)}`, 2500);
  if (!(await bayo.run(`location.pathname.endsWith('/join')`))) await bayo.go(`${BASE}/c/${slug}/join?t=${encodeURIComponent(invite)}`, 2500);
  await bayo.type('input[autocomplete="given-name"]', "Bayo");
  await bayo.type("#join-area", "Ikeja");
  await sleep(1200);
  await shot(bayo, "04-join");
  await bayo.run(`document.activeElement.blur()`);
  await bayo.click('button[type="submit"]', "Join the crew");
  await bayo.waitFor("h2", { text: "nudge" });
  await sleep(500);
  await shot(bayo, "05-joined");
  const bayoToken = /** @type {any} */ (Object.values(await bayo.run(`JSON.parse(localStorage.getItem('ct.crews.v1'))`))[0]).memberToken;

  // ---------------------------------------------------------------- Amaka and Seyi join by the API
  const amaka = await api("POST", `/api/crews/${slug}/members`, { token: invite, json: { name: "Amaka", area: "Lekki Phase 1" } });
  const seyi = await api("POST", `/api/crews/${slug}/members`, { token: invite, json: { name: "Seyi", area: "Surulere" } });

  // ---------------------------------------------------------------- plans
  await tolu.go(`${BASE}/c/${slug}/add`);
  await shot(tolu, "06-add-plan");
  await tolu.type("#plan-text", "https://www.instagram.com/p/DAbCdEfGhIj/");
  await sleep(400);
  await shot(tolu, "07-instagram-link");
  await tolu.type("#plan-text", "wine and monopoly at mine friday 7, bring a bottle");
  await tolu.click('button[type="submit"]', "Read it");
  await tolu.waitFor("h1", { text: "Here's what Gemma got" });
  await sleep(500);
  await shot(tolu, "08-draft-sentence");
  await tolu.click("button", "Post it to the crew");
  await tolu.waitFor(".plan-h1");
  const winePath = await tolu.run("location.pathname");

  await tolu.go(`${BASE}/c/${slug}/add`);
  await tolu.upload('input[type="file"]', FLYER);
  await sleep(1500);
  await shot(tolu, "09-gemma-reading-flyer");
  // Gemma's vision call sometimes takes longer than the 25 s cap: the screen then says
  // "Over to you" and offers another go, which is what a person would tap
  for (let attempt = 0; ; attempt++) {
    await tolu.waitFor("h1", { timeoutMs: 120000 });
    await tolu.waitFor(".draft-head h1");
    const busy = await tolu.run(`document.querySelector('.draft-head h1').textContent.includes('Over to you')`);
    if (!busy) break;
    if (attempt === 0) await shot(tolu, "10b-gemma-busy");
    if (attempt >= 2) throw new Error("Gemma stayed busy");
    await tolu.click("button", "Try Gemma again");
    await sleep(1000);
  }
  await sleep(500);
  await shot(tolu, "10-draft-flyer");
  await tolu.click("button", "Post it to the crew");
  await tolu.waitFor(".plan-h1");
  const flyerPath = await tolu.run("location.pathname");
  const flyerId = flyerPath.split("/").pop();

  let linkId = null;
  if (EVENT_URL) {
    const parsed = await api("POST", `/api/crews/${slug}/plans/parse`, { token: amaka.memberToken, json: { url: EVENT_URL } });
    linkId = (await api("POST", `/api/crews/${slug}/plans`, { token: amaka.memberToken, json: { plan: parsed.draft } })).plan.id;
  }

  // RSVPs from the others
  const wineId = winePath.split("/").pop();
  for (const [t, v] of [[amaka.memberToken, "going"], [seyi.memberToken, "going"], [bayoToken, "maybe"]]) await api("PATCH", `/api/plans/${wineId}`, { token: t, json: { rsvp: v } });
  for (const [t, v] of [[seyi.memberToken, "going"], [amaka.memberToken, "going"], [bayoToken, "maybe"]]) await api("PATCH", `/api/plans/${flyerId}`, { token: t, json: { rsvp: v } });

  // the flyer plan, which Tolu posted (so Tolu is going): the poster and the ride pod
  await tolu.go(`${BASE}${flyerPath}`, 2500);
  await shot(tolu, "11-plan-flyer");
  await tolu.scrollTo(".rides");
  await shot(tolu, "12-plan-flyer-rides");

  // Seyi's view of the hosted plan: a ride from Surulere to Tolu's, guessed from Yaba
  const seyiPage = await chrome.page();
  await seyiPage.go(`${BASE}/c/${slug}?t=${encodeURIComponent(seyi.memberToken)}`, 2500);
  await seyiPage.go(`${BASE}${winePath}`, 2500);
  await shot(seyiPage, "13-plan-hosted");
  await seyiPage.scrollTo(".rides");
  await seyiPage.click("button", "How we guess");
  await sleep(400);
  await seyiPage.scrollTo(".rides");
  await shot(seyiPage, "14-plan-hosted-rides");

  if (linkId) {
    // Tolu taps I'm going on Amaka's link plan: the face swings on, the pod forms, Uber is one tap
    await tolu.go(`${BASE}/c/${slug}/p/${linkId}`, 2500);
    await shot(tolu, "15-plan-link");
    await tolu.click("button", "I'm going");
    await sleep(2500);
    await tolu.scrollTo(".rides");
    await tolu.click("button", "How we guess");
    await sleep(500);
    await tolu.scrollTo(".rides");
    await shot(tolu, "16-plan-going-uber-estimate");
  }

  // ---------------------------------------------------------------- the heartbeat makes the ritual
  const tick = await api("POST", "/api/tick", { token: process.env.TICK_SECRET });
  if (!tick.rituals) console.error("no ritual made:", JSON.stringify(tick));
  await tolu.go(`${BASE}/c/${slug}`, 2500);
  await shot(tolu, "17-crew-home");
  await tolu.run("window.scrollTo(0, 600)");
  await sleep(400);
  await shot(tolu, "18-crew-home-plans");
  const ritualId = /** @type {any} */ ((await api("GET", `/api/crews/${slug}`, { token: toluToken })).plans.find((/** @type {any} */ p) => p.kind === "ritual"))?.id;
  if (ritualId) {
    await tolu.go(`${BASE}/c/${slug}/p/${ritualId}`, 2500);
    await shot(tolu, "19-ritual-rain");
    await tolu.scrollTo(".why", "center");
    await shot(tolu, "20-ritual-why");
  }
  const dark = await chrome.page({ dark: true });
  await dark.go(`${BASE}/c/${slug}?t=${encodeURIComponent(toluToken)}`, 3500);
  await shot(dark, "21-crew-home-dark");
  if (ritualId) {
    await dark.go(`${BASE}/c/${slug}/p/${ritualId}`, 5000);
    await shot(dark, "22-ritual-dark");
  }
  console.log(JSON.stringify({ out: OUT, slug, tick, shots }, null, 1));
} finally {
  await chrome.close();
}
