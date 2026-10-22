// @ts-check
// Screenshots of the growth features at 390 x 844 (2x) in headless Chrome (scripts/cdp.mjs:
// never the Playwright browser): sloth avatars, renaming the crew with the sloth's name
// ideas and Undo, the "We came through" card and its Status card, "Got another crew?",
// adding your face, a discreet crew, and the WhatsApp preview cards.
//
// It runs its own server in this process on port 3300 (never 3000) with a memory store and
// faked outside services, and real Gemma for the name ideas when GEMINI_API_KEY is set. The
// server's clock starts two days back so a plan can be made "yesterday", then catches up.
//
// Run: npm --prefix web run build && node scripts/screens-growth.mjs [out dir]
//   default out dir: docs/screens/growth

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { config, loadDotEnv } from "../src/config.mjs";
import { createService } from "../src/app/service.mjs";
import { makeIds } from "../src/app/ids.mjs";
import { loadPrompts } from "../src/app/prompts.mjs";
import { fakeAi, fakeGeocoder, fakeOverpass, fakePageMeta, fakePush, fakeWeather } from "../src/adapters/fakes.mjs";
import { createLlm } from "../src/adapters/llm.mjs";
import { memoryStore } from "../src/adapters/store.mjs";
import { createApi } from "../src/server/server.mjs";
import { launch, sleep } from "./cdp.mjs";

loadDotEnv();
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.argv[2] || path.join(here, "../docs/screens/growth"));
const PORT = 3300;
const BASE = `http://localhost:${PORT}`;
const DAY = 86_400_000;
let offset = -2 * DAY;
const now = () => Date.now() + offset;

// ---------------------------------------------------------------- the server
const cfg = config({ ...process.env, PORT: String(PORT), PUBLIC_URL: BASE, WEB_URL: BASE, STATIC_DIR: path.join(here, "../web/dist"), MONGODB_URI: "" });
const store = memoryStore();
const realGemma = !!process.env.GEMINI_API_KEY;
const ai = realGemma ? createLlm(cfg) : fakeAi();
const service = createService({ store, ai, now, geocoder: fakeGeocoder(), places: fakeOverpass([]), weather: fakeWeather({ rain: () => 5 }), pages: fakePageMeta(), push: fakePush({ enabled: false }), spots: [], prompts: loadPrompts(), ids: makeIds(), cfg });
const server = createApi({ service, cfg, now });
await new Promise((r) => server.listen(PORT, () => r(null)));
console.log(`server on ${BASE}, name ideas by ${realGemma ? "Gemma" : "code"}`);

async function api(method, p, { token, json } = /** @type {any} */ ({})) {
  const res = await fetch(BASE + p, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(json ? { "content-type": "application/json" } : {}) }, body: json ? JSON.stringify(json) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

// ---------------------------------------------------------------- pictures to share (no real people)
const { Resvg } = createRequire(import.meta.url)("@resvg/resvg-js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ct-growth-shots-"));
const picture = (/** @type {string} */ name, /** @type {string} */ svg) => {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, new Resvg(svg).render().asPng());
  return file;
};
const scene = (/** @type {string} */ sky, /** @type {string} */ ground, /** @type {string} */ sun) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky}"/><stop offset="1" stop-color="#ffd59a"/></linearGradient></defs><rect width="900" height="1200" fill="url(#g)"/><circle cx="620" cy="520" r="120" fill="${sun}"/><path d="M0 760 C 200 700, 500 820, 900 740 V1200 H0z" fill="${ground}"/><path d="M180 760 q 20 -260 40 -380" stroke="#3a2a1e" stroke-width="18" fill="none"/><path d="M220 390 c -80 -40 -160 -10 -200 40 M220 390 c 60 -70 160 -60 200 -10 M220 390 c -20 -80 -100 -120 -160 -110 M220 390 c 40 -80 120 -110 180 -90" stroke="#1e4a39" stroke-width="26" fill="none" stroke-linecap="round"/><circle cx="430" cy="900" r="46" fill="#7a5b3e"/><rect x="392" y="940" width="76" height="140" rx="30" fill="#a3214f"/><circle cx="560" cy="910" r="44" fill="#4a3626"/><rect x="524" y="950" width="72" height="130" rx="30" fill="#1b6782"/></svg>`;
const photos = [picture("beach.png", scene("#8fd0e6", "#e9d3a0", "#ffc21a")), picture("park.png", scene("#b9dcc4", "#3f8a5c", "#f29d7e")), picture("dusk.png", scene("#c7b8e8", "#1e4a39", "#ffc21a"))];
const face = picture("face.png", `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#9cc58a"/><circle cx="300" cy="330" r="150" fill="#6b4f36"/><path d="M150 330 q 0 -200 150 -200 q 150 0 150 200 q -60 -100 -150 -100 q -90 0 -150 100z" fill="#14302a"/><circle cx="250" cy="330" r="14" fill="#14302a"/><circle cx="350" cy="330" r="14" fill="#14302a"/><path d="M250 400 q 50 40 100 0" stroke="#14302a" stroke-width="12" fill="none" stroke-linecap="round"/><rect x="140" y="500" width="320" height="300" rx="140" fill="#ffc21a"/></svg>`);

