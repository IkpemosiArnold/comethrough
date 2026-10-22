// @ts-check
// "The sloth has 3 ideas": what the crew could do tonight or this weekend. One card with
// three ideas, never a feed. The pure part: the time slot, the candidates from three
// sources, the deterministic filters, the facts Gemma ranks, the check on its reasons, the
// code's own order and reasons when Gemma is away, and the plan draft each idea becomes.
//
// Sources (the app layer gathers them; this module never fetches):
//   place  open data anywhere: green and open spaces near the crew's middle from the
//          places pipeline (OpenStreetMap, Wikidata, a pack's curated spots), and covered
//          spots a source vouches for
//   usual  the crew's own history: places it went to before, and plans people came to
//   event  a city pack's curated weekly guides (Lagos: Awe Lagos and NTDIL), as facts
//          read from their RSS feeds (./feeds.mjs), each crediting its guide and post
//
// Order of work: deterministic filters first (inside the slot, not passed, within the
// distance cap and a fair trip, dry enough if it is outdoors), then Gemma ranks what is
// left for the crew's vibe and budget, the trips, the time and the weather, and writes a
// one-line reason per pick. A reason with a number that is not in that idea's facts, or
// that does not name the idea, is replaced by the code's own sentence.
//
// Pure: the caller passes now, the forecast and the travel model; no city is named here.

import { FREE_FLOW, haversineKm, travelEstimate } from "./geo.mjs";
import { placeKey, placeKind, scorePlaces } from "./places.mjs";
import { DAY_NAMES, addDays, daysBetween, localParts, minutesOfDay, hhmm, parseInstant, toIsoLocal, zonedToMs } from "./time.mjs";
import { GENERIC_SOCIAL_HOURS, RAIN_OK, bestWindow, clockWords, isWeekend, socialWindow } from "./weather.mjs";
import { LEAKED_FIELDS, fill, noDashes, numbersGrounded, unsafeText } from "./tasks.mjs";
import { PLACE_KINDS, eventFit, hasTaste, kindOfTags, overBudget } from "./taste.mjs";
import { upcomingDates } from "./feeds.mjs";

/** @typedef {import("./tasks.mjs").Message} Message */
/** @typedef {import("./tasks.mjs").Prompt} Prompt */
/** @typedef {import("./feeds.mjs").FeedEvent} FeedEvent */
/** @typedef {import("./types.mjs").Plan} Plan */
/** @typedef {{ from: string, to: string }} TimeWindow */
/** @typedef {{ id: string, name: string, area: { label: string, lat: number, lon: number }|null }} Traveller */

export const IDEA_PROMPT_NAMES = ["extract-events", "rank-ideas"];
/** Ideas are kept this long per crew and slot. */
export const IDEAS_TTL_MS = 3 * 3_600_000;
/** How far from the crew's middle each kind may be (km, straight line). */
export const CAP_KM = { place: 15, usual: 25, event: 35 };
/** No idea where someone's trip is longer than this (minutes, the pack's estimate). */
export const MAX_TRIP_MIN = 90;
/** How many of each kind Gemma is shown. */
export const POOL = { event: 6, place: 4, usual: 3 };
export const RANK_MAX_TOKENS = 500;

// ---------------------------------------------------------------- the slot

/**
 * @typedef {object} SlotDay
 * @property {string} date
 * @property {TimeWindow|null} outdoor  when an outdoor idea may happen that day (null: none)
 * @property {TimeWindow|null} covered  when an indoor or covered idea may happen
 */
/** @typedef {{ when: "tonight"|"weekend", today: string, nowTime: string, tz: string, days: SlotDay[] }} Slot */

const later = (/** @type {string} */ a, /** @type {string} */ b) => (a > b ? a : b);
const roundUp = (/** @type {string} */ t, step = 30) => hhmm(Math.ceil(minutesOfDay(t) / step) * step);

/**
 * The days and hours "tonight" or "this weekend" means for a crew, inside its pack's social
 * hours. Tonight is today's evening (from 5 pm under a roof; the light part of it outside).
 * The weekend is Friday evening, Saturday and Sunday, from now on: on a Saturday, the rest
 * of Saturday and Sunday. A day with less than an hour left is dropped.
 * @param {"tonight"|"weekend"} when
 * @param {number} nowMs
 * @param {string} tz
 * @param {import("./weather.mjs").SocialHours} [social]
 * @returns {Slot}
 */
