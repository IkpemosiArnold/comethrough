// @ts-check
// Lagos geography and traffic: the metro box, the two sides of the lagoon, the bridges that
// cross it, and the traffic bands. Moved here unchanged from src/core/geo.mjs when the core
// went global; the core takes this model as a parameter (see FREE_FLOW there for the
// generic one).
//
// The bands and speeds are assumptions, written down in docs/LOCAL-FACTS.md ("Travel times")
// and kept in one place so they can be tuned.

import { inBox } from "../../core/geo.mjs";
import { localParts } from "../../core/time.mjs";

/** @typedef {import("../../core/types.mjs").LatLon} LatLon */
/** @typedef {import("../../core/geo.mjs").TravelModel} TravelModel */

export const LAGOS_TZ = "Africa/Lagos";

/** Roughly metropolitan Lagos. */
export const LAGOS_BBOX = { south: 6.35, north: 6.75, west: 2.7, east: 4.4 };
export const inLagos = (/** @type {LatLon} */ p) => inBox(LAGOS_BBOX, p);

/**
 * True for the island side of the Lagos Lagoon (Lagos Island, Ikoyi, Victoria Island, the
 * Lekki peninsula and Ajah), false for the mainland (Yaba, Surulere, Ikeja, Apapa,
 * Ikorodu). A two-line heuristic: south of 6.475 N and east of 3.385 E. It is checked
 * against the neighbourhoods in test/time-geo.test.mjs.
 */
export const islandSide = (/** @type {LatLon} */ p) => inLagos(p) && p.lat < 6.475 && p.lon > 3.385;

/** True when a trip between two Lagos points crosses the lagoon. */
export const crossesLagoon = (/** @type {LatLon} */ a, /** @type {LatLon} */ b) => inLagos(a) && inLagos(b) && islandSide(a) !== islandSide(b);

/** The bridges that cross the Lagos Lagoon between the mainland and the island. */
export const LAGOON_BRIDGES = /^(third mainland|carter|eko) bridge$/i;

/**
 * The traffic numbers. Speeds are door-to-door averages in km/h on the road distance;
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

/**
 * Which traffic band an instant falls in.
 * @param {number} ms
 * @param {string} [tz]
 * @param {typeof LAGOS_TRAFFIC} [model]
 * @returns {"peak"|"day"|"saturday"|"weekend"|"night"}
 */
export function trafficBand(ms, tz = LAGOS_TZ, model = LAGOS_TRAFFIC) {
  const p = localParts(ms, tz);
  const h = p.h + p.mi / 60;
  if (h >= 22 || h < 5) return "night";
  if (p.weekday === 6 && h >= model.saturday[0] && h < model.saturday[1]) return "saturday";
  if (p.weekday === 0 || p.weekday === 6) return "weekend";
  return model.peaks.some(([a, b]) => h >= a && h < b) ? "peak" : "day";
}

/** The Lagos model in the shape the core's travelEstimate takes. @type {TravelModel} */
export const LAGOS_TRAVEL = Object.freeze({
  id: "lagos",
  roadFactor: LAGOS_TRAFFIC.roadFactor,
  minMinutes: LAGOS_TRAFFIC.minMinutes,
  speedKmh: LAGOS_TRAFFIC.speedKmh,
  band: (/** @type {number} */ ms, /** @type {string} */ tz) => trafficBand(ms, tz),
  dayBand: "day",
  bandWords: { peak: "weekday rush hour traffic", day: "daytime traffic", saturday: "Saturday afternoon traffic", weekend: "weekend traffic", night: "light night traffic" },
  crossing: { crosses: crossesLagoon, bridges: LAGOON_BRIDGES, penaltyMin: LAGOS_TRAFFIC.lagoonPenaltyMin, words: "the lagoon" },
});
