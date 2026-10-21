// @ts-check
// Named green and outdoor places near a point, from OpenStreetMap through Overpass.
//
// The public instances are shared and often "at capacity". In the smoke test on 21 Oct
// 2026, overpass-api.de answered 502 in a second, two mirrors hung past 40 s, and only
// maps.mail.ru answered (17 to 19 s). So the query is bounded (a radius, a server timeout,
// a result cap), each endpoint gets one attempt of at most 25 s before the next is tried
// (OVERPASS_URL takes a comma-separated list), and the whole call has a 40 s budget. It
// runs only in the heartbeat, never while someone waits, but the heartbeat itself must
// answer within Cloudflare's 100 s (Render sits behind it): on 21 Oct 2026 a 90 s budget
// tried twice made one tick take 166 s. Results are cached for a week (parks do not
// move). When every endpoint fails, the ritual still has the curated spots. Unnamed features are skipped: in Lekki most mapped
// green is unnamed grass, and "meet at an unnamed lawn" is not a plan.

import { GREEN_TAGS } from "../core/places.mjs";
import { cached, fetchJson, userAgent } from "./http.mjs";

/** @typedef {import("./http.mjs").Cache} Cache */
/** @typedef {import("../core/places.mjs").Candidate} Candidate */

const TTL = 7 * 24 * 3600_000;
const KEEP_TAGS = ["name", "leisure", "natural", "landuse", "amenity", "tourism", "shop", "fee", "access", "opening_hours", "outdoor_seating", "wheelchair", "addr:street", "addr:city", "website"];

/**
 * The Overpass QL query for named green places within radiusM of a point.
 * @param {{ lat: number, lon: number }} at
 * @param {number} radiusM
 * @param {number} [limit]
 */
export function greenQuery({ lat, lon }, radiusM, limit = 150) {
  const around = `(around:${Math.round(radiusM)},${lat.toFixed(5)},${lon.toFixed(5)})`;
  const lines = Object.entries(GREEN_TAGS).map(([k, vs]) => `  nwr${around}["${k}"~"^(${vs.join("|")})$"]["name"];`);
  return `[out:json][timeout:25];\n(\n${lines.join("\n")}\n);\nout center tags ${limit};`;
}

/**
 * The Overpass QL query for named places with any of these tags within radiusM: a crew's
 * taste (src/core/taste.mjs, osmTagsFor), e.g. { tourism: ["gallery"], amenity: ["cafe"] }.
 * @param {{ lat: number, lon: number }} at
 * @param {number} radiusM
 * @param {Record<string, string[]>} tags
 * @param {number} [limit]
 */
export function kindsQuery({ lat, lon }, radiusM, tags, limit = 120) {
  const around = `(around:${Math.round(radiusM)},${lat.toFixed(5)},${lon.toFixed(5)})`;
  const safe = (/** @type {string} */ x) => x.replace(/[^a-z_:]/gi, "");
  const lines = Object.entries(tags).filter(([, vs]) => vs.length).map(([k, vs]) => `  nwr${around}["${safe(k)}"~"^(${vs.map(safe).join("|")})$"]["name"];`);
  return `[out:json][timeout:25];\n(\n${lines.join("\n")}\n);\nout center tags ${limit};`;
}

/** Overpass elements to candidates. Pure; exported for tests. */
export function readOverpass(json) {
  /** @type {Candidate[]} */
  const out = [];
  for (const el of json?.elements || []) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    const name = el.tags?.name;
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (el.tags.access === "private" || el.tags.access === "no") continue;
    const tags = Object.fromEntries(KEEP_TAGS.filter((k) => el.tags[k] != null).map((k) => [k, String(el.tags[k])]));
    const address = [el.tags["addr:street"], el.tags["addr:city"]].filter(Boolean).join(", ");
    out.push({ name, lat, lon, ...(address ? { address } : {}), osm: { type: el.type, id: el.id, tags } });
  }
  return out;
}

/**
 * @param {{ urls: string[], contact: string, cache: Cache, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<any>, attemptMs?: number, budgetMs?: number, now?: () => number }} cfg
 * @returns {{ greenNear(at: { lat: number, lon: number }, radiusM: number): Promise<Candidate[]>, kindsNear(at: { lat: number, lon: number }, radiusM: number, tags: Record<string, string[]>): Promise<Candidate[]> }}
 */
export function createOverpass({ urls, contact, cache, fetchImpl, sleep, attemptMs = 25000, budgetMs = 40000, now = Date.now }) {
  /** One query, cached a week, tried on each endpoint in turn. @param {string} key @param {string} query */
  function ask(key, query) {
    return cached(cache, key, TTL, async () => {
      const body = `data=${encodeURIComponent(query)}`;
      const deadline = now() + budgetMs;
      /** @type {any} */
      let last = null;
      for (const url of urls) {
        const left = deadline - now();
        if (left < 2000) break;
        try {
          const json = await fetchJson(url, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": userAgent(contact), accept: "application/json" },
            body,
            timeoutMs: Math.min(attemptMs, left),
            retries: 0,
            maxBytes: 3_000_000,
            fetchImpl,
            sleep,
          });
          return readOverpass(json);
        } catch (e) {
          last = e; // at capacity or slow: the next endpoint, at once
        }
      }
      throw last ?? new Error("Overpass: no endpoint answered in time");
    });
  }
  return {
    greenNear(at, radiusM) {
      return ask(`osm:green:${at.lat.toFixed(3)},${at.lon.toFixed(3)}:${Math.round(radiusM)}`, greenQuery(at, radiusM));
    },
    kindsNear(at, radiusM, tags) {
      const sig = Object.entries(tags).map(([k, vs]) => `${k}=${[...vs].sort().join("|")}`).sort().join(";");
      return ask(`osm:kinds:${at.lat.toFixed(3)},${at.lon.toFixed(3)}:${Math.round(radiusM)}:${sig}`, kindsQuery(at, radiusM, tags));
    },
  };
}
