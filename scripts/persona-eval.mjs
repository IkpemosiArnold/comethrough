// @ts-check
// The persona eval: does describing the crew change what the sloth suggests, and is what it
// suggests right for that crew? Six Lagos crews and one Berlin control, the same areas
// (Yaba and Lekki Phase 1) and the same dates, each through the real flow: crew setup
// (Gemma reads the sentence), the sloth's first ritual pick (places, weather, roads, Gemma's
// explanation and invite), and "The sloth has 3 ideas" for the weekend (the Lagos guides'
// events, places, Gemma's ranking). Writes docs/PERSONA-EVAL.md.
//
// Respecting the services: every HTTP answer (Photon, Nominatim, Overpass, OSRM, Open-Meteo,
// the guides' RSS) is cached on disk under .data/persona-eval/cache, so a second run asks
// nobody again; the adapters keep their own pacing (OSRM one a second, Overpass one query at a
// time). Gemma: at most MAX_CALLS live calls, 4.5 s apart; answers are cached under a hash of
// the request (never the request's words), with every string scrubbed of sensitive words.
//
// Run: node scripts/persona-eval.mjs          (needs GEMINI_API_KEY in .env)
//      FRESH=1 node scripts/persona-eval.mjs  (forget cached Gemma answers; map data stays)

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config, loadDotEnv } from "../src/config.mjs";
import { createIdeas } from "../src/app/ideas.mjs";
import { createService } from "../src/app/service.mjs";
import { makeIds } from "../src/app/ids.mjs";
import { loadPrompts } from "../src/app/prompts.mjs";
import { createFeeds } from "../src/adapters/feeds.mjs";
import { fakePageMeta, fakePush } from "../src/adapters/fakes.mjs";
import { createGeocoder } from "../src/adapters/geocode.mjs";
import { layeredCache, memoryCache, storeCache } from "../src/adapters/http.mjs";
import { createLlm, describeLlm } from "../src/adapters/llm.mjs";
import { createOpenMeteo } from "../src/adapters/openmeteo.mjs";
import { createOsrm } from "../src/adapters/osrm.mjs";
import { createOverpass } from "../src/adapters/overpass.mjs";
import { createWikidata } from "../src/adapters/wikidata.mjs";
import { fileStore } from "../src/adapters/store.mjs";
import { withEntries } from "../src/core/places.mjs";
import { centroid } from "../src/core/geo.mjs";
import { PLACE_KINDS, kindOfTags, osmTagsFor, priceAmount, scrubDeep } from "../src/core/taste.mjs";
import { LAGOS, LAGOS_REGION } from "../src/packs/index.mjs";

loadDotEnv();
const cfg = config();
const MAX_CALLS = Number(process.env.MAX_CALLS || 75);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
// PERSONA_EVAL_DIR keeps the eval's stores and caches somewhere a cleanup of .data cannot reach
const dataDir = path.resolve(process.env.PERSONA_EVAL_DIR || path.join(root, ".data/persona-eval"));
for (const d of ["app", "before"]) fs.rmSync(path.join(dataDir, d), { recursive: true, force: true });
if (process.env.FRESH) fs.rmSync(path.join(dataDir, "llm"), { recursive: true, force: true });

/** The crews. Same areas and rhythm; only who they are differs. Sentences as people type them. */
const PERSONAS = [
  { id: "alte", label: "Alte men, late 20s", sentence: "The guys, alte, mostly male, mid to late 20s, every other Saturday, around Yaba and Lekki", tz: "Africa/Lagos", organiser: "Yaba" },
  { id: "queer", label: "Queer women's crew", sentence: "Our girls, queer and mostly female, late 20s, every other Saturday, around Yaba and Lekki", tz: "Africa/Lagos", organiser: "Yaba" },
  { id: "church", label: "Church youth group", sentence: "Church youth group, every other Saturday, around Yaba and Lekki", tz: "Africa/Lagos", organiser: "Yaba" },
  { id: "students", label: "Broke university students", sentence: "Broke university students, every other Saturday, around Yaba and Lekki", tz: "Africa/Lagos", organiser: "Yaba" },
  { id: "parents", label: "Parents with young kids", sentence: "Parents with young kids, every other Saturday, around Yaba and Lekki", tz: "Africa/Lagos", organiser: "Yaba" },
  { id: "corporate", label: "Corporate, 30s", sentence: "Work friends, corporate, early 30s, every other Saturday, around Yaba and Lekki", tz: "Africa/Lagos", organiser: "Yaba" },
  { id: "berlin", label: "Berlin control (no taste said)", sentence: "The Kreuzberg lot, every other Saturday, around Kreuzberg and Friedrichshain", tz: "Europe/Berlin", organiser: "Kreuzberg" },
];
/** Words that would say who a crew is; none may appear in what is stored or sent for these crews. */
const LABELS = { queer: /queer|lesbian|\bgay\b|lgbt|sapphic|bisexual/i, church: /church|christian|pentecostal/i };

