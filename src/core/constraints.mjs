// @ts-check
// A crew's hard constraints, as filters (Astra's review, 25 Oct): what the crew said it
// needs is never traded against a score. Ideas and the ritual are filtered by these before
// ranking, and the final picks are checked again before anything is published; "nothing
// fits" is an honest answer, said as such.
//
//   window      the crew's own hours (its rhythm's window); the city pack's social hours
//               only narrow it (slotFor, clipToSocial)
//   budget      free: nothing with a price; cheap: nothing over the pack's ceiling
//   maxTripMin  nobody travels longer than this (the pack's estimate)
//   needs       step-free, no alcohol, kid-friendly, daytime (no nightlife), discreet
//
// Pure: no I/O.

import { MAX_TRIP_MIN } from "./ideas.mjs";
import { eventFit, hasSensitive, overBudget, tasteFit } from "./taste.mjs";
import { clockWords } from "./weather.mjs";

/** @typedef {import("./types.mjs").TimeWindow} TimeWindow */
/** @typedef {import("./taste.mjs").Taste} Taste */
/**
 * @typedef {object} Constraints
 * @property {TimeWindow|null} window
 * @property {"free"|"cheap"|"any"} budget
 * @property {number|null} cheapMax
 * @property {number} maxTripMin
 * @property {Taste|null} taste
 */

/**
 * The constraints a crew has said, one way or another.
 * @param {{ budget?: string|null, taste?: Taste|null, rhythm?: { window?: TimeWindow }|null }} crew
 * @param {{ cheapMax?: number|null, maxTripMin?: number }} [opts]
 * @returns {Constraints}
 */
export function crewConstraints(crew, { cheapMax = null, maxTripMin = MAX_TRIP_MIN } = {}) {
  const b = crew?.taste?.budget ?? crew?.budget;
  const w = crew?.rhythm?.window;
  return {
    window: w && typeof w.from === "string" && typeof w.to === "string" && w.from < w.to ? { from: w.from, to: w.to } : null,
    budget: b === "free" || b === "cheap" ? b : "any",
    cheapMax,
    maxTripMin,
    taste: crew?.taste ?? null,
  };
}

/**
 * Why an idea (or the ritual's pick, in the same shape) breaks the crew's constraints; [] when
 * it does not.
 * @param {{ kind: string, title: string, label?: string|null, time: TimeWindow, price?: { text: string, free: boolean }|null, travel?: { maxMin: number }|null, place: { name?: string|null, outdoor?: boolean, osm?: { tags?: Record<string, string> } } }} c
 * @param {Constraints} k
 * @returns {string[]}
 */
export function candidateViolations(c, k) {
  /** @type {string[]} */
  const out = [];
  if (k.window && (c.time.from < k.window.from || c.time.to > k.window.to)) out.push(`outside the crew's hours (${clockWords(k.window.from)} to ${clockWords(k.window.to)})`);
  if (c.travel && c.travel.maxMin > k.maxTripMin) out.push(`too far (${c.travel.maxMin} minutes for someone)`);
  if (c.price && (k.budget === "free" ? c.price.free === false : overBudget(c.price, k.budget, k.cheapMax))) out.push("over the crew's budget");
  const t = k.taste;
  if (t) {
    const tags = c.place?.osm?.tags;
    const needs = new Set(t.needs);
    const placeBlock = tags ? tasteFit(tags, t, { green: c.place.outdoor === true }).blocked : null;
    if (placeBlock) out.push(placeBlock === "not step-free" ? "not step-free" : placeBlock);
    if (c.kind === "event" || c.kind === "usual") {
      const e = eventFit({ title: c.title, category: c.label ?? null, venue: c.place?.name ?? null, start: c.time.from }, t);
      if (e.blocked) out.push(e.blocked);
    }
    if (needs.has("daytime") && c.time.from >= "20:00") out.push("a night-time plan");
    if (needs.has("kid-friendly") && c.time.from >= "20:00" && !out.includes("too late")) out.push("too late for kids");
    // a plan's title travels (calendars, push, WhatsApp): for a discreet crew it never says who anyone is
    if ((needs.has("discreet") || needs.has("safe")) && hasSensitive(c.title)) out.push("names who the crew is (discreet)");
  }
  return [...new Set(out)];
}

/** The honest line for a card or a ritual with nothing that fits. */
export function nothingFits(/** @type {Constraints} */ k) {
  const parts = [k.window ? `your hours (${clockWords(k.window.from)} to ${clockWords(k.window.to)})` : null, k.budget !== "any" ? "your budget" : null, k.taste?.needs?.length ? "what the crew needs" : null].filter(Boolean);
  return `Nothing the sloth found fits ${parts.length ? parts.join(", ").replace(/, ([^,]*)$/, " and $1") : "this time"}${parts.length ? " this time" : ""}. Try the other slot, or add a plan yourself.`;
}
