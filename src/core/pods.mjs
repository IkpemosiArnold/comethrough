// @ts-check
// Ride pods: the members going to a plan, grouped by where they start so they can share a
// ride, each with a leave-by time and the drop-off text to paste into a ride app (no ride app
// in Lagos documents a link that fills the drop-off in; see ./rides.mjs).
//
// Grouping is small agglomerative clustering with complete linkage: start with everyone
// alone, then keep merging the two closest groups while every pair inside the merged group
// is within radiusKm, the group fits in one car (maxSize, 4), and nobody would cross the
// lagoon to collect someone. A final pass splits 4 + 1 into 3 + 2, so nobody rides alone
// when a neighbour's car is full. Ties break on member ids, so the result never depends on
// input order.

import { LAGOS_TRAFFIC, centroid, crossesLagoon, haversineKm, travelEstimate } from "./geo.mjs";

/** @typedef {import("./geo.mjs").Route} Route */
import { DEFAULT_TZ, MINUTE, parseInstant, toIsoLocal, localParts } from "./time.mjs";
import { destinationText } from "./rides.mjs";

/** @typedef {import("./types.mjs").Pod} Pod */
/** @typedef {{ id: string, name: string, area: { label: string, lat: number, lon: number }|null }} Rider */

export const POD_DEFAULTS = {
  maxSize: 4,
  radiusKm: 5,
  /** minutes added to the trip estimate before the start time */
  bufferMin: 15,
  /** minutes per extra pickup in a pod */
  pickupMin: 5,
  /** leave-by is rounded down to this many minutes */
  roundMin: 5,
};

/**
 * Group riders into pods (ids only).
 * @param {Rider[]} riders  riders with an area
 * @param {{ maxSize?: number, radiusKm?: number }} [opts]
 * @returns {Rider[][]}
 */
export function clusterRiders(riders, { maxSize = POD_DEFAULTS.maxSize, radiusKm = POD_DEFAULTS.radiusKm } = {}) {
  const sorted = [...riders].sort((a, b) => a.id.localeCompare(b.id));
  /** @type {Rider[][]} */
  let groups = sorted.map((r) => [r]);
  const dist = (/** @type {Rider} */ a, /** @type {Rider} */ b) => {
    const pa = /** @type {{lat:number,lon:number}} */ (a.area), pb = /** @type {{lat:number,lon:number}} */ (b.area);
    return crossesLagoon(pa, pb) ? Infinity : haversineKm(pa, pb);
  };
  const linkage = (/** @type {Rider[]} */ g, /** @type {Rider[]} */ h) => Math.max(...g.flatMap((a) => h.map((b) => dist(a, b))));
  for (;;) {
    let best = null;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        if (groups[i].length + groups[j].length > maxSize) continue;
        const d = linkage(groups[i], groups[j]);
        if (d <= radiusKm && (!best || d < best.d - 1e-9)) best = { i, j, d };
      }
    }
    if (!best) break;
    const merged = [...groups[best.i], ...groups[best.j]];
    groups = groups.filter((_, k) => k !== best.i && k !== best.j);
    groups.push(merged);
  }
  // nobody rides alone next to a full car: 4 + 1 becomes 3 + 2
  for (const solo of groups.filter((g) => g.length === 1)) {
    const full = groups
      .filter((g) => g.length === maxSize && maxSize >= 3 && linkage(g, solo) <= radiusKm)
      .sort((a, b) => linkage(a, solo) - linkage(b, solo))[0];
    if (!full) continue;
    // move the member of the full pod who is closest to the solo rider
    const mover = [...full].sort((a, b) => dist(a, solo[0]) - dist(b, solo[0]) || a.id.localeCompare(b.id))[0];
    full.splice(full.indexOf(mover), 1);
    solo.push(mover);
  }
  return groups
    .map((g) => [...g].sort((a, b) => a.id.localeCompare(b.id)))
    .sort((a, b) => b.length - a.length || a[0].id.localeCompare(b[0].id));
}

