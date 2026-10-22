// @ts-check
// Persona eval v2: every crew in a frozen set goes through the app's real flow (crew setup,
// the sloth's first ritual pick, the weekend's 3 ideas, the calendar feed, push, the plain
// pages a link preview reads) against a frozen world (eval/world.mjs), and is judged by
// eval/metrics.mjs. Imports the app's modules; edits none of them.
//
//   node eval/run.mjs --set dev --record             record what dev asks of the world (writes no results)
//   node eval/run.mjs --set test --record --blind    record test's world; Gemma reads the sentence only; no results
//   node eval/run.mjs --set dev --replay             the dev run: results in eval/results/v2-dev.md
//   node eval/run.mjs --set test --replay --scored   the one scored test run, after the freeze
//
// Options: --fast (replay without the recorded latencies), --only id,id (debugging; the
// shared caches then differ from a full run, so a replay may miss), --rerun-reason "..."
// (a second scored test run, said at the top of the report).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, loadDotEnv } from "../src/config.mjs";
import { createIdeas } from "../src/app/ideas.mjs";
import { createService } from "../src/app/service.mjs";
import { loadPrompts } from "../src/app/prompts.mjs";
import { createFeeds } from "../src/adapters/feeds.mjs";
import { fakePageMeta, fakePush } from "../src/adapters/fakes.mjs";
import { createGeocoder } from "../src/adapters/geocode.mjs";
import { createLlm, describeLlm } from "../src/adapters/llm.mjs";
import { createOpenMeteo } from "../src/adapters/openmeteo.mjs";
import { createOsrm } from "../src/adapters/osrm.mjs";
import { createOverpass } from "../src/adapters/overpass.mjs";
import { createWikidata } from "../src/adapters/wikidata.mjs";
import { fileStore } from "../src/adapters/store.mjs";
import { withEntries } from "../src/core/places.mjs";
import { tripsTo } from "../src/core/ideas.mjs";
import { LAGOS, LAGOS_REGION, packFor, regionOf } from "../src/packs/index.mjs";
import { basicHandler } from "../src/server/basic.mjs";
import { createLlmCache, createWorld } from "./world.mjs";
import { kindOf } from "./metrics.mjs";
import { writeReports } from "./report.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVAL = path.join(ROOT, "eval");
const PERSONAS = path.join(EVAL, "personas/v2.json");
const WORLD = path.join(EVAL, "world/2026-10-24");
const RESULTS = path.join(EVAL, "results");
/**
 * Scored test runs are labelled: "baseline" (the first, the reported numbers before the
 * crew-parsing fixes) and "after-fix" (one more, after they land). Each label is scored once;
 * neither overwrites the other's results, sheet or marker.
 */
const SCORED_LABELS = ["baseline", "after-fix"];
const labelArg = () => {
  const i = process.argv.indexOf("--label");
  return i >= 0 ? process.argv[i + 1] : null;
};
const label = labelArg();
const TEST_MARKER = path.join(RESULTS, `.v2-test-scored${label && label !== "baseline" ? `-${label}` : ""}.json`);
/** Live Gemma calls across both sets: 250, raised to at most 370 for the dev after-run on 22 Oct (approved; Gemma on the Gemini API is free). */
const LLM_CAP_DEFAULT = 250;
const BIG = 600_000;

// ---------------------------------------------------------------- arguments and guards

const argv = process.argv.slice(2);
const flag = (/** @type {string} */ f) => argv.includes(f);
const opt = (/** @type {string} */ f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : null;
};
const set = opt("--set");
const mode = flag("--record") ? "record" : flag("--replay") ? "replay" : null;
const blind = flag("--blind");
const fast = flag("--fast");
const only = opt("--only")?.split(",") ?? null;
const die = (/** @type {string} */ m) => {
  console.error(m);
  process.exit(2);
};
if (set !== "dev" && set !== "test") die("Say --set dev or --set test.");
if (!mode) die("Say --record or --replay.");
if (blind && mode !== "record") die("--blind is a recording pass.");

