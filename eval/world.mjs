// @ts-check
// The frozen world: record-and-replay for every outside service the app calls, so a persona
// run asks the same questions of the same answers every time.
//
//   createWorld   wraps fetch. Photon, Nominatim, Overpass, OSRM, Open-Meteo, Wikidata and
//                 the guides' RSS (and their robots.txt) are kept on disk, keyed by the
//                 request (method, URL, body; Overpass by its query alone, whichever mirror
//                 answered). "record" answers from the world when it can and otherwise asks
//                 the service once, politely, and keeps the answer (a failure after the
//                 retries is kept too, so a replay sees the same world). "replay" answers
//                 only from the world: a request that was not recorded is a miss, counted
//                 and thrown as a network error, and the run reports it. No silent live calls.
//   createLlmCache wraps the LLM port. Answers are keyed by a SHA-256 of the model, the
//                 task, the task's prompt hash and the exact messages, so a changed prompt
//                 is a new key and is asked again. Live calls are paced, retried and capped
//                 by a ledger kept beside the world. A crew reading (parse-crew, the only
//                 task that sees the setup sentence) is kept with every sensitive word
//                 scrubbed, and only the names of the fields that had one are noted.
//
// Nothing here edits the app: the app's adapters call globalThis.fetch, which install() swaps.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { hasSensitive, scrubDeep } from "../src/core/taste.mjs";

const realFetch = globalThis.fetch;
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
const sha = (/** @type {string} */ s) => crypto.createHash("sha256").update(s).digest("hex");

/** Hosts that are the LLM, never part of the recorded world (their answers live in the LLM cache). */
export const LLM_HOSTS = ["generativelanguage.googleapis.com", "localhost:11434", "127.0.0.1:11434"];
/** Overpass mirrors the app may try; one recording answers for all of them. */
export const OVERPASS_MIRRORS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.private.coffee/api/interpreter"];

/** Which service a URL belongs to, for pacing and the report. */
export function serviceOf(/** @type {string} */ url) {
  const u = new URL(url);
  if (/\/api\/interpreter$/.test(u.pathname) || /overpass/.test(u.host)) return "overpass";
  if (/photon/.test(u.host)) return "photon";
  if (/nominatim/.test(u.host)) return "nominatim";
  if (/osrm/.test(u.host)) return "osrm";
  if (/open-meteo/.test(u.host)) return "openmeteo";
  if (/wikidata/.test(u.host)) return "wikidata";
  if (/substack|feed|rss/.test(u.host + u.pathname) || /robots\.txt$/.test(u.pathname)) return "rss";
  return "other";
}

/** Minimum gap between two live requests to a service while recording (on top of the app's own pacing). */
const GAP_MS = { overpass: 2000, photon: 400, nominatim: 1200, osrm: 1200, openmeteo: 300, wikidata: 1500, rss: 2000, other: 1000 };
/** Live timeouts while recording: generous, so a slow answer is kept instead of lost. */
const TIMEOUT_MS = { overpass: 90_000, wikidata: 60_000, other: 30_000 };
const RETRY_WAITS_MS = [8000, 20_000, 45_000];
/** Overpass is often at capacity: more tries, longer waits, round the mirrors. */
const OVERPASS_WAITS_MS = [10_000, 20_000, 40_000, 60_000, 90_000];

/** The key a request is kept under. */
export function requestKey(/** @type {string} */ url, /** @type {{ method?: string, body?: any }} */ init = {}) {
  const method = String(init.method || "GET").toUpperCase();
  const body = init.body == null ? "" : String(init.body);
  if (serviceOf(url) === "overpass") return { key: sha(`overpass\n${body}`), canon: `overpass POST ${body.slice(0, 120)}` };
  return { key: sha(`${method} ${url}\n${body}`), canon: `${method} ${url}` };
}

const HEADER_KEEP = ["content-type", "etag", "last-modified", "retry-after"];

/**
 * @param {{ dir: string, mode: "record"|"replay", latency?: boolean, llmLive?: boolean, log?: (e: string, f?: any) => void }} opts
 *   latency: replay sleeps for the time the recorded answer took (so latency per crew is real)
 *   llmLive: let requests to the LLM host through (the LLM cache decides when)
 *   extendedSince: ISO time; hits recorded at or after it are counted as the extension
 */
