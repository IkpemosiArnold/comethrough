// @ts-check
// Choosing a place for a crew. Deterministic and tested: a model never does this maths.
//
// A place is good when it is fair (nobody has a much longer trip than the others), fits
// what the crew likes (green and outdoor, its vibe, its budget) and is not where the crew
// went last time. Each part is a number from 0 to 1, and the total is a weighted sum minus
// a variety penalty. Travel times are estimates from ./geo.mjs (haversine, a road factor,
// the hour's traffic and the Lagos lagoon), so they rank places well but are not routes.
//
// scorePlaces also returns an explanation object: the facts behind the pick, in a shape
// Gemma can phrase ("Freedom Park keeps everyone under 40 minutes") without inventing any.

import { travelEstimate } from "./geo.mjs";
import { DEFAULT_TZ, DAY } from "./time.mjs";

/** @typedef {import("./types.mjs").LatLon} LatLon */
/**
 * @typedef {object} Candidate
 * @property {string} name
 * @property {number} lat
 * @property {number} lon
 * @property {string} [address]
 * @property {{ type: "node"|"way"|"relation", id: number, tags: Record<string,string> }} [osm]
 * @property {boolean} [outdoor]  known to be an outdoor spot (the curated list says so) even if its OSM tags do not
 * @property {{ free: boolean|null }} [entry]  a sourced entry fee from the curated list
 */
/**
 * @typedef {object} Traveller
 * @property {string} id
 * @property {string} name
 * @property {{ label: string, lat: number, lon: number }|null} area
 */
/** @typedef {{ key: string, at: number }} RecentUse  a place the crew used, and when (ms) */

/**
 * Weights of each part of the score (normalised to sum to 1). Green counts double for a
 * crew that wants to be outside; a crew that names its vibe ("drinks") is heard over the
 * default green bonus.
 */
export const WEIGHTS = { fairness: 0.55, green: 0.1, vibe: 0.2, budget: 0.15 };
/** A place used yesterday loses this much; the penalty fades to nothing over VARIETY_DAYS. */
export const VARIETY_PENALTY = 0.3;
export const VARIETY_DAYS = 56;
/** Fairness cost = the longest trip + SPREAD_WEIGHT x (longest - shortest). */
export const SPREAD_WEIGHT = 0.5;

/** OpenStreetMap tags that make a place green and outdoor (from the spec). */
export const GREEN_TAGS = {
  leisure: ["park", "garden", "recreation_ground"],
  natural: ["beach"],
  landuse: ["grass"],
};

/** True when the tags describe a park, garden, recreation ground, beach or named grass. */
export function isGreen(tags = {}) {
  return Object.entries(GREEN_TAGS).some(([k, vs]) => vs.includes(tags[k]));
}

/** A plain word for what the place is: "park", "beach", "bar", or null. */
export function placeKind(tags = {}) {
  if (tags.natural === "beach") return "beach";
  if (tags.leisure === "recreation_ground") return "recreation ground";
  if (tags.leisure) return tags.leisure.replace(/_/g, " ");
  if (tags.landuse === "grass") return "green";
  if (tags.amenity) return tags.amenity.replace(/_/g, " ");
  if (tags.tourism) return tags.tourism.replace(/_/g, " ");
  return null;
}

