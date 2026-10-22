// @ts-check
// The Come Through HTTP API (docs/SPEC.md, "HTTP API"), on Node's standard http module.
// Routing, auth tokens, input limits, CORS, rate limits and error shapes live here; every
// decision lives in src/app/service.mjs and src/core.
//
// Run: npm run dev  (reads .env; OFFLINE=1 for fakes)   Health: GET /healthz

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config, loadDotEnv } from "../config.mjs";
import { AppError } from "../app/errors.mjs";
import { makeIds, safeEqual } from "../app/ids.mjs";
import { loadPrompts } from "../app/prompts.mjs";
import { createIdeas } from "../app/ideas.mjs";
import { createService } from "../app/service.mjs";
import { withEntries } from "../core/places.mjs";
import { fakeAi, fakeGeocoder, fakeOverpass, fakePageMeta, fakePush, fakeWeather, fakeWikidata } from "../adapters/fakes.mjs";
import { createFeeds } from "../adapters/feeds.mjs";
import { createGeocoder } from "../adapters/geocode.mjs";
import { createLlm, describeLlm } from "../adapters/llm.mjs";
import { layeredCache, memoryCache, storeCache } from "../adapters/http.mjs";
import { laneAi } from "../adapters/lanes.mjs";
import { createOpenMeteo } from "../adapters/openmeteo.mjs";
import { createOsrm } from "../adapters/osrm.mjs";
import { createOverpass } from "../adapters/overpass.mjs";
import { createPageMeta } from "../adapters/pagemeta.mjs";
import { createWebPush } from "../adapters/push.mjs";
import { openStore } from "../adapters/store.mjs";
import { createWikidata } from "../adapters/wikidata.mjs";
import { LAGOS, LAGOS_REGION } from "../packs/index.mjs";
import { BASE_HEADERS, HttpFail, clientIp, makeLimiter, parseMultipart, readBody, readJson, sendJson, sniffImage, tokenOf } from "./http.mjs";
import { staticHandler } from "./static.mjs";
import { APP_ROUTE, PAGE_ROUTE, basicHandler, wantsBasic } from "./basic.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Per-IP and global limits. Gemma's free tier allows roughly 15 to 30 requests a minute per key. */
export const RATE = {
  api: { limit: 120, windowMs: 60_000 },
  ai: { limit: 8, windowMs: 60_000 },
  aiDay: { limit: 80, windowMs: 86_400_000 },
  aiGlobal: { limit: 20, windowMs: 60_000 },
  areas: { limit: 40, windowMs: 60_000 },
  create: { limit: 20, windowMs: 3_600_000 },
  /** per crew: a cached card is free; a new one also counts against the Gemma limits */
  ideas: { limit: 30, windowMs: 3_600_000 },
};

/**
 * @param {object} opts
 * @param {ReturnType<typeof createService>} opts.service
 * @param {import("../config.mjs").Config} opts.cfg
 * @param {() => number} [opts.now]
 * @param {(event: string, fields?: Record<string, any>) => void} [opts.log]
 * @param {ReturnType<typeof createIdeas>|null} [opts.ideas]  "The sloth has 3 ideas"; null answers 503
 */