/**
 * Ride pods for a plan: who rides together, when to leave, and what to paste into the app.
 *
 * Travel times are estimates (see travelEstimate in geo.mjs), and each pod says what was
 * assumed, so the UI can show it one tap away: the traffic band, the road distance, the
 * speed, the bridge penalty, and whether the destination itself was only approximate.
 * @param {{ start: string, tz?: string, place: { name: string|null, address: string|null, lat: number|null, lon: number|null, private?: boolean } }} plan
 * @param {Rider[]} going  the members going (the caller filters rsvps)
 * @param {{ maxSize?: number, radiusKm?: number, bufferMin?: number, pickupMin?: number,
 *           near?: { label: string, lat: number, lon: number } | null,
 *           route?: (from: { lat: number, lon: number }, to: { lat: number, lon: number }) => Route|null }} [opts]
 *   near: where the place roughly is when it has no pin (a host's home is "near" the host's
 *   neighbourhood); used for times only, never as the drop-off
 *   route: the road route the caller fetched for a pickup (see podTrips), or null to fall back
 */
export function podsForPlan(plan, going, opts = {}) {
  const o = { ...POD_DEFAULTS, ...opts };
  const tz = plan.tz || DEFAULT_TZ;
  const startMs = parseInstant(plan.start);
  const place = plan.place;
  const placed = going.filter((r) => r.area && Number.isFinite(r.area.lat) && Number.isFinite(r.area.lon));
  const unplaced = going.filter((r) => !placed.includes(r)).map((r) => ({ id: r.id, name: r.name }));
  const hasDest = Number.isFinite(place?.lat) && Number.isFinite(place?.lon);
  const near = !hasDest && o.near && Number.isFinite(o.near.lat) && Number.isFinite(o.near.lon) ? o.near : null;
  const dest = hasDest ? /** @type {any} */ (place) : near;
  // a host's home with no address has nothing worth pasting ("Tolu's place" finds nothing)
  const dropoff = place?.private && !place?.address ? null : destinationText(place || {});

  const pods = clusterRiders(placed, o).map((g) => {
    const pickup = /** @type {{lat:number,lon:number}} */ (centroid(g.map((r) => /** @type {any} */ (r.area))));
    // traffic is judged an hour before the start, when people are on the road
    const judgedAt = startMs - 60 * MINUTE;
    const est = dest ? travelEstimate(pickup, dest, { at: judgedAt, tz, route: o.route ? o.route(pickup, dest) : null }) : null;
    const travelMin = est ? est.minutes + o.pickupMin * (g.length - 1) : null;
    let leaveBy = null;
    if (travelMin != null && Number.isFinite(startMs)) {
      const raw = startMs - (travelMin + o.bufferMin) * MINUTE;
      leaveBy = toIsoLocal(Math.floor(raw / (o.roundMin * MINUTE)) * o.roundMin * MINUTE, tz);
    }
    const fromLabel = labelsOf(g.map((r) => /** @type {any} */ (r.area).label));
    const names = g.map((r) => r.name);
    return {
      memberIds: g.map((r) => r.id),
      names,
      fromLabel,
      solo: g.length === 1,
      leaveBy,
      travelMin,
      crossesLagoon: !!est?.crossesLagoon,
      // the lagoon bridge the road route takes, by name; null when there is no route to say so
      bridge: est?.bridge ?? null,
      estimate: est ? {
        band: est.band,
        source: est.source,
        roadKm: est.roadKm,
        speedKmh: LAGOS_TRAFFIC.speedKmh[est.band],
        lagoonMin: est.crossesLagoon ? LAGOS_TRAFFIC.lagoonPenaltyMin[est.band] : 0,
        bridge: est.bridge,
        pickupMin: o.pickupMin * (g.length - 1),
        bufferMin: o.bufferMin,
        judgedAt: toIsoLocal(judgedAt, tz),
        approxTo: near ? near.label : null,
        text: estimateText(est, { pickupMin: o.pickupMin * (g.length - 1), bufferMin: o.bufferMin, approxTo: near ? near.label : null }),
      } : null,
      destinationText: dropoff,
      shareText: shareText({ names, fromLabel, leaveBy, travelMin, place, tz }),
    };
  });
  return { pods, unplaced };
}