export function createWorld({ dir, mode, latency = false, llmLive = false, extendedSince = null, log = () => {} }) {
  const httpDir = path.join(dir, "http");
  fs.mkdirSync(httpDir, { recursive: true });
  const stats = { hits: 0, recorded: 0, recordedFailures: 0, misses: 0, liveAttempts: 0, hitsExtended: 0, byService: /** @type {Record<string, { hits: number, recorded: number, misses: number }>} */ ({}) };
  /** @type {{ persona: string|null, service: string, canon: string }[]} */
  const misses = [];
  /** @type {{ persona: string|null, service: string, canon: string, recordedAt: string }[]} */
  const newlyRecorded = [];
  let persona = /** @type {string|null} */ (null);
  /** @type {Map<string, Promise<any>>} */
  const lanes = new Map();
  /** @type {Map<string, number>} */
  const lastAt = new Map();
  /** @type {Map<string, Promise<any>>} */
  const inflight = new Map();

  const fileOf = (/** @type {string} */ key) => path.join(httpDir, key.slice(0, 2), `${key}.json.gz`);
  const bump = (/** @type {string} */ service, /** @type {"hits"|"recorded"|"misses"} */ k) => {
    const s = (stats.byService[service] ||= { hits: 0, recorded: 0, misses: 0 });
    s[k]++;
  };

  function read(/** @type {string} */ key) {
    try {
      return JSON.parse(zlib.gunzipSync(fs.readFileSync(fileOf(key))).toString("utf8"));
    } catch (e) {
      if (/** @type {any} */ (e).code === "ENOENT") return null;
      throw e;
    }
  }
  function write(/** @type {string} */ key, /** @type {any} */ entry) {
    const f = fileOf(key);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, zlib.gzipSync(JSON.stringify(entry), { level: 9 }));
    fs.renameSync(tmp, f);
  }

  /** A recorded answer as a fetch Response, or a thrown network error. */
  function respond(/** @type {any} */ e) {
    if (e.error) throw new TypeError(`fetch failed (recorded: ${e.error})`);
    const nullBody = e.status === 204 || e.status === 304;
    return new Response(nullBody ? null : e.text, { status: e.status, headers: e.headers || {} });
  }

  /** One service at a time, with a gap, while recording. */
  function paced(/** @type {string} */ service, /** @type {() => Promise<any>} */ task) {
    const prev = lanes.get(service) || Promise.resolve();
    const run = prev.then(async () => {
      const wait = (lastAt.get(service) ?? 0) + (/** @type {any} */ (GAP_MS)[service] ?? 1000) - Date.now();
      if (wait > 0) await sleep(wait);
      lastAt.set(service, Date.now());
      return task();
    });
    lanes.set(service, run.catch(() => {}));
    return run;
  }

  /** Ask the service, retrying transient failures; an Overpass query goes round the mirrors. */
  async function live(/** @type {string} */ url, /** @type {any} */ init, /** @type {string} */ service) {
    const urls = service === "overpass" ? [url, ...OVERPASS_MIRRORS.filter((m) => m !== url)] : [url];
    const timeout = /** @type {any} */ (TIMEOUT_MS)[service] ?? TIMEOUT_MS.other;
    /** @type {any} */
    let last = null;
    const waits = service === "overpass" ? OVERPASS_WAITS_MS : RETRY_WAITS_MS;
    for (let attempt = 0; attempt <= waits.length; attempt++) {
      const target = urls[attempt % urls.length];
      const t0 = Date.now();
      try {
        stats.liveAttempts++;
        const res = await paced(service, () => realFetch(target, { method: init.method || "GET", headers: init.headers, body: init.body, signal: AbortSignal.timeout(timeout) }));
        const text = await res.text();
        const headers = Object.fromEntries(HEADER_KEEP.map((h) => [h, res.headers.get(h)]).filter(([, v]) => v != null));
        const entry = { status: res.status, headers, text, ms: Date.now() - t0, attempts: attempt + 1, via: target };
        const transient = res.status === 429 || res.status >= 500;
        if (!transient) return entry;
        last = entry;
        const ra = Number(res.headers.get("retry-after"));
        if (attempt < waits.length) await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 90_000) : waits[attempt]);
      } catch (e) {
        last = { error: String(/** @type {any} */ (e)?.message || e).slice(0, 200), ms: Date.now() - t0, attempts: attempt + 1, via: target };
        if (attempt < waits.length) await sleep(waits[attempt]);
      }
    }
    return { ...last, failed: true };
  }

  /** @type {typeof fetch} */
  async function worldFetch(input, init = {}) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : /** @type {any} */ (input).url;
    const host = new URL(url).host;
    if (LLM_HOSTS.includes(host)) {
      if (!llmLive) throw new TypeError(`fetch failed (the LLM is answered from the eval's LLM cache; ${host} is not part of the world)`);
      return realFetch(input, init);
    }
    const service = serviceOf(url);
    const { key, canon } = requestKey(url, /** @type {any} */ (init));
    const hit = read(key);
    if (hit) {
      stats.hits++;
      // answers recorded after the first recording day's fixes landed (the world was extended, never overwritten)
      if (extendedSince && hit.recordedAt >= extendedSince) stats.hitsExtended++;
      bump(service, "hits");
      if (mode === "replay" && latency && hit.ms) await sleep(hit.ms);
      return respond(hit);
    }
    if (mode === "replay") {
      stats.misses++;
      bump(service, "misses");
      misses.push({ persona, service, canon: canon.slice(0, 200) });
      log("world_miss", { persona, service, canon: canon.slice(0, 200) });
      throw new TypeError(`fetch failed (not in the frozen world: ${canon.slice(0, 120)})`);
    }
    // record: one live request per key, even when the app asks twice at once
    let p = inflight.get(key);
    if (!p) {
      p = (async () => {
        const got = await live(url, init, service);
        const entry = { key, service, request: { method: String(/** @type {any} */ (init).method || "GET").toUpperCase(), url: service === "overpass" ? "overpass" : url, body: service === "overpass" ? String(/** @type {any} */ (init).body ?? "") : undefined }, ...got, recordedAt: new Date().toISOString() };
        write(key, entry);
        stats.recorded++;
        if (got.failed) stats.recordedFailures++;
        bump(service, "recorded");
        newlyRecorded.push({ persona, service, canon: canon.slice(0, 200), recordedAt: entry.recordedAt });
        log("world_recorded", { persona, service, status: got.status ?? null, error: got.error ?? null, ms: got.ms, attempts: got.attempts });
        return entry;
      })().finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    return respond(await p);
  }

  return {
    fetch: /** @type {typeof fetch} */ (worldFetch),
    stats,
    misses,
    newlyRecorded,
    setPersona(/** @type {string|null} */ id) {
      persona = id;
    },
    install() {
      globalThis.fetch = worldFetch;
    },
    uninstall() {
      globalThis.fetch = realFetch;
    },
  };
}