// ---------------------------------------------------------------- ports

const httpStore = await fileStore(path.join(dataDir, "cache"));
const cache = layeredCache(memoryCache({ max: 20000 }), storeCache(httpStore));
const llmStore = await fileStore(path.join(dataDir, "llm"));
const appStore = await fileStore(path.join(dataDir, "app"));
const live = createLlm(cfg);
let calls = 0;
let cachedCalls = 0;
let last = 0;
/** Gemma, paced and capped, its answers cached by a hash of the request and scrubbed. */
const ai = {
  ...live,
  available: live.available,
  async generate(/** @type {any} */ req) {
    const key = crypto.createHash("sha256").update(JSON.stringify([req.task, req.messages, req.schema ?? null])).digest("hex");
    const hit = await llmStore.get("llm", key);
    if (hit) {
      cachedCalls++;
      return { data: hit.data, text: "", model: hit.model, wallSec: 0, jsonMode: true };
    }
    if (calls >= MAX_CALLS) throw Object.assign(new Error("eval call budget spent"), { status: 0, hint: "Over the eval's Gemma budget." });
    const wait = last + 4500 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    calls++;
    const r = await live.generate(req);
    // what is kept: the parsed answer, no raw text; a crew reading (the only task that sees
    // the setup sentence) with every sensitive word scrubbed. Other answers are kept as they
    // are: scrubbing them would mangle place names ("John Randle Centre for Yoruba Culture").
    const keep = req.task === "parse-crew" ? scrubDeep(r.data) : r.data;
    await llmStore.put("llm", { id: key, task: req.task, model: r.model, data: keep });
    return { ...r, data: keep };
  },
};
const geocoder = createGeocoder({ ...cfg.geocoder, contact: cfg.contact, cache });
const weather = createOpenMeteo({ url: cfg.openMeteoUrl, cache });
const places = createOverpass({ urls: cfg.overpassUrls, contact: cfg.contact, cache });
const routes = cfg.osrmUrl ? createOsrm({ url: cfg.osrmUrl, contact: cfg.contact, cache }) : null;
const wikidata = cfg.wikidataUrl ? createWikidata({ url: cfg.wikidataUrl, contact: cfg.contact, cache }) : null;
const fees = JSON.parse(fs.readFileSync(path.join(root, "data/spot-entry-fees.json"), "utf8")).fees;
const spots = withEntries(JSON.parse(fs.readFileSync(path.join(root, "data/lagos-spots.json"), "utf8")).spots, fees);
const prompts = loadPrompts();
const now = Date.now;
/** @type {any[]} */
const logs = [];
const log = (/** @type {string} */ e, /** @type {any} */ f = {}) => logs.push({ e, ...f });
const push = fakePush();
const common = { geocoder, places, weather, routes, wikidata, pages: fakePageMeta(), spots, prompts, ids: makeIds(), now, cfg: { publicUrl: "https://eval.test", webUrl: "https://eval.test", uidDomain: "eval.test" }, log };
const service = createService({ store: appStore, ai, push, ...common });
// the same crews with the taste ignored: the "before" pick, made by code alone
const beforeStore = await fileStore(path.join(dataDir, "before"));
const before = createService({ store: beforeStore, ai: { available: false, model: "none", async generate() { throw new Error("off"); } }, push: fakePush({ enabled: false }), ...common });
const ideas = createIdeas({ store: appStore, cache, ai, feeds: createFeeds({ cache, contact: cfg.contact }), weather, geocoder, candidatesNear: service._internal.candidatesNear, spots, prompts, now, log, refreshBudgetMs: 600_000 });