export function slotFor(when, nowMs, tz, social = GENERIC_SOCIAL_HOURS) {
  const { date: today, time: nowTime, weekday } = localParts(nowMs, tz);
  const earliest = roundUp(nowTime);
  /** @type {string[]} */
  let dates;
  if (when === "tonight") dates = [today];
  else if (weekday === 0) dates = [today];
  else if (weekday === 6) dates = [today, addDays(today, 1)];
  else dates = [5, 6, 7].map((d) => addDays(today, d - weekday));
  const clip = (/** @type {string} */ date, /** @type {TimeWindow|null} */ w) => {
    if (!w) return null;
    const from = date === today ? later(w.from, earliest) : w.from;
    return minutesOfDay(w.to) - minutesOfDay(from) >= 60 ? { from, to: w.to } : null;
  };
  const days = dates.map((date) => {
    const o = socialWindow(date, { outdoor: true, social });
    const c = socialWindow(date, { outdoor: false, social });
    const evening = when === "tonight" || !isWeekend(date);
    return {
      date,
      outdoor: clip(date, evening ? (minutesOfDay(o.to) > minutesOfDay("17:00") ? { from: later(o.from, "16:00"), to: o.to } : null) : o),
      covered: clip(date, evening ? { from: later(c.from, "17:00"), to: c.to } : c),
    };
  }).filter((d) => d.outdoor || d.covered);
  return { when, today, nowTime, tz, days };
}

/** "Saturday 24 October" */
export function dayWords(/** @type {string} */ date, /** @type {string} */ today) {
  const n = daysBetween(today, date);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  const [, m, d] = date.split("-").map(Number);
  return `${DAY_NAMES[new Date(`${date}T12:00:00Z`).getUTCDay()]} ${d} ${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1]}`;
}

// ---------------------------------------------------------------- candidates

/**
 * One candidate idea before ranking.
 * @typedef {object} Candidate
 * @property {string} id         "e1", "p2", "u1": unique in one request
 * @property {"event"|"place"|"usual"|"home"} kind  home: a night in at a member's place, offered to a crew that needs discreet or safe
 * @property {string} title
 * @property {string} date
 * @property {TimeWindow} time   from is the start; to the end (an event with no end gets 3 hours)
 * @property {{ name: string|null, address: string|null, area: string|null, lat: number|null, lon: number|null, outdoor: boolean, osm?: any }} place
 * @property {{ text: string, free: boolean }|null} price
 * @property {{ maxMin: number, trips: { from: string, minutes: number }[] }|null} travel  null when the place is not on the map
 * @property {{ text: string, ok: boolean, rainProb: number|null }|null} weather
 * @property {number} pre        the code's own score, 0 to 1, for the fallback order
 * @property {Record<string, any>} facts  what Gemma may see and phrase (no member names)
 * @property {{ name: string, url: string, title?: string, published?: string|null }} [source]
 * @property {string|null} [ticketUrl]
 * @property {string} [label]    the guide's own category, a place's kind
 * @property {{ visits: number, lastDaysAgo: number|null, going: number }} [history]
 * @property {string[]} [fits]   what the crew is into that this idea is (taste words), for the facts
 * @property {boolean} [lowKey]  a quiet, low-key place
 */

/**
 * Trips from every located member to a point, with the pack's travel model.
 * @param {Traveller[]} points
 * @param {{ lat: number, lon: number }} to
 * @param {{ at: number, tz: string, model?: import("./geo.mjs").TravelModel }} opts
 */
export function tripsTo(points, to, { at, tz, model = FREE_FLOW }) {
  const trips = points.filter((p) => p.area && Number.isFinite(p.area.lat)).map((p) => ({ from: /** @type {any} */ (p.area).label, minutes: travelEstimate(/** @type {any} */ (p.area), to, { at, tz, model }).minutes }));
  if (!trips.length) return null;
  // one line per neighbourhood: the facts never say who, only where from
  /** @type {Map<string, number>} */
  const by = new Map();
  for (const t of trips) by.set(t.from, Math.max(by.get(t.from) ?? 0, t.minutes));
  const list = [...by.entries()].map(([from, minutes]) => ({ from, minutes })).sort((a, b) => b.minutes - a.minutes);
  return { maxMin: list[0].minutes, trips: list };
}

/** The slot's days in the order a place or the usual should try them: Saturday and Sunday before a Friday evening. */
export const preferredDays = (/** @type {Slot} */ slot) => (slot.when === "weekend" ? [...slot.days.filter((d) => isWeekend(d.date)), ...slot.days.filter((d) => !isWeekend(d.date))] : slot.days);

const near = (/** @type {{ lat: number, lon: number }} */ center, /** @type {any} */ p, /** @type {number} */ km) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon) && haversineKm(center, p) <= km;

