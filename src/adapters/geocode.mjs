// @ts-check
// Geocoding area names ("Yaba") and venues to coordinates, from OpenStreetMap data.
//
// Photon (komoot) is the default: it is built for search-as-you-type, so it also serves the
// area type-ahead (/api/areas). Nominatim forbids autocomplete and allows at most one
// request a second with an identifying User-Agent, so it is used only for single lookups
// when GEOCODER=nominatim. Both are throttled and cached (30 days; places do not move).
//
// Where to look comes with each call, from the crew's city pack (src/packs): a point to bias
// toward, a country to keep to, and whether to add the city to a bare name. Lagos keeps what
// it always did (bias to Lagos, Nigeria only, ", Lagos" added). Anywhere else, results are
// biased to the crew's centre and no city is added, except to retry a name that found
// nothing within 50 km of the crew ("Westlands" alone could be anywhere).

import { cached, fetchJson, throttle, userAgent } from "./http.mjs";

/** @typedef {import("./http.mjs").Cache} Cache */
/** @typedef {{ label: string, detail: string, lat: number, lon: number, osm?: { type: string, id: number }, cls?: string, country?: string, city?: string }} GeoResult */
/** @typedef {import("../packs/index.mjs").GeocodeContext} GeocodeContext */
/**
 * @typedef {object} Geocoder
 * @property {(q: string, opts?: { limit?: number, areas?: boolean, near?: { lat: number, lon: number }|null, country?: string|null, viewbox?: string }) => Promise<GeoResult[]>} search  areas: only neighbourhoods, towns and the like
 * @property {(q: string, ctx?: Partial<GeocodeContext>) => Promise<GeoResult|null>} lookup      a venue or an address
 * @property {(q: string, ctx?: Partial<GeocodeContext>) => Promise<GeoResult|null>} lookupArea  a neighbourhood ("Yaba" is the district, not Yaba College of Technology)
 * @property {(at: { lat: number, lon: number }) => Promise<{ label: string, country?: string, city?: string }|null>} [reverse]  the neighbourhood's name at a point (the caller rounds the point first)
 */

/** Beyond this distance from the crew's centre, a hit is not trusted and the city is added. */
export const NEAR_KM = 50;
const TTL = 30 * 24 * 3600_000;
const OSM_TYPES = { N: "node", W: "way", R: "relation", node: "node", way: "way", relation: "relation" };

const norm = (/** @type {string} */ q) => q.toLowerCase().replace(/\s+/g, " ").trim();
const uniq = (/** @type {string[]} */ xs) => xs.filter((x, i) => x && xs.indexOf(x) === i);

/** The city a Photon feature is in (or is): the city, else the place itself when it is a city or town. */
const photonCity = (/** @type {any} */ p) => p.city || (["city", "town"].includes(p.type) || ["city", "town"].includes(p.osm_value) ? p.name : null) || p.county || null;

