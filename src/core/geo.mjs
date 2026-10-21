// @ts-check
// Travel-time estimates for Lagos. They are rough estimates, not live traffic, and the UI
// says so. Two inputs, in order of preference:
//   1. a road route from OSRM (OpenStreetMap data): the real road distance, and the names of
//      the bridges it uses, so a lagoon crossing is claimed only when the route takes Third
//      Mainland, Carter or Eko Bridge;
//   2. when no route is available (OSRM down, or offline), the old straight-line estimate:
//      haversine distance times a road factor, with a lagoon penalty when the two ends are
//      on different sides of the lagoon. The estimate says it is the fallback.
// Either way the time is the road distance at a speed for the hour's traffic band, plus the
// bridge penalty, and never less than OSRM's own free-flow time.
//
// The bands and speeds are assumptions, written down in docs/LOCAL-FACTS.md ("Travel times")
// and kept in one place so they can be tuned (pass { model } to travelEstimate).

import { localParts, DEFAULT_TZ } from "./time.mjs";

/** @typedef {import("./types.mjs").LatLon} LatLon */

const R_KM = 6371.0088;
const rad = (/** @type {number} */ d) => (d * Math.PI) / 180;

/** Great-circle distance in km. */
export function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The mean point of a set of points (fine at city scale). Null for an empty list. */
export function centroid(points) {
  const ps = points.filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (!ps.length) return null;
  return { lat: ps.reduce((s, p) => s + p.lat, 0) / ps.length, lon: ps.reduce((s, p) => s + p.lon, 0) / ps.length };
}

/** True for a usable coordinate. */
export const isLatLon = (/** @type {any} */ p) =>
  !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

/** Roughly metropolitan Lagos. */
export const LAGOS_BBOX = { south: 6.35, north: 6.75, west: 2.7, east: 4.4 };
export const inLagos = (/** @type {LatLon} */ p) =>
  p.lat >= LAGOS_BBOX.south && p.lat <= LAGOS_BBOX.north && p.lon >= LAGOS_BBOX.west && p.lon <= LAGOS_BBOX.east;

/**
 * True for the island side of the Lagos Lagoon (Lagos Island, Ikoyi, Victoria Island, the
 * Lekki peninsula and Ajah), false for the mainland (Yaba, Surulere, Ikeja, Apapa,
 * Ikorodu). A two-line heuristic: south of 6.475 N and east of 3.385 E. It is checked
 * against the neighbourhoods in test/geo.test.mjs.
 */
export const islandSide = (/** @type {LatLon} */ p) => inLagos(p) && p.lat < 6.475 && p.lon > 3.385;

/** True when a trip between two Lagos points crosses the lagoon. */
export const crossesLagoon = (/** @type {LatLon} */ a, /** @type {LatLon} */ b) => inLagos(a) && inLagos(b) && islandSide(a) !== islandSide(b);

/**
 * The traffic model. Speeds are door-to-door averages in km/h on the road distance;
 * penalties are extra minutes for crossing the lagoon on one of its bridges. Assumptions,
 * not measurements (docs/LOCAL-FACTS.md, "Travel times").
 */
export const LAGOS_TRAFFIC = {
  roadFactor: 1.4, // the fallback only: road km is about 1.4x the straight line
  speedKmh: { peak: 13, day: 20, saturday: 18, weekend: 22, night: 32 },
  lagoonPenaltyMin: { peak: 20, day: 10, saturday: 12, weekend: 8, night: 3 },
  minMinutes: 5,
  /** weekday rush hours, local time: [from, to) in hours */
  peaks: [[6, 10], [16, 21]],
  /** Saturday afternoon and evening, when parties, weddings and markets fill the roads: [from, to) */
  saturday: [12, 21],
};

/** The bridges that cross the Lagos Lagoon between the mainland and the island. */
export const LAGOON_BRIDGES = /^(third mainland|carter|eko) bridge$/i;

/**
 * A road route as the OSRM adapter returns it.
 * @typedef {{ km: number, min: number, bridges?: string[] }} Route
 *   km: road distance; min: OSRM's free-flow minutes (no traffic); bridges: the named
 *   bridges on the route (absent from a table lookup, which has no step names)
 */

/**
 * Which traffic band an instant falls in.
 * @param {number} ms
 * @param {string} [tz]
 * @param {typeof LAGOS_TRAFFIC} [model]
 * @returns {"peak"|"day"|"saturday"|"weekend"|"night"}
 */
export function trafficBand(ms, tz = DEFAULT_TZ, model = LAGOS_TRAFFIC) {
  const p = localParts(ms, tz);
  const h = p.h + p.mi / 60;
  if (h >= 22 || h < 5) return "night";
  if (p.weekday === 6 && h >= model.saturday[0] && h < model.saturday[1]) return "saturday";
  if (p.weekday === 0 || p.weekday === 6) return "weekend";
  return model.peaks.some(([a, b]) => h >= a && h < b) ? "peak" : "day";
}

/**
 * An estimate of a road trip. `at` is when the trip happens (ms); without it, daytime
 * traffic is assumed. `route` is the OSRM route when there is one.
 * @param {LatLon} from
 * @param {LatLon} to
 * @param {{ at?: number, tz?: string, model?: typeof LAGOS_TRAFFIC, route?: Route|null }} [opts]
 */
export function travelEstimate(from, to, { at, tz = DEFAULT_TZ, model = LAGOS_TRAFFIC, route = null } = {}) {
  const km = haversineKm(from, to);
  const band = at == null ? "day" : trafficBand(at, tz, model);
  const useRoute = !!route && Number.isFinite(route.km) && Number.isFinite(route.min);
  const roadKm = useRoute ? /** @type {Route} */ (route).km : km * model.roadFactor;
  // the bridge is named only when the route says so; without step names (a table lookup, or
  // no route at all) the two ends' sides of the lagoon decide, and the text says it is a guess
  const bridge = useRoute && Array.isArray(route?.bridges) ? route.bridges.find((b) => LAGOON_BRIDGES.test(b)) ?? null : null;
  const lagoon = useRoute && Array.isArray(route?.bridges) ? !!bridge : crossesLagoon(from, to);
  const moving = (roadKm / model.speedKmh[band]) * 60;
  const floor = useRoute ? /** @type {Route} */ (route).min : 0;
  const minutes = Math.max(model.minMinutes, Math.round(Math.max(moving, floor) + (lagoon ? model.lagoonPenaltyMin[band] : 0)));
  return { km: round1(km), roadKm: round1(roadKm), minutes, crossesLagoon: lagoon, bridge, band, source: /** @type {"road"|"straight"} */ (useRoute ? "road" : "straight") };
}

/** A stable key for a trip between two points (about 10 m), for route lookups. */
export const tripKey = (/** @type {LatLon} */ a, /** @type {LatLon} */ b) => `${a.lat.toFixed(4)},${a.lon.toFixed(4)}>${b.lat.toFixed(4)},${b.lon.toFixed(4)}`;

const round1 = (/** @type {number} */ x) => Math.round(x * 10) / 10;