/**
 * The trips podsForPlan will estimate: each pod's pickup point to the destination. The
 * caller fetches a road route for each (asynchronously) and passes them back as `route`.
 * @param {{ place: { lat: number|null, lon: number|null } }} plan
 * @param {Rider[]} going
 * @param {{ maxSize?: number, radiusKm?: number, near?: { lat: number, lon: number } | null }} [opts]
 * @returns {{ from: { lat: number, lon: number }, to: { lat: number, lon: number } }[]}
 */
export function podTrips(plan, going, opts = {}) {
  const place = plan.place;
  const hasDest = Number.isFinite(place?.lat) && Number.isFinite(place?.lon);
  const dest = hasDest ? { lat: /** @type {number} */ (place.lat), lon: /** @type {number} */ (place.lon) } : opts.near && Number.isFinite(opts.near.lat) ? { lat: opts.near.lat, lon: opts.near.lon } : null;
  if (!dest) return [];
  const placed = going.filter((r) => r.area && Number.isFinite(r.area.lat) && Number.isFinite(r.area.lon));
  return clusterRiders(placed, opts).map((g) => ({ from: /** @type {{lat:number,lon:number}} */ (centroid(g.map((r) => /** @type {any} */ (r.area)))), to: dest }));
}

/** "Yaba", "Yaba and Surulere", or "Yaba, Surulere and Ebute Metta": every neighbourhood in the pod, the commonest first. */
function labelsOf(xs) {
  /** @type {Map<string, number>} */
  const n = new Map();
  for (const x of xs) n.set(x, (n.get(x) || 0) + 1);
  const ls = [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l]) => l);
  return ls.length > 1 ? `${ls.slice(0, -1).join(", ")} and ${ls.at(-1)}` : ls[0] ?? "";
}

/** A message the pod can paste into its chat. Plain, no dashes. */
function shareText({ names, fromLabel, leaveBy, travelMin, place, tz }) {
  const where = place?.name || place?.address || "the plan";
  const when = leaveBy ? localParts(Date.parse(leaveBy), tz).time : null;
  const who = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  if (!when) return `${who}: heading to ${where} from ${fromLabel}.`;
  return `${who}: leave ${fromLabel} by ${when} for ${where} (about ${travelMin} min).`;
}

const BAND_WORDS = { peak: "weekday rush hour traffic", day: "daytime traffic", saturday: "Saturday afternoon traffic", weekend: "weekend traffic", night: "light night traffic" };

/**
 * The assumptions behind a travel time, in plain words for the "how we guess" line. It says
 * whether the distance is a real road route or the straight-line fallback, and names a
 * bridge only when the route takes one. No dashes.
 */
export function estimateText(est, { pickupMin = 0, bufferMin = 0, approxTo = null } = {}) {
  const band = /** @type {keyof typeof LAGOS_TRAFFIC.speedKmh} */ (est.band);
  const speed = `at about ${LAGOS_TRAFFIC.speedKmh[band]} km/h in ${BAND_WORDS[band]}`;
  const parts = [est.source === "road" ? `${est.roadKm} km by road ${speed}` : `${est.roadKm} km ${speed} (the road route was not available, so this is the straight line plus 40%)`];
  const penalty = LAGOS_TRAFFIC.lagoonPenaltyMin[band];
  if (est.crossesLagoon) parts.push(est.bridge ? `${penalty} min for ${est.bridge}` : `${penalty} min in case the trip crosses the lagoon`);
  if (pickupMin) parts.push(`${pickupMin} min to pick each other up`);
  const head = `A rough estimate, not live traffic: ${parts.join(", ")}.`;
  const tail = [approxTo ? `The exact address is not on the map, so this is from ${approxTo}.` : "", bufferMin ? `Leave-by adds ${bufferMin} min to spare.` : "", est.source === "road" ? "Route: OSRM, OpenStreetMap data." : ""].filter(Boolean).join(" ");
  return tail ? `${head} ${tail}` : head;
}