const raw = fs.readFileSync(PERSONAS, "utf8");
const sha = crypto.createHash("sha256").update(raw).digest("hex");
const frozen = /`([0-9a-f]{64})`/.exec(fs.readFileSync(path.join(EVAL, "personas/FROZEN.md"), "utf8"))?.[1];
if (sha !== frozen) die(`eval/personas/v2.json (${sha.slice(0, 12)}) does not match the hash in FROZEN.md (${String(frozen).slice(0, 12)}). The sets are frozen.`);
const file = JSON.parse(raw);
let personas = file.personas.filter((/** @type {any} */ p) => p.split === set);
if (only) personas = personas.filter((/** @type {any} */ p) => only.includes(p.id));
const scoredTest = set === "test" && mode === "replay";
if (scoredTest) {
  if (!flag("--scored")) die("The test set is scored once, after the freeze: add --scored when that is what this is.");
  if (only) die("The scored test run takes the whole set.");
  if (!label || !SCORED_LABELS.includes(label)) die(`Label the scored test run: --label ${SCORED_LABELS.join(" or --label ")}.`);
  if (label === "after-fix" && !fs.existsSync(path.join(RESULTS, ".v2-test-scored.json"))) die("The after-fix run compares with the baseline: score --label baseline first.");
  if (fs.existsSync(TEST_MARKER) && !opt("--rerun-reason")) die(`The test set was already scored (${fs.readFileSync(TEST_MARKER, "utf8").trim()}). A second scored run needs --rerun-reason "...", which goes at the top of the report.`);
}
const writesResults = mode === "replay";
const LLM_CAP = Math.min(370, Number(opt("--llm-cap") || LLM_CAP_DEFAULT));

// ---------------------------------------------------------------- the clock, the world, the ports