// ---------------------------------------------------------------- the LLM cache

/** A prompt's hash: its system and user templates. */
export function promptHash(/** @type {any} */ prompt) {
  return prompt ? sha(`${prompt.system ?? ""}\n----\n${prompt.user ?? ""}`).slice(0, 16) : "none";
}

/** The fields of a crew reading that carried a sensitive word (names only, never the words). */
function sensitiveFields(/** @type {any} */ data, prefix = "") {
  /** @type {string[]} */
  const out = [];
  if (typeof data === "string") return hasSensitive(data) ? [prefix || "(value)"] : [];
  if (Array.isArray(data)) return data.some((x) => sensitiveFields(x).length) ? [prefix] : [];
  if (data && typeof data === "object") for (const [k, v] of Object.entries(data)) out.push(...sensitiveFields(v, prefix ? `${prefix}.${k}` : k));
  return out;
}

/**
 * @param {{ dir: string, mode: "record"|"replay", live: any, model: string, prompts: Record<string, any>, maxLive: number,
 *           onlyTasks?: string[]|null, gapMs?: number, latency?: boolean, runLabel: string, log?: (e: string, f?: any) => void }} opts
 *   onlyTasks: in record mode, the tasks that may go live (the blind pass asks only parse-crew)
 */
export function createLlmCache({ dir, mode, live, model, prompts, maxLive, onlyTasks = null, gapMs = 4500, latency = false, runLabel, log = () => {} }) {
  const llmDir = path.join(dir, "llm");
  fs.mkdirSync(llmDir, { recursive: true });
  const ledgerFile = path.join(dir, "llm-ledger.json");
  const ledger = fs.existsSync(ledgerFile) ? JSON.parse(fs.readFileSync(ledgerFile, "utf8")) : { cap: maxLive, liveCalls: 0, runs: [] };
  // the cap is the run's own (--llm-cap); a raise is noted in the ledger
  if (mode === "record") {
    if (maxLive !== ledger.cap) (ledger.capChanges ||= []).push({ at: new Date().toISOString(), from: ledger.cap, to: maxLive, run: runLabel });
    ledger.cap = maxLive;
  }
  const run = { label: runLabel, at: new Date().toISOString(), live: 0, failed: 0 };
  ledger.runs.push(run);
  const saveLedger = () => fs.writeFileSync(ledgerFile, `${JSON.stringify(ledger, null, 1)}\n`);
  const stats = { hits: 0, live: 0, misses: 0, refusedBlind: 0, refusedBudget: 0, failures: 0, liveByTask: /** @type {Record<string, number>} */ ({}), missByTask: /** @type {Record<string, number>} */ ({}), sensitiveFieldsSeen: /** @type {Record<string, number>} */ ({}) };
  /** @type {{ persona: string|null, task: string }[]} */
  const misses = [];
  let persona = /** @type {string|null} */ (null);
  let last = 0;
  let chain = Promise.resolve();

  const fileOf = (/** @type {string} */ key) => path.join(llmDir, `${key}.json`);

  /** @param {any} req */
  async function generate(req) {
    const ph = promptHash(prompts[req.task]);
    const key = sha(JSON.stringify([model, req.task, ph, req.messages, req.schema ?? null, req.maxTokens ?? null, req.temperature ?? null]));
    if (fs.existsSync(fileOf(key))) {
      const hit = JSON.parse(fs.readFileSync(fileOf(key), "utf8"));
      stats.hits++;
      for (const f of hit.sensitiveFields || []) stats.sensitiveFieldsSeen[`${hit.task}.${f}`] = (stats.sensitiveFieldsSeen[`${hit.task}.${f}`] || 0) + 1;
      if (mode === "replay" && latency && hit.wallSec) await sleep(hit.wallSec * 1000);
      if (hit.error) throw Object.assign(new Error(`recorded failure: ${hit.error}`), { status: hit.status ?? 0, hint: "Gemma was unavailable when the world was recorded." });
      return { data: hit.data, text: "", model: hit.model, wallSec: hit.wallSec ?? 0, jsonMode: true, recorded: true };
    }
    if (mode === "replay") {
      stats.misses++;
      stats.missByTask[req.task] = (stats.missByTask[req.task] || 0) + 1;
      misses.push({ persona, task: req.task });
      log("llm_miss", { persona, task: req.task, promptHash: ph });
      throw Object.assign(new Error(`not in the LLM cache: ${req.task} (prompt ${ph})`), { status: 0, hint: "Not in the eval's LLM cache." });
    }
    if (onlyTasks && !onlyTasks.includes(req.task)) {
      stats.refusedBlind++;
      throw Object.assign(new Error(`blind pass: ${req.task} not asked`), { status: 0, hint: "Not asked in the blind recording pass." });
    }
    // one live call at a time, paced, within the ledger's cap
    const mine = chain.then(async () => {
      if (ledger.liveCalls >= ledger.cap) {
        stats.refusedBudget++;
        throw Object.assign(new Error(`eval Gemma budget spent (${ledger.liveCalls} of ${ledger.cap})`), { status: 0, hint: "Over the eval's Gemma budget." });
      }
      /** @type {any} */
      let lastErr = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        const wait = last + gapMs - Date.now();
        if (wait > 0) await sleep(wait);
        last = Date.now();
        ledger.liveCalls++;
        run.live++;
        stats.live++;
        stats.liveByTask[req.task] = (stats.liveByTask[req.task] || 0) + 1;
        saveLedger();
        try {
          const r = await live.generate(req);
          const fields = req.task === "parse-crew" ? sensitiveFields(r.data) : [];
          const keep = req.task === "parse-crew" ? scrubDeep(r.data) : r.data;
          fs.writeFileSync(fileOf(key), JSON.stringify({ key, task: req.task, promptHash: ph, model: r.model, data: keep, wallSec: r.wallSec ?? null, sensitiveFields: fields, recordedAt: new Date().toISOString() }));
          for (const f of fields) stats.sensitiveFieldsSeen[`${req.task}.${f}`] = (stats.sensitiveFieldsSeen[`${req.task}.${f}`] || 0) + 1;
          log("llm_recorded", { persona, task: req.task, sec: r.wallSec, parsed: r.data != null });
          return { ...r, data: keep };
        } catch (e) {
          lastErr = e;
          const status = /** @type {any} */ (e)?.status ?? 0;
          log("llm_error", { persona, task: req.task, status, message: String(/** @type {any} */ (e)?.message).slice(0, 160) });
          if (!(status === 429 || status >= 500 || status === 0) || ledger.liveCalls >= ledger.cap) break;
          await sleep([15_000, 40_000, 60_000][attempt] ?? 60_000);
        }
      }
      // kept as a failure, so a replay sees the same world (Gemma away means the code's fallbacks)
      stats.failures++;
      run.failed++;
      saveLedger();
      fs.writeFileSync(fileOf(key), JSON.stringify({ key, task: req.task, promptHash: ph, model, error: String(lastErr?.message).slice(0, 200), status: lastErr?.status ?? 0, recordedAt: new Date().toISOString() }));
      throw lastErr;
    });
    chain = mine.then(() => {}, () => {});
    return mine;
  }

  return {
    port: { ...live, available: true, model, generate },
    stats,
    misses,
    ledger: () => ({ cap: ledger.cap, liveCalls: ledger.liveCalls, thisRun: run.live }),
    setPersona(/** @type {string|null} */ id) {
      persona = id;
    },
  };
}