// ---------------------------------------------------------------- the crews
const areas = [{ label: "Yaba", lat: 6.5095, lon: 3.3711 }, { label: "Surulere", lat: 6.5005, lon: 3.3539 }, { label: "Lekki Phase 1", lat: 6.4478, lon: 3.4723 }];
const draft = { name: "the uni guys", vibe: "outside and cheap", vibeTags: ["outside", "chill"], budget: "cheap", rhythm: { every: "2w", day: 6, window: { from: "15:00", to: "19:00" } }, areas, taste: { scenes: ["alte"], likes: ["live music", "suya"], placeKinds: ["park", "live music"], eventKeywords: [], avoid: [], needs: [], budget: "cheap", ageBand: null, energy: "chill" } };
const made = await api("POST", "/api/crews", { json: { confirm: draft, organiser: { name: "Tolu Adébáyọ̀", area: "Yaba" } } });
const crew = made.crew;
const tolu = { token: made.memberToken, id: made.member.id };
const people = [tolu];
for (const name of ["Kene", "Zainab Bello", "Seyi", "Ada"]) {
  const j = await api("POST", `/api/crews/${crew.slug}/members`, { token: made.inviteToken, json: { name, area: "Surulere" } });
  people.push({ token: j.memberToken, id: j.member.id });
}
const lagosIso = (/** @type {number} */ ms, /** @type {string} */ hhmm) => `${new Date(ms + 3_600_000).toISOString().slice(0, 10)}T${hhmm}:00+01:00`;
const plan = async (/** @type {string} */ title, /** @type {number} */ dayMs, /** @type {string} */ from, /** @type {string} */ to, /** @type {string} */ place, goers) => {
  const p = await api("POST", `/api/crews/${crew.slug}/plans`, { token: tolu.token, json: { plan: { kind: "found", title, start: lagosIso(dayMs, from), end: lagosIso(dayMs, to), tz: "Africa/Lagos", place: { name: place, address: null, lat: 6.4488, lon: 3.3965, outdoor: false }, price: null, host: null, hostName: null, bring: [], source: {} } } });
  for (const g of goers) await api("PATCH", `/api/plans/${p.plan.id}`, { token: g.token, json: { rsvp: "going" } });
  return p.plan;
};
// yesterday (made while the server's clock is two days back)
const yesterday = Date.now() - DAY;
await plan("Selfie Sunday at Alali VI", yesterday, "16:00", "19:00", "Alali, Victoria Island", people.slice(0, 4));
// and the weekend
const sat = Date.now() + ((6 - new Date(Date.now() + 3_600_000).getUTCDay() + 7) % 7 || 7) * DAY;
await plan("Highlife Under Mangoes", sat, "17:00", "21:00", "The Mango Yard, Surulere", people);
offset = 0;

const quietMade = await api("POST", "/api/crews", { json: { confirm: { ...draft, name: "Our Lot", taste: { ...draft.taste, needs: ["discreet", "safe"] } }, organiser: { name: "Bisi", area: "Yaba" } } });
const quietPeople = [{ token: quietMade.memberToken, id: quietMade.member.id }];
for (const name of ["Funmi", "Dayo"]) {
  const j = await api("POST", `/api/crews/${quietMade.crew.slug}/members`, { token: quietMade.inviteToken, json: { name, area: "Yaba" } });
  quietPeople.push({ token: j.memberToken, id: j.member.id });
}
const quietPlan = await api("POST", `/api/crews/${quietMade.crew.slug}/plans`, { token: quietPeople[0].token, json: { plan: { kind: "hosted", title: "Board games at mine", start: lagosIso(sat, "15:00"), end: lagosIso(sat, "19:00"), tz: "Africa/Lagos", place: { name: null, address: "12 Herbert Macaulay Way", lat: null, lon: null, outdoor: false, private: true }, price: null, host: quietPeople[0].id, hostName: null, bring: [], source: {} } } });
for (const g of quietPeople.slice(1)) await api("PATCH", `/api/plans/${quietPlan.plan.id}`, { token: g.token, json: { rsvp: "going" } });