loadDotEnv(path.join(ROOT, ".env"));
// Photon refused every connection from the recording machine on 22 Oct 2026 (ECONNREFUSED on
// 443 and 80), so the world is recorded with the app's own Nominatim provider (GEOCODER is a
// setting the app supports). EVAL_GEOCODER=photon records with Photon instead.
process.env.GEOCODER = process.env.EVAL_GEOCODER || "nominatim";
const cfg = config();
const NOW = Date.parse(file.target.now);
const now = () => NOW;
const runId = `${set}-${mode}${blind ? "-blind" : ""}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const runDir = path.join(EVAL, ".runs", runId);
fs.mkdirSync(runDir, { recursive: true });

/** @type {any[]} */
const logs = [];
let current = /** @type {string|null} */ (null);
const log = (/** @type {string} */ e, /** @type {any} */ f = {}) => logs.push({ persona: current, e, ...f });

// the fixes of 22 Oct changed some requests; what they asked for was appended after this time
const EXTENDED_SINCE = "2026-10-22T16:40:00Z";
const world = createWorld({ dir: WORLD, mode, latency: mode === "replay" && !fast, llmLive: mode === "record", extendedSince: EXTENDED_SINCE, log });
world.install();
const prompts = loadPrompts();
const llm = createLlmCache({
  dir: WORLD, mode, live: createLlm(cfg), model: cfg.gemini.model, prompts, maxLive: LLM_CAP, onlyTasks: blind ? ["parse-crew"] : null,
  latency: mode === "replay" && !fast, runLabel: `${set} ${mode}${blind ? " blind" : ""}${only ? ` only ${only.join(",")}` : ""}`, log,
});

/** The app's cache, in memory; keys are noted per crew, for the safety scan. */
function evalCache() {
  /** @type {Map<string, { value: any, until: number, persona: string|null }>} */
  const m = new Map();
  return {
    async get(/** @type {string} */ k) {
      const e = m.get(k);
      if (!e) return undefined;
      if (e.until <= Date.now()) {
        m.delete(k);
        return undefined;
      }
      return e.value;
    },
    async set(/** @type {string} */ k, /** @type {any} */ v, /** @type {number} */ ttl) {
      m.set(k, { value: v, until: Date.now() + ttl, persona: current });
    },
    dump() {
      return [...m.entries()].map(([key, e]) => ({ key, persona: e.persona, value: e.value }));
    },
  };
}
const cache = evalCache();

// the guides as read once, part of the world: seeded so a replay never reads them again
const FEEDS_STATE = path.join(WORLD, "feeds-state.json");
const FEED_KEYS = /^(feedstate|robots|feedposts|feedfacts):/;
if (fs.existsSync(FEEDS_STATE)) for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(FEEDS_STATE, "utf8")).entries)) await cache.set(k, v, 365 * 24 * 3_600_000);
else if (mode === "replay") die("The world has no guides yet (feeds-state.json): record first.");

const geocoder = createGeocoder({ ...cfg.geocoder, contact: cfg.contact, cache });
const weather = createOpenMeteo({ url: cfg.openMeteoUrl, cache });
const places = createOverpass({ urls: cfg.overpassUrls, contact: cfg.contact, cache, now, attemptMs: BIG, budgetMs: BIG });
const routes = cfg.osrmUrl ? createOsrm({ url: cfg.osrmUrl, contact: cfg.contact, cache, now, timeoutMs: BIG }) : null;
const wikidata = cfg.wikidataUrl ? createWikidata({ url: cfg.wikidataUrl, contact: cfg.contact, cache, now, timeoutMs: BIG }) : null;
const fees = JSON.parse(fs.readFileSync(path.join(ROOT, "data/spot-entry-fees.json"), "utf8")).fees;
const spots = withEntries(JSON.parse(fs.readFileSync(path.join(ROOT, "data/lagos-spots.json"), "utf8")).spots, fees);
const store = await fileStore(path.join(runDir, "app"));
const push = fakePush();

/** Ids from a seed per crew, so two runs of the same crew make the same ids. */
let idSeed = "none";
let idN = 0;
const B32 = "0123456789abcdefghjkmnpqrstvwxyz";
const bytes = (/** @type {string} */ what) => crypto.createHash("sha256").update(`${idSeed}:${what}:${idN++}`).digest();
const b32 = (/** @type {Buffer} */ b, /** @type {number} */ n) => Array.from(b.subarray(0, n), (x) => B32[x & 31]).join("");
const ids = { id: (/** @type {string} */ p) => `${p}_${b32(bytes("id"), 12)}`, token: () => bytes("token").subarray(0, 24).toString("base64url"), suffix: () => b32(bytes("suffix"), 4) };

const service = /** @type {any} */ (createService({
  store, ai: llm.port, geocoder, places, weather, routes, wikidata, pages: fakePageMeta(), push, spots, prompts, ids, now, log,
  cfg: { publicUrl: "https://eval.test", webUrl: "https://eval.test", uidDomain: "eval.test" },
  budgets: { pinMs: BIG, weatherMs: BIG, gemmaMs: BIG, pickPlacesMs: BIG, pickWeatherMs: BIG, pickWaitMs: BIG },
}));
/** @type {any[]} */
let seen = [];
const candidatesNear = async (/** @type {any[]} */ ...a) => {
  const r = await service._internal.candidatesNear(...a);
  seen.push(...r);
  return r;
};
const ideas = createIdeas({ store, cache, ai: llm.port, feeds: createFeeds({ cache, contact: cfg.contact, now, log }), weather, geocoder, candidatesNear, spots, prompts, now, log, placesBudgetMs: BIG, refreshBudgetMs: BIG });
const basic = basicHandler({ service, webUrl: "https://eval.test" });

/** A plain page as a link preview (or Opera Mini) gets it. */
async function page(/** @type {string} */ pathname) {
  const url = new URL(`https://eval.test${pathname}`);
  let body = "";
  let status = 0;
  const res = /** @type {any} */ ({ writeHead(/** @type {number} */ s) { status = s; return res; }, end(/** @type {any} */ b) { body = b ? b.toString() : ""; } });
  await basic(/** @type {any} */ ({ method: "GET", headers: {}, url: url.pathname + url.search }), res, url);
  return { status, body };
}
const unescape = (/** @type {string} */ s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

// ---------------------------------------------------------------- the run

console.error(`persona eval v2: ${set} (${personas.length} crews), ${mode}${blind ? " (blind)" : ""}${mode === "replay" && !fast ? ", with recorded latencies" : ""}; LLM ${describeLlm(cfg)}; world ${path.relative(ROOT, WORLD)}`);
if (!fs.existsSync(FEEDS_STATE)) {
  console.error("reading the Lagos guides once, into the world");
  current = "(guides)";
  await ideas.refreshAll([{ pack: LAGOS, region: LAGOS_REGION }]);
  const entries = Object.fromEntries(cache.dump().filter((e) => FEED_KEYS.test(e.key)).map((e) => [e.key, e.value]));
  fs.writeFileSync(FEEDS_STATE, `${JSON.stringify({ readAt: new Date().toISOString(), clock: file.target.now, entries }, null, 1)}\n`);
  current = null;
}

const curatedKind = new Map(spots.map((/** @type {any} */ s) => [s.name.toLowerCase(), s.kind]));
const curatedTags = new Map(spots.map((/** @type {any} */ s) => [s.name.toLowerCase(), s.osm?.tags ?? null]));
const ms = (/** @type {number} */ t0) => Math.round(performance.now() - t0);

/** @type {any[]} */
const rows = [];
for (const [n, p] of personas.entries()) {
  current = p.id;
  world.setPersona(p.id);
  llm.setPersona(p.id);
  idSeed = p.id;
  idN = 0;
  seen = [];
  const pushBefore = push.sent.length;
  console.error(`[${n + 1}/${personas.length}] ${p.id}`);
  /** @type {any} */
  const r = { id: p.id, timings: {}, error: null };
  const t0 = performance.now();
  try {
    let t = performance.now();
    const draft = await service.draftCrew({ sentence: p.sentence, hint: { tz: p.hintTz } });
    r.timings.draft = ms(t);
    r.draft = { ai: draft.ai, name: draft.draft.name, vibe: draft.draft.vibe, budget: draft.draft.budget, rhythm: draft.draft.rhythm, areas: draft.draft.areas, taste: draft.draft.taste, summary: draft.taste?.summary ?? null, chips: (draft.taste?.chips || []).map((/** @type {any} */ c) => c.label), notes: draft.notes };
    const confirm = { ...draft.draft, name: draft.draft.name || `Crew ${n + 1}` };
    // every crew meets on the target Saturday; a misread day is noted and put right, as the organiser would
    r.rhythmRead = draft.draft.rhythm ? { every: draft.draft.rhythm.every, day: draft.draft.rhythm.day, window: draft.draft.rhythm.window } : null;
    if (!confirm.rhythm || confirm.rhythm.day !== 6) confirm.rhythm = { every: confirm.rhythm?.every || "2w", day: 6, window: confirm.rhythm?.window || { from: "15:00", to: "19:00" } };
    t = performance.now();
    let made;
    try {
      made = await service.createCrew({ confirm, hint: { tz: p.hintTz }, organiser: { name: "Organiser", area: p.areas[0].label } });
    } catch (e) {
      // a name that says who the crew is is refused at confirm; the organiser picks another
      if (!/** @type {any} */ (e).fields?.some?.((/** @type {any} */ d) => d.field === "name")) throw e;
      r.nameRefused = confirm.name;
      made = await service.createCrew({ confirm: { ...confirm, name: `Crew ${n + 1}` }, hint: { tz: p.hintTz }, organiser: { name: "Organiser", area: p.areas[0].label } });
    }
    r.timings.create = ms(t);
    const crew = await store.findOne("crews", { slug: made.crew.slug });
    await service.subscribePush({ memberId: made.member.id, token: made.memberToken, body: { subscription: { endpoint: `https://push.eval.test/crew-${n + 1}`, keys: { p256dh: "eval-p256dh", auth: "eval-auth" } } } });
    t = performance.now();
    if (typeof service.kickFirstPick === "function") await service.kickFirstPick(crew.id, { force: true });
    const pick = await service.firstPick({ slug: made.crew.slug, token: made.memberToken, waitMs: BIG });
    r.timings.pick = ms(t);
    r.pick = { status: pick.status, reason: pick.reason };
    const stored = await store.findOne("crews", { slug: made.crew.slug });
    const region = regionOf(stored);
    const pack = packFor(region);
    const points = (stored.areas || []).filter((/** @type {any} */ a) => Number.isFinite(a.lat)).map((/** @type {any} */ a, /** @type {number} */ i) => ({ id: `a${i}`, name: a.label, area: a }));
    const plan = pick.plan;
    if (plan) {
      const tags = plan.place?.osm?.tags ?? curatedTags.get(String(plan.place?.name).toLowerCase()) ?? null;
      r.ritual = {
        title: plan.title, place: { name: plan.place?.name, lat: plan.place?.lat, lon: plan.place?.lon, outdoor: plan.place?.outdoor }, tags,
        kind: kindOf(tags, curatedKind.get(String(plan.place?.name).toLowerCase())), entry: plan.place?.entry ?? null, price: plan.price ?? null,
        start: plan.start, end: plan.end, status: plan.status, rain: plan.rainPlan?.kind ?? null, rainNote: plan.rainPlan?.note ?? null, why: plan.why, invite: plan.invite, weather: plan.weather?.summary ?? null,
        trips: Number.isFinite(plan.place?.lat) ? tripsTo(points, plan.place, { at: Date.parse(plan.start), tz: stored.tz, model: pack.travel }) : null,
      };
    }
    t = performance.now();
    const card = await ideas.getIdeas({ slug: made.crew.slug, token: made.memberToken, when: "weekend" });
    r.timings.ideas = ms(t);
    const tagsFor = (/** @type {any} */ pl) => {
      const c = seen.find((x) => x.name === pl?.name && Number.isFinite(pl?.lat) && Math.abs(x.lat - pl.lat) < 0.003 && Math.abs(x.lon - pl.lon) < 0.003) || seen.find((x) => x.name === pl?.name);
      return c?.osm?.tags ?? curatedTags.get(String(pl?.name).toLowerCase()) ?? null;
    };
    r.ideas = card.ideas.map((/** @type {any} */ i) => {
      const tags = i.kind === "place" || i.kind === "usual" ? tagsFor(i.place) : null;
      return { kind: i.kind, title: i.title, when: i.when, start: i.start, end: i.end, place: i.place, price: i.price, why: i.why, by: i.by, source: i.source?.name ?? null, longest: i.travel?.longestMinutes ?? null, tags, placeKind: tags || i.kind === "place" ? kindOf(tags, curatedKind.get(String(i.place?.name).toLowerCase())) : null };
    });
    r.cardNotes = card.notes;
    r.cardBy = card.by;
    r.timings.total = ms(t0);
    // what travels, and what is kept
    const me = await store.findOne("members", { token: made.memberToken });
    const ics = await service.feed({ calToken: me.calToken });
    const pages = plan ? { planPage: await page(`/c/${stored.slug}/p/${plan.id}?t=${encodeURIComponent(stored.inviteToken)}&basic=1`), oneTapPage: await page(`/c/${stored.slug}/p/${plan.id}/in?t=${encodeURIComponent(stored.inviteToken)}&basic=1`) } : {};
    const crewPage = await page(`/c/${stored.slug}?t=${encodeURIComponent(stored.inviteToken)}&basic=1`);
    const share = /href="(https:\/\/wa\.me\/\?text=[^"]+)"/.exec(pages.planPage?.body || "")?.[1];
    r.crew = { name: stored.name, vibe: stored.vibe, vibeTags: stored.vibeTags, budget: stored.budget, taste: stored.taste, areas: stored.areas, tz: stored.tz, region: stored.region, rhythm: stored.rhythm };
    r.exemptNames = [...new Set([r.ritual?.place?.name, ...r.ideas.flatMap((/** @type {any} */ i) => [i.title, i.place?.name]), ...seen.map((x) => x.name)].filter(Boolean))];
    r.artifacts = {
      setupDraft: r.draft, storedCrew: stored, members: await store.find("members", { crewId: stored.id }), plans: await store.find("plans", { crewId: stored.id }),
      pickView: plan ?? null, ideasCard: card, invite: plan?.invite ?? null, ics, push: push.sent.slice(pushBefore),
      planPage: pages.planPage?.body ?? null, oneTapPage: pages.oneTapPage?.body ?? null, crewPage: crewPage.body, whatsappShare: share ? decodeURIComponent(new URL(unescape(share)).searchParams.get("text") || "") : null,
      appLogs: logs.filter((l) => l.persona === p.id).map(({ persona, ...l }) => l),
    };
  } catch (e) {
    r.error = String(/** @type {any} */ (e)?.stack || e).split("\n").slice(0, 3).join(" | ");
    console.error(`  error: ${r.error}`);
  }
  rows.push({ p, r });
}
current = null;

