// @ts-check
// All settings come from the environment (12-factor). In development, a .env file in the
// working directory is read first; variables already set in the environment win. Nothing
// here depends on where the repo lives on disk. See .env.example for every variable.

import fs from "node:fs";
import path from "node:path";

/**
 * Read KEY=VALUE lines from a .env file into process.env without overwriting what is set.
 * Supports comments, blank lines, `export KEY=...` and single or double quotes.
 * @param {string} [file]
 */
export function loadDotEnv(file = path.resolve(".env")) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return false;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
  return true;
}

const num = (/** @type {string|undefined} */ v, /** @type {number} */ d) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
const list = (/** @type {string|undefined} */ v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
/** Origins ("https://a.example") from a comma-separated list; anything that is not an http(s) URL is dropped. */
const origins = (/** @type {string|undefined} */ v) =>
  list(v).flatMap((s) => {
    try {
      const u = new URL(s);
      return /^https?:$/.test(u.protocol) ? [u.origin] : [];
    } catch {
      return [];
    }
  });

/**
 * The resolved configuration.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function config(env = process.env) {
  const port = num(env.PORT, 3000);
  const publicUrl = (env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, "");
  return {
    port,
    /** where this API is reachable; calendar links are built from it */
    publicUrl,
    /** where the web app lives; invite links point there */
    webUrl: (env.WEB_URL || publicUrl).replace(/\/+$/, ""),
    /**
     * Other origins allowed to call the API from a browser (CORS), comma separated. The app is
     * served from PUBLIC_URL itself, which never needs CORS, so this is usually empty.
     * WEB_ORIGIN is the older name. Entries that are not URLs are dropped.
     */
    webOrigins: origins(env.ALLOWED_ORIGINS ?? env.WEB_ORIGIN ?? env.WEB_URL ?? ""),
    dataDir: path.resolve(env.DATA_DIR || ".data"),
    mongoUri: env.MONGODB_URI || "",
    mongoDb: env.MONGODB_DB || "comethrough",
    gemini: {
      key: env.GEMINI_API_KEY || "",
      model: env.GEMMA_MODEL || "gemma-4-26b-a4b-it",
      fallbacks: list(env.GEMMA_FALLBACKS ?? "gemma-4-31b-it"),
      visionModel: env.GEMMA_VISION_MODEL || "",
      timeoutMs: num(env.GEMMA_TIMEOUT_MS, 25000),
    },
    /** which adapter answers every Gemma task: the Gemini API (default) or your own Ollama */
    llm: /** @type {"gemini"|"ollama"} */ (String(env.LLM || "").toLowerCase() === "ollama" ? "ollama" : "gemini"),
    ollama: {
      url: (env.OLLAMA_URL || "http://localhost:11434").replace(/\/+$/, ""),
      model: env.OLLAMA_MODEL || "gemma3:4b",
      /** auto: ask Ollama whether the model has a vision projector; yes or no to override */
      vision: /** @type {"auto"|"yes"|"no"} */ (["yes", "no"].includes(String(env.OLLAMA_VISION)) ? env.OLLAMA_VISION : "auto"),
      /** a small model on a laptop is slow: three minutes by default */
      timeoutMs: num(env.OLLAMA_TIMEOUT_MS, 180_000),
    },
    geocoder: {
      // Photon for search and type-ahead (Nominatim forbids autocomplete); Nominatim for single lookups
      provider: /** @type {"nominatim"|"photon"} */ (env.GEOCODER === "nominatim" ? "nominatim" : "photon"),
      nominatimUrl: env.NOMINATIM_URL || "https://nominatim.openstreetmap.org",
      photonUrl: env.PHOTON_URL || "https://photon.komoot.io",
      // empty by default: each crew's city pack says which country to keep to (Lagos: NG)
      countryCodes: env.GEOCODE_COUNTRY || "",
    },
    /** comma-separated; each is tried in turn when the one before is at capacity or slow */
    overpassUrls: list(env.OVERPASS_URL || "https://overpass-api.de/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter,https://overpass.private.coffee/api/interpreter"),
    openMeteoUrl: env.OPEN_METEO_URL || "https://api.open-meteo.com/v1/forecast",
    /** parks and beaches near crews in cities with no pack (Wikidata Query Service); WIKIDATA_URL=off to skip */
    wikidataUrl: env.WIKIDATA_URL === "off" ? "" : env.WIKIDATA_URL || "https://query.wikidata.org/sparql",
    /** road routes for travel times; the public OSRM demo by default (light, non-commercial use, one request a second); OSRM_URL=off for the straight-line estimate */
    osrmUrl: env.OSRM_URL === "off" ? "" : env.OSRM_URL || "https://router.project-osrm.org",
    /** sent in User-Agent to OpenStreetMap services, as their usage policies ask */
    contact: env.CONTACT || "https://github.com/IkpemosiArnold/comethrough",
    tickSecret: env.TICK_SECRET || "",
    /** proxies in front that append to X-Forwarded-For: 3 on Render behind Cloudflare (measured for Selects), 0 locally */
    trustProxyHops: num(env.TRUST_PROXY_HOPS, env.RENDER ? 3 : 0),
    imageMaxBytes: num(env.IMAGE_MAX_BYTES, 5 * 1024 * 1024),
    uidDomain: env.UID_DOMAIN || "comethrough.tech",
    /** the built web app, served by this server when the folder exists (one origin, no CORS needed) */
    staticDir: path.resolve(env.STATIC_DIR || "web/dist"),
    vapid: { publicKey: env.VAPID_PUBLIC_KEY || "", privateKey: env.VAPID_PRIVATE_KEY || "", subject: env.VAPID_SUBJECT || "mailto:hello@comethrough.tech" },
    /** TIMING=1: one `timing` log line per slow flow (crew draft and create, first pick, plan parse and add, ideas), with its stages */
    timing: env.TIMING === "1" || env.TIMING === "true",
    /** OFFLINE=1: fake geocoding, places, weather, links and a regex stand-in for Gemma (UI work with no keys or network) */
    offline: env.OFFLINE === "1" || env.OFFLINE === "true",
  };
}

/** @typedef {ReturnType<typeof config>} Config */