/**
 * The best stretch of `span` hours inside a window, with its weather; null only when the
 * forecast has no hours for that date (too far ahead). A window too short or not on the
 * hour for bestWindow (17:30 to 18:30) is judged on every forecast hour it touches.
 * @param {any[]|null} hours
 * @param {string} date
 * @param {TimeWindow} w
 * @param {number} span
 * @returns {{ from: string, to: string, ok: boolean, text: string, rainProb: number|null }|null}
 */
export function windowWeather(hours, date, w, span) {
  const day = (hours || []).filter((h) => h.date === date);
  if (!day.length) return null;
  const b = bestWindow(day, { date, from: w.from, to: w.to, hours: span });
  if (b) return { from: b.from, to: b.to, ok: b.ok, text: b.reason.text, rainProb: b.rainProb };
  const lo = Math.floor(minutesOfDay(w.from) / 60) * 60;
  const inside = day.filter((h) => minutesOfDay(h.time) >= lo && minutesOfDay(h.time) < minutesOfDay(w.to));
  if (!inside.length) return null;
  const rain = Math.max(...inside.map((h) => h.rainProb ?? 50));
  const ok = rain < RAIN_OK;
  return { from: w.from, to: w.to, ok, rainProb: rain, text: ok ? `Mostly dry: rain chance up to ${rain}%.` : `Rain likely: up to ${rain}%.` };
}

/** The weather fact for an idea's hours, from the forecast, or null when it is too far ahead. */
function weatherAt(/** @type {any[]} */ hours, /** @type {string} */ date, /** @type {TimeWindow} */ w) {
  const span = Math.max(1, Math.floor((minutesOfDay(w.to) - minutesOfDay(w.from)) / 60));
  const b = windowWeather(hours, date, w, span);
  return b ? { text: b.text, ok: b.ok, rainProb: b.rainProb } : null;
}

/**
 * Event candidates: still to come inside the slot, starting in its hours, near enough,
 * and dry enough when the guide says it is outdoors.
 * @param {FeedEvent[]} events
 * @param {{ slot: Slot, center: { lat: number, lon: number }, points: Traveller[], hours: any[]|null, model?: import("./geo.mjs").TravelModel, taste?: import("./taste.mjs").Taste|null, budget?: "free"|"cheap"|"any", cheapMax?: number|null }} ctx
 *   taste: events its needs rule out (drinks for a crew that needs no alcohol, late nights
 *   with kids) are dropped, and events matching its keywords rank higher; budget and
 *   cheapMax (the pack's ceiling for "cheap", in the local currency) drop events over budget
 * @returns {Candidate[]}
 */
export function eventCandidates(events, { slot, center, points, hours, model, taste = null, budget = "any", cheapMax = null }) {
  /** @type {Candidate[]} */
  const out = [];
  for (const e of events) {
    if (!e.start) continue; // a plan needs a time; the guide's "times vary" is not one
    const fit = eventFit(e, taste);
    if (fit.blocked || overBudget(e.price, budget, cheapMax)) continue;
    const dates = upcomingDates(e, slot.today, slot.nowTime);
    const day = slot.days.find((d) => dates.includes(d.date) && (d.covered || d.outdoor) && /** @type {string} */ (e.start) >= (slot.when === "tonight" ? "16:00" : "00:00") && (d.date !== slot.today || /** @type {string} */ (e.start) >= hhmm(minutesOfDay(slot.nowTime) - 30)));
    if (!day) continue;
    const at = e.at && Number.isFinite(e.at.lat) ? e.at : null;
    if (at && !near(center, at, CAP_KM.event)) continue;
    const startMs = zonedToMs(day.date, /** @type {string} */ (e.start), slot.tz);
    const travel = at ? tripsTo(points, at, { at: startMs, tz: slot.tz, model }) : null;
    if (travel && travel.maxMin > MAX_TRIP_MIN) continue;
    const end = e.end && e.end > /** @type {string} */ (e.start) ? e.end : hhmm(Math.min(minutesOfDay(/** @type {string} */ (e.start)) + 180, 23 * 60 + 59));
    const time = { from: /** @type {string} */ (e.start), to: end };
    const weather = e.outdoor === true && hours ? weatherAt(hours, day.date, time) : null;
    if (weather && !weather.ok) continue;
    const pre = 0.5 + (travel ? 0.3 * (1 - travel.maxMin / MAX_TRIP_MIN) : 0.1) + (e.price?.free ? 0.1 : 0) + 0.1 * e.confidence.time + 0.4 * fit.score - (hasTaste(taste) && !fit.matched.length ? 0.3 : 0);
    out.push({
      id: "",
      kind: "event",
      title: e.title,
      date: day.date,
      time,
      place: { name: e.venue ?? e.area, address: e.venue, area: e.area, lat: at?.lat ?? null, lon: at?.lon ?? null, outdoor: e.outdoor === true },
      price: e.price,
      travel,
      weather,
      pre: Math.round(pre * 1000) / 1000,
      facts: {},
      source: { name: e.source.name, url: e.source.url, title: e.source.title, published: e.source.published },
      ticketUrl: e.ticketUrl,
      label: e.category ?? undefined,
      ...(fit.matched.length ? { fits: fit.matched } : {}),
    });
  }
  return out.sort((a, b) => b.pre - a.pre || a.date.localeCompare(b.date) || a.time.from.localeCompare(b.time.from)).slice(0, POOL.event * 2);
}

