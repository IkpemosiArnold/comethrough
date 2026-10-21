// @ts-check
// Distances and travel-time estimates. These are estimates, not routing: straight-line
// (haversine) distance times a road factor, at a speed that depends on the hour, plus a
// penalty for crossing the Lagos Lagoon (the Third Mainland, Carter and Eko bridges are
// the city's worst chokepoints). They are good enough to compare places fairly and to
// suggest a leave-by time with a buffer; the UI says "about".
//
// The constants are documented guesses from living with Lagos traffic, kept in one place
// so a contributor in another city can tune them (pass { model } to travelEstimate).

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
 * penalties are extra minutes for a lagoon crossing.
 */
export const LAGOS_TRAFFIC = {
  roadFactor: 1.4, // Lagos roads wind around the lagoon and creeks: road km is about 1.4x the straight line
  speedKmh: { peak: 13, day: 20, weekend: 22, night: 32 },
  lagoonPenaltyMin: { peak: 20, day: 10, weekend: 8, night: 3 },
  minMinutes: 5,
  /** weekday rush hours, local time: [from, to) in hours */
  peaks: [[6, 10], [16, 21]],
};

/**
 * Which traffic band an instant falls in.
 * @param {number} ms
 * @param {string} [tz]
 * @param {typeof LAGOS_TRAFFIC} [model]
 * @returns {"peak"|"day"|"weekend"|"night"}
 */
export function trafficBand(ms, tz = DEFAULT_TZ, model = LAGOS_TRAFFIC) {
  const p = localParts(ms, tz);
  const h = p.h + p.mi / 60;
  if (h >= 22 || h < 5) return "night";
  if (p.weekday === 0 || p.weekday === 6) return "weekend";
  return model.peaks.some(([a, b]) => h >= a && h < b) ? "peak" : "day";
}

/**
 * An estimate of a road trip. `at` is when the trip happens (ms); without it, daytime
 * traffic is assumed.
 * @param {LatLon} from
 * @param {LatLon} to
 * @param {{ at?: number, tz?: string, model?: typeof LAGOS_TRAFFIC }} [opts]
 */
export function travelEstimate(from, to, { at, tz = DEFAULT_TZ, model = LAGOS_TRAFFIC } = {}) {
  const km = haversineKm(from, to);
  const roadKm = km * model.roadFactor;
  const band = at == null ? "day" : trafficBand(at, tz, model);
  const lagoon = crossesLagoon(from, to);
  const minutes = Math.max(model.minMinutes, Math.round((roadKm / model.speedKmh[band]) * 60 + (lagoon ? model.lagoonPenaltyMin[band] : 0)));
  return { km: round1(km), roadKm: round1(roadKm), minutes, crossesLagoon: lagoon, band };
}

const round1 = (/** @type {number} */ x) => Math.round(x * 10) / 10;