export function createApi({ service, cfg, now = Date.now, log = () => {}, ideas = null }) {
  const limiter = makeLimiter(now);
  const serveStatic = staticHandler(cfg.staticDir);
  const serveBasic = basicHandler({ service, webUrl: cfg.webUrl });
  const ownOrigin = new URL(cfg.publicUrl).origin;
  const allowedOrigins = new Set(cfg.webOrigins.map((o) => new URL(o).origin).filter((o) => o !== ownOrigin));
  const sweep = setInterval(() => limiter.sweep(), 3_600_000);
  sweep.unref();

  /** @param {string} bucket @param {string} key */
  const limit = (bucket, key) => {
    const r = /** @type {keyof typeof RATE} */ (bucket);
    const { ok, retrySec } = limiter.allow(`${bucket}:${key}`, RATE[r].limit, RATE[r].windowMs);
    if (!ok) throw Object.assign(new HttpFail(429, "slow_down", bucket.startsWith("ai") ? "Gemma needs a breather. Try again in a minute." : "Too many requests. Try again in a minute."), { retrySec });
  };

  /** @type {[string, RegExp, (ctx: any) => Promise<any>][]} */
  const routes = [
    ["GET", /^\/healthz$/, async ({ ip }) => ({ ...(await service.health()), you: ip })],
    ["GET", /^\/api\/push\/key$/, () => service.pushKey()],
    ["GET", /^\/api\/areas$/, ({ url, ip }) => {
      limit("areas", ip);
      // near=lat,lon and cc=DE from the crew's region; tz= the visitor's zone before a crew exists
      const [lat, lon] = String(url.searchParams.get("near") || "").split(",").map(Number);
      const near = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
      return service.searchAreas({ q: url.searchParams.get("q"), near, country: url.searchParams.get("cc"), tz: url.searchParams.get("tz") });
    }],
    ["POST", /^\/api\/crews$/, async ({ req, ip }) => {
      const body = await readJson(req);
      if (body.confirm) {
        limit("create", ip);
        const made = await service.createCrew({ confirm: body.confirm, organiser: body.organiser, hint: body.hint });
        // the sloth's first pick starts once the answer is on its way (GET .../first-pick follows it)
        return { status: 201, body: made, after: made.crew.firstPick ? () => service.kickFirstPick(made.crew.id) : null };
      }
      aiLimits(ip);
      return service.draftCrew({ sentence: body.sentence, into: body.into, hint: body.hint });
    }],
    ["POST", /^\/api\/crews\/([a-z0-9-]{1,64})\/taste$/, async ({ m, token, req, ip }) => {
      const body = await readJson(req, 8 * 1024);
      if (!body?.taste) aiLimits(ip);
      return service.crewTaste({ slug: m[1], token, body });
    }],
    ["GET", /^\/api\/crews\/([a-z0-9-]{1,64})$/, ({ m, token }) => service.getCrew({ slug: m[1], token })],
    ["POST", /^\/api\/crews\/([a-z0-9-]{1,64})\/members$/, async ({ m, token, req, ip }) => {
      limit("create", ip);
      return { status: 201, body: await service.joinCrew({ slug: m[1], token, body: await readJson(req) }) };
    }],
    // the first pick's state; ?wait=25 holds the answer up to 25 s while the pick runs
    // (wrapped: the answer has a `status` field of its own)
    ["GET", /^\/api\/crews\/([a-z0-9-]{1,64})\/first-pick$/, async ({ m, token, url }) => {
      const wait = Math.max(0, Math.min(25, Number(url.searchParams.get("wait")) || 0));
      return { status: 200, body: await service.firstPick({ slug: m[1], token, waitMs: wait * 1000 }) };
    }],
    // older clients: the same, waiting up to 25 s
    ["POST", /^\/api\/crews\/([a-z0-9-]{1,64})\/first-pick$/, async ({ m, token, ip }) => {
      aiLimits(ip);
      return { status: 200, body: await service.firstPick({ slug: m[1], token, waitMs: 25_000 }) };
    }],
    ["PATCH", /^\/api\/members\/([A-Za-z0-9_-]{1,64})$/, async ({ m, token, req, ip }) => {
      limit("areas", ip);
      return service.setMyArea({ memberId: m[1], token, body: await readJson(req, 8 * 1024) });
    }],
    ["GET", /^\/api\/crews\/([a-z0-9-]{1,64})\/ideas$/, async ({ m, token, url, ip }) => {
      if (!ideas) throw new AppError(503, "ideas_off", "Ideas are not set up on this server.");
      return ideas.getIdeas({ slug: m[1], token, when: url.searchParams.get("when"), onAsk: () => limit("ideas", m[1]), onMiss: () => aiLimits(ip) });
    }],
    ["POST", /^\/api\/crews\/([a-z0-9-]{1,64})\/plans\/parse$/, async ({ m, token, req, ip }) => {
      aiLimits(ip);
      const input = await readParseInput(req);
      return service.parsePlan({ slug: m[1], token, ...input });
    }],
    ["POST", /^\/api\/crews\/([a-z0-9-]{1,64})\/plans$/, async ({ m, token, req }) => ({ status: 201, body: await service.addPlan({ slug: m[1], token, body: await readJson(req) }) })],
    ["PATCH", /^\/api\/plans\/([A-Za-z0-9_-]{1,64})$/, async ({ m, token, req }) => service.patchPlan({ id: m[1], token, body: await readJson(req) })],
    ["GET", /^\/api\/plans\/([A-Za-z0-9_-]{1,64})$/, ({ m, token }) => service.getPlan({ id: m[1], token })],
    ["GET", /^\/api\/flyers\/(f_[A-Za-z0-9_-]{20,64})$/, async ({ m }) => {
      const f = await service.getFlyer({ id: m[1] });
      return { raw: f.data, headers: { "content-type": f.mimeType, "cache-control": "public, max-age=31536000, immutable", "content-security-policy": "default-src 'none'" } };
    }],
    ["GET", /^\/api\/plans\/([A-Za-z0-9_-]{1,64})\/pods$/, ({ m, token }) => service.getPods({ id: m[1], token })],
    ["GET", /^\/api\/plans\/([A-Za-z0-9_-]{1,64})\/event\.ics$/, async ({ m, token }) => {
      const { ics, filename } = await service.eventIcs({ id: m[1], token });
      return { raw: ics, headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="${filename.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}` } };
    }],
    ["POST", /^\/api\/members\/([A-Za-z0-9_-]{1,64})\/push-subscription$/, async ({ m, token, req }) => ({ status: 204, body: await service.subscribePush({ memberId: m[1], token, body: await readJson(req, 8 * 1024) }) })],
    ["DELETE", /^\/api\/members\/([A-Za-z0-9_-]{1,64})\/push-subscription$/, async ({ m, token, req }) => ({ status: 204, body: await service.unsubscribePush({ memberId: m[1], token, body: await readJson(req, 8 * 1024) }) })],
    ["POST", /^\/api\/tick$/, async ({ req }) => {
      if (!cfg.tickSecret) throw new AppError(503, "tick_off", "TICK_SECRET is not set on the server.");
      const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ""));
      if (!m || !safeEqual(m[1], cfg.tickSecret)) throw new AppError(401, "bad_secret", "Wrong or missing tick secret.");
      const out = await service.tick();
      // the curated guides' feeds, at most once a day each, in the background (Gemma reads new posts)
      if (ideas) ideas.refreshAll([{ pack: LAGOS, region: LAGOS_REGION }]).catch((e) => log("feed_error", { message: String(e?.message).slice(0, 120) }));
      return out;
    }],
    ["GET", /^\/cal\/([A-Za-z0-9_-]{16,64})\.ics$/, async ({ m, req }) => {
      const ics = await service.feed({ calToken: m[1] });
      const etag = `"${crypto.createHash("sha1").update(ics).digest("base64url")}"`;
      const headers = { "content-type": "text/calendar; charset=utf-8", "cache-control": "private, max-age=300", etag, "content-disposition": 'inline; filename="comethrough.ics"' };
      if (req.headers["if-none-match"] === etag) return { status: 304, raw: "", headers };
      return { raw: ics, headers };
    }],
  ];

  function aiLimits(ip) {
    limit("ai", ip);
    limit("aiDay", ip);
    limit("aiGlobal", "all");
  }

  /** text, url and an image from multipart, or text and url from JSON. */
  async function readParseInput(req) {
    const type = String(req.headers["content-type"] || "");
    if (/^multipart\/form-data/i.test(type)) {
      const { fields, files } = parseMultipart(await readBody(req, cfg.imageMaxBytes + 300 * 1024), type);
      const asImage = (/** @type {any} */ f) => {
        if (!f || !f.data.length) return null;
        if (f.data.length > cfg.imageMaxBytes) throw new HttpFail(413, "too_large", `That image is too large (the limit is ${Math.round(cfg.imageMaxBytes / 1048576)} MB).`);
        const mimeType = sniffImage(f.data);
        if (!mimeType) throw new HttpFail(415, "not_an_image", "That file is not a JPEG, PNG, WebP or HEIC image.");
        return { mimeType, data: f.data };
      };
      const thumb = asImage(files.thumb);
      return { text: fields.text ?? null, url: fields.url ?? null, image: asImage(files.image), thumb: thumb && thumb.mimeType !== "image/heic" && thumb.mimeType !== "image/heif" ? thumb : null };
    }
    const b = await readJson(req, 16 * 1024);
    return { text: typeof b.text === "string" ? b.text : null, url: typeof b.url === "string" ? b.url : null, image: null };
  }

  /** CORS for the web origin only (same-origin requests need none). */
  function cors(req, res) {
    const origin = String(req.headers.origin || "");
    if (!origin || !allowedOrigins.has(origin)) return false;
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
    res.setHeader("access-control-allow-headers", "authorization, content-type");
    res.setHeader("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("access-control-max-age", "600");
    return true;
  }

  return http.createServer(async (req, res) => {
    const t0 = now();
    const url = new URL(req.url || "/", "http://x");
    const ip = clientIp(req, cfg.trustProxyHops);
    const isApi = url.pathname.startsWith("/api/") || url.pathname === "/healthz" || url.pathname.startsWith("/cal/");
    let status = 500;
    try {
      if (isApi) {
        const corsOk = cors(req, res);
        if (req.method === "OPTIONS") {
          status = corsOk ? 204 : 403;
          res.writeHead(status, BASE_HEADERS).end();
          return;
        }
        if (url.pathname !== "/api/tick") limit("api", ip);
        const route = routes.find(([method, re]) => method === req.method && re.test(url.pathname));
        if (!route) {
          const exists = routes.some(([, re]) => re.test(url.pathname));
          throw exists ? new HttpFail(405, "method", "That method is not allowed here.") : new HttpFail(404, "not_found", "There is nothing at that address.");
        }
        const m = /** @type {RegExpExecArray} */ (route[1].exec(url.pathname));
        const out = await route[2]({ req, res, url, m, ip, token: tokenOf(req, url) });
        const wrapped = out && typeof out === "object" && ("status" in out || "raw" in out) ? out : { status: 200, body: out };
        status = wrapped.status ?? 200;
        if ("raw" in wrapped) {
          res.writeHead(status, { ...BASE_HEADERS, ...wrapped.headers, ...(status === 304 ? {} : { "content-length": String(Buffer.isBuffer(wrapped.raw) ? wrapped.raw.length : Buffer.byteLength(wrapped.raw)) }) });
          res.end(status === 304 ? undefined : wrapped.raw);
        } else sendJson(res, status, wrapped.body);
        // work that must not hold up the answer (the first pick)
        if (typeof wrapped.after === "function") setImmediate(() => Promise.resolve().then(wrapped.after).catch((e) => log("error", { path: url.pathname, message: String(e?.message).slice(0, 200) })));
        return;
      }
      // Opera Mini and phones without JavaScript get plain pages for the links in the chat
      if (url.pathname.startsWith("/basic/") || (req.method === "GET" && (PAGE_ROUTE.test(url.pathname) || APP_ROUTE.test(url.pathname)) && wantsBasic(req, url))) {
        limit("api", ip);
        if (await serveBasic(req, res, url)) {
          status = res.statusCode;
          return;
        }
      }
      if (serveStatic && (await serveStatic(req, res, url.pathname, url.search))) {
        status = 200;
        return;
      }
      status = 404;
      res.writeHead(404, { ...BASE_HEADERS, "content-type": "text/plain; charset=utf-8" }).end("Not found");
    } catch (e) {
      const err = /** @type {any} */ (e);
      if (err instanceof AppError || err instanceof HttpFail) {
        /** @type {any} */
        const known = err;
        status = known.status;
        sendJson(res, status, { error: { code: known.code, message: known.message, ...(known.fields ? { fields: known.fields } : {}) } }, known.retrySec ? { "retry-after": String(known.retrySec) } : {});
      } else {
        status = 500;
        log("error", { path: url.pathname, message: String(err?.stack || err).slice(0, 500) });
        if (!res.headersSent) sendJson(res, 500, { error: { code: "server", message: "Something went wrong on our side. Try again in a minute." } });
        else res.destroy();
      }
    } finally {
      // never log query strings: they carry tokens
      if (isApi) log("req", { method: req.method, path: url.pathname.replace(/\/cal\/[^/]+/, "/cal/:token").replace(/\/(c|p|m)_[a-z0-9_]+/g, "/:id"), status, ms: now() - t0 });
    }
  });
}