// ---------------------------------------------------------------- run

console.error(`LLM: ${describeLlm(cfg)}; reading the Lagos guides first (cached daily)`);
await ideas.refreshAll([{ pack: LAGOS, region: LAGOS_REGION }]);

/** @type {any[]} */
const results = [];
for (const p of PERSONAS) {
  console.error(`${p.id}: setup`);
  const r = /** @type {any} */ ({ persona: p });
  const draft = await service.draftCrew({ sentence: p.sentence, hint: { tz: p.tz } });
  r.draft = { name: draft.draft.name, vibe: draft.draft.vibe, budget: draft.draft.budget, rhythm: draft.draft.rhythm, areas: draft.draft.areas.map((/** @type {any} */ a) => a.label), taste: draft.draft.taste, summary: draft.taste.summary, chips: draft.taste.chips.map((/** @type {any} */ c) => c.label), notes: draft.notes, ai: draft.ai };
  const confirm = { ...draft.draft, name: draft.draft.name || `Eval crew ${PERSONAS.indexOf(p) + 1}` };
  if (!confirm.rhythm) confirm.rhythm = { every: "2w", day: 6, window: { from: "15:00", to: "19:00" } };
  const made = /** @type {any} */ (await service.createCrew({ confirm, hint: { tz: p.tz }, organiser: { name: "Organiser", area: p.organiser } }));
  r.crew = made.crew;
  // the public Overpass servers are often at capacity: try the taste's query up to twice
  // here, one after the other, so the ritual below finds it in the cache (a failure is
  // not cached, and the app then goes on with green places and the curated spots)
  const stored = /** @type {any} */ (await appStore.findOne("crews", { slug: made.crew.slug }));
  const kinds = (stored.taste?.placeKinds || []).filter((/** @type {string} */ k) => !["park", "garden", "beach"].includes(k));
  const center = centroid(stored.areas.filter((/** @type {any} */ a) => Number.isFinite(a.lat)));
  r.tastePlaces = null;
  for (let i = 0; kinds.length && center && i < 2 && r.tastePlaces == null; i++) {
    try {
      r.tastePlaces = (await places.kindsNear(center, 6000, osmTagsFor(kinds))).length;
    } catch (e) {
      log("eval_overpass_retry", { message: String(/** @type {any} */ (e).message).slice(0, 100) });
    }
  }
  console.error(`${p.id}: ritual`);
  const pick = await service.firstPick({ slug: made.crew.slug, token: made.memberToken });
  r.ritual = pick.plan ? { title: pick.plan.title, place: pick.plan.place.name, kind: kindName(pick.plan.place.osm?.tags), outdoor: pick.plan.place.outdoor, start: pick.plan.start, rain: pick.plan.rainPlan?.kind ?? null, status: pick.plan.status, why: pick.plan.why, invite: pick.plan.invite, tags: pick.plan.place.osm?.tags ?? null } : { reason: pick.reason };
  // the before pick: the same crew with no taste
  const b = /** @type {any} */ (await before.createCrew({ confirm: { ...confirm, taste: null }, hint: { tz: p.tz }, organiser: { name: "Organiser", area: p.organiser } }));
  const bp = await before.firstPick({ slug: b.crew.slug, token: b.memberToken });
  r.before = bp.plan ? { place: bp.plan.place.name, kind: kindName(bp.plan.place.osm?.tags), rain: bp.plan.rainPlan?.kind ?? null } : { reason: bp.reason };
  console.error(`${p.id}: ideas`);
  const card = /** @type {any} */ (await ideas.getIdeas({ slug: made.crew.slug, token: made.memberToken, when: "weekend" }));
  r.ideas = { by: card.by, notes: card.notes, list: card.ideas.map((/** @type {any} */ i) => ({ kind: i.kind, title: i.title, when: i.when, place: i.place.name, price: i.price?.text ?? null, why: i.why, by: i.by, source: i.source?.name ?? null, longest: i.travel?.longestMinutes ?? null })) };
  r.card = card;
  const me = /** @type {any} */ (await appStore.findOne("members", { token: made.memberToken }));
  r.ics = await service.feed({ calToken: me.calToken });
  r.storedCrew = await appStore.findOne("crews", { slug: made.crew.slug });
  results.push(r);
}