/**
 * Place candidates from the places pipeline: outdoor ones only on a dry day (the best
 * window in the slot's outdoor hours), covered ones in the covered hours. Ranked by the
 * core's own fair-place scoring (travel fairness, green, vibe, budget, variety).
 * @param {any[]} places   candidates from the places pipeline (name, lat, lon, osm?, outdoor?, covered?, entry?)
 * @param {{ slot: Slot, center: { lat: number, lon: number }, points: Traveller[], hours: any[]|null, crew: { vibeTags?: string[], budget?: "free"|"cheap"|"any", taste?: import("./taste.mjs").Taste|null }, recent: { key: string, at: number }[], now: number, model?: import("./geo.mjs").TravelModel }} ctx
 *   places marked `indoor` (a gallery or café the crew's taste asked for) go with the covered ones
 * @returns {{ candidates: Candidate[], wet: boolean }}
 */
export function placeCandidates(places, { slot, center, points, hours, crew, recent, now, model = FREE_FLOW }) {
  const inCap = places.filter((p) => near(center, p, CAP_KM.place));
  // the dry window for outdoor places: the first slot day with an ok window
  /** @type {{ date: string, time: TimeWindow, weather: any }|null} */
  let dry = null;
  let wet = false;
  for (const d of preferredDays(slot)) {
    if (!d.outdoor) continue;
    const span = Math.min(3, Math.floor((minutesOfDay(d.outdoor.to) - minutesOfDay(d.outdoor.from)) / 60));
    const b = windowWeather(hours, d.date, d.outdoor, Math.max(1, span));
    if (!b) {
      // no forecast that far ahead: the afternoon, and the weather unknown
      const from = isWeekend(d.date) ? later(d.outdoor.from, "15:00") : d.outdoor.from;
      const to = hhmm(Math.min(minutesOfDay(d.outdoor.to), minutesOfDay(from) + Math.max(1, span) * 60));
      if (minutesOfDay(to) - minutesOfDay(from) >= 60) {
        dry = { date: d.date, time: { from, to }, weather: null };
        break;
      }
      continue;
    }
    if (b.ok) {
      dry = { date: d.date, time: { from: b.from, to: b.to }, weather: { text: b.text, ok: true, rainProb: b.rainProb } };
      break;
    }
    wet = true;
  }
  const coveredDay = preferredDays(slot).find((d) => d.covered);
  const coveredTime = coveredDay?.covered
    ? (() => {
      const from = isWeekend(coveredDay.date) && slot.when === "weekend" ? later(coveredDay.covered.from, "16:00") : coveredDay.covered.from;
      return { from, to: hhmm(Math.min(minutesOfDay(coveredDay.covered.to), minutesOfDay(from) + 180)) };
    })()
    : null;
  /** @type {Candidate[]} */
  const out = [];
  const groups = [
    { list: inCap.filter((p) => p.covered !== true && p.indoor !== true), when: dry, outdoor: true },
    { list: inCap.filter((p) => p.covered === true || p.indoor === true), when: coveredDay && coveredTime && minutesOfDay(coveredTime.to) - minutesOfDay(coveredTime.from) >= 60 ? { date: coveredDay.date, time: coveredTime, weather: null } : null, outdoor: false },
  ];
  for (const g of groups) {
    if (!g.when || !g.list.length) continue;
    const at = zonedToMs(g.when.date, g.when.time.from, slot.tz);
    const scored = scorePlaces({ members: points, candidates: g.list, at, tz: slot.tz, vibeTags: crew.vibeTags || [], budget: crew.budget || "any", outdoor: g.outdoor, recent, now, model, taste: crew.taste ?? null });
    for (const r of scored.ranked) {
      if (r.maxMin > MAX_TRIP_MIN) continue;
      const c = r.candidate;
      const tags = c.osm?.tags || c.tags || {};
      /** @type {Map<string, number>} */
      const by = new Map();
      for (const t of r.travel) by.set(t.from, Math.max(by.get(t.from) ?? 0, t.minutes));
      const trips = [...by.entries()].map(([from, minutes]) => ({ from, minutes })).sort((a, b) => b.minutes - a.minutes);
      out.push({
        id: "",
        kind: "place",
        title: c.name,
        date: g.when.date,
        time: g.when.time,
        place: { name: c.name, address: c.address ?? null, area: null, lat: c.lat, lon: c.lon, outdoor: g.outdoor, ...(c.osm ? { osm: c.osm } : {}) },
        price: c.entry?.free === true ? { text: "Free", free: true } : null,
        travel: trips.length ? { maxMin: r.maxMin, trips } : null,
        weather: g.outdoor ? g.when.weather : null,
        pre: Math.max(0, Math.min(1, r.score)),
        facts: {},
        label: (kindOfTags(tags) ? PLACE_KINDS[/** @type {string} */ (kindOfTags(tags))].label.replace(/^an? /, "") : null) ?? placeKind(tags) ?? (g.outdoor ? "open space" : "covered spot"),
        ...(r.taste.matched.length || r.taste.lowKey ? { fits: r.taste.matched, lowKey: r.taste.lowKey } : {}),
      });
    }
  }
  return { candidates: out.sort((a, b) => b.pre - a.pre).slice(0, POOL.place * 2), wet: wet && !dry };
}