// ---------------------------------------------------------------- the end

const cacheDump = cache.dump();
const storeFiles = fs.readdirSync(path.join(runDir, "app")).filter((f) => f.endsWith(".json")).map((f) => ({ file: `store/${f}`, text: fs.readFileSync(path.join(runDir, "app", f), "utf8") }));
const cacheText = JSON.stringify(cacheDump);
const logText = JSON.stringify(logs);
for (const { p, r } of rows) {
  if (r.error) continue;
  // the cache entries written while this crew was being served
  r.artifacts.appCache = cacheDump.filter((e) => e.persona === p.id).map(({ persona, ...e }) => e);
  r.sentenceFoundIn = [...storeFiles.filter((f) => f.text.includes(p.sentence)).map((f) => f.file), ...(cacheText.includes(p.sentence) ? ["the app's cache"] : []), ...(logText.includes(p.sentence) ? ["the logs"] : [])];
}
await store.close?.();
world.uninstall();

const meta = {
  set, mode, runId, sha, at: new Date().toISOString(), clock: file.target.now, llm: describeLlm(cfg), fast, only,
  git: gitState(), world: world.stats, worldMisses: world.misses, worldNew: world.newlyRecorded, llmStats: llm.stats, llmMisses: llm.misses, ledger: llm.ledger(),
  geocoder: cfg.geocoder.provider,
  extendedSince: EXTENDED_SINCE,
  appends: fs.existsSync(path.join(WORLD, "appends")) ? fs.readdirSync(path.join(WORLD, "appends")).map((f) => JSON.parse(fs.readFileSync(path.join(WORLD, "appends", f), "utf8"))) : [],
  promptHashes: Object.fromEntries(Object.entries(prompts).map(([k, v]) => [k, crypto.createHash("sha256").update(`${v.system ?? ""}\n----\n${v.user ?? ""}`).digest("hex").slice(0, 16)])),
  rerunReason: opt("--rerun-reason"),
  note: opt("--note"),
  label: scoredTest ? label : null,
};
fs.writeFileSync(path.join(runDir, "meta.json"), JSON.stringify(meta, null, 1));
console.error(`world: ${world.stats.hits} answered from the world, ${world.stats.recorded} recorded now (${world.stats.recordedFailures} failures kept), ${world.stats.misses} misses`);
console.error(`LLM: ${llm.stats.hits} from the cache, ${llm.stats.live} live (ledger ${llm.ledger().liveCalls} of ${llm.ledger().cap}), ${llm.stats.misses} misses, ${llm.stats.failures} failures kept${blind ? `, ${llm.stats.refusedBlind} not asked (blind)` : ""}`);

