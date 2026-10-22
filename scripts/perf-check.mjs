// @ts-check
// How long the slow flows take, live: starting a crew (the setup sentence, the confirm, and
// the sloth's first pick reaching the invite screen), and reading a link plan, once on a
// quiet server and once while the ideas card reads a weekly guide in the background.
//
// Run: node scripts/perf-check.mjs [--root <repo copy>] [--port 3200] [--skip crew,quiet]
//        [--link <event url>] [--link-extract <event url>] [--link-venues <event url>]
//   Starts the API in this process on the port (3200 by default, never 3000), with a fresh
//   data folder, the real Gemini API, Photon, Overpass, OSRM and Open-Meteo, and TIMING=1.
//   --root runs another copy of this repo (an older commit) through the same steps, so the
//   numbers before and after a change come from one script.
//   The guide is synthetic (invented events at real Lagos venues, so the venue lookups are
//   real); no curator's feed is fetched. About 8 Gemini calls per run; --skip crew makes the
//   crew from a written draft with no regular day (no setup call, no first pick) and
//   --skip quiet leaves out the quiet link, and --skip ideas the busy ones. The two busy links are different event pages,
//   so neither finds the other's venue in the cache: one is read while Gemma reads the
//   guide, the other right after, while the guide's venues are looked up.
//   Prints a JSON report; tokens are never printed.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const opt = (/** @type {string} */ name, /** @type {string} */ d) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(opt("root", path.join(here, "..")));
const PORT = Number(opt("port", "3200"));
if (PORT === 3000) throw new Error("Port 3000 is Arnold's own server. Use another port.");
const SKIP = opt("skip", "").split(",");
const LINK = opt("link", "https://www.eventbrite.com/e/the-amala-and-palmwine-festival-20-tickets-2002313797469");
const LINK_EXTRACT = opt("link-extract", "https://www.eventbrite.com/e/leadway-lifestyle-fair-tickets-2002921744856");
const LINK_VENUES = opt("link-venues", "https://www.eventbrite.com/e/fabric-painting-class-with-cz-tickets-2001406002229");
const SENTENCE = "the uni guys, every other Saturday, somewhere outside and cheap, around Yaba and Lekki";