/**
 * The crew's usual: places from its own past plans (not homes, not cancelled), most liked
 * first (more people going, more visits), at the slot's first fitting hours.
 * @param {Plan[]} plans
 * @param {{ slot: Slot, center: { lat: number, lon: number }, points: Traveller[], hours: any[]|null, now: number, model?: import("./geo.mjs").TravelModel }} ctx
 * @returns {Candidate[]}
 */
export function usualCandidates(plans, { slot, center, points, hours, now, model }) {
  /** @type {Map<string, { plan: Plan, visits: number, going: number, last: number }>} */
  const by = new Map();
  for (const p of plans) {
    if (p.status === "cancelled" || p.place?.private || !near(center, p.place, CAP_KM.usual) || !p.place?.name) continue;
    const startMs = parseInstant(p.start);
    if (!Number.isFinite(startMs) || startMs > now) continue; // the past only: what the crew did
    const key = placeKey(p.place);
    const going = Object.values(p.rsvps || {}).filter((v) => v === "going").length;
    const cur = by.get(key);
    if (!cur) by.set(key, { plan: p, visits: 1, going, last: startMs });
    else {
      cur.visits++;
      if (going >= cur.going) cur.plan = p;
      cur.going = Math.max(cur.going, going);
      cur.last = Math.max(cur.last, startMs);
    }
  }
  /** @type {Candidate[]} */
  const out = [];
  for (const u of [...by.values()].sort((a, b) => b.going + b.visits - (a.going + a.visits) || b.last - a.last)) {
    const p = u.plan;
    const outdoor = p.place.outdoor === true;
    const span = Math.max(1, Math.min(3, Math.round((parseInstant(p.end) - parseInstant(p.start)) / 3_600_000) || 2));
    // the first slot day with fitting hours (and, outdoors, not wet)
    let day = null;
    let b = null;
    for (const d of preferredDays(slot)) {
      const dw = outdoor ? d.outdoor : d.covered;
      if (!dw) continue;
      const ww = outdoor ? windowWeather(hours, d.date, dw, span) : null;
      if (ww && !ww.ok) continue;
      day = d;
      b = ww;
      break;
    }
    if (!day) continue;
    const w = /** @type {TimeWindow} */ (outdoor ? day.outdoor : day.covered);
    const from = b ? b.from : (() => {
      // the hour the crew used last time, when it fits; else the start of the slot's hours
      const used = localParts(parseInstant(p.start), slot.tz).time;
      return used >= w.from && minutesOfDay(used) + 60 <= minutesOfDay(w.to) ? used : w.from;
    })();
    const time = { from, to: b ? b.to : hhmm(Math.min(minutesOfDay(w.to), minutesOfDay(from) + span * 60)) };
    const travel = tripsTo(points, /** @type {any} */ (p.place), { at: zonedToMs(day.date, time.from, slot.tz), tz: slot.tz, model });
    if (travel && travel.maxMin > MAX_TRIP_MIN) continue;
    const lastDaysAgo = Math.max(0, Math.round((now - u.last) / 86_400_000));
    out.push({
      id: "",
      kind: "usual",
      title: p.kind === "ritual" ? /** @type {string} */ (p.place.name) : p.title,
      date: day.date,
      time,
      place: { name: p.place.name, address: p.place.address, area: null, lat: p.place.lat, lon: p.place.lon, outdoor, ...(p.place.osm ? { osm: p.place.osm } : {}) },
      price: p.price,
      travel,
      weather: b ? { text: b.text, ok: true, rainProb: b.rainProb } : null,
      pre: Math.min(1, 0.4 + 0.1 * u.going + 0.1 * u.visits),
      facts: {},
      history: { visits: u.visits, lastDaysAgo, going: u.going },
    });
  }
  return out.slice(0, POOL.usual);
}