function kindName(/** @type {any} */ tags) {
  if (!tags) return null;
  return kindOfTags(tags) ?? (tags.leisure || tags.natural || tags.amenity || tags.tourism || null);
}

// ---------------------------------------------------------------- checks

const NIGHT = /\b(wine|beer|cocktails?|bar|bars|pub|club|clubs|nightclub|rave|party|parties|drinks?|lounge|shisha|hookah|tequila|gin|whisk(?:e)?y|brewery|after ?party)\b/i;
const by = (/** @type {string} */ id) => results.find((r) => r.persona.id === id);
const itemsOf = (/** @type {any} */ r) => [r.ritual?.place, ...r.ideas.list.map((/** @type {any} */ i) => i.title)].filter(Boolean);
/** @type {{ name: string, pass: boolean, detail: string }[]} */
const checks = [];

// distinctness: share of suggestions two crews have in common (Jaccard), Lagos crews only
const lagos = results.filter((r) => r.persona.id !== "berlin");
/** @type {string[]} */
const overlaps = [];
let worst = 0;
for (let i = 0; i < lagos.length; i++) {
  for (let j = i + 1; j < lagos.length; j++) {
    const a = new Set(itemsOf(lagos[i]));
    const b = new Set(itemsOf(lagos[j]));
    const inter = [...a].filter((x) => b.has(x)).length;
    const jac = inter / new Set([...a, ...b]).size;
    worst = Math.max(worst, jac);
    if (jac >= 0.5) overlaps.push(`${lagos[i].persona.id} and ${lagos[j].persona.id} share ${inter} of their suggestions`);
  }
}
const ritualPlaces = new Set(lagos.map((r) => r.ritual?.place));
checks.push({ name: "Distinct suggestions between the Lagos crews (no pair shares half or more)", pass: overlaps.length === 0, detail: overlaps.length ? overlaps.join("; ") : `highest overlap ${Math.round(worst * 100)}%` });
checks.push({ name: "Distinct ritual picks", pass: ritualPlaces.size >= Math.ceil(lagos.length / 2), detail: `${ritualPlaces.size} different places for ${lagos.length} Lagos crews` });
const changed = lagos.filter((r) => r.before?.place && r.ritual?.place && r.before.place !== r.ritual.place);
checks.push({ name: "Taste changes the ritual pick (compared with the same crew, taste ignored)", pass: changed.length > 0, detail: `${changed.length} of ${lagos.length}: ${changed.map((r) => `${r.persona.id} (${r.before.place} to ${r.ritual.place})`).join(", ") || "none"}` });

for (const id of ["parents", "church"]) {
  const r = by(id);
  const k = r.ritual?.tags ? PLACE_KINDS[/** @type {string} */ (kindOfTags(r.ritual.tags))] : null;
  const bad = [
    ...(k?.alcohol || k?.nightlife ? [`ritual at ${r.ritual.place} (${kindOfTags(r.ritual.tags)})`] : []),
    ...r.ideas.list.filter((/** @type {any} */ i) => NIGHT.test(`${i.title} ${i.place || ""}`) || (i.when && /(\b9|10|11) pm|midnight/.test(i.when))).map((/** @type {any} */ i) => `idea "${i.title}"`),
  ];
  checks.push({ name: `No nightlife or alcohol for ${r.persona.label.toLowerCase()}`, pass: bad.length === 0, detail: bad.join("; ") || "none found in the ritual or the 3 ideas" });
}