// ---------------------------------------------------------------- the screens
fs.mkdirSync(OUT, { recursive: true });
/** @type {string[]} */
const shots = [];
const chrome = await launch();
try {
  const shot = async (/** @type {any} */ page, /** @type {string} */ name) => shots.push(path.basename(await page.shot(path.join(OUT, `${name}.png`))));
  const me = await chrome.page();
  await me.go(`${BASE}/c/${crew.slug}?t=${encodeURIComponent(tolu.token)}`, 2500);
  await me.waitFor(".status-prompt");
  await shot(me, "01-crew-home-came-through");

  // rename in place, the sloth's ideas, and Undo
  await me.click(".crew-name-btn");
  await sleep(500);
  await shot(me, "02-rename-inline");
  await me.click(".sloth-chip");
  await me.waitFor(".name-idea", { timeoutMs: 40_000 });
  await sleep(300);
  await shot(me, "03-rename-sloth-names");
  await me.run(`(() => { const b = document.querySelector('.name-idea'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); b.click(); })()`);
  await me.waitFor(".toast-action");
  await sleep(300);
  await shot(me, "04-renamed-undo");
  await sleep(5200);

  // the Status card: the sheet, three photos, the card made on the phone
  await me.click(".status-prompt .btn", "Make the card");
  await me.waitFor(".status-sheet");
  await sleep(400);
  await shot(me, "05-status-sheet");
  const { root } = await me.send("DOM.getDocument", {});
  const { nodeId } = await me.send("DOM.querySelector", { nodeId: root.nodeId, selector: ".status-sheet input[type=file]" });
  await me.send("DOM.setFileInputFiles", { nodeId, files: photos });
  await me.waitFor(".status-preview", { timeoutMs: 40_000 });
  await sleep(800);
  await shot(me, "06-status-card-ready");
  const card = await me.run(`fetch(document.querySelector('.status-preview').src).then((r) => r.blob()).then((b) => new Promise((ok) => { const f = new FileReader(); f.onload = () => ok(f.result); f.readAsDataURL(b); }))`);
  fs.writeFileSync(path.join(OUT, "07-status-card-1080x1920.jpg"), Buffer.from(String(card).split(",")[1], "base64"));
  shots.push("07-status-card-1080x1920.jpg");
  await me.click(".status-sheet .btn", "Not now");
  await me.click(".status-prompt .once-x");
  // one card a visit: "Got another crew?" waits for the next time the page opens
  await me.go(`${BASE}/c/${crew.slug}?t=${encodeURIComponent(tolu.token)}`, 2500);
  await me.waitFor(".another-crew");
  await shot(me, "08-got-another-crew");

  // your face, for the crew only
  await me.run("document.querySelector('.you-here').open = true");
  await me.scrollTo(".you-here", "center");
  await shot(me, "09-you-in-this-crew");
  const doc = await me.send("DOM.getDocument", {});
  const input = await me.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: ".you-here input[capture]" });
  await me.send("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [face] });
  await me.waitFor(".you-here img", { timeoutMs: 20_000 });
  await sleep(800);
  await me.scrollTo(".you-here", "center");
  await shot(me, "10-face-added");

  // the branch on a plan: sloths, and your photo
  const next = (await api("GET", `/api/crews/${crew.slug}`, { token: tolu.token })).plans.find((/** @type {any} */ p) => p.title.startsWith("Highlife"));
  await me.go(`${BASE}/c/${crew.slug}/p/${next.id}`, 2500);
  await me.scrollTo(".branch, .who, h2", "start");
  await shot(me, "11-plan-branch-sloths");

  // a discreet crew: no Status prompt; the opt-in sits under "You in this crew"
  const q = await chrome.page();
  await q.go(`${BASE}/c/${quietMade.crew.slug}?t=${encodeURIComponent(quietPeople[0].token)}`, 2500);
  await q.run("document.querySelector('.you-here').open = true");
  await q.scrollTo(".you-here", "center");
  await shot(q, "12-discreet-opt-in");

  // the preview cards WhatsApp shows
  for (const [name, link] of [["13-og-plan", `/c/${crew.slug}/p/${next.id}/in?t=${encodeURIComponent(made.inviteToken)}`], ["14-og-invite", `/c/${crew.slug}?t=${encodeURIComponent(made.inviteToken)}`], ["15-og-discreet", `/c/${quietMade.crew.slug}/p/${quietPlan.plan.id}/in?t=${encodeURIComponent(quietMade.inviteToken)}`]]) {
    const html = await (await fetch(BASE + link, { headers: { "user-agent": "WhatsApp/2.24.20.80 A" } })).text();
    const img = /og:image" content="([^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, "&");
    const png = Buffer.from(await (await fetch(String(img))).arrayBuffer());
    fs.writeFileSync(path.join(OUT, `${name}.png`), png);
    shots.push(`${name}.png`);
    console.log(name, /og:title" content="([^"]+)"/.exec(html)?.[1], `${Math.round(png.length / 1024)} KB`);
  }
} finally {
  await chrome.close();
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(shots.join("\n"));
process.exit(0);