/**
 * A night in at one of the crew's homes: hosted and private. Offered only to a crew whose
 * needs say safe or discreet (who it is stays unsaid). Its title is neutral, because a plan's
 * title travels (calendars, WhatsApp). The host fills in the address on the confirm screen;
 * members alone see it.
 * @param {Slot} slot
 * @param {import("./taste.mjs").Taste|null|undefined} taste
 * @returns {Candidate|null}
 */
export function homeCandidate(slot, taste) {
  if (!taste?.needs.some((n) => n === "discreet" || n === "safe")) return null;
  const day = slot.days.find((d) => d.covered && minutesOfDay(d.covered.to) - minutesOfDay(d.covered.from) >= 120);
  if (!day?.covered) return null;
  const from = later(day.covered.from, "18:00") <= hhmm(minutesOfDay(day.covered.to) - 120) ? later(day.covered.from, "18:00") : day.covered.from;
  const to = hhmm(Math.min(minutesOfDay(day.covered.to), minutesOfDay(from) + 180));
  return {
    id: "",
    kind: "home",
    title: "A night in at one of yours",
    date: day.date,
    time: { from, to },
    place: { name: null, address: null, area: null, lat: null, lon: null, outdoor: false },
    price: null,
    travel: null,
    weather: null,
    pre: 0.75,
    facts: {},
    label: "hosted at home",
    lowKey: true,
  };
}

/**
 * The pool Gemma sees: the best few of each kind, with ids and facts. Facts hold only what
 * the idea is, when, where (neighbourhoods and minutes, never member names), the price as
 * stated, the weather and the crew's history with it.
 * @param {{ events: Candidate[], places: Candidate[], usual: Candidate[], home?: Candidate|null }} lists
 * @param {string} today
 * @returns {Candidate[]}
 */
export function pool({ events, places, usual, home = null }, today) {
  const take = (/** @type {Candidate[]} */ l, /** @type {string} */ p, /** @type {number} */ n) => l.slice(0, n).map((c, i) => ({ ...c, id: `${p}${i + 1}` }));
  // a place the crew already went to is offered once, as the usual
  const used = new Set(usual.map((u) => placeKey(u.place)));
  const fresh = places.filter((p) => !used.has(placeKey(p.place)));
  const all = [...take(events, "e", POOL.event), ...take(fresh, "p", POOL.place), ...take(usual, "u", POOL.usual), ...(home ? [{ ...home, id: "h1" }] : [])];
  return all.map((c) => ({ ...c, facts: factsOf(c, today) }));
}

/** @param {Candidate} c @param {string} today */
function factsOf(c, today) {
  return {
    id: c.id,
    kind: c.kind,
    title: c.title,
    label: c.label ?? null,
    day: dayWords(c.date, today),
    time: `${clockWords(c.time.from)} to ${clockWords(c.time.to)}`,
    place: c.place.name,
    area: c.place.area,
    outdoor: c.place.outdoor,
    price: c.price?.text ?? null,
    longestTripMinutes: c.travel?.maxMin ?? null,
    tripsFrom: c.travel?.trips ?? null,
    weather: c.weather?.text ?? null,
    guide: c.source?.name ?? null,
    crewHistory: c.history ? { visits: c.history.visits, lastDaysAgo: c.history.lastDaysAgo, goingLastTime: c.history.going } : null,
    fitsCrewTaste: c.fits?.length ? c.fits : null,
    lowKey: c.lowKey === true,
  };
}

// ---------------------------------------------------------------- ranking

export const RANK_SCHEMA = {
  type: "object",
  properties: {
    picks: {
      type: "array",
      items: { type: "object", properties: { id: { type: "string" }, why: { type: "string" } }, required: ["id", "why"] },
    },
  },
  required: ["picks"],
};

/**
 * @param {Prompt} prompt  rank-ideas, localised
 * @param {{ crew: { vibe?: string|null, vibeTags?: string[], budget?: string, taste?: import("./taste.mjs").Taste|null }, when: "tonight"|"weekend", candidates: Candidate[] }} input
 * @returns {Message[]}
 */