/** A stable key for a place: its OSM id when it has one, else its name and rounded position. */
export function placeKey(p) {
  if (p?.osm?.type && p.osm.id != null) return `osm:${p.osm.type}/${p.osm.id}`;
  const name = String(p?.name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const pos = Number.isFinite(p?.lat) && Number.isFinite(p?.lon) ? `@${p.lat.toFixed(3)},${p.lon.toFixed(3)}` : "";
  return `name:${name}${pos}`;
}

/**
 * Vibe words a crew might use, and the OSM tags that match each. A tag absent here is
 * ignored rather than guessed at.
 * @type {Record<string, (tags: Record<string,string>) => boolean>}
 */
export const VIBE_MATCHERS = {
  outside: isGreen,
  outdoor: isGreen,
  green: isGreen,
  nature: (t) => isGreen(t) || t.leisure === "nature_reserve",
  chill: (t) => isGreen(t) || ["cafe", "lounge"].includes(t.amenity),
  quiet: (t) => ["park", "garden"].includes(t.leisure),
  beach: (t) => t.natural === "beach",
  picnic: (t) => isGreen(t) || t.leisure === "picnic_site",
  drinks: (t) => ["bar", "pub", "biergarten", "lounge"].includes(t.amenity),
  food: (t) => ["restaurant", "fast_food", "cafe", "food_court"].includes(t.amenity),
  active: (t) => ["pitch", "sports_centre", "fitness_centre", "recreation_ground", "park"].includes(t.leisure) || t.natural === "beach",
  sport: (t) => ["pitch", "sports_centre", "fitness_centre"].includes(t.leisure),
  music: (t) => ["nightclub", "bar", "music_venue"].includes(t.amenity),
  party: (t) => ["nightclub", "bar"].includes(t.amenity) || t.natural === "beach",
  art: (t) => ["arts_centre", "gallery"].includes(t.amenity) || ["gallery", "museum"].includes(t.tourism),
};

/** How well the place fits the crew's vibe words: the share of known words it matches (0.5 when none are known). */
export function vibeFit(tags = {}, vibeTags = []) {
  const known = [...new Set(vibeTags.map((v) => String(v).toLowerCase().trim()))].filter((v) => VIBE_MATCHERS[v]);
  if (!known.length) return { score: 0.5, matched: [] };
  const matched = known.filter((v) => VIBE_MATCHERS[v](tags));
  return { score: matched.length / known.length, matched };
}

/**
 * How well the place fits the budget. "free" and "cheap" prefer fee=no and green spaces
 * without a fee tag; "any" does not care.
 * @param {Record<string,string>} tags
 * @param {"free"|"cheap"|"any"} budget
 */
export function budgetFit(tags = {}, budget = "any") {
  if (budget === "any") return { score: 0.5, fee: feeOf(tags) };
  const fee = feeOf(tags);
  if (fee === "no") return { score: 1, fee };
  if (fee === "yes") return { score: budget === "free" ? 0 : 0.3, fee };
  return { score: isGreen(tags) ? 0.7 : 0.4, fee };
}

/** @returns {"yes"|"no"|null} */
function feeOf(tags = {}) {
  const f = String(tags.fee || "").toLowerCase();
  if (!f) return null;
  return f === "no" || f === "free" ? "no" : "yes";
}

/** The variety penalty for a place, from the crew's recent uses. */
export function varietyPenalty(key, recent = [], now = 0) {
  let worst = 0;
  /** @type {number|null} */
  let daysAgo = null;
  for (const r of recent) {
    if (r.key !== key) continue;
    const d = Math.max(0, (now - r.at) / DAY);
    const p = VARIETY_PENALTY * Math.max(0, 1 - d / VARIETY_DAYS);
    if (p > worst) {
      worst = p;
      daysAgo = Math.round(d);
    }
  }
  return { penalty: worst, daysAgo };
}

/**
 * Score candidate places for a crew.
 * @param {object} input
 * @param {Traveller[]} input.members  who is coming (members without an area are listed but not counted)
 * @param {Candidate[]} input.candidates
 * @param {number} [input.at]          when the plan starts (ms), for traffic
 * @param {string} [input.tz]
 * @param {string[]} [input.vibeTags]
 * @param {"free"|"cheap"|"any"} [input.budget]
 * @param {boolean} [input.outdoor]   the crew wants to be outside (green counts double)
 * @param {RecentUse[]} [input.recent]
 * @param {number} [input.now]
 */
export function scorePlaces({ members, candidates, at, tz = DEFAULT_TZ, vibeTags = [], budget = "any", outdoor = false, recent = [], now = at ?? 0 }) {
  const located = members.filter((m) => m.area && Number.isFinite(m.area.lat) && Number.isFinite(m.area.lon));
  const scored = candidates
    .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon))
    .map((c) => {
      const travel = located.map((m) => {
        const e = travelEstimate(/** @type {LatLon} */ (m.area), c, { at, tz });
        return { memberId: m.id, name: m.name, from: /** @type {any} */ (m.area).label, minutes: e.minutes, crossesLagoon: e.crossesLagoon };
      });
      const mins = travel.map((t) => t.minutes);
      const maxMin = mins.length ? Math.max(...mins) : 0;
      const minMin = mins.length ? Math.min(...mins) : 0;
      const spreadMin = maxMin - minMin;
      const meanMin = mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : 0;
      const tags = c.osm?.tags || {};
      const key = placeKey(c);
      return {
        candidate: c, key, travel, maxMin, spreadMin, meanMin,
        cost: maxMin + SPREAD_WEIGHT * spreadMin,
        green: isGreen(tags) || c.outdoor === true,
        vibe: vibeFit(tags, vibeTags),
        // a sourced entry fee on a curated spot counts like an OpenStreetMap fee tag
        budget: budgetFit(c.entry?.free === true ? { ...tags, fee: "no" } : c.entry?.free === false ? { ...tags, fee: "yes" } : tags, budget),
        variety: varietyPenalty(key, recent, now),
      };
    });
  if (!scored.length) return { ranked: [], pick: null, explanation: null };

  const bestCost = Math.min(...scored.map((s) => s.cost));
  const wGreen = outdoor ? WEIGHTS.green * 2 : WEIGHTS.green;
  const total = WEIGHTS.fairness + wGreen + WEIGHTS.vibe + WEIGHTS.budget;
  const ranked = scored
    .map((s) => {
      const parts = {
        fairness: s.cost > 0 ? Math.min(1, Math.max(bestCost, 1) / Math.max(s.cost, 1)) : 1,
        green: s.green ? 1 : 0,
        vibe: s.vibe.score,
        budget: s.budget.score,
        variety: -s.variety.penalty,
      };
      const score = (WEIGHTS.fairness * parts.fairness + wGreen * parts.green + WEIGHTS.vibe * parts.vibe + WEIGHTS.budget * parts.budget) / total - s.variety.penalty;
      return { ...s, parts, score: Math.round(score * 1000) / 1000 };
    })
    // ties go to the fairer place, then to the name, so the order never depends on input order
    .sort((a, b) => b.score - a.score || a.cost - b.cost || a.candidate.name.localeCompare(b.candidate.name));

  const pick = ranked[0];
  return { ranked, pick, explanation: explain(pick, ranked, { members, bestCost, at }) };
}