if (!writesResults) {
  // a recording pass keeps only the world (and a note of what it added): no results, nothing to read
  const byService = /** @type {Record<string, number>} */ ({});
  for (const e of world.newlyRecorded) byService[e.service] = (byService[e.service] || 0) + 1;
  const appends = path.join(WORLD, "appends");
  fs.mkdirSync(appends, { recursive: true });
  fs.writeFileSync(path.join(appends, `${runId}.json`), `${JSON.stringify({ runId, at: meta.at, git: meta.git, geocoder: meta.geocoder, added: { total: world.newlyRecorded.length, failuresKept: world.stats.recordedFailures, byService }, llm: { live: llm.stats.live, liveByTask: llm.stats.liveByTask, failures: llm.stats.failures, notAskedBlind: llm.stats.refusedBlind }, ledger: llm.ledger() }, null, 1)}\n`);
  fs.rmSync(runDir, { recursive: true, force: true });
  console.error("recording pass: the world is kept; no results were written.");
  process.exit(0);
}
const errors = rows.filter((x) => x.r.error).length;
fs.writeFileSync(path.join(runDir, "rows.json"), JSON.stringify(rows.map(({ p, r }) => ({ id: p.id, ...r })), null, 1));
if (world.stats.misses || llm.stats.misses) {
  // not a clean replay: the numbers would measure missing world data, not the app
  console.error(`NOT CLEAN: ${world.stats.misses} world misses and ${llm.stats.misses} Gemma misses. No results written (the run's raw output is in ${path.relative(ROOT, runDir)}). Record the missing entries first.`);
  process.exit(1);
}
const out = writeReports({ set, rows, meta, resultsDir: RESULTS, file, suffix: scoredTest && label !== "baseline" ? `-${label}` : "" });
if (scoredTest) fs.writeFileSync(TEST_MARKER, `${JSON.stringify({ at: meta.at, runId, sha, rerunReason: meta.rerunReason, label })}\n`);
console.error(`wrote ${out.map((f) => path.relative(ROOT, f)).join(", ")}; ${errors} crews errored; world misses ${world.stats.misses}, LLM misses ${llm.stats.misses}`);
process.exit(world.stats.misses || llm.stats.misses ? 1 : 0);

function gitState() {
  try {
    const head = fs.readFileSync(path.join(ROOT, ".git/HEAD"), "utf8").trim();
    const ref = head.startsWith("ref: ") ? fs.readFileSync(path.join(ROOT, ".git", head.slice(5)), "utf8").trim() : head;
    return { head: ref };
  } catch {
    return { head: null };
  }
}