/** Photon's GeoJSON features to results, kept to one country when one is given. Pure; exported for tests. */
export function readPhoton(json, { countryCode = "" } = {}) {
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
        ...(p.countrycode ? { country: String(p.countrycode).toUpperCase() } : {}),
        ...(photonCity(p) ? { city: photonCity(p) } : {}),
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

const R_KM = 6371.0088;
const kmBetween = (/** @type {{ lat: number, lon: number }} */ a, /** @type {{ lat: number, lon: number }} */ b) => {
  const r = (/** @type {number} */ d) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

/**
 * @param {{ provider: "photon"|"nominatim", photonUrl: string, nominatimUrl: string, countryCodes?: string, contact: string, cache: Cache, fetchImpl?: typeof fetch }} cfg
 *   countryCodes: kept for GEOCODE_COUNTRY; a call's own context wins
 * @returns {Geocoder}
 */
export function createGeocoder({ provider, photonUrl, nominatimUrl, countryCodes = "", contact, cache, fetchImpl }) {
  const headers = { "user-agent": userAgent(contact), accept: "application/json" };
  const photonGate = throttle(250);
  const nominatimGate = throttle(1100); // "an absolute maximum of 1 request per second"
  const envCountry = countryCodes.split(",")[0] || "";

  const photon = (/** @type {string} */ q, /** @type {number} */ limit, /** @type {boolean} */ areas, /** @type {{ lat: number, lon: number }|null} */ near, /** @type {string} */ country) =>
    photonGate(async () => {
      const u = new URL("/api/", photonUrl);
      u.searchParams.set("q", q);
      // places only: suburbs, neighbourhoods, towns (the smoke test's "Yaba, Lagos" otherwise found a college first)
      if (areas) u.searchParams.set("osm_tag", "place");
      u.searchParams.set("limit", String(Math.min(10, limit * 2)));
      if (near) {
        u.searchParams.set("lat", String(near.lat));
        u.searchParams.set("lon", String(near.lon));
      }
      u.searchParams.set("lang", "en");
      return readPhoton(await fetchJson(u.href, { headers, timeoutMs: 8000, retries: 1, fetchImpl }), { countryCode: country }).slice(0, limit);
    });

  const nominatim = (/** @type {string} */ q, /** @type {number} */ limit, /** @type {boolean} */ areas, /** @type {string} */ country, /** @type {string|undefined} */ viewbox) =>
    nominatimGate(async () => {
      const u = new URL("/search", nominatimUrl);
      u.searchParams.set("q", q);
      u.searchParams.set("format", "jsonv2");
      u.searchParams.set("limit", String(limit));
      if (country) u.searchParams.set("countrycodes", country.toLowerCase());
      if (viewbox) u.searchParams.set("viewbox", viewbox); // prefer the city, without excluding elsewhere
      const rs = readNominatim(await fetchJson(u.href, { headers: { ...headers, "accept-language": "en" }, timeoutMs: 10000, retries: 1, fetchImpl }));
      return areas ? rs.filter((r) => r.cls === "place" || r.cls === "boundary") : rs;
    });

  /** @type {Geocoder["search"]} */
  const search = async (q, { limit = 5, areas = false, near = null, country = null, viewbox = undefined } = {}) => {
    const query = norm(String(q || "")).slice(0, 120);
    if (query.length < 2) return [];
    const cc = country ?? envCountry;
    const where = `${near ? `${near.lat.toFixed(2)},${near.lon.toFixed(2)}` : "-"}:${cc || "-"}`;
    return cached(cache, `geo:${provider}:${areas ? "area" : "any"}:${limit}:${where}:${query}`, TTL, () => (provider === "nominatim" ? nominatim(query, limit, areas, cc, viewbox) : photon(query, limit, areas, near, cc)));
  };

  /**
   * One lookup in the crew's context. Lagos adds ", Lagos" to a bare name, as it always did;
   * elsewhere the bare name is tried near the crew first, and the city is added only when
   * that finds nothing within NEAR_KM of the crew.
   * @param {string} q
   * @param {Partial<GeocodeContext>} ctx
   * @param {boolean} areas
   */
  async function one(q, ctx, areas) {
    const near = ctx.near ?? null;
    const country = ctx.country ?? null;
    const find = async (/** @type {string} */ text) => {
      const opts = { limit: 1, near, country, viewbox: ctx.viewbox };
      const hit = (await search(text, { ...opts, areas }))[0] ?? null;
      return hit ?? (areas ? (await search(text, opts))[0] ?? null : null);
    };
    if (ctx.appendCity) {
      const city = ctx.appendCity;
      return find(q.toLowerCase().includes(city.toLowerCase()) ? q : `${q}, ${city}`);
    }
    const hit = await find(q);
    if (!near) return hit; // no centre yet (a crew's first areas): the best hit anywhere
    const close = (/** @type {GeoResult|null} */ h) => !!h && kmBetween(near, h) <= NEAR_KM;
    if (close(hit)) return hit;
    const city = ctx.cityFallback;
    if (city && !q.toLowerCase().includes(city.toLowerCase())) {
      const again = await find(`${q}, ${city}`);
      if (close(again)) return again;
    }
    return null; // only far-away matches: better "not found" than a pin in another city
  }

  /**
   * The neighbourhood's name at a point: the district, else the locality, else the city.
   * Only the name comes back; the caller looks up that neighbourhood's own centre, so a
   * member's area is never the phone's position. Photon's /reverse; Nominatim's at zoom 14.
   * @type {NonNullable<Geocoder["reverse"]>}
   */
  const reverse = async (at) => {
    const lat = Math.round(at.lat * 100) / 100;
    const lon = Math.round(at.lon * 100) / 100;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return cached(cache, `rev:${provider}:${lat.toFixed(2)},${lon.toFixed(2)}`, TTL, async () => {
      if (provider === "nominatim") {
        return nominatimGate(async () => {
          const u = new URL("/reverse", nominatimUrl);
          u.searchParams.set("lat", String(lat));
          u.searchParams.set("lon", String(lon));
          u.searchParams.set("format", "jsonv2");
          u.searchParams.set("zoom", "14");
          const r = await fetchJson(u.href, { headers: { ...headers, "accept-language": "en" }, timeoutMs: 10000, retries: 1, fetchImpl });
          const a = r?.address || {};
          const label = a.suburb || a.neighbourhood || a.quarter || a.city_district || a.town || a.city || null;
          return label ? { label, ...(a.country_code ? { country: String(a.country_code).toUpperCase() } : {}), ...(a.city || a.town ? { city: a.city || a.town } : {}) } : null;
        });
      }
      return photonGate(async () => {
        const u = new URL("/reverse", photonUrl);
        u.searchParams.set("lat", String(lat));
        u.searchParams.set("lon", String(lon));
        u.searchParams.set("limit", "3");
        u.searchParams.set("lang", "en");
        return readReverse(await fetchJson(u.href, { headers, timeoutMs: 8000, retries: 1, fetchImpl }));
      });
    });
  };

  return {
    search,
    lookup: (q, ctx = {}) => one(q, ctx, false),
    lookupArea: (q, ctx = {}) => one(q, ctx, true),
    reverse,
  };
}

/** The neighbourhood named by Photon's reverse answer: district, else locality, else city. Pure; exported for tests. */
export function readReverse(json) {
  for (const f of json?.features || []) {
    const p = f.properties || {};
    const label = p.district || p.locality || p.city || p.county || null;
    if (label) return { label, ...(p.countrycode ? { country: String(p.countrycode).toUpperCase() } : {}), ...(photonCity(p) ? { city: photonCity(p) } : {}) };
  }
  return null;
}