/**
 * The facts behind a pick, for Gemma to phrase and for the UI to show. Reason codes:
 * fair (the fairest or within 10 minutes of it), green, vibe, free, fresh (not used in
 * VARIETY_DAYS), short (everyone under 30 minutes).
 */
function explain(pick, ranked, { members, bestCost, at }) {
  const tags = pick.candidate.osm?.tags || {};
  /** @type {string[]} */
  const reasons = [];
  if (pick.cost <= bestCost + 10) reasons.push("fair");
  if (pick.maxMin > 0 && pick.maxMin <= 30) reasons.push("short");
  if (pick.green) reasons.push("green");
  if (pick.vibe.matched.length) reasons.push("vibe");
  if (pick.budget.fee === "no") reasons.push("free");
  if (pick.variety.daysAgo == null) reasons.push("fresh");
  const longest = pick.travel.reduce((a, t) => (!a || t.minutes > a.minutes ? t : a), null);
  return {
    pick: { name: pick.candidate.name, key: pick.key, kind: placeKind(tags), green: pick.green, fee: pick.budget.fee },
    members: pick.travel.map((t) => ({ name: t.name, from: t.from, minutes: t.minutes, crossesLagoon: t.crossesLagoon })),
    unlocated: members.filter((m) => !m.area).map((m) => m.name),
    maxMinutes: pick.maxMin,
    spreadMinutes: pick.spreadMin,
    meanMinutes: pick.meanMin,
    longest: longest ? { name: longest.name, minutes: longest.minutes } : null,
    vibeMatched: pick.vibe.matched,
    lastUsedDaysAgo: pick.variety.daysAgo,
    reasons,
    estimate: at == null ? "daytime traffic" : "traffic at the plan's time",
    notChosen: ranked.slice(1, 3).map((r) => ({ name: r.candidate.name, why: whyNot(r, pick) })),
  };
}