export function rankMessages(prompt, { crew, when, candidates }) {
  const crewFacts = crewFactsOf(crew, when);
  return [
    { role: "system", content: prompt.system },
    // "the three best" of two ideas made Gemma answer with none (live, 21 Oct): say how many
    { role: "user", content: `${fill(prompt.user, { crew: JSON.stringify(crewFacts), ideas: candidates.map((c) => JSON.stringify(c.facts)).join("\n") })}\n\nPick ${Math.min(3, candidates.length) === 1 ? "this one idea" : `${Math.min(3, candidates.length)} of these ${candidates.length} ideas`}.` },
  ];
}

/**
 * What Gemma may know about the crew when ranking: its vibe, likes, budget and taste (what
 * it is into and what it needs). Needs are requirements, never who the crew is.
 * @param {{ vibe?: string|null, vibeTags?: string[], budget?: string, taste?: import("./taste.mjs").Taste|null }} crew
 * @param {"tonight"|"weekend"} when
 */
export function crewFactsOf(crew, when) {
  const t = crew.taste;
  return {
    vibe: crew.vibe ?? null,
    likes: [...new Set([...(crew.vibeTags ?? []), ...(t?.likes ?? [])])],
    budget: crew.budget ?? "any",
    when,
    ...(hasTaste(t) ? { scenes: t?.scenes, placeKinds: t?.placeKinds, avoid: t?.avoid, needs: t?.needs, ageBand: t?.ageBand, energy: t?.energy } : {}),
  };
}

/** Words of four letters or more from the idea's name and place, one of which the reason must use. */
const nameWords = (/** @type {Candidate} */ c) =>
  `${c.title} ${c.place.name || ""}`.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !["park", "beach", "garden", "night", "with", "from", "this", "that", "your"].includes(w));

/**
 * The reason Gemma gave, when it is grounded: every number in it is in this idea's facts
 * (or the crew's), it names the idea, and it is short. Null otherwise.
 * @param {any} why
 * @param {Candidate} c
 * @param {any} crewFacts
 */
export function groundedWhy(why, c, crewFacts = {}) {
  if (typeof why !== "string") return null;
  const s = noDashes(why.replace(/\s+/g, " ").trim());
  if (s.length < 12 || s.length > 220) return null;
  if (!numbersGrounded(s, { ...c.facts, crew: crewFacts })) return null;
  // never who the crew is, and never "X-friendly" or "a safe space" about a venue nobody sourced
  if (unsafeText(s, [c.title, c.place.name])) return null;
  if (LEAKED_FIELDS.test(s)) return null;
  const low = s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const words = nameWords(c);
  if (words.length && !words.some((w) => low.includes(w))) return null;
  return s;
}

/** The code's own reason for an idea: plain facts only. */
export function fallbackWhy(/** @type {Candidate} */ c) {
  const trip = c.travel ? `nobody's trip is over about ${c.travel.maxMin} minutes` : null;
  if (c.kind === "home") return "A night in at one of your places: private, easy to keep low-key, and nobody pays at a door.";
  if (c.kind === "event") {
    const bits = [`${c.source?.name ?? "A local guide"} lists ${c.title}${c.price ? ` (${c.price.text})` : ""}${c.fits?.length ? `, with ${c.fits.slice(0, 2).join(" and ")}` : ""}`];
    if (trip) bits.push(trip);
    return `${bits.join(", and ")}.`;
  }
  if (c.kind === "usual" && c.history) {
    const been = c.history.visits === 1 ? "The crew has been to" : `The crew has been to ${c.place.name} ${c.history.visits} times`;
    const first = c.history.visits === 1 ? `${been} ${c.place.name} before` : been;
    return `${first}${c.history.going >= 2 ? `, and ${c.history.going} people came last time` : ""}${trip ? `; ${trip}` : ""}.`;
  }
  const extra = c.place.outdoor ? (c.weather?.ok ? ", it is outdoors and the forecast is dry" : ", and it is outdoors") : ", and it has a roof";
  if (c.fits?.length || c.lowKey) {
    const what = c.fits?.[0] ?? (c.label ? `a ${c.label}` : "a quiet spot");
    return `${c.title} is ${what}${c.lowKey ? ", quiet and low-key" : ""}${trip ? `, and ${trip}` : ""}.`;
  }
  return `${c.title} keeps ${trip ? trip.replace(/^nobody's trip is over/, "everyone's trip under") : "the crew close"}${extra}.`;
}

/**
 * The code's own order: the best of each kind first (an event, a place, the usual), then
 * the rest by score.
 * @param {Candidate[]} cands
 */
