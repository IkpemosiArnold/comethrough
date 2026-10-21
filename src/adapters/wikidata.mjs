// @ts-check
// Parks, gardens and beaches near a point, from Wikidata (CC0), for crews in a city with no
// curated spots. OpenStreetMap often lacks the places people know by name (in Lagos it had
// neither Elegushi Beach nor JJT Park), and Wikidata often has them, with coordinates.
//
// One SPARQL query by coordinates (the wikibase:around service) to the public Wikidata Query
// Service. Its rules (checked 21 Oct 2026, https://www.mediawiki.org/wiki/Wikidata_Query_Service/User_Manual
// and the Wikimedia User-Agent policy): an identifying User-Agent, no more than a few queries
// at a time, and 60 seconds of query time a minute per client. So the query is bounded (a
// radius, a LIMIT, a server timeout), it runs only in the heartbeat, at most once a week for
// each spot (results are cached for 7 days), and a failure just means the Overpass results
// carry the ritual on their own.

import { cached, fetchJson, userAgent } from "./http.mjs";

/** @typedef {import("./http.mjs").Cache} Cache */
/** @typedef {import("../core/places.mjs").Candidate} Candidate */

const TTL = 7 * 24 * 3600_000;

/** Wikidata classes that make a meetup spot, and the OpenStreetMap-style tags each one gets. */
export const WIKIDATA_KINDS = {
  Q22698: { leisure: "park" }, // park
  Q22746: { leisure: "park" }, // urban park
  Q1107656: { leisure: "garden" }, // garden
  Q167346: { leisure: "garden" }, // botanical garden
  Q40080: { natural: "beach" }, // beach
};

/**
 * The SPARQL query for named parks, gardens and beaches within radiusKm of a point,
 * nearest first. Items with a dissolution date (P576) are left out.
 * @param {{ lat: number, lon: number }} at
 * @param {number} radiusKm
 * @param {number} [limit]
 */
export function spotsQuery({ lat, lon }, radiusKm, limit = 60) {
  return `SELECT ?item ?itemLabel ?type ?coord ?dist WHERE {
  SERVICE wikibase:around {
    ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:center "Point(${lon.toFixed(5)} ${lat.toFixed(5)})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${Math.max(0.5, Math.min(30, radiusKm)).toFixed(1)}" .
    bd:serviceParam wikibase:distance ?dist .
  }
  VALUES ?type { ${Object.keys(WIKIDATA_KINDS).map((q) => `wd:${q}`).join(" ")} }
  ?item wdt:P31 ?type .
  FILTER NOT EXISTS { ?item wdt:P576 ?ended . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
}
ORDER BY ?dist
LIMIT ${limit}`;
}

/**
 * SPARQL JSON results to candidates. Pure; exported for tests. An item with no label (the
 * label service then answers with its Q-id) is skipped, and each item appears once.
 * @param {any} json
 * @param {string} checkedAt  "YYYY-MM-DD"
 * @returns {Candidate[]}
 */
export function readWikidata(json, checkedAt) {
  /** @type {Map<string, Candidate>} */
  const out = new Map();
  for (const b of json?.results?.bindings || []) {
    const item = String(b.item?.value || "").replace(/^https?:\/\/www\.wikidata\.org\/entity\//, "");
    const name = String(b.itemLabel?.value || "").trim();
    const type = String(b.type?.value || "").replace(/^https?:\/\/www\.wikidata\.org\/entity\//, "");
    const m = /^Point\(([-\d.]+) ([-\d.]+)\)$/.exec(String(b.coord?.value || ""));
    if (!/^Q\d+$/.test(item) || !name || /^Q\d+$/.test(name) || !m || out.has(item)) continue;
    const tags = WIKIDATA_KINDS[/** @type {keyof typeof WIKIDATA_KINDS} */ (type)];
    if (!tags) continue;
    out.set(item, {
      name,
      lat: Number(m[2]),
      lon: Number(m[1]),
      tags: { name, ...tags },
      outdoor: true,
      wikidata: item,
      source: { url: `https://www.wikidata.org/wiki/${item}`, publisher: "Wikidata", says: `${name} (${item}), coordinate location (P625)`, checkedAt },
    });
  }
  return [...out.values()];
}

/**
 * @param {{ url?: string, contact: string, cache: Cache, fetchImpl?: typeof fetch, timeoutMs?: number, now?: () => number }} cfg
 * @returns {{ spotsNear(at: { lat: number, lon: number }, radiusKm: number): Promise<Candidate[]> }}
 */
export function createWikidata({ url = "https://query.wikidata.org/sparql", contact, cache, fetchImpl, timeoutMs = 15000, now = Date.now }) {
  return {
    async spotsNear(at, radiusKm) {
      const key = `wd:spots:${at.lat.toFixed(3)},${at.lon.toFixed(3)}:${Math.round(radiusKm)}`;
      return cached(cache, key, TTL, async () => {
        const u = new URL(url);
        u.searchParams.set("query", spotsQuery(at, radiusKm));
        u.searchParams.set("format", "json");
        const json = await fetchJson(u.href, { headers: { "user-agent": userAgent(contact), accept: "application/sparql-results+json" }, timeoutMs, retries: 0, fetchImpl });
        return readWikidata(json, new Date(now()).toISOString().slice(0, 10));
      });
    },
  };
}
