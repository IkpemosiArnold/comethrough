// @ts-check
// Road routes from OSRM (Open Source Routing Machine) over OpenStreetMap data.
//
// The default server is the public demo, router.project-osrm.org. Its policy (checked 21 Oct
// 2026, github.com/Project-OSRM/osrm-backend/wiki/Demo-server and the older Api-usage-policy
// page): reasonable, non-commercial use only, at most one request a second, a valid
// User-Agent that names the app, no heavy use, ODbL attribution, no uptime guarantee. So this
// adapter sends one request at a time with a gap of at least a second, names itself, caches
// every answer for a week (roads change slowly), gives up after 3 seconds, and stops asking
// for five minutes after a failure. Set OSRM_URL to a server of your own for real traffic.
//
// OSRM's durations are free-flow times from road speeds: they know nothing about Lagos
// traffic (osrm-talk, Nov 2023). The core uses the road distance and the route's bridge
// names, and applies its own traffic bands (src/core/geo.mjs).

import { cached, fetchJson, throttle, userAgent } from "./http.mjs";

/** @typedef {import("./http.mjs").Cache} Cache */
/** @typedef {import("../core/geo.mjs").Route} Route */

const WEEK = 7 * 24 * 3600_000;
const c5 = (/** @type {{ lat: number, lon: number }} */ p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`;
const k4 = (/** @type {{ lat: number, lon: number }} */ p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;

/**
 * Read one route: road km, OSRM's free-flow minutes, and the names of the bridges it uses.
 * @param {any} json
 * @returns {Route|null}
 */
export function readRoute(json) {
  const r = json?.code === "Ok" ? json.routes?.[0] : null;
  if (!r || !Number.isFinite(r.distance) || !Number.isFinite(r.duration)) return null;
  /** @type {string[]} */
  const bridges = [];
  for (const leg of r.legs || []) for (const s of leg.steps || []) if (typeof s.name === "string" && /bridge/i.test(s.name) && !bridges.includes(s.name)) bridges.push(s.name);
  return { km: Math.round(r.distance / 100) / 10, min: Math.round(r.duration / 6) / 10, bridges };
}

/**
 * Read a table: road km and free-flow minutes from each source to each destination.
 * @param {any} json
 * @returns {{ km: (number|null)[][], min: (number|null)[][] }|null}
 */
export function readTable(json) {
  if (json?.code !== "Ok" || !Array.isArray(json.distances) || !Array.isArray(json.durations)) return null;
  const km = json.distances.map((/** @type {any[]} */ row) => row.map((d) => (Number.isFinite(d) ? Math.round(d / 100) / 10 : null)));
  const min = json.durations.map((/** @type {any[]} */ row) => row.map((d) => (Number.isFinite(d) ? Math.round(d / 6) / 10 : null)));
  return { km, min };
}

/**
 * @param {{ url?: string, contact: string, cache: Cache, fetchImpl?: typeof fetch, timeoutMs?: number, now?: () => number, log?: (event: string, fields?: any) => void }} cfg
 */
export function createOsrm({ url = "https://router.project-osrm.org", contact, cache, fetchImpl, timeoutMs = 3000, now = Date.now, log = () => {} }) {
  const base = url.replace(/\/+$/, "");
  const gate = throttle(1100);
  let downUntil = 0;
  const headers = { "user-agent": userAgent(contact), accept: "application/json" };

  /** @param {string} u */
  async function get(u) {
    if (now() < downUntil) throw new Error("OSRM was failing a moment ago");
    try {
      return await gate(() => fetchJson(u, { headers, timeoutMs, retries: 0, fetchImpl }));
    } catch (e) {
      downUntil = now() + 5 * 60_000;
      log("osrm_error", { message: String(/** @type {any} */ (e).message).slice(0, 120) });
      throw e;
    }
  }

  return {
    /**
     * A driving route, or null when OSRM has none or is unreachable (the caller falls back).
     * @param {{ lat: number, lon: number }} from
     * @param {{ lat: number, lon: number }} to
     * @returns {Promise<Route|null>}
     */
    async route(from, to) {
      try {
        return await cached(cache, `osrm:r:${k4(from)}>${k4(to)}`, WEEK, async () => readRoute(await get(`${base}/route/v1/driving/${c5(from)};${c5(to)}?overview=false&steps=true`)));
      } catch {
        return null;
      }
    },
    /**
     * Road km and free-flow minutes from every source to every destination, in one request.
     * @param {{ lat: number, lon: number }[]} sources
     * @param {{ lat: number, lon: number }[]} destinations
     */
    async table(sources, destinations) {
      if (!sources.length || !destinations.length || sources.length + destinations.length > 100) return null;
      const all = [...sources, ...destinations];
      const key = `osrm:t:${all.map(k4).join(";")}:${sources.length}`;
      try {
        return await cached(cache, key, WEEK, async () => {
          const s = sources.map((_, i) => i).join(";");
          const d = destinations.map((_, i) => i + sources.length).join(";");
          return readTable(await get(`${base}/table/v1/driving/${all.map(c5).join(";")}?sources=${s}&destinations=${d}&annotations=distance,duration`));
        });
      } catch {
        return null;
      }
    },
  };
}
