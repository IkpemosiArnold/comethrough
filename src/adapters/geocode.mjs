// @ts-check
// Geocoding area names ("Yaba") and venues to coordinates, from OpenStreetMap data.
//
// Photon (komoot) is the default: it is built for search-as-you-type, so it also serves the
// area type-ahead (/api/areas). Nominatim forbids autocomplete and allows at most one
// request a second with an identifying User-Agent, so it is used only for single lookups
// when GEOCODER=nominatim. Both are throttled and cached (30 days; places do not move).

import { cached, fetchJson, throttle, userAgent } from "./http.mjs";

/** @typedef {import("./http.mjs").Cache} Cache */
/** @typedef {{ label: string, detail: string, lat: number, lon: number, osm?: { type: string, id: number }, cls?: string }} GeoResult */
/**
 * @typedef {object} Geocoder
 * @property {(q: string, opts?: { limit?: number, areas?: boolean }) => Promise<GeoResult[]>} search  areas: only neighbourhoods, towns and the like
 * @property {(q: string) => Promise<GeoResult|null>} lookup      a venue or an address
 * @property {(q: string) => Promise<GeoResult|null>} lookupArea  a neighbourhood ("Yaba" is the district, not Yaba College of Technology)
 */

/** Lagos: where results are biased. */
export const LAGOS_BIAS = { lat: 6.52, lon: 3.38 };
const TTL = 30 * 24 * 3600_000;
const OSM_TYPES = { N: "node", W: "way", R: "relation", node: "node", way: "way", relation: "relation" };

const norm = (/** @type {string} */ q) => q.toLowerCase().replace(/\s+/g, " ").trim();
const uniq = (/** @type {string[]} */ xs) => xs.filter((x, i) => x && xs.indexOf(x) === i);

/** Photon's GeoJSON features to results. Pure; exported for tests. */
export function readPhoton(json, { countryCode = "NG" } = {}) {
  return (json?.features || [])
    .filter((/** @type {any} */ f) => !countryCode || String(f.properties?.countrycode || "").toUpperCase() === countryCode.toUpperCase())
    .map((/** @type {any} */ f) => {
      const p = f.properties || {};
      const [lon, lat] = f.geometry?.coordinates || [];
      const label = p.name || [p.housenumber, p.street].filter(Boolean).join(" ") || p.district || p.city;
      return {
        label,
        detail: uniq([p.street && p.name ? p.street : "", p.district, p.locality, p.city, p.county, p.state].filter((x) => x && x !== label)).slice(0, 3).join(", "),
        lat,
        lon,
        ...(p.osm_type && p.osm_id ? { osm: { type: OSM_TYPES[/** @type {keyof typeof OSM_TYPES} */ (p.osm_type)] || p.osm_type, id: p.osm_id } } : {}),
        ...(p.osm_key ? { cls: p.osm_key } : {}),
      };
    })
    .filter((/** @type {any} */ r) => r.label && Number.isFinite(r.lat) && Number.isFinite(r.lon));
}

/** Nominatim's jsonv2 results to results. Pure; exported for tests. */
export function readNominatim(json) {
  return (Array.isArray(json) ? json : []).map((r) => {
    const parts = String(r.display_name || "").split(",").map((s) => s.trim());
    return {
      label: r.name || parts[0],
      detail: parts.slice(1, 4).join(", "),
      lat: Number(r.lat),
      lon: Number(r.lon),
      ...(r.osm_type && r.osm_id ? { osm: { type: OSM_TYPES[/** @type {keyof typeof OSM_TYPES} */ (r.osm_type)] || r.osm_type, id: Number(r.osm_id) } } : {}),
      ...(r.category ? { cls: r.category } : {}),
    };
  }).filter((r) => r.label && Number.isFinite(r.lat) && Number.isFinite(r.lon));
}

/**
 * @param {{ provider: "photon"|"nominatim", photonUrl: string, nominatimUrl: string, countryCodes: string, contact: string, cache: Cache, fetchImpl?: typeof fetch, bias?: { lat: number, lon: number } }} cfg
 * @returns {Geocoder}
 */
export function createGeocoder({ provider, photonUrl, nominatimUrl, countryCodes, contact, cache, fetchImpl, bias = LAGOS_BIAS }) {
  const headers = { "user-agent": userAgent(contact), accept: "application/json" };
  const photonGate = throttle(250);
  const nominatimGate = throttle(1100); // "an absolute maximum of 1 request per second"
  const country = countryCodes.split(",")[0] || "";

  const photon = (/** @type {string} */ q, /** @type {number} */ limit, /** @type {boolean} */ areas) =>
    photonGate(async () => {
      const u = new URL("/api/", photonUrl);
      u.searchParams.set("q", q);
      // places only: suburbs, neighbourhoods, towns (the smoke test's "Yaba, Lagos" otherwise found a college first)
      if (areas) u.searchParams.set("osm_tag", "place");
      u.searchParams.set("limit", String(Math.min(10, limit * 2)));
      u.searchParams.set("lat", String(bias.lat));
      u.searchParams.set("lon", String(bias.lon));
      u.searchParams.set("lang", "en");
      return readPhoton(await fetchJson(u.href, { headers, timeoutMs: 8000, retries: 1, fetchImpl }), { countryCode: country }).slice(0, limit);
    });

  const nominatim = (/** @type {string} */ q, /** @type {number} */ limit, /** @type {boolean} */ areas) =>
    nominatimGate(async () => {
      const u = new URL("/search", nominatimUrl);
      u.searchParams.set("q", q);
      u.searchParams.set("format", "jsonv2");
      u.searchParams.set("limit", String(limit));
      if (countryCodes) u.searchParams.set("countrycodes", countryCodes);
      u.searchParams.set("viewbox", "2.70,6.75,4.40,6.35"); // prefer Lagos, without excluding elsewhere
      const rs = readNominatim(await fetchJson(u.href, { headers: { ...headers, "accept-language": "en" }, timeoutMs: 10000, retries: 1, fetchImpl }));
      return areas ? rs.filter((r) => r.cls === "place" || r.cls === "boundary") : rs;
    });

  const search = async (/** @type {string} */ q, { limit = 5, areas = false } = {}) => {
    const query = norm(String(q || "")).slice(0, 120);
    if (query.length < 2) return [];
    return cached(cache, `geo:${provider}:${areas ? "area" : "any"}:${limit}:${query}`, TTL, () => (provider === "nominatim" ? nominatim(query, limit, areas) : photon(query, limit, areas)));
  };
  // a bare name reads better with the city ("Yaba" -> "Yaba, Lagos")
  const withCity = (/** @type {string} */ q) => (/lagos/i.test(q) ? q : `${q}, Lagos`);
  return {
    search,
    async lookup(q) {
      return (await search(withCity(q), { limit: 1 }))[0] ?? null;
    },
    async lookupArea(q) {
      return (await search(withCity(q), { limit: 1, areas: true }))[0] ?? (await search(withCity(q), { limit: 1 }))[0] ?? null;
    },
  };
}