/** One short fact on why an alternative lost. */
function whyNot(r, pick) {
  if (r.variety.daysAgo != null && r.variety.penalty > 0.05) return `used ${r.variety.daysAgo} days ago`;
  if (r.cost > pick.cost + 5) {
    const worst = r.travel.reduce((a, t) => (!a || t.minutes > a.minutes ? t : a), null);
    return worst ? `about ${worst.minutes} minutes for ${worst.name}` : "less fair";
  }
  if (!r.green && pick.green) return "not outdoors";
  if (r.budget.score < pick.budget.score) return r.budget.fee === "yes" ? "charges a fee" : "may charge a fee";
  return "a close second";
}

/**
 * @typedef {{ free: boolean|null, note: string|null, source: { url: string, publisher?: string, published?: string, says: string, checkedAt?: string }|null }} Entry
 *   free: true only when a source says free; null means nobody we can cite knows
 */

/** Unknown entry: the UI says "Entry: check at the gate". */
export const UNKNOWN_ENTRY = Object.freeze({ free: null, note: null, source: null });

const normName = (/** @type {any} */ s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * The curated spots with their sourced entry fees attached (data/spot-entry-fees.json).
 * A fee that claims free or paid without a source is dropped, so it can never reach a person.
 * @param {any[]} spots
 * @param {{ spot: string, free: boolean|null, note?: string|null, source?: any }[]} fees
 */
export function withEntries(spots, fees = []) {
  return spots.map((s) => {
    const f = fees.find((x) => normName(x.spot) === normName(s.name));
    const sourced = f && typeof f.source?.url === "string" && /^https:\/\//.test(f.source.url) && typeof f.source.says === "string";
    return { ...s, entry: sourced ? { free: f.free === true ? true : f.free === false ? false : null, note: f.note ?? null, source: f.source } : UNKNOWN_ENTRY };
  });
}

/**
 * The curated spot a plan's place is, if any: the same OpenStreetMap feature, or the same
 * name (or alias) within half a kilometre.
 * @param {{ name?: string|null, lat?: number|null, lon?: number|null, osm?: { type: string, id: number } }} place
 * @param {any[]} spots
 */
export function spotFor(place, spots) {
  if (!place) return null;
  const key = place.osm ? `${place.osm.type}/${place.osm.id}` : null;
  const n = normName(place.name);
  return spots.find((s) => {
    if (key && s.osm && `${s.osm.type}/${s.osm.id}` === key) return true;
    if (!n || ![s.name, ...(s.aliases || [])].some((x) => normName(x) === n)) return false;
    return !Number.isFinite(place.lat) || travelEstimate(/** @type {any} */ (place), s).km <= 0.5;
  }) ?? null;
}

/**
 * What to say about getting in, for a plan's place, or null when there is nothing to say (a
 * home, or a flyer that gave its own price). A curated spot's sourced fee comes first, then
 * an OpenStreetMap fee tag (itself a source), else unknown for any public spot the sloth
 * picked.
 * @param {any} place
 * @param {any[]} spots
 * @param {{ ritual?: boolean }} [opts]
 * @returns {Entry|null}
 */
export function entryFor(place, spots, { ritual = false } = {}) {
  if (!place || place.private) return null;
  const spot = spotFor(place, spots);
  if (spot?.entry && spot.entry.free !== null) return spot.entry;
  const fee = String(place.osm?.tags?.fee || "").toLowerCase();
  if (fee && place.osm) {
    const url = `https://www.openstreetmap.org/${place.osm.type}/${place.osm.id}`;
    return { free: fee === "no" || fee === "free", note: null, source: { url, publisher: "OpenStreetMap", says: `fee=${fee}` } };
  }
  return spot || ritual ? UNKNOWN_ENTRY : null;
}