const imp = (/** @type {string} */ rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const { loadDotEnv, config } = await imp("src/config.mjs");
const { buildDeps, createApi } = await imp("src/server/server.mjs");
const { createService } = await imp("src/app/service.mjs");
const { createIdeas } = await imp("src/app/ideas.mjs");
const { parseRss } = await imp("src/core/feeds.mjs");

loadDotEnv(path.join(here, "../.env"));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ct-perf-"));
const cfg = config({ ...process.env, PORT: String(PORT), PUBLIC_URL: `http://localhost:${PORT}`, DATA_DIR: dataDir, MONGODB_URI: "", TIMING: "1", OFFLINE: "" });
if (!cfg.gemini.key) throw new Error("GEMINI_API_KEY is not set");

/** @type {{ t: number, event: string, [k: string]: any }[]} */
const logs = [];
const T0 = performance.now();
/** @type {((e: any) => void)[]} */
const watchers = [];
const log = (/** @type {string} */ event, fields = {}) => {
  const e = { t: Math.round(performance.now() - T0), event, ...fields };
  logs.push(e);
  for (const w of watchers) w(e);
};
const when = (/** @type {(e: any) => boolean} */ test) => new Promise((resolve) => watchers.push((e) => test(e) && resolve(e)));

// a synthetic weekend guide: invented events at real Lagos venues (the venue lookups are real)
const VENUES = [
  "Terra Kulture, Victoria Island", "Hard Rock Cafe, Oniru", "Nike Art Gallery, Lekki", "Lekki Conservation Centre, Lekki",
  "New Afrika Shrine, Ikeja", "Eko Hotel, Victoria Island", "Landmark Centre, Oniru", "Ikoyi Club, Ikoyi",
  "Federal Palace Hotel, Victoria Island", "Mike Adenuga Centre, Ikoyi", "National Theatre, Iganmu", "Lagos City Hall, Lagos Island",
  "Jazzhole, Ikoyi", "Kalakuta Museum, Ikeja", "Tarkwa Bay, Lagos", "Johnson Jakande Tinubu Park, Alausa",
  "Bogobiri House, Ikoyi", "Ndubuisi Kanu Park, Ikeja", "Tafawa Balewa Square, Lagos Island", "Lagos Polo Club, Ikoyi",
];
const day = (/** @type {number} */ i) => (i % 2 ? "SUNDAY, OCTOBER 25" : "SATURDAY, OCTOBER 24");
const html = `<p>Twenty things to do this weekend.</p>${VENUES.map((v, i) => `<h2><strong>${day(i)}</strong></h2><h3><strong>Perf Night ${i + 1}</strong></h3><p>An evening of music and food.</p><p>📍 <strong>Where:</strong> ${v}</p><p>🗓 <strong>When:</strong> ${day(i).split(",")[0][0]}${day(i).split(",")[0].slice(1).toLowerCase()}, October ${i % 2 ? 25 : 24} &#8226; ${4 + (i % 4)} PM</p><p>🎟 <strong>Tickets:</strong> &#8358;${(i + 1) * 1000}</p>`).join("")}`;
const rss = `<?xml version="1.0" encoding="UTF-8"?><rss xmlns:content="http://purl.org/rss/1.0/modules/content/" version="2.0"><channel><title>Perf Guide</title><link>https://guide-perf.example.com</link><item><title>Weekend guide: 23 to 25 October 2026</title><description>Synthetic</description><link>https://guide-perf.example.com/p/weekend-${Date.now()}</link><guid>1</guid><pubDate>${new Date().toUTCString()}</pubDate><content:encoded><![CDATA[${html}]]></content:encoded></item></channel></rss>`;
const feeds = { async pull(/** @type {any} */ s) { return s.id === "awe-lagos" ? { items: parseRss(rss), reason: "fetched", checkedAt: new Date().toISOString() } : { items: null, reason: "checked_today", checkedAt: null }; } };

const deps = await buildDeps(cfg, log);
const service = createService({ ...deps, cfg });
const ideas = createIdeas({ store: deps.store, cache: deps.cache, ai: deps.ai, feeds, weather: deps.weather, geocoder: deps.geocoder, candidatesNear: service._internal.candidatesNear, spots: deps.spots, prompts: deps.prompts, now: deps.now, log, timing: true });
const server = createApi({ service, cfg, log, ideas });
await new Promise((r) => server.listen(PORT, "127.0.0.1", () => r(null)));
const BASE = `http://127.0.0.1:${PORT}`;

/** @param {string} method @param {string} p @param {{ token?: string, json?: any }} [o] */
async function call(method, p, o = {}) {
  /** @type {Record<string, string>} */
  const headers = {};
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.json !== undefined) headers["content-type"] = "application/json";
  const t = performance.now();
  const res = await fetch(BASE + p, { method, headers, body: o.json !== undefined ? JSON.stringify(o.json) : undefined });
  const body = await res.json().catch(() => null);
  return { status: res.status, body, ms: Math.round(performance.now() - t) };
}

