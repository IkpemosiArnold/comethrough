// @ts-check
// Ride pods: the members going to a plan, grouped by where they start so they can share a
// ride, each with a leave-by time and a one-tap ride link.
//
// Grouping is small agglomerative clustering with complete linkage: start with everyone
// alone, then keep merging the two closest groups while every pair inside the merged group
// is within radiusKm, the group fits in one car (maxSize, 4), and nobody would cross the
// lagoon to collect someone. A final pass splits 4 + 1 into 3 + 2, so nobody rides alone
// when a neighbour's car is full. Ties break on member ids, so the result never depends on
// input order.

import { LAGOS_TRAFFIC, centroid, crossesLagoon, haversineKm, travelEstimate } from "./geo.mjs";
import { DEFAULT_TZ, MINUTE, parseInstant, toIsoLocal, localParts } from "./time.mjs";

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
 * An Uber link that opens the app (or the mobile site) with the dropoff filled in and the
 * pickup left to the rider's current location.
 *   "looking" (default): https://m.uber.com/looking?drop[0]=<JSON>, the universal link in
 *     Uber's deep-link docs as checked on 21 Oct 2026; the JSON is
 *     {"latitude","longitude","addressLine1","addressLine2"}.
 *   "legacy": the older m.uber.com/ul/?action=setPickup&dropoff[...] form, now documented
 *     only for the uber:// scheme. Kept behind UBER_LINK_STYLE=legacy in case it works better.
 * @param {{ name?: string|null, address?: string|null, lat: number|null, lon: number|null }} dropoff
 * @param {{ style?: "looking"|"legacy" }} [opts]
 * @returns {string|null}  null when the place has no coordinates
 */
export function uberLink(dropoff, { style = "looking" } = {}) {
  if (!Number.isFinite(dropoff.lat) || !Number.isFinite(dropoff.lon)) return null;
  const lat = Number(/** @type {number} */ (dropoff.lat).toFixed(6));
  const lon = Number(/** @type {number} */ (dropoff.lon).toFixed(6));
  const line1 = dropoff.name || dropoff.address || "Dropoff";
  const line2 = dropoff.address && dropoff.address !== line1 ? dropoff.address : "";
  if (style === "legacy") {
    const q = [["action", "setPickup"], ["pickup", "my_location"], ["dropoff[latitude]", String(lat)], ["dropoff[longitude]", String(lon)], ["dropoff[nickname]", line1]];
    if (line2) q.push(["dropoff[formatted_address]", line2]);
    return `https://m.uber.com/ul/?${q.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}`;
  }
  const drop = { latitude: lat, longitude: lon, addressLine1: line1, addressLine2: line2 };
  return `https://m.uber.com/looking?${encodeURIComponent("drop[0]")}=${encodeURIComponent(JSON.stringify(drop))}`;
}

/** The destination text to paste into Bolt (Bolt documents no deep link that fills the destination). */
export function boltText(place) {
  const parts = [place.name, place.address].filter(Boolean);
  const text = [...new Set(parts)].join(", ");
  const pin = Number.isFinite(place.lat) && Number.isFinite(place.lon) ? ` (${place.lat.toFixed(5)}, ${place.lon.toFixed(5)})` : "";
  return (text || "the plan's location") + pin;
}

/**
 * Ride pods for a plan: who rides together, when to leave and the ride links.
 *
 * Travel times are estimates (see travelEstimate in geo.mjs), and each pod says what was
 * assumed, so the UI can show it one tap away: the traffic band, the road distance, the
 * speed, the bridge penalty, and whether the destination itself was only approximate.
 * @param {{ start: string, tz?: string, place: { name: string|null, address: string|null, lat: number|null, lon: number|null } }} plan
 * @param {Rider[]} going  the members going (the caller filters rsvps)
 * @param {{ maxSize?: number, radiusKm?: number, bufferMin?: number, pickupMin?: number, uberStyle?: "looking"|"legacy",
 *           near?: { label: string, lat: number, lon: number } | null }} [opts]
 *   near: where the place roughly is when it has no pin (a host's home is "near" the host's
 *   neighbourhood); used for times only, never for the ride links
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
  const uberUrl = hasDest ? uberLink(place, { style: o.uberStyle }) : null;
  const bolt = boltText(place || {});

  const pods = clusterRiders(placed, o).map((g) => {
    const pickup = /** @type {{lat:number,lon:number}} */ (centroid(g.map((r) => /** @type {any} */ (r.area))));
    // traffic is judged an hour before the start, when people are on the road
    const judgedAt = startMs - 60 * MINUTE;
    const est = dest ? travelEstimate(pickup, dest, { at: judgedAt, tz }) : null;
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
      estimate: est ? {
        band: est.band,
        roadKm: est.roadKm,
        speedKmh: LAGOS_TRAFFIC.speedKmh[est.band],
        lagoonMin: est.crossesLagoon ? LAGOS_TRAFFIC.lagoonPenaltyMin[est.band] : 0,
        pickupMin: o.pickupMin * (g.length - 1),
        bufferMin: o.bufferMin,
        judgedAt: toIsoLocal(judgedAt, tz),
        approxTo: near ? near.label : null,
        text: estimateText(est, { pickupMin: o.pickupMin * (g.length - 1), bufferMin: o.bufferMin, approxTo: near ? near.label : null }),
      } : null,
      uberUrl,
      boltText: bolt,
      shareText: shareText({ names, fromLabel, leaveBy, travelMin, place, tz }),
    };
  });
  return { pods, unplaced };
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

const BAND_WORDS = { peak: "rush hour traffic", day: "daytime traffic", weekend: "weekend traffic", night: "light night traffic" };

/** The assumptions behind a travel time, in plain words for the "how we guess" line. No dashes. */
export function estimateText(est, { pickupMin = 0, bufferMin = 0, approxTo = null } = {}) {
  const parts = [`${est.roadKm} km of road at about ${LAGOS_TRAFFIC.speedKmh[/** @type {keyof typeof LAGOS_TRAFFIC.speedKmh} */ (est.band)]} km/h in ${BAND_WORDS[/** @type {keyof typeof BAND_WORDS} */ (est.band)]}`];
  if (est.crossesLagoon) parts.push(`${LAGOS_TRAFFIC.lagoonPenaltyMin[/** @type {keyof typeof LAGOS_TRAFFIC.lagoonPenaltyMin} */ (est.band)]} min for the bridge`);
  if (pickupMin) parts.push(`${pickupMin} min to pick each other up`);
  const head = `A guess from the map, not live traffic: ${parts.join(", ")}.`;
  const tail = [approxTo ? `The exact address is not on the map, so this is from ${approxTo}.` : "", bufferMin ? `Leave-by adds ${bufferMin} min to spare.` : ""].filter(Boolean).join(" ");
  return tail ? `${head} ${tail}` : head;
}