/** One JSON line per event on stdout (Render keeps them). */
export const jsonLog = (/** @type {string} */ event, fields = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), event, ...fields }));

/**
 * Build the real (or offline) dependencies from the config.
 * @param {import("../config.mjs").Config} cfg
 */
export async function buildDeps(cfg, log = jsonLog) {
  const store = await openStore(cfg);
  const cache = layeredCache(memoryCache(), storeCache(store));
  // the Lagos pack's curated spots and their sourced entry fees (the only pack with a list)
  const spotsFile = path.resolve(here, "../..", /** @type {any} */ (LAGOS.data).spots);
  const feesFile = path.resolve(here, "../..", /** @type {any} */ (LAGOS.data).fees);
  const fees = fs.existsSync(feesFile) ? JSON.parse(fs.readFileSync(feesFile, "utf8")).fees : [];
  const spots = withEntries(fs.existsSync(spotsFile) ? JSON.parse(fs.readFileSync(spotsFile, "utf8")).spots : [], fees);
  // TIMING=1 also logs every wait of 100 ms or more in a lane (src/adapters/lanes.mjs)
  const onWait = cfg.timing ? (/** @type {any} */ e) => log("lane_wait", e) : undefined;
  // a local model on a laptop can take minutes: someone waiting on it waits that long too
  const budgets = cfg.llm === "ollama" && !cfg.offline ? { gemmaMs: cfg.ollama.timeoutMs + 5000 } : {};
  const common = { store, cache, spots, prompts: loadPrompts(), ids: makeIds(), now: Date.now, log, timing: cfg.timing, budgets };
  if (cfg.offline) {
    return { ...common, feeds: null, ai: laneAi(fakeAi(), { onWait }), geocoder: fakeGeocoder(), places: fakeOverpass(), weather: fakeWeather(), wikidata: fakeWikidata(), pages: fakePageMeta(), push: fakePush({ enabled: false }) };
  }
  return {
    ...common,
    prewarm: true,
    // LLM=gemini (default) or LLM=ollama: every Gemma task goes through this one port, in two
    // lanes: a crew sentence or a plan never waits for the background's calls
    ai: laneAi(createLlm(cfg), { onWait }),
    feeds: createFeeds({ cache, contact: cfg.contact, log }),
    geocoder: createGeocoder({ ...cfg.geocoder, contact: cfg.contact, cache, onWait }),
    places: createOverpass({ urls: cfg.overpassUrls, contact: cfg.contact, cache }),
    weather: createOpenMeteo({ url: cfg.openMeteoUrl, cache }),
    wikidata: cfg.wikidataUrl ? createWikidata({ url: cfg.wikidataUrl, contact: cfg.contact, cache }) : null,
    routes: cfg.osrmUrl ? createOsrm({ url: cfg.osrmUrl, contact: cfg.contact, cache, log, onWait }) : null,
    pages: createPageMeta({ contact: cfg.contact, imageMaxBytes: cfg.imageMaxBytes }),
    push: await createWebPush(cfg.vapid),
  };
}

async function main() {
  loadDotEnv();
  const cfg = config();
  const deps = await buildDeps(cfg);
  const service = createService({ ...deps, cfg });
  const ideas = createIdeas({ store: deps.store, cache: deps.cache, ai: deps.ai, feeds: deps.feeds, weather: deps.weather, geocoder: deps.geocoder, candidatesNear: service._internal.candidatesNear, spots: deps.spots, prompts: deps.prompts, now: deps.now, log: jsonLog, timing: deps.timing });
  const server = createApi({ service, cfg, log: jsonLog, ideas });
  // a local model on a laptop can take minutes; the request must outlive it
  server.requestTimeout = cfg.llm === "ollama" && !cfg.offline ? Math.max(60_000, cfg.ollama.timeoutMs + 15_000) : 60_000;
  server.headersTimeout = 20_000;
  server.listen(cfg.port, () => {
    jsonLog("listening", { port: cfg.port, store: deps.store.kind, ai: deps.ai.available ? cfg.offline ? "offline stand-in" : describeLlm(cfg) : "off", push: deps.push.enabled, web: !!staticHandler(cfg.staticDir), offline: cfg.offline, trustProxyHops: cfg.trustProxyHops });
  });
  const stop = async () => {
    server.close();
    await deps.store.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