{
  const r = by("queer");
  const where = [];
  const scan = (/** @type {string} */ what, /** @type {any} */ v) => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    if (LABELS.queer.test(s)) where.push(what);
    if (s && s.includes(r.persona.sentence)) where.push(`${what} (raw sentence)`);
  };
  scan("stored crew", r.storedCrew);
  scan("setup draft", r.draft);
  scan("ritual plan", r.ritual);
  scan("ideas card", r.card);
  scan("calendar feed", r.ics);
  scan("push payloads", push.sent);
  scan("logs", logs);
  for (const dir of ["app", "before", "cache", "llm"]) {
    const files = fs.readdirSync(path.join(dataDir, dir), { recursive: true }).map(String).filter((f) => f.endsWith(".json"));
    for (const f of files) scan(`${dir}/${f}`, fs.readFileSync(path.join(dataDir, dir, f), "utf8"));
  }
  const needsOk = ["safe", "discreet"].every((n) => r.storedCrew?.taste?.needs?.includes(n));
  checks.push({ name: "Queer crew: no identity label or raw sentence anywhere (stored crew, draft, ritual, ideas card, calendar, push, logs, every file in the stores, the map cache and the Gemma cache)", pass: where.length === 0, detail: where.length ? `found in: ${where.join(", ")}` : `clean; stored needs: ${r.storedCrew?.taste?.needs?.join(", ")}` });
  checks.push({ name: "Queer crew: the needs were kept (safe, discreet)", pass: needsOk, detail: (r.storedCrew?.taste?.needs || []).join(", ") });
  const outward = [r.ritual?.invite, r.ics, JSON.stringify(push.sent)].join("\n");
  checks.push({ name: "Queer crew: no taste or needs in the invite, the calendar or push", pass: !/discreet|low-key|women-friendly|inclusive|\bsafe\b/i.test(outward), detail: "checked the ritual invite, the .ics feed and every push payload" });
}
{
  const r = by("students");
  const over = r.ideas.list.filter((/** @type {any} */ i) => { const a = priceAmount(i.price ? { text: i.price, free: /free/i.test(i.price) } : null); return a != null && a > (LAGOS.cheapMax ?? Infinity); });
  const fee = r.ritual?.tags?.fee;
  checks.push({ name: `Budget respected for students (no idea over ₦${(LAGOS.cheapMax ?? 0).toLocaleString("en")}; budget read as "${r.storedCrew?.budget}")`, pass: over.length === 0 && r.storedCrew?.budget !== "any", detail: over.length ? over.map((/** @type {any} */ i) => `${i.title} (${i.price})`).join("; ") : `ideas' prices: ${r.ideas.list.map((/** @type {any} */ i) => i.price ?? "none stated").join(", ")}; ritual entry fee tag: ${fee ?? "none"}` });
}
{
  const r = by("berlin");
  const t = r.storedCrew?.taste;
  const empty = t && !t.scenes.length && !t.placeKinds.length && !t.needs.length;
  checks.push({ name: "Berlin control: no taste invented from a sentence that says none, and no Lagos guides", pass: !!empty && r.ideas.list.every((/** @type {any} */ i) => !i.source), detail: `taste: ${JSON.stringify(t)}` });
}