/** @type {Record<string, any>} */
const report = { root: ROOT === path.resolve(here, "..") ? "this checkout" : ROOT, startedAt: new Date().toISOString() };
try {
  /** @type {string} */
  let slug;
  /** @type {string} */
  let token;
  if (SKIP.includes("crew")) {
    const confirm = { name: "Perf crew", vibe: "outside and cheap", vibeTags: ["outside"], budget: "cheap", rhythm: null, taste: null, areas: [{ label: "Yaba", lat: 6.5068, lon: 3.3755 }, { label: "Lekki Phase 1", lat: 6.4474, lon: 3.4723 }], region: { center: { lat: 6.4771, lon: 3.4239 }, countryCode: "NG", city: "Lagos", timezone: "Africa/Lagos", tzSource: "open-meteo" } };
    const made = await call("POST", "/api/crews", { json: { confirm, organiser: { name: "Tolu", area: { label: "Yaba", lat: 6.5068, lon: 3.3755 } } } });
    if (made.status !== 201) throw new Error(`create: ${made.status} ${JSON.stringify(made.body)}`);
    slug = made.body.crew.slug;
    token = made.body.memberToken;
    report.crew = { skipped: true, createMs: made.ms };
  } else {
  // 1. Start a crew: the sentence, then the confirm (the invite screen shows after this)
  const draft = await call("POST", "/api/crews", { json: { sentence: SENTENCE, hint: { tz: "Africa/Lagos" } } });
  if (draft.status !== 200) throw new Error(`draft: ${draft.status} ${JSON.stringify(draft.body)}`);
  const { confidence, low, notes, ai, pack, taste, ...rest } = draft.body;
  const made = await call("POST", "/api/crews", { json: { confirm: rest.draft, organiser: { name: "Tolu", area: "Yaba" }, hint: { tz: "Africa/Lagos" } } });
  if (made.status !== 201) throw new Error(`create: ${made.status} ${JSON.stringify(made.body)}`);
  slug = made.body.crew.slug;
  token = made.body.memberToken;
  // 2. The first pick, as the invite screen asks for it
  const p0 = performance.now();
  let pick = await call("GET", `/api/crews/${slug}/first-pick?wait=25`, { token });
  let mode = "background job";
  if (pick.status === 404 || pick.status === 405) {
    mode = "made inside the request";
    pick = await call("POST", `/api/crews/${slug}/first-pick`, { token });
  } else {
    while (pick.status === 200 && pick.body?.status === "pending" && performance.now() - p0 < 120_000) pick = await call("GET", `/api/crews/${slug}/first-pick?wait=25`, { token });
  }
  const pickMs = Math.round(performance.now() - p0);
  report.crew = {
    draftMs: draft.ms, createMs: made.ms, toInviteScreenMs: draft.ms + made.ms, firstPickMode: mode, firstPickMs: pickMs, toPickCardMs: draft.ms + made.ms + pickMs,
    pick: pick.body?.plan ? { place: pick.body.plan.place?.name, start: pick.body.plan.start, status: pick.body.plan.status } : { status: pick.status, body: pick.body },
  };

  }

  // 3. A link plan on a quiet server
  if (!SKIP.includes("quiet")) {
    const quiet = await call("POST", `/api/crews/${slug}/plans/parse`, { token, json: { url: LINK } });
    report.linkQuiet = { ms: quiet.ms, status: quiet.status, title: quiet.body?.draft?.title, place: quiet.body?.draft?.place?.name, pinned: quiet.body?.draft?.place?.lat != null };
  }

  // 4. Links while the ideas card reads a weekly guide: one while Gemma reads the guide,
  //    one right after, while its 20 venues are looked up
  if (SKIP.includes("ideas")) throw "done";
  const c0 = performance.now();
  const extracted = when((e) => (e.event === "gemma" || e.event === "gemma_error") && e.task === "extract-events");
  const card = call("GET", `/api/crews/${slug}/ideas?when=weekend`, { token });
  await new Promise((r) => setTimeout(r, 3000));
  const parse = async (/** @type {string} */ url) => {
    const at = Math.round(performance.now() - c0);
    const r = await call("POST", `/api/crews/${slug}/plans/parse`, { token, json: { url } });
    return { ms: r.ms, status: r.status, startedAtMs: at, title: r.body?.draft?.title, place: r.body?.draft?.place?.name, pinned: r.body?.draft?.place?.lat != null };
  };
  report.linkDuringGuideRead = await parse(LINK_EXTRACT);
  await Promise.race([extracted, new Promise((r) => setTimeout(r, 90_000))]);
  report.linkDuringVenueLookups = await parse(LINK_VENUES);
  const cardDone = await card;
  report.ideasCard = { ms: cardDone.ms, status: cardDone.status, ideas: cardDone.body?.ideas?.length ?? null, partial: !!cardDone.body?.partial };
  // the guide's venues, looked up after the card answered (partial cards go on in the background)
  await Promise.race([when((e) => e.event === "timing" && e.flow === "feed_read"), new Promise((r) => setTimeout(r, 30_000))]);
  // a moment for background work to land its timing lines
  await new Promise((r) => setTimeout(r, 1500));
} catch (e) {
  if (e !== "done") report.error = String(/** @type {any} */ (e)?.stack || e).slice(0, 600);
} finally {
  report.gemmaCalls = logs.filter((l) => l.event === "gemma" || l.event === "gemma_error").map((l) => ({ t: l.t, task: l.task, sec: l.sec ?? null, error: l.event === "gemma_error" ? l.message : undefined }));
  report.timings = logs.filter((l) => l.event === "timing").map(({ event, ...rest }) => rest);
  report.lanes = logs.filter((l) => l.event === "lane_wait").map(({ event, ...rest }) => rest).slice(0, 40);
  report.errors = logs.filter((l) => /error/.test(l.event) && l.event !== "gemma_error").map(({ t, event, message }) => ({ t, event, message }));
  console.log(JSON.stringify(report, null, 2));
  server.close();
  await deps.store.close().catch(() => {});
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(0);
}
