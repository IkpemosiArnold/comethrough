// @ts-check
// Named green and outdoor places near a point, from OpenStreetMap through Overpass.
//
// The public instance is shared and sometimes "at capacity" (a 502 or 504; it happened on
// the first try during research on 21 Oct 2026), so the query is bounded (a radius, a
// server timeout, a result cap), the call retries with backoff and can fail over to a
// second endpoint (OVERPASS_URL takes a comma-separated list), and results are cached for
// a day. Unnamed features are skipped: in Lekki most mapped green is unnamed grass, and
// "meet at an unnamed lawn" is not a plan.

import { GREEN_TAGS } from "../core/places.mjs";
import { cached, fetchJson, userAgent } from "./http.mjs";

/** @typedef {import("./http.mjs").Cache} Cache */
/** @typedef {import("../core/places.mjs").Candidate} Candidate */

const TTL = 24 * 3600_000;
const KEEP_TAGS = ["name", "leisure", "natural", "landuse", "amenity", "tourism", "fee", "access", "opening_hours", "addr:street", "addr:city", "website"];

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
 * @param {{ urls: string[], contact: string, cache: Cache, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<any> }} cfg
 * @returns {{ greenNear(at: { lat: number, lon: number }, radiusM: number): Promise<Candidate[]> }}
 */
export function createOverpass({ urls, contact, cache, fetchImpl, sleep }) {
  return {
    async greenNear(at, radiusM) {
      const key = `osm:green:${at.lat.toFixed(3)},${at.lon.toFixed(3)}:${Math.round(radiusM)}`;
      return cached(cache, key, TTL, async () => {
        const body = `data=${encodeURIComponent(greenQuery(at, radiusM))}`;
        /** @type {any} */
        let last = null;
        for (const url of urls) {
          try {
            const json = await fetchJson(url, {
              method: "POST",
              headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": userAgent(contact), accept: "application/json" },
              body,
              timeoutMs: 30000,
              retries: 2,
              backoffMs: 2000,
              maxBytes: 3_000_000,
              fetchImpl,
              sleep,
            });
            return readOverpass(json);
          } catch (e) {
            last = e;
          }
        }
        throw last;
      });
    },
  };
}