export function fallbackOrder(cands) {
  const best = (/** @type {string} */ k) => cands.filter((c) => c.kind === k).sort((a, b) => b.pre - a.pre)[0];
  const first = /** @type {Candidate[]} */ (["home", "event", "place", "usual"].map(best).filter(Boolean));
  const rest = cands.filter((c) => !first.includes(c)).sort((a, b) => b.pre - a.pre);
  return [...first, ...rest];
}

/**
 * Three picks: Gemma's, in its order, each with a grounded reason (else the code's), then
 * topped up from the code's own order.
 * @param {any} data  the parsed answer, or null
 * @param {Candidate[]} cands
 * @param {any} [crewFacts]
 * @returns {{ picks: { candidate: Candidate, why: string, by: "gemma"|"code" }[], by: "gemma"|"code" }}
 */
export function readRanking(data, cands, crewFacts = {}) {
  /** @type {{ candidate: Candidate, why: string, by: "gemma"|"code" }[]} */
  const picks = [];
  const list = Array.isArray(data?.picks) ? data.picks : [];
  for (const p of list) {
    const c = cands.find((x) => x.id === String(p?.id ?? "").trim());
    if (!c || picks.some((x) => x.candidate === c)) continue;
    const why = groundedWhy(p?.why, c, crewFacts);
    picks.push({ candidate: c, why: why ?? fallbackWhy(c), by: why ? "gemma" : "code" });
    if (picks.length === 3) break;
  }
  const byModel = picks.length > 0;
  for (const c of fallbackOrder(cands)) {
    if (picks.length >= 3) break;
    if (!picks.some((x) => x.candidate === c)) picks.push({ candidate: c, why: fallbackWhy(c), by: "code" });
  }
  return { picks, by: byModel ? "gemma" : "code" };
}

// ---------------------------------------------------------------- the card

/** "Awe Lagos' weekly guide", "NTDIL's weekly guide" */
export const creditFor = (/** @type {string} */ name) => `From ${name}${/s$/i.test(name) ? "'" : "'s"} weekly guide`;

/**
 * The plan draft an idea becomes with one tap: a PlanDraft (docs/SPEC.md) that the
 * existing create flow (POST /api/crews/:slug/plans) takes as it is.
 * @param {Candidate} c
 * @param {string} tz
 */
export function draftFor(c, tz) {
  const start = toIsoLocal(zonedToMs(c.date, c.time.from, tz), tz);
  const endMs = zonedToMs(c.date, c.time.to, tz);
  const end = endMs > parseInstant(start) ? toIsoLocal(endMs, tz) : null;
  return {
    kind: c.kind === "event" ? "found" : c.kind === "home" ? "hosted" : "quick",
    title: c.kind === "place" ? `${DAY_NAMES[new Date(`${c.date}T12:00:00Z`).getUTCDay()]} at ${c.title}` : c.title,
    start,
    end,
    tz,
    place: {
      name: c.place.name,
      address: c.place.address,
      lat: c.place.lat,
      lon: c.place.lon,
      outdoor: c.place.outdoor,
      private: c.kind === "home",
      ...(c.place.osm ? { osm: c.place.osm } : {}),
    },
    price: c.price,
    host: null,
    hostName: null,
    bring: [],
    source: c.kind === "event" && c.source ? { url: c.ticketUrl || c.source.url, text: `${creditFor(c.source.name)}: ${c.source.url}` } : {},
  };
}

/** "Saturday 24 October, 4 pm to 7 pm" */
export function whenWords(/** @type {Candidate} */ c, /** @type {string} */ today) {
  const d = dayWords(c.date, today);
  return `${d.replace(/^./, (x) => x.toUpperCase())}, ${clockWords(c.time.from)} to ${clockWords(c.time.to)}`;
}

/**
 * One idea as the API sends it.
 * @param {{ candidate: Candidate, why: string, by: "gemma"|"code" }} pick
 * @param {{ today: string, tz: string }} ctx
 */
export function ideaView({ candidate: c, why, by }, { today, tz }) {
  const draft = draftFor(c, tz);
  return {
    id: c.id,
    kind: c.kind,
    title: c.title,
    when: whenWords(c, today),
    start: draft.start,
    end: draft.end,
    place: { name: c.place.name, address: c.place.address, area: c.place.area, lat: c.place.lat, lon: c.place.lon, outdoor: c.place.outdoor },
    price: c.price,
    why,
    by,
    travel: c.travel ? { longestMinutes: c.travel.maxMin, from: c.travel.trips } : null,
    weather: c.weather,
    ...(c.kind === "event" && c.source
      ? { source: { name: c.source.name, url: c.source.url, credit: creditFor(c.source.name) }, ticketUrl: c.ticketUrl ?? null }
      : {}),
    draftPlan: draft,
  };
}