{
  // how often Gemma slipped into another script inside a taste list (the filter in cleanTaste drops these)
  const readings = (await llmStore.find("llm", {})).filter((/** @type {any} */ x) => x.task === "parse-crew");
  const items = readings.flatMap((/** @type {any} */ x) => ["scenes", "likes", "eventKeywords", "avoid"].flatMap((k) => (Array.isArray(x.data?.taste?.[k]) ? x.data.taste[k] : [])));
  const slips = items.filter((/** @type {any} */ w) => typeof w === "string" && /[^\p{Script=Latin}\p{N}\p{P}\p{Zs}+&']/u.test(w));
  checks.push({ name: "Script slips: taste words in another script, dropped by the reader", pass: true, detail: `${slips.length} of ${items.length} words in ${readings.length} crew readings (all runs of this eval)${slips.length ? `: ${slips.join(", ")}` : ""}` });
}

// ---------------------------------------------------------------- the report

const esc = (/** @type {any} */ s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const date = new Date().toISOString().slice(0, 10);
const lines = [];
lines.push("# Persona eval: does describing the crew change what the sloth suggests?", "");
lines.push(`Run ${date} with ${describeLlm(cfg)}: ${calls} live Gemma calls and ${cachedCalls} answered from the eval's cache (budget ${MAX_CALLS}). Map data, routes, weather and the guides' RSS came through the app's own adapters with their pacing, cached on disk under \`.data/persona-eval/cache\` so a rerun asks nobody again. Reproduce with \`node scripts/persona-eval.mjs\`.`, "");
lines.push("Every crew: same rhythm (every other Saturday), same areas (Yaba and Lekki Phase 1; Berlin: Kreuzberg and Friedrichshain), the same day of asking, the organiser in the first area. Each went through crew setup (Gemma reads only the sentence below), the sloth's first ritual pick (Saturday) and the weekend's 3 ideas. \"Before\" is the same crew's ritual pick with its taste ignored (code only), to show what the taste changed.", "");
lines.push("## What the sloth understood", "");
lines.push("| Crew | Sentence | Stored taste (summary; chips) | Place kinds | Budget | Taste places found on the map |", "|---|---|---|---|---|---|");
for (const r of results) lines.push(`| ${esc(r.persona.label)} | ${esc(r.persona.sentence)} | ${esc(r.draft.summary ?? "(nothing)")} ${esc(r.draft.chips.join(", "))} | ${esc(r.storedCrew?.taste?.placeKinds?.join(", ") || "none")} | ${esc(r.storedCrew?.budget)} | ${r.tastePlaces == null ? "none asked, or Overpass did not answer" : r.tastePlaces} |`);
lines.push("", "## Side by side: the ritual and the 3 ideas", "");
lines.push("| Crew | Ritual pick (before, with no taste) | Why (as the crew sees it) | Idea 1 | Idea 2 | Idea 3 | Fit 1 to 5 (Arnold) |", "|---|---|---|---|---|---|---|");
for (const r of results) {
  const rain = (/** @type {any} */ k) => (k ? `, rain plan: ${k}` : "");
  const rit = r.ritual?.place ? `**${esc(r.ritual.place)}** (${esc(r.ritual.kind ?? "place")}${r.ritual.outdoor ? ", outdoors" : ""}${rain(r.ritual.rain)}); before: ${esc(r.before?.place ?? r.before?.reason)}${rain(r.before?.rain)}` : `none (${esc(r.ritual?.reason)})`;
  const idea = (/** @type {any} */ i) => (i ? `**${esc(i.title)}** (${esc(i.kind)}${i.price ? `, ${esc(i.price)}` : ""}${i.source ? `, ${esc(i.source)}` : ""}): ${esc(i.why)} _[${i.by}]_` : "");
  lines.push(`| ${esc(r.persona.label)} | ${rit} | ${esc(r.ritual?.why)} | ${idea(r.ideas.list[0])} | ${idea(r.ideas.list[1])} | ${idea(r.ideas.list[2])} |  |`);
}
lines.push("", "_[gemma]_ means Gemma's reason passed the checks (its numbers are in the facts, it names the idea, it names nobody's identity and calls no venue \"friendly\"); _[code]_ means the code's own sentence was used.", "");
lines.push("## Invites (these travel: calendar, push, the plain page)", "");
for (const r of results) lines.push(`- **${esc(r.persona.label)}:** ${esc(r.ritual?.invite ?? "none")}`);
lines.push("", "## Automatic checks", "");
lines.push("| Check | Result | Detail |", "|---|---|---|");
for (const c of checks) lines.push(`| ${esc(c.name)} | ${c.pass ? "pass" : "**FAIL**"} | ${esc(c.detail)} |`);
lines.push("", "## Notes from the run", "");
for (const r of results) {
  const n = [...(r.draft.notes || []), ...(r.ideas.notes || [])];
  if (n.length) lines.push(`- **${esc(r.persona.label)}:** ${esc(n.join(" "))}`);
}
lines.push("", "<!-- honest-read: the analysis is written by hand after each run -->", "");
fs.writeFileSync(path.join(root, "docs/PERSONA-EVAL.md"), lines.join("\n"));
fs.writeFileSync(path.join(dataDir, "results.json"), JSON.stringify({ results: results.map(({ card, ics, ...r }) => r), errors: logs.filter((l) => /error|retry/.test(l.e)), calls, cachedCalls }, null, 1));
console.error(`done: ${calls} live Gemma calls, ${cachedCalls} cached; ${checks.filter((c) => !c.pass).length} checks failed`);
for (const c of checks) console.error(`${c.pass ? "PASS" : "FAIL"} ${c.name}: ${c.detail}`);
