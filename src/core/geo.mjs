// @ts-check
// Travel-time estimates. They are rough estimates, not live traffic, and the UI says so.
// Nothing here knows about any one city: the traffic model is a parameter, and a city pack
// (src/packs) supplies its own. Two inputs, in order of preference:
//   1. a road route from OSRM (OpenStreetMap data): the real road distance, its free-flow
//      time, and the names of the bridges it uses (a pack with a water crossing, such as
//      Lagos and its lagoon, claims the crossing only when the route takes one of its bridges);
//   2. when no route is available (OSRM down, or offline), the straight line times a road
//      factor. The estimate says it is the fallback.
//
// Two kinds of model:
//   - FREE_FLOW, the generic one: OSRM's own driving time, which knows nothing about traffic,
//     and a plain average speed for the straight-line fallback. No city-specific claims.
//   - a banded model from a city pack: a door-to-door speed for each traffic band of the
//     week (rush hour, Saturday afternoon, night...) and an optional water crossing with a
//     penalty per band. The time is never less than OSRM's own free-flow time.

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

/** True when a point is inside a box { south, north, west, east }. */
export const inBox = (/** @type {{ south: number, north: number, west: number, east: number }} */ box, /** @type {LatLon} */ p) =>
  p.lat >= box.south && p.lat <= box.north && p.lon >= box.west && p.lon <= box.east;

/**
 * A water crossing a city pack knows about (Lagos: the lagoon and its bridges).
 * @typedef {object} Crossing
 * @property {(a: LatLon, b: LatLon) => boolean} crosses  a guess from the two ends, used when the route has no step names
 * @property {RegExp} bridges                            the route step names that count as crossing
 * @property {Record<string, number>} penaltyMin         extra minutes per traffic band
 * @property {string} words                              "the lagoon", for the "how we guess" line
 */

/**
 * @typedef {object} TravelModel
 * @property {string} id
 * @property {number} roadFactor        the fallback only: road km per straight-line km
 * @property {number} minMinutes
 * @property {Record<string, number>|null} speedKmh   door-to-door speed per band; null means OSRM's own time
 * @property {number} [fallbackKmh]     the straight-line fallback's speed when speedKmh is null
 * @property {((ms: number, tz: string) => string)|null} band  the traffic band of an instant; null for no bands
 * @property {string} [dayBand]         the band assumed when the time is not known
 * @property {Record<string, string>} [bandWords]  "weekday rush hour traffic", for the "how we guess" line
 * @property {Crossing|null} crossing
 */

/**
 * The generic model: OSRM's driving time with no traffic, and 25 km/h on the straight line
 * plus 40% when there is no route. It makes no claim about any city's traffic.
 * @type {TravelModel}
 */
export const FREE_FLOW = Object.freeze({ id: "free-flow", roadFactor: 1.4, minMinutes: 5, speedKmh: null, fallbackKmh: 25, band: null, crossing: null });

/**
 * A road route as the OSRM adapter returns it.
 * @typedef {{ km: number, min: number, bridges?: string[] }} Route
 *   km: road distance; min: OSRM's free-flow minutes (no traffic); bridges: the named
 *   bridges on the route (absent from a table lookup, which has no step names)
 */

/**
 * An estimate of a road trip. `at` is when the trip happens (ms); without it, the model's
 * daytime band is assumed. `route` is the OSRM route when there is one.
 * @param {LatLon} from
 * @param {LatLon} to
 * @param {{ at?: number, tz?: string, model?: TravelModel, route?: Route|null }} [opts]
 */
export function travelEstimate(from, to, { at, tz = "UTC", model = FREE_FLOW, route = null } = {}) {
  const km = haversineKm(from, to);
  const band = model.band ? (at == null ? model.dayBand ?? "day" : model.band(at, tz)) : null;
  const useRoute = !!route && Number.isFinite(route.km) && Number.isFinite(route.min);
  const roadKm = useRoute ? /** @type {Route} */ (route).km : km * model.roadFactor;
  // a crossing is named only when the route says so; without step names (a table lookup, or
  // no route at all) the two ends decide, and the text says it is a guess
  const cross = model.crossing;
  const stepNames = useRoute && Array.isArray(route?.bridges);
  const bridge = cross && stepNames ? /** @type {string[]} */ (route?.bridges).find((b) => cross.bridges.test(b)) ?? null : null;
  const crossed = !!cross && (stepNames ? !!bridge : cross.crosses(from, to));
  const floor = useRoute ? /** @type {Route} */ (route).min : 0;
  const moving = model.speedKmh && band
    ? (roadKm / model.speedKmh[band]) * 60
    : useRoute ? floor : (roadKm / (model.fallbackKmh || 25)) * 60;
  const penalty = crossed && cross && band ? cross.penaltyMin[band] ?? 0 : 0;
  const minutes = Math.max(model.minMinutes, Math.round(Math.max(moving, floor) + penalty));
  return { km: round1(km), roadKm: round1(roadKm), minutes, crossesLagoon: crossed, bridge, band, source: /** @type {"road"|"straight"} */ (useRoute ? "road" : "straight") };
}

/** A stable key for a trip between two points (about 10 m), for route lookups. */
export const tripKey = (/** @type {LatLon} */ a, /** @type {LatLon} */ b) => `${a.lat.toFixed(4)},${a.lon.toFixed(4)}>${b.lat.toFixed(4)},${b.lon.toFixed(4)}`;

const round1 = (/** @type {number} */ x) => Math.round(x * 10) / 10;

/** A crew's areas this far apart are not one crew's neighbourhoods without asking (Lekki Phase I and Ibeju-Lekki are 38 km apart). */
export const AREA_SPREAD_KM = 25;

/**
 * Pick one candidate per area name so the picks sit together: every candidate of every
 * name (the best three of each) is tried as the anchor, and each name takes its best
 * candidate (the geocoder's own order) within maxKm of the anchor. The anchor that places
 * the most names wins, then the one whose picks rank best, then the one whose picks are
 * closest, then the earlier name's. A name with no candidate near the anchor gets null (the
 * caller asks about it). Pure.
 * @template {LatLon} T
 * @param {T[][]} lists  candidates per name, best first
 * @param {number} [maxKm]
 * @returns {{ anchor: T|null, picks: (T|null)[] }}
 */
export function clusterAreas(lists, maxKm = AREA_SPREAD_KM) {
  /** @type {{ anchor: T|null, picks: (T|null)[], n: number, rank: number, km: number }} */
  let best = { anchor: null, picks: lists.map(() => null), n: 0, rank: Infinity, km: Infinity };
  for (const list of lists) {
    for (const anchor of list.slice(0, 3)) {
      const idx = lists.map((l) => l.findIndex((r) => haversineKm(anchor, r) <= maxKm));
      const picks = idx.map((i, k) => (i >= 0 ? lists[k][i] : null));
      const n = picks.filter(Boolean).length;
      const rank = idx.reduce((s, i) => s + (i >= 0 ? i : 0), 0);
      const km = picks.reduce((s, p) => s + (p ? haversineKm(anchor, p) : 0), 0);
      if (n > best.n || (n === best.n && (rank < best.rank || (rank === best.rank && km < best.km - 1e-9)))) best = { anchor, picks, n, rank, km };
    }
  }
  return { anchor: best.anchor, picks: best.picks };
}
