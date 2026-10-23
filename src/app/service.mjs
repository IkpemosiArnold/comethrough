// @ts-check
// The use cases: the imperative shell around the pure core. Each function checks who is
// asking, loads what it needs through the ports (store, Gemma, geocoder, places, weather,
// link reader, push), calls the core to decide, saves, and returns what the HTTP layer
// sends. Nothing here knows about HTTP, and nothing in the core knows about this.
//
// Outside services fail; the app should not. Gemma being busy gives an empty draft to fill
// by hand, a failed geocode leaves a place without a pin, Overpass at capacity falls back to
// the curated spots (or Wikidata's), and the ritual still goes out with a plain invite
// written by code.
//
// Where a crew is decides how the app behaves there: each crew has a region (its centre,
// country, city and zone, from its own areas), and the region picks a city pack
// (src/packs): Lagos, with everything sourced in docs/LOCAL-FACTS.md, or the default pack,
// which makes no local claims. This file passes the pack's parts into the core.

import { AREA_SPREAD_KM, centroid, clusterAreas, haversineKm, isLatLon, tripKey } from "../core/geo.mjs";
import { NEAR_KM } from "../adapters/geocode.mjs";
import { areaQueries, citiesFor, cityNamedIn, cleanRegion, hintRegion, localeRegion, packFor, packView, regionOf, zoneOfCountry } from "../packs/index.mjs";
import { calendarFeed, icsFileName, singleEvent } from "../core/ics.mjs";
import { entryFor, placeKey, scorePlaces } from "../core/places.mjs";
import { applyEdit, canEdit, createPlan, goingIds, isExpired, recentPlaces, upcoming, validateDraft, viewPlan } from "../core/plans.mjs";
import { podTrips, podsForPlan } from "../core/pods.mjs";
import { directionsLinks, ridesForApi } from "../core/rides.mjs";
import { fallbackInvite, ritualDraft, ritualDue } from "../core/ritual.mjs";
import {
  CREW_SCHEMA, DEFAULT_WINDOW, EXPLAIN_SCHEMA, INVITE_SCHEMA, MAX_TOKENS, PLAN_SCHEMA, crewSetupMessages, explainMessages, guessCrew, guessPlan, inviteMessages, localisePrompt, planMessages,
  readCrewSetup, readExplain, readInvite, readPlan,
} from "../core/tasks.mjs";
import { PLACE_KINDS, cleanTaste, hasSensitive, hasTaste, kindOfTags, osmTagsFor, tasteView, withVibe } from "../core/taste.mjs";
import { DAY, DAY_NAMES, hhmm, isTime, isValidZone, localParts, minutesOfDay, parseInstant, weekdayOf, zonedToMs } from "../core/time.mjs";
import { clipToSocial, clockWords, coveredNote, rainMovedIn, ritualWindow, weatherForPlan } from "../core/weather.mjs";
import { isSubscription } from "../adapters/push.mjs";
import { inBackground, within } from "../adapters/lanes.mjs";
import { beginPick, finishPick, pendingPick, pickView, shouldRun } from "../core/firstpick.mjs";
import { lockedMessage, lockedSite } from "../core/netguard.mjs";
import { AppError, badToken, invalid, noToken, notFound } from "./errors.mjs";
import { createGrowth } from "./growth.mjs";
import { outboundName } from "../core/growth.mjs";
import { endpointId, safeEqual, slugify } from "./ids.mjs";
import { stopwatch } from "./timing.mjs";
import { candidateViolations, crewConstraints } from "../core/constraints.mjs";
import { diffChange, editDoc } from "./writes.mjs";
import { claimedJobs } from "./claims.mjs";
import { safePath } from "../adapters/store.mjs";
import { droppedFields, emptyFields } from "../core/diagnose.mjs";

/** @typedef {import("../core/types.mjs").Crew} Crew */
/** @typedef {import("../core/types.mjs").Member} Member */
/** @typedef {import("../core/types.mjs").Plan} Plan */
/** @typedef {import("../packs/index.mjs").Region} Region */
/** @typedef {import("../packs/index.mjs").CityPack} CityPack */

/** A flyer thumbnail is kept only when it is this small (the browser sends a ~400 px copy). */
export const FLYER_MAX_BYTES = 200 * 1024;
export const LIMITS = { sentence: 500, into: 300, planText: 2000, url: 2000, memberName: 40, crewName: 60, membersPerCrew: 60, areas: 8 };
/** The ritual looks for places this far from the crew's middle, then wider if it finds too few. */
export const SEARCH_RADII_M = [6000, 12000];
const SPOT_RADIUS_KM = 15;
/**
 * How long someone waiting is kept waiting before the honest fallback: a plan's place not
 * pinned yet, a plan without its forecast (the heartbeat adds it), Gemma's draft left to
 * fill by hand. The first pick runs in the background, but someone is watching its card, so
 * the map and the forecast get budgets there too; what they had not answered by then still
 * fills the caches for the next time.
 */
/**
 * Push deliveries (notify): at least once. A lease stops two workers sending the same push;
 * a crash between the send and the mark can still repeat one, and the phone folds the two
 * into one notification by its tag (web/public/sw.js). Backoff after the 1st, 2nd, ... failure.
 * sendMs: the deadline on one send, well inside the lease (the push adapter has its own).
 */
export const DELIVERY = Object.freeze({ leaseMs: 60_000, sendMs: 20_000, maxAttempts: 6, backoffMs: [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 3600_000], ttlMs: 12 * 3600_000, keepMs: 14 * 24 * 3600_000 });
const iso = (/** @type {number} */ ms) => new Date(ms).toISOString();
/** What the confirm screens say when the sloth (Gemma) was busy and code made the draft. */
export const BEST_GUESS = "The sloth was busy, so this is a best guess. Fix anything that's off.";
export const BUDGETS = { pinMs: 8000, weatherMs: 6000, gemmaMs: 35_000, pickPlacesMs: 8000, pickWeatherMs: 8000, pickWaitMs: 25_000, pushSendMs: DELIVERY.sendMs };
const OUTDOOR_KINDS = ["park", "garden", "nature", "beach", "waterfront", "square", "heritage"];

/** A crew draft's fields, named as Gemma names them, for the logs. */
const crewFields = (/** @type {any} */ d) => ({ name: d.name, vibe: d.vibe, vibeTags: d.vibeTags, budget: d.budget === "any" ? null : d.budget, rhythm: d.rhythm, areas: d.areaLabels, taste: d.taste });
/** A plan draft's fields, named as Gemma names them, for the logs. */
const planFields = (/** @type {any} */ d) => ({ title: d.title, start: d.start, end: d.end, venueName: d.place?.name, address: d.place?.address, priceText: d.price?.text ?? null, bring: d.bring, note: d.note ?? null });

/**
 * @param {object} deps
 * @param {import("../adapters/store.mjs").Store} deps.store
 * @param {import("../adapters/gemini.mjs").AiPort} deps.ai
 * @param {import("../adapters/geocode.mjs").Geocoder} deps.geocoder
 * @param {{ greenNear(at: { lat: number, lon: number }, radiusM: number): Promise<any[]>, kindsNear?: (at: { lat: number, lon: number }, radiusM: number, tags: Record<string, string[]>) => Promise<any[]> }} deps.places
 *   kindsNear: named places with any of these OpenStreetMap tags (a crew's taste: galleries, cafés)
 * @param {{ hourly(at: { lat: number, lon: number }, opts?: { tz?: string, days?: number }): Promise<any[]>, timezoneAt?: (at: { lat: number, lon: number }) => Promise<string|null> }} deps.weather
 * @param {{ spotsNear(at: { lat: number, lon: number }, radiusKm: number): Promise<any[]> }|null} [deps.wikidata]  parks and beaches for crews with no curated spots
 * @param {{ fetchPage(url: string): Promise<{ meta: any, image: any, note: string|null }> }} deps.pages
 * @param {import("../adapters/push.mjs").PushPort} deps.push
 * @param {{ route(from: { lat: number, lon: number }, to: { lat: number, lon: number }): Promise<any>, table(sources: { lat: number, lon: number }[], destinations: { lat: number, lon: number }[]): Promise<{ km: (number|null)[][], min: (number|null)[][] }|null> }|null} [deps.routes]
 *   road routes (OSRM); null or failing means the straight-line estimate, which says so
 * @param {any[]} deps.spots           the Lagos pack's curated spots (data/lagos-spots.json), used only for crews whose pack has curated spots
 * @param {Record<string, import("../core/tasks.mjs").Prompt>} deps.prompts
 * @param {import("./ids.mjs").Ids} deps.ids
 * @param {() => number} deps.now
 * @param {{ publicUrl: string, webUrl: string, uidDomain: string }} deps.cfg
 * @param {(event: string, fields?: Record<string, any>) => void} [deps.log]
 * @param {boolean} [deps.timing]  TIMING=1: one `timing` log line per slow flow, with its stages (src/app/timing.mjs)
 * @param {Partial<typeof BUDGETS>} [deps.budgets]  the waits above (a local Ollama model needs a longer gemmaMs)
 * @param {boolean} [deps.prewarm]  look up a new crew's places and forecast while the organiser reads the draft (the server turns it on)
 */
export function createService({ store, ai, geocoder, places, weather, pages, push, spots, prompts, ids, now, cfg, log = () => {}, routes = null, wikidata = null, timing = false, budgets = {}, prewarm = false }) {
  const budget = { ...BUDGETS, ...budgets };
  // background jobs with a lease: only the worker holding the current claim records an outcome
  const pickJobs = claimedJobs({ store, coll: "crews", at: "firstPick", newToken: () => ids.id("claim") });
  const deliveryJobs = claimedJobs({ store, coll: "deliveries", newToken: () => ids.id("claim") });
  /** A stopwatch for one flow; it logs only when timing is on. */
  const watch = (/** @type {string} */ flow) => stopwatch(flow, { on: timing, log });
  // ------------------------------------------------------------ where a crew is

  /** A crew's region, its city pack, and what the prompts may know about it. */
  function placeOf(/** @type {{ region?: any, tz?: string }} */ crew) {
    const region = regionOf(crew);
    const pack = packFor(region);
    return { region, pack, local: pack.local(region), geo: pack.geocode(region), curated: pack.curated ? spots : [] };
  }

  /** A prompt with the crew's place filled in. */
  const promptFor = (/** @type {string} */ name, /** @type {import("../core/tasks.mjs").Local} */ local) => localisePrompt(prompts[name], local);

  /** The IANA zone of a point (Open-Meteo), or null. */
  async function zoneAt(/** @type {{ lat: number, lon: number }} */ at) {
    if (!weather.timezoneAt) return null;
    try {
      const tz = await weather.timezoneAt(at);
      return tz && isValidZone(tz) ? tz : null;
    } catch (e) {
      log("timezone_error", { message: String(/** @type {any} */ (e).message).slice(0, 120) });
      return null;
    }
  }

  /**
   * A region from geocoded areas: the centre of the areas, the country and city most of
   * them are in (Photon), and the zone at the centre (Open-Meteo; the visitor's own zone
   * when that fails). Null when no area is on the map.
   * @param {{ lat: number|null, lon: number|null, country?: string, city?: string }[]} located
   * @param {Region} base  what is known already (the hint, or the crew's region)
   * @returns {Promise<Region|null>}
   */
  async function regionFrom(located, base) {
    const pts = located.filter(isLatLon);
    const center = centroid(/** @type {any[]} */ (pts));
    if (!center) return null;
    const mode = (/** @type {(string|undefined)[]} */ xs) => {
      /** @type {Map<string, number>} */
      const n = new Map();
      for (const x of xs) if (x) n.set(x, (n.get(x) || 0) + 1);
      return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    };
    // the city at the centre, at city level (Nominatim), names it best; the areas' own say
    // otherwise. The city and the zone are asked for at the same time.
    const cityP = geocoder.cityAt
      ? geocoder.cityAt(center).catch((e) => {
        log("geocode_error", { message: String(/** @type {any} */ (e).message).slice(0, 120) });
        return null;
      })
      : Promise.resolve(null);
    const [at, tz] = await Promise.all([cityP, zoneAt(center)]);
    const countryCode = at?.country ?? mode(pts.map((p) => p.country)) ?? base.countryCode;
    const city = at?.city ?? mode(pts.map((p) => p.city)) ?? base.city;
    const round = (/** @type {number} */ x) => Math.round(x * 1e4) / 1e4;
    return {
      center: { lat: round(center.lat), lon: round(center.lon) },
      countryCode: countryCode ? countryCode.toUpperCase() : null,
      city,
      timezone: tz ?? base.timezone,
      tzSource: tz ? "open-meteo" : base.tzSource === "legacy" ? "legacy" : base.tzSource === "utc" ? "utc" : "browser",
    };
  }

  // ------------------------------------------------------------ links

  const links = {
    invite: (/** @type {Crew} */ c) => `${cfg.webUrl}/c/${c.slug}?t=${encodeURIComponent(c.inviteToken)}`,
    member: (/** @type {Crew} */ c, /** @type {Member} */ m) => `${cfg.webUrl}/c/${c.slug}?t=${encodeURIComponent(m.token)}`,
    plan: (/** @type {Crew} */ c, /** @type {string} */ id) => `${cfg.webUrl}/c/${c.slug}/p/${id}`,
    calendar: (/** @type {Member} */ m) => `${cfg.publicUrl}/cal/${m.calToken}.ics`,
    webcal: (/** @type {Member} */ m) => `${cfg.publicUrl.replace(/^https?:/, "webcal:")}/cal/${m.calToken}.ics`,
    eventIcs: (/** @type {string} */ planId, /** @type {Member} */ m) => `${cfg.publicUrl}/api/plans/${planId}/event.ics?t=${encodeURIComponent(m.token)}`,
    flyer: (/** @type {string} */ flyerId) => `${cfg.publicUrl}/api/flyers/${flyerId}`,
  };

  const growth = createGrowth({ store, ai, now, log });

  // ------------------------------------------------------------ access

  /** The crew and who is asking: a member (member token) or a guest (invite token). */
  async function viewerOf(slug, token) {
    if (!token) throw noToken();
    const crew = /** @type {Crew|null} */ (await store.findOne("crews", { slug: String(slug) }));
    if (!crew) throw notFound("That crew");
    if (safeEqual(token, crew.inviteToken)) return { crew, role: /** @type {const} */ ("guest"), member: null };
    const member = /** @type {Member|null} */ (await store.findOne("members", { token: String(token) }));
    if (member && member.crewId === crew.id) return { crew, role: /** @type {const} */ ("member"), member };
    throw badToken();
  }

  /** The member a member token belongs to, and their crew. */
  async function memberOf(token) {
    if (!token) throw noToken();
    const member = /** @type {Member|null} */ (await store.findOne("members", { token: String(token) }));
    if (!member) throw badToken();
    const crew = /** @type {Crew|null} */ (await store.get("crews", member.crewId));
    if (!crew) throw notFound("That crew");
    return { member, crew };
  }

  /** A plan the member may see (in their crew), or 404. */
  async function planFor(id, token) {
    const { member, crew } = await memberOf(token);
    const plan = /** @type {Plan|null} */ (await store.get("plans", String(id)));
    if (!plan || plan.crewId !== crew.id || isExpired(plan, now())) throw notFound("That plan");
    return { member, crew, plan };
  }

  const membersOf = async (/** @type {string} */ crewId) => /** @type {Member[]} */ (await store.find("members", { crewId })).sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.id.localeCompare(b.id));
  const plansOf = async (/** @type {string} */ crewId) => /** @type {Plan[]} */ (await store.find("plans", { crewId }));
  const namesOf = (/** @type {Member[]} */ ms) => Object.fromEntries(ms.map((m) => [m.id, m.name]));

  // ------------------------------------------------------------ Gemma

  /**
   * One Gemma task. Returns the parsed answer, or null with the reason when Gemma is
   * unavailable. `waitMs`: someone is waiting, so give up after this long (the adapter's own
   * retries and fallback model could otherwise take minutes).
   */
  async function gemma(task, messages, schema, { waitMs = 0 } = {}) {
    if (!ai.available) return { data: null, model: null, error: "Gemma is not set up on this server." };
    try {
      const call = ai.generate({ task, messages, schema, maxTokens: MAX_TOKENS[/** @type {keyof typeof MAX_TOKENS} */ (task)] });
      const r = waitMs ? await within(call, waitMs, null) : await call;
      if (!r) {
        log("gemma_error", { task, status: 0, message: `no answer within ${Math.round(waitMs / 1000)} s` });
        return { data: null, model: null, error: "Gemma is slow right now." };
      }
      log("gemma", { task, model: r.model, sec: r.wallSec, json: r.jsonMode, parsed: r.data != null });
      return { data: r.data, model: r.model, error: r.data == null ? "Gemma's answer could not be read." : null };
    } catch (e) {
      const err = /** @type {any} */ (e);
      log("gemma_error", { task, status: err.status, message: String(err.message).slice(0, 160) });
      return { data: null, model: null, error: err.hint || "Gemma is busy right now." };
    }
  }

  /**
   * One log line after code has read a Gemma answer: which fields the app kept empty, which
   * fields Gemma filled that code then emptied, and whether code made the draft itself.
   * Field names only (src/core/diagnose.mjs).
   * @param {string} task
   * @param {{ data: any, error: string|null }} g
   * @param {Record<string, any>} kept  the fields the app kept, named as in Gemma's answer
   * @param {{ fallback?: boolean }} [opts]
   */
  function readLog(task, g, kept, { fallback = false } = {}) {
    log("gemma_read", { task, ai: !g.error, fallback, empty: emptyFields(kept), dropped: g.data ? droppedFields(g.data, kept) : [] });
  }

  // ------------------------------------------------------------ views

  /** The crew as the web app sees it. Its taste (what it is into and needs) only for its members. */
  const crewView = (/** @type {Crew} */ c, /** @type {"member"|"guest"} */ role = "guest") => ({
    id: c.id, slug: c.slug, name: c.name, shareName: outboundName(c), vibe: c.vibe, vibeTags: c.vibeTags || [], budget: c.budget || "any",
    rhythm: c.rhythm, areas: (c.areas || []).map((a) => ({ label: a.label })), tz: c.tz || regionOf(c).timezone, inviteToken: c.inviteToken, createdAt: c.createdAt,
    ...regionFields(c),
    firstPick: pickView(c.firstPick),
    ...(role === "member" ? { taste: c.taste ?? null } : {}),
  });
  /** The crew's region and pack, as the web app sees them (for times, examples and the ride card). */
  function regionFields(/** @type {Crew} */ c) {
    const { region, pack } = placeOf(c);
    return { region: { center: region.center, countryCode: region.countryCode, city: region.city, timezone: region.timezone }, pack: packView(pack, region) };
  }
  // faceV: the member's own photo's version, when they added one (shown to the crew only, src/app/growth.mjs)
  const memberView = (/** @type {Member} */ m) => ({ id: m.id, name: m.name, area: { label: m.area?.label ?? null }, ...(/** @type {any} */ (m).faceV ? { faceV: /** @type {any} */ (m).faceV } : {}) });

  function planView(/** @type {Plan} */ plan, /** @type {Crew} */ crew, /** @type {Member[]} */ members, /** @type {"member"|"guest"} */ role, /** @type {Member|null} */ me) {
    const view = viewPlan(plan, {
      role,
      memberId: me?.id ?? null,
      names: namesOf(members),
      eventIcsUrl: role === "member" && me ? links.eventIcs(plan.id, me) : null,
      planUrl: links.plan(crew, plan.id),
      flyerUrl: links.flyer,
    });
    // what it costs to get in, only from a source; a flyer's own price speaks for itself
    const entry = plan.price ? null : entryFor(plan.place, placeOf(crew).curated, { ritual: plan.kind === "ritual" });
    return entry ? { ...view, place: { ...view.place, entry } } : view;
  }

  // ------------------------------------------------------------ places and areas

  /**
   * Geocode an area: a label ("Yaba") or a picked { label, lat, lon }, in the crew's context
   * (src/packs: Lagos adds ", Lagos"; elsewhere results are biased to the crew's centre).
   * The hit's country and city come back too, for the crew's region.
   * @param {any} area
   * @param {Partial<import("../packs/index.mjs").GeocodeContext>} [ctx]
   * @returns {Promise<{ area: { label: string, lat: number|null, lon: number|null }|null, note: string|null, country?: string, city?: string }>}
   */
  async function resolveArea(area, ctx = {}) {
    if (area && typeof area === "object") {
      const label = clip(area.label, 60);
      if (!label) return { area: null, note: null };
      if (isLatLon(area)) return { area: { label, lat: Number(area.lat), lon: Number(area.lon) }, note: null, country: typeof area.country === "string" ? area.country : undefined, city: typeof area.city === "string" ? area.city : undefined };
      return resolveArea(label, ctx);
    }
    const label = clip(area, 60);
    if (!label) return { area: null, note: null };
    // the names people write, as the map knows them ("Lekki" is Lekki Phase I)
    for (const q of areaQueries(label, ctx.country ?? null)) {
      try {
        const hit = await geocoder.lookupArea(q, ctx);
        if (hit) return { area: { label, lat: hit.lat, lon: hit.lon }, note: null, country: hit.country, city: hit.city };
      } catch (e) {
        log("geocode_error", { message: String(/** @type {any} */ (e).message).slice(0, 120) });
      }
    }
    return { area: { label, lat: null, lon: null }, note: `Could not find "${label}" on the map. Rides and fair picks will skip it until it is fixed.` };
  }

  /** A curated spot with this name ("FREEDOM PARK" on a flyer is Freedom Park), or null. */
  function knownSpot(name, /** @type {any[]} */ curated) {
    const n = normName(name);
    if (n.length < 4) return null;
    return curated.find((s) => [s.name, ...(s.aliases || [])].some((x) => normName(x) === n || normName(x).replace(/ (park|beach|garden)$/, "") === n)) ?? null;
  }

  /**
   * Put a plan's place on the map when it has a name or an address but no pin. When the
   * exact place is not on the map, the neighbourhood named in its address ("..., Surulere")
   * is kept as `near`: good enough for ride times and the weather, never as the drop-off.
   * @param {any} place
   * @param {ReturnType<typeof placeOf>} where  the crew's pack and geocoding context
   */
  async function pinPlace(place, where) {
    if (!place || isLatLon(place) || !(place.address || place.name) || (/'s place$/.test(place.name || "") && !place.address)) return { place, note: null };
    const { near: _old, ...bare } = place;
    const spot = !place.private && knownSpot(place.name, where.curated);
    if (spot) {
      const outdoor = place.outdoor || OUTDOOR_KINDS.includes(spot.kind);
      return { place: { ...bare, name: spot.name, lat: spot.lat, lon: spot.lon, outdoor, ...(spot.osm ? { osm: spot.osm } : {}) }, note: `Pinned at ${spot.name}${outdoor && !place.outdoor ? ", an outdoor spot, so the weather is watched" : ""}.` };
    }
    try {
      const hit = await geocoder.lookup(place.address || place.name, where.geo);
      if (hit) return { place: { ...bare, lat: hit.lat, lon: hit.lon }, note: `Pinned on the map at ${hit.label}${hit.detail ? `, ${hit.detail}` : ""}. Check it.` };
    } catch {}
    for (const label of neighbourhoodsIn(place.address, where.pack.addressNoise(where.region))) {
      try {
        const hit = await geocoder.lookupArea(label, where.geo);
        if (hit) return { place: { ...bare, near: { label, lat: hit.lat, lon: hit.lon } }, note: `Could not find the exact address on the map, so ride times and the weather are guessed from ${label}. Riders will paste the address into their ride app.` };
      } catch {}
    }
    return { place: bare, note: "Could not pin the place on the map, so there are no ride times. Riders will paste the address into their ride app." };
  }

  /** pinPlace, for someone waiting: after budget.pinMs the place goes on unpinned, and says so. */
  function pinWithin(/** @type {any} */ place, /** @type {ReturnType<typeof placeOf>} */ where) {
    return within(pinPlace(place, where), budget.pinMs, { place, note: place && (place.address || place.name) && !isLatLon(place) ? "The map was slow to answer, so the place is not pinned yet. Riders will paste the address into their ride app." : null });
  }

  // ------------------------------------------------------------ crews

  /**
   * Step 1: Gemma reads the setup sentence; areas are geocoded; nothing is saved.
   * `hint.tz` is the visitor's own zone (the browser's). It picks the prompts' wording (a
   * Lagos zone reads Pidgin) and a country at most: where the crew is comes only from its
   * areas on the map (locateAreas), so an Abuja crew with a Lagos zone is an Abuja crew.
   * `hint.city` is the city the organiser confirmed when asked (needsLocation).
   * When no area is on the map, `needsLocation` asks which city or area is meant, and
   * nothing that depends on where the crew is gets recommended until it is answered.
   */
  async function draftCrew({ sentence, into = null, hint = null }) {
    const s = clip(sentence, LIMITS.sentence);
    if (!s || s.length < 3) throw invalid([{ field: "sentence", message: "Describe the crew in a sentence." }]);
    // the optional "what you're into" line; like the sentence, it is read here and never kept
    const i = clip(into, LIMITS.into);
    const sw = watch("crew_draft");
    const start = hintRegion(hint);
    const first = placeOf({ region: localeRegion(hint) });
    // one Gemma call reads everything: the name, rhythm, vibe, areas and the taste
    const g = await sw.time("gemma", gemma("parse-crew", crewSetupMessages(promptFor("parse-crew", first.local), { sentence: s, into: i }), CREW_SCHEMA, { waitMs: budget.gemmaMs }));
    // Gemma busy or failing: code's own best guess, every field marked for a check
    const guessed = !g.data && !!g.error;
    const r = readCrewSetup(guessed ? guessCrew(s) : g.data, { sentence: s, into: i }, first.local);
    const notes = [...r.notes];
    if (guessed) notes.unshift(BEST_GUESS);
    readLog("parse-crew", g, crewFields(r.draft), { fallback: guessed });
    // a city the sentence names counts whatever the visitor's zone ("in Lagos" typed in London)
    const named = cityIn([s, i].filter(Boolean).join(" "), start.countryCode);
    const city = clip(hint?.city, 60) ?? named?.city ?? null;
    const located = await sw.time("areas", locateAreas(r.draft.areaLabels, start, notes, { city, country: hint?.city ? null : named?.country ?? null, soft: true }));
    // the areas named in the sentence decide the country, and with it the zone to fall back
    // on when the zone at the centre is not known: never the visitor's own zone over them
    const base = located.country && located.country !== start.countryCode ? { ...start, countryCode: located.country, timezone: zoneOfCountry(located.country) ?? start.timezone } : start;
    const region = (await sw.time("region", regionFrom(located.found, base))) ?? start;
    sw.end({ areas: located.areas.length, ai: !g.error });
    const { areaLabels, ...rest } = r.draft;
    const { pack } = placeOf({ region });
    const tv = tasteView(r.draft.taste, { areas: located.areas.map((a) => a.label) });
    // a crew with a regular day gets the sloth's first pick once it is made: look up its
    // places and forecast now, while the organiser reads the draft (cached by tile)
    if (prewarm && r.draft.rhythm && region.center) warmUp(/** @type {{ lat: number, lon: number }} */ (region.center), pack, r.draft.taste, region.timezone);
    return { draft: { ...rest, areas: located.areas, region }, pack: packView(pack, region), taste: tv, confidence: r.confidence, low: r.low, notes, ai: !g.error, guess: guessed, needsLocation: askLocation(located.areas, region, located.suggestions) };
  }

  /** The first pick's lookups, in the background: places near the centre and the forecast. Never throws. */
  function warmUp(/** @type {{ lat: number, lon: number }} */ center, /** @type {CityPack} */ pack, /** @type {any} */ taste, /** @type {string} */ tz) {
    inBackground(() => Promise.all([
      candidatesNear(center, pack, taste).catch(() => null),
      weather.hourly(center, { tz, days: 7 }).catch(() => null),
    ])).catch(() => {});
  }

  /**
   * Geocode a new crew's area names, from nothing but the names, the country the zone vouches
   * for and the city the organiser named (if any). Every name gets a few candidates (the
   * names people write mapped to the map's own first, "Lekki" is Lekki Phase I), and the set
   * that sits together within AREA_SPREAD_KM wins (core/geo.mjs, clusterAreas): "Garki" next
   * to Wuse is the Abuja one, not the Jigawa town. A name with nothing near the others is
   * looked up once more near them, with their city; still nothing, and it is asked about
   * ("Did you mean ...?") instead of pinned 38 km away.
   *
   * For a new crew (`soft`), the zone's country is only a hint: an area anywhere comes
   * before a shop or a street in the zone's country, and once the named areas land in
   * another country, every name is looked up again there (a Lagos crew set up from London
   * names Yaba and Surulere: the pinned run of d1770d0 found a London result taking over).
   * @param {string[]} labels
   * @param {Region} start  country level at most (hintRegion), or a crew's region
   * @param {string[]} notes
   * @param {{ city?: string|null, country?: string|null, soft?: boolean }} [opts]  country: the country of a city the sentence names
   */
  async function locateAreas(labels, start, notes, { city = null, country: said = null, soft = false } = {}) {
    let country = said ?? start.countryCode ?? (await zoneCountry(start.timezone));
    const inCity = city ? new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i") : null;
    const lookUp = (/** @type {string|null} */ cc) => {
      const majors = citiesFor(cc);
      const big = majors.length ? new RegExp(`\\b(${[...majors, "Federal Capital Territory"].join("|")})\\b`, "i") : null;
      return Promise.all(labels.map(async (label) => {
        const rs = await candidatesFor(clip(label, 60) || "", cc, city, { soft });
        // the city the organiser named first, then a big city's namesake before a village's
        const rank = (/** @type {any} */ r) => (inCity?.test(`${r.city ?? ""} ${r.detail ?? ""}`) ? 0 : 2) + (big?.test(`${r.city ?? ""} ${r.detail ?? ""}`) ? 0 : 1);
        return rs.map((r, k) => ({ r, k })).sort((a, b) => rank(a.r) - rank(b.r) || a.k - b.k).map((x) => x.r);
      }));
    };
    /** @type {any[][]} */
    let lists = await lookUp(country);
    if (soft) {
      // where the named areas are, by the country most of their best area matches are in
      /** @type {Map<string, number>} */
      const n = new Map();
      for (const l of lists) {
        const cc = l.find((r) => r.isArea && r.country)?.country;
        if (cc) n.set(cc, (n.get(cc) || 0) + 1);
      }
      const top = [...n.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top && top[0] !== country && top[1] > (country ? n.get(country) ?? 0 : 0)) {
        country = top[0];
        lists = await lookUp(country);
      }
    }
    const { anchor, picks } = clusterAreas(lists, AREA_SPREAD_KM);
    /** @type {Awaited<ReturnType<typeof resolveArea>>[]} */
    const got = [];
    /** @type {Record<string, any[]>} */
    const suggestions = {};
    for (let i = 0; i < labels.length; i++) {
      const label = clip(labels[i], 60);
      if (!label) continue;
      let hit = picks[i];
      if (!hit && anchor) {
        const again = await resolveArea(label, { near: anchor, country: anchor.country ?? country, cityFallback: city ?? anchor.city ?? null });
        if (again.area && isLatLon(again.area) && haversineKm(anchor, /** @type {any} */ (again.area)) <= AREA_SPREAD_KM) hit = { lat: again.area.lat, lon: again.area.lon, country: again.country, city: again.city };
      }
      if (hit) {
        got.push({ area: { label, lat: hit.lat, lon: hit.lon }, note: null, country: hit.country, city: hit.city });
        continue;
      }
      const options = lists[i].slice(0, 3).map((r) => ({ label: r.label, detail: r.detail ?? "", lat: r.lat, lon: r.lon, ...(r.country ? { country: r.country } : {}), ...(r.city ? { city: r.city } : {}) }));
      suggestions[label] = options;
      const named = options.map((o) => (o.detail ? `${o.label} (${o.detail.split(",").slice(0, 2).join(",").trim()})` : o.label));
      got.push({
        area: { label, lat: null, lon: null },
        note: options.length
          ? `"${label}" is far from the crew's other areas on the map. Did you mean ${named.join(" or ")}? Pick the right one.`
          : `Could not find "${label}" on the map. Rides and fair picks will skip it until it is fixed.`,
      });
    }
    return { ...collect(got, notes), suggestions, country };
  }

  /**
   * Candidates for one area name: each query for it (areaQueries) in turn, first with the
   * city the organiser named, then country-wide, then any kind of place, then anywhere. The
   * first query that finds anything wins. Photon first, and Nominatim when Photon is down or
   * finds no such area (the geocoder's fallback; single lookups only). Never throws.
   * `soft`: the country is only the visitor's zone, so an area anywhere comes before any
   * other kind of place in that country. Each result says whether it came back as an area.
   * @param {string} label
   * @param {string|null} country
   * @param {string|null} city
   * @param {{ soft?: boolean }} [opts]
   */
  async function candidatesFor(label, country, city, { soft = false } = {}) {
    if (label.length < 2) return [];
    for (const q of areaQueries(label, country)) {
      const anywhere = country ? [{ text: q, areas: true, country: null, fallback: false }] : [];
      const inCountry = { text: q, areas: false, country, fallback: false };
      const tries = [
        ...(city && !q.toLowerCase().includes(city.toLowerCase()) ? [{ text: `${q}, ${city}`, areas: true, country, fallback: true }] : []),
        { text: q, areas: true, country, fallback: true },
        ...(soft ? [...anywhere, inCountry] : [inCountry, ...anywhere]),
      ];
      for (const t of tries) {
        try {
          const rs = await geocoder.search(t.text, { limit: 5, areas: t.areas, fallback: t.fallback, ...(t.country ? { country: t.country } : {}) });
          if (rs.length) return rs.map((r) => ({ ...r, isArea: t.areas }));
        } catch (e) {
          log("geocode_error", { message: String(/** @type {any} */ (e).message).slice(0, 120) });
        }
      }
    }
    return [];
  }

  /** @param {Awaited<ReturnType<typeof resolveArea>>[]} got @param {string[]} notes */
  function collect(got, notes) {
    /** @type {{ label: string, lat: number|null, lon: number|null }[]} */
    const areas = [];
    /** @type {{ lat: number, lon: number, country?: string, city?: string }[]} */
    const found = [];
    for (const g of got) {
      if (g.area) areas.push(g.area);
      if (g.note) notes.push(g.note);
      if (g.area && isLatLon(g.area)) found.push({ lat: /** @type {number} */ (g.area.lat), lon: /** @type {number} */ (g.area.lon), country: g.country, city: g.city });
    }
    return { areas, found };
  }

  /**
   * What to ask when areas are not on the map: null when every one is. `blocking` when the
   * crew has no centre at all, so nothing that depends on where it is gets recommended (no
   * first pick, no ideas, no warm-up) until the organiser picks an area or names the city.
   * @param {{ label: string, lat: number|null, lon: number|null }[]} areas
   * @param {Region} region
   * @param {Record<string, any[]>} [suggestions]
   */
  function askLocation(areas, region, suggestions = {}) {
    const unresolved = areas.filter((a) => !isLatLon(a)).map((a) => a.label);
    const blocking = !region.center;
    if (!unresolved.length && !blocking) return null;
    const cities = blocking ? citiesFor(region.countryCode) : [];
    const message = blocking
      ? `Which city is the crew in? ${unresolved.length ? `Could not find ${unresolved.map((l) => `"${l}"`).join(" or ")} on the map, so` : "No area is on the map yet, so"} the sloth will not suggest anything until you pick an area or name the city.`
      : `Pick the right place for ${unresolved.map((l) => `"${l}"`).join(" and ")}, so rides and fair picks count it.`;
    return { blocking, message, unresolved, suggestions: Object.fromEntries(unresolved.map((l) => [l, suggestions[l] ?? []])), cities };
  }

  /** The country of the city a zone is named after ("Africa/Nairobi" is in KE), or null. */
  async function zoneCountry(/** @type {string} */ tz) {
    const known = hintRegion({ tz }).countryCode;
    if (known) return known;
    const city = String(tz || "").split("/").slice(1).pop()?.replace(/_/g, " ");
    if (!city || /^(UTC|GMT|Etc)/i.test(tz)) return null;
    try {
      return (await geocoder.search(city, { limit: 1, areas: true }))[0]?.country ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Step 2: create the crew from the confirmed draft; the organiser may join at once. The
   * crew's region is the draft's (the confirm screen sends it back), its centre moved to
   * the confirmed areas; with no region at all (an old client), the visitor's zone decides,
   * and with no zone either, Lagos, as before.
   */
  async function createCrew({ confirm, organiser, hint = null }) {
    const c = confirm && typeof confirm === "object" ? confirm : {};
    /** @type {{ field: string, message: string }[]} */
    const errors = [];
    const name = clip(c.name, LIMITS.crewName);
    if (!name) errors.push({ field: "name", message: "Give the crew a name." });
    // a name the organiser typed is theirs, even one that says who the crew is (the sloth
    // never suggests one): it stays in the app, and outboundName keeps it out of previews,
    // cards, calendar feeds and the plain pages for anyone else (src/core/growth.mjs)
    const rhythm = checkRhythm(c.rhythm, errors);
    const areas = (Array.isArray(c.areas) ? c.areas : []).slice(0, LIMITS.areas).map((/** @type {any} */ a) => ({ label: clip(a?.label, 60), lat: isLatLon(a) ? Number(a.lat) : null, lon: isLatLon(a) ? Number(a.lon) : null })).filter((/** @type {any} */ a) => a.label);
    if (errors.length) throw invalid(errors);
    const sw = watch("crew_create");
    const t = now();
    const given = cleanRegion(c.region);
    const base = given ?? hintRegion(hint);
    const located = areas.filter(isLatLon).map((/** @type {any} */ a) => ({ lat: a.lat, lon: a.lon }));
    const moved = located.length && (!base.center || haversineKm(base.center, /** @type {any} */ (centroid(located))) > 1);
    /** @type {Region} */
    // where the crew is comes only from its areas on the map; the zone says a country at most
    const region = moved ? (await sw.time("region", regionFrom(located, base))) ?? base : base;
    const tz = region.timezone;
    /** @type {Crew} */
    const crew = {
      id: ids.id("c"),
      // the slug is in every link that travels: a name that may not leave the app stays out of it
      slug: `${slugify(outboundName({ name, taste: cleanTaste(c.taste) }) ?? "crew")}-${ids.suffix()}`,
      name: /** @type {string} */ (name),
      vibe: hasSensitive(c.vibe) ? null : clip(c.vibe, 80),
      vibeTags: (Array.isArray(c.vibeTags) ? c.vibeTags : []).map((/** @type {any} */ v) => clip(v, 20)?.toLowerCase()).filter(Boolean).slice(0, 8),
      budget: ["free", "cheap", "any"].includes(c.budget) ? c.budget : "any",
      // the edited chips, checked again: vocabularies, limits, and no word for who anyone is
      // a vibe typed by hand counts when the taste says nothing about what the crew likes
      taste: withVibe(cleanTaste(c.taste), hasSensitive(c.vibe) ? null : c.vibe),
      rhythm: rhythm ? { ...rhythm, anchor: localParts(t, tz).date } : null,
      areas: /** @type {any} */ (areas),
      tz,
      region,
      createdAt: new Date(t).toISOString(),
      inviteToken: ids.token(),
      // the sloth's first pick runs after the answer is sent (kickFirstPick); see src/core/firstpick.mjs.
      // A crew with no regular day gets one too, for this weekend, so its page is never empty
      ...(rhythm || region.center ? { firstPick: pendingPick(t) } : {}),
    };
    await sw.time("store", store.put("crews", crew));
    log("crew_created", { crew: crew.id, rhythm: !!crew.rhythm, firstPick: !!crew.firstPick, pack: packFor(region).id, country: region.countryCode, tzSource: region.tzSource, taste: hasTaste(crew.taste) });
    const out = { crew: crewView(crew, "member"), inviteUrl: links.invite(crew), inviteToken: crew.inviteToken, needsLocation: askLocation(/** @type {any} */ (areas), region) };
    if (organiser && typeof organiser === "object" && clip(organiser.name, LIMITS.memberName)) {
      const joined = await sw.time("organiser", addMember(crew, organiser));
      sw.end();
      return { ...out, ...joined };
    }
    sw.end();
    return out;
  }

  function checkRhythm(r, errors) {
    if (r == null) return null;
    if (typeof r !== "object" || !["1w", "2w", "4w"].includes(r.every) || !Number.isInteger(r.day) || r.day < 0 || r.day > 6) {
      errors.push({ field: "rhythm", message: "The rhythm needs how often (every week, every other week or monthly) and a day." });
      return null;
    }
    const from = isTime(r.window?.from) ? r.window.from : "15:00";
    const to = isTime(r.window?.to) ? r.window.to : "19:00";
    if (minutesOfDay(to) <= minutesOfDay(from)) {
      errors.push({ field: "rhythm.window", message: "The time window has to end after it starts." });
      return null;
    }
    return { every: r.every, day: r.day, window: { from, to } };
  }

  /**
   * "Tell the sloth what you're into": a member reads a line into a taste (`{ sentence }`,
   * nothing saved), or saves the edited chips (`{ taste }`). The line is read once and never
   * kept; who anyone is becomes needs (src/core/taste.mjs).
   */
  async function crewTaste({ slug, token, body }) {
    const { crew, role } = await viewerOf(slug, token);
    if (role !== "member") throw new AppError(403, "members_only", "Join the crew first.");
    const b = body && typeof body === "object" ? body : {};
    const labels = (crew.areas || []).map((a) => a.label);
    if (b.taste && typeof b.taste === "object") {
      const taste = cleanTaste(b.taste);
      await store.update("crews", crew.id, { set: { taste } });
      log("crew_taste", { crew: crew.id, taste: hasTaste(taste) });
      return { taste, ...tasteView(taste, { areas: labels }), saved: true };
    }
    const s = clip(b.sentence, LIMITS.into);
    if (!s || s.length < 3) throw invalid([{ field: "sentence", message: "Tell the sloth what the crew is into." }]);
    const { local } = placeOf(crew);
    const g = await gemma("parse-crew", crewSetupMessages(promptFor("parse-crew", local), { sentence: "(the crew is already set up)", into: s }), CREW_SCHEMA, { waitMs: budget.gemmaMs });
    const r = readCrewSetup(g.data, { sentence: "", into: s }, local);
    const taste = r.draft.taste;
    return { taste, ...tasteView(taste, { areas: labels }), saved: false, ai: !g.error, notes: g.error ? [`${g.error} Pick the chips yourself.`] : [] };
  }

  /** The crew page: the crew, its members (names and area labels), upcoming plans, and who you are. */
  async function getCrew({ slug, token }) {
    const { crew, role, member } = await viewerOf(slug, token);
    const members = await membersOf(crew.id);
    const all = await plansOf(crew.id);
    const plans = upcoming(all, now());
    // members only: linkups so far, the day-after card, "Got another crew?" (src/core/growth.mjs)
    const extras = member ? await growth.crewExtras({ crew, member, plans: all, tz: regionOf(crew).timezone }) : null;
    // a crew made before every crew got a first pick, with nothing on: the sloth picks once
    if (member && !crew.firstPick && !plans.length && regionOf(crew).center) {
      const set = await store.update("crews", crew.id, { set: { firstPick: pendingPick(now()) } }, { ifMatch: { firstPick: { $exists: false } } });
      if (set) {
        crew.firstPick = pendingPick(now());
        kickFirstPick(crew.id);
      }
    }
    return {
      crew: crewView(crew, role),
      members: members.map(memberView),
      plans: plans.map((p) => planView(p, crew, members, role, member)),
      you: member ? { id: member.id, name: member.name, area: { label: member.area?.label ?? null } } : null,
      ...(extras ? { growth: extras } : {}),
    };
  }

  async function addMember(/** @type {Crew} */ crew, body) {
    const name = clip(body?.name, LIMITS.memberName);
    if (!name) throw invalid([{ field: "name", message: "What should the crew call you?" }]);
    const count = (await store.find("members", { crewId: crew.id })).length;
    if (count >= LIMITS.membersPerCrew) throw new AppError(409, "crew_full", "This crew is full.");
    const where = placeOf(crew);
    // with no centre yet, the name is looked up as a new crew's areas are (the visitor's
    // country first); after that, near the crew
    const { area, note, country, city } = !where.region.center && typeof body?.area === "string"
      ? await firstArea(body.area, where.region)
      : await resolveArea(body?.area, where.geo);
    // a crew whose region has no centre yet (no area was found at setup) takes it from its
    // first member on the map
    if (area && isLatLon(area) && !where.region.center && crew.region) {
      const region = await regionFrom([{ lat: /** @type {number} */ (area.lat), lon: /** @type {number} */ (area.lon), country, city }], where.region);
      // only while the crew still has no centre: two first joiners at once set it once
      if (region && (await store.update("crews", crew.id, { set: { region, tz: region.timezone } }, { ifMatch: { "region.center": null } }))) {
        crew.region = region;
        crew.tz = region.timezone;
      }
    }
    /** @type {Member} */
    const member = { id: ids.id("m"), crewId: crew.id, name, area: /** @type {any} */ (area), token: ids.token(), calToken: ids.token(), joinedAt: new Date(now()).toISOString() };
    await store.put("members", member);
    log("member_joined", { crew: crew.id, member: member.id, located: isLatLon(area) });
    return { member: memberView(member), memberToken: member.token, memberUrl: links.member(crew, member), calendarUrl: links.calendar(member), webcalUrl: links.webcal(member), notes: note ? [note] : [] };
  }

  /** A member's area for a crew with no centre yet: looked up as a new crew's areas are. */
  async function firstArea(/** @type {string} */ label, /** @type {Region} */ region) {
    /** @type {string[]} */
    const notes = [];
    const r = await locateAreas([label], region, notes, { city: region.city });
    const area = r.areas[0] ?? null;
    const f = r.found[0];
    return { area, note: notes[0] ?? null, country: f?.country, city: f?.city };
  }

  /** Join with the invite link. */
  async function joinCrew({ slug, token, body }) {
    const { crew } = await viewerOf(slug, token);
    return addMember(crew, body);
  }

  /**
   * The neighbourhood at a point, for "Use my rough location". The phone rounds its position
   * to two decimals (about a kilometre) before sending it, and this rounds again: only the
   * neighbourhood's name is looked up at that point, and its own centre is what is kept.
   * @param {{ lat: number, lon: number }} at
   * @param {any} ctx  the crew's geocoding context
   */
  async function areaNear(at, ctx = {}) {
    const lat = Math.round(Number(at?.lat) * 100) / 100;
    const lon = Math.round(Number(at?.lon) * 100) / 100;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw invalid([{ field: "near", message: "That location is not valid." }]);
    let named = null;
    try {
      named = geocoder.reverse ? await geocoder.reverse({ lat, lon }) : null;
    } catch (e) {
      log("geocode_error", { message: String(/** @type {any} */ (e).message).slice(0, 120) });
    }
    if (!named?.label) throw new AppError(404, "not_found", "Couldn't name your area. Type it instead.");
    const label = /** @type {string} */ (clip(named.label, 60));
    let hit = null;
    try {
      hit = await geocoder.lookupArea(label, { ...ctx, near: { lat, lon } });
    } catch {}
    // the neighbourhood's own centre when it is close by; else the rounded point itself
    const centre = hit && haversineKm(hit, { lat, lon }) <= 5 ? { lat: hit.lat, lon: hit.lon } : { lat, lon };
    return { label, ...centre, ...(named.country ? { country: named.country } : {}), ...(named.city ? { city: named.city } : {}) };
  }

  /**
   * "Use my rough location" while a crew is being set up (there is no crew or member yet):
   * the neighbourhood at a point the phone already rounded, looked up in the visitor's
   * country (their zone, as for the type-ahead). Only the neighbourhood is answered.
   * @param {{ at: any, tz?: string|null }} input
   */
  async function roughArea({ at, tz = null }) {
    const start = hintRegion(tz ? { tz } : null);
    return { area: await areaNear(at, placeOf({ region: start }).geo) };
  }

  /** Set your own area: a typed or picked area, or `near` (a rounded point) for the rough location. */
  async function setMyArea({ memberId, token, body }) {
    const { member, crew } = await memberOf(token);
    if (member.id !== memberId) throw badToken();
    const where = placeOf(crew);
    const input = body?.near ? await areaNear(body.near, where.geo) : body?.area;
    const { area, note } = await resolveArea(input, where.geo);
    if (!area) throw invalid([{ field: "area", message: "Add the area you're coming from." }]);
    const next = (await store.update("members", member.id, { set: { area } })) ?? { ...member, area: /** @type {any} */ (area) };
    log("member_area", { crew: crew.id, member: member.id, located: isLatLon(area), rough: !!body?.near });
    return { you: memberView(next), notes: note ? [note] : [] };
  }

  // ------------------------------------------------------------ the first pick (a background job)

  /** First picks running in this process, by crew id. @type {Map<string, Promise<any>>} */
  const picking = new Map();

  /**
   * Start the crew's first pick in the background, unless it is done, running, or waiting
   * for its next try (src/core/firstpick.mjs). Returns the running job, or null.
   * @param {string} crewId
   * @param {{ force?: boolean }} [opts]  force: run a pending job even if its start looks recent
   */
  function kickFirstPick(crewId, { force = false } = {}) {
    const running = picking.get(crewId);
    if (running) return running;
    const job = inBackground(() => firstPickJob(crewId, force)).catch((e) => {
      log("first_pick_error", { crew: crewId, message: String(e?.message).slice(0, 200) });
      return null;
    }).finally(() => picking.delete(crewId));
    picking.set(crewId, job);
    return job;
  }

  /**
   * One attempt: claim it, pick, and record what happened. Safe to run twice, and on two
   * instances at once: the claim (src/app/claims.mjs) carries an attempt token, and only the
   * attempt that still holds it records its outcome. An attempt that stalled past
   * FIRST_PICK.staleMs while another took over records nothing (the review of d01a23b: a
   * late failure had overwritten the newer attempt's ready pick).
   */
  async function firstPickJob(/** @type {string} */ crewId, force = false) {
    const crew = /** @type {Crew|null} */ (await store.get("crews", crewId));
    if (!crew?.firstPick) return null;
    const state = crew.firstPick;
    const fresh = state.status === "pending" && state.attempts === 0;
    if (!fresh && !(force && state.status === "pending") && !shouldRun(state, now(), { running: false })) return state;
    const begun = beginPick(state, now());
    // a claim: only the job that moves the state from what it read starts the pick
    const job = await pickJobs.claim(crewId, {
      when: { "firstPick.status": state.status, "firstPick.attempts": state.attempts, "firstPick.startedAt": state.startedAt ?? null },
      set: { status: begun.status, startedAt: begun.startedAt, updatedAt: begun.updatedAt, nextTryAt: null },
    });
    if (!job) return /** @type {Crew|null} */ ((await store.get("crews", crewId)))?.firstPick ?? state;
    const t0 = now();
    /** @type {{ planId?: string|null, reason: string }} */
    let outcome;
    try {
      outcome = await pickNow(crew);
    } catch (e) {
      log("first_pick_error", { crew: crewId, message: String(/** @type {any} */ (e)?.message).slice(0, 200) });
      outcome = { reason: "error" };
    }
    const done = finishPick({ ...begun, attempts: job.attempts }, outcome, now());
    // only the pick's own fields, and only while this attempt holds the claim: a rename or a
    // taste saved meanwhile stays, and so does a newer attempt's outcome
    const saved = done.status === "failed" ? await pickJobs.fail(job, done) : await pickJobs.complete(job, done);
    if (!saved) {
      log("first_pick_stale", { crew: crewId, status: done.status, attempts: job.attempts, ms: now() - t0 });
      return /** @type {Crew|null} */ ((await store.get("crews", crewId)))?.firstPick ?? done;
    }
    log("first_pick", { crew: crewId, status: done.status, reason: done.reason, attempts: done.attempts, ms: now() - t0 });
    return saved.firstPick;
  }

  /**
   * The pick itself: the ritual for the next slot of the rhythm, made now instead of two or
   * three days before, so the invite has something to come to. The heartbeat then finds it
   * and leaves it be.
   * @param {Crew} crew
   * @returns {Promise<{ planId?: string|null, reason: string }>}
   */
  async function pickNow(crew) {
    const plans = (await plansOf(crew.id)).filter((p) => !isExpired(p, now()));
    const mine = plans.find((p) => p.kind === "ritual");
    if (mine) return { planId: mine.id, reason: "exists" };
    // no regular day: a one-off pick for this weekend; the crew's rhythm stays null, so the
    // heartbeat makes nothing after it (on 22 Oct 2026 a crew with no day had an empty home)
    const c = { ...crew, rhythm: pickRhythm(crew) };
    const due = ritualDue({ crew: c, now: now(), plans, lead: { min: 1, max: 31 } });
    if (!due.due) return { reason: due.reason };
    const r = await makeRitual(c, due, plans, watch("first_pick"), { placesBudgetMs: budget.pickPlacesMs, weatherBudgetMs: budget.pickWeatherMs });
    if (r.made && r.plan) return { planId: r.plan.id, reason: "made" };
    const again = (await plansOf(crew.id)).find((p) => p.kind === "ritual");
    return again ? { planId: again.id, reason: "exists" } : { reason: r.reason || "not_made" };
  }

  /**
   * The rhythm the first pick uses: the crew's own, or for a crew with no regular day, this
   * weekend (Saturday, or Sunday when it is Saturday already) in the default window.
   * @param {Crew} crew
   */
  function pickRhythm(crew) {
    if (crew.rhythm) return crew.rhythm;
    const tz = crew.tz || regionOf(crew).timezone;
    const today = localParts(now(), tz).date;
    return { every: /** @type {"1w"} */ ("1w"), day: weekdayOf(today) === 6 ? 0 : 6, window: { ...DEFAULT_WINDOW }, anchor: today };
  }

  /**
   * The first pick as the invite screen asks for it: `{ status, plan, reason }`. A pending
   * pick running here is waited for up to `waitMs` (so the app can ask again at once when it
   * comes back pending); one cut off by a restart, or a failed one whose wait is over, is
   * started again. A crew made before the job existed gets one now.
   * @param {{ slug: string, token: string|null, waitMs?: number }} input
   */
  async function firstPick({ slug, token, waitMs = budget.pickWaitMs }) {
    const { crew, role, member } = await viewerOf(slug, token);
    if (!crew.firstPick && !regionOf(crew).center) return { status: "ready", plan: null, reason: "no_location" };
    if (!crew.firstPick) await store.update("crews", crew.id, { set: { firstPick: pendingPick(now()) } }, { ifMatch: { firstPick: { $exists: false } } });
    const state = crew.firstPick ?? pendingPick(now());
    if (shouldRun(state, now(), { running: picking.has(crew.id) })) kickFirstPick(crew.id, { force: true });
    const job = picking.get(crew.id);
    if (job && waitMs > 0) await within(job, Math.min(waitMs, budget.pickWaitMs), null);
    const latest = /** @type {Crew} */ ((await store.get("crews", crew.id)) ?? crew);
    const s = latest.firstPick ?? state;
    const plan = s.planId ? /** @type {Plan|null} */ (await store.get("plans", s.planId)) : null;
    const members = plan ? await membersOf(crew.id) : [];
    return { status: s.status, plan: plan && !isExpired(plan, now()) ? planView(plan, latest, members, role, member) : null, reason: s.reason ?? null };
  }

  /**
   * Area type-ahead, biased to where the crew is: `near` and `country` from the crew's region
   * (the join screen and the crew's own screens send them), else the visitor's zone: no zone,
   * or a Lagos one, searches Lagos as before; any other zone searches anywhere.
   * @param {{ q: any, near?: { lat: number, lon: number }|null, country?: string|null, tz?: string|null }} input
   */
  async function searchAreas({ q, near = null, country = null, tz = null }) {
    const query = clip(q, 80);
    if (!query || query.length < 2) return { results: [] };
    const cc = typeof country === "string" && /^[a-z]{2}$/i.test(country) ? country.toUpperCase() : null;
    /** @type {{ near: { lat: number, lon: number }|null, country: string|null }} */
    let where;
    if (isLatLon(near)) where = { near: { lat: Number(/** @type {any} */ (near).lat), lon: Number(/** @type {any} */ (near).lon) }, country: cc };
    else {
      const start = hintRegion(tz ? { tz } : null);
      const ctx = packFor(start).geocode(start);
      where = { near: ctx.near, country: ctx.country ?? cc };
    }
    try {
      let rs = await geocoder.search(query, { limit: 5, areas: true, ...where });
      if (!rs.length) rs = await geocoder.search(query, { limit: 5, ...where });
      // near a crew, a far-away namesake is not the neighbourhood anyone means
      if (isLatLon(near)) rs = rs.filter((r) => haversineKm(/** @type {any} */ (where.near), r) <= NEAR_KM * 2);
      return { results: rs.map((r) => ({ label: r.label, detail: r.detail, lat: r.lat, lon: r.lon, ...(r.country ? { country: r.country } : {}), ...(r.city ? { city: r.city } : {}) })) };
    } catch {
      return { results: [] };
    }
  }

  // ------------------------------------------------------------ plans

  /**
   * Read a plan from text, a link and/or a flyer image into a draft to confirm.
   * @param {{ slug: string, token: string, text?: string|null, url?: string|null, image?: { mimeType: string, data: Buffer }|null, thumb?: { mimeType: string, data: Buffer }|null }} req
   *   thumb: the browser's small copy of the flyer (about 400 px), kept for the crew to see
   */
  async function parsePlan({ slug, token, text, url, image, thumb }) {
    const { crew, role, member } = await viewerOf(slug, token);
    if (role !== "member" || !member) throw new AppError(403, "members_only", "Join the crew first, then add plans.");
    const t = clip(text, LIMITS.planText);
    const link = clip(url, LIMITS.url) || firstUrl(t);
    if (!t && !link && !image) throw invalid([{ field: "text", message: "Paste a link, type a sentence or add a flyer." }]);
    // Instagram and Facebook give servers an empty page: with nothing else to read, ask for
    // the flyer picture instead of spending a Gemma call on a bare link
    const locked = link ? lockedSite(link) : null;
    if (locked && !image && !(t && t.replace(/https?:\/\/\S+/gi, "").trim().length >= 8)) {
      throw new AppError(422, "link_locked", lockedMessage(locked));
    }
    /** @type {string[]} */
    const notes = [];
    const sw = watch("plan_parse");
    let pageMeta = null;
    let img = image ? { mimeType: image.mimeType, data: image.data.toString("base64") } : null;
    if (link) {
      try {
        const page = await sw.time("page", pages.fetchPage(link));
        pageMeta = page.meta;
        if (page.image && !img) img = page.image;
        if (page.note) notes.push(page.note);
      } catch (e) {
        if (!t && !img) throw new AppError(422, "link_unreadable", /** @type {any} */ (e).message || "That link could not be read.");
        notes.push(`${/** @type {any} */ (e).message || "That link could not be read."} Used the rest.`);
      }
    }
    const where = placeOf(crew);
    const tz = crew.tz || where.region.timezone;
    const today = localParts(now(), tz).date;
    const input = { text: t, url: link, pageMeta, image: img, today, tz };
    const g = await sw.time("gemma", gemma("parse-plan", planMessages(promptFor("parse-plan", where.local), input), PLAN_SCHEMA, { waitMs: budget.gemmaMs }));
    // Gemma busy or failing: the page's own event details, or code's best guess at the
    // sentence, every field marked for a check; a flyer alone has nothing to guess from
    const guessed = !g.data && !!g.error && !!t && !pageMeta?.event;
    if (g.error) notes.unshift(pageMeta?.event ? "The sloth was busy, so this is from the page's own event details." : guessed ? BEST_GUESS : `${g.error} Fill this in yourself.`);
    const r = readPlan(guessed ? guessPlan(/** @type {string} */ (t)) : g.data, { ...input, member: { id: member.id, name: member.name }, local: where.local });
    readLog("parse-plan", g, planFields(r.draft), { fallback: guessed });
    const pinned = await sw.time("pin", pinWithin(r.draft.place, where));
    if (pinned.note) notes.push(pinned.note);
    /** @type {Record<string, any>} */
    const source = { ...r.draft.source };
    const small = thumb ?? (image && image.data.length <= FLYER_MAX_BYTES ? image : null);
    if (small && small.data.length <= FLYER_MAX_BYTES) {
      // kept for two days unless a plan claims it
      const id = `f_${ids.token()}`;
      await store.put("flyers", { id, crewId: crew.id, mimeType: small.mimeType, data: small.data.toString("base64"), expiresAt: new Date(now() + 2 * DAY).toISOString() });
      source.flyerId = id;
      source.imageUrl = links.flyer(id);
    } else if (typeof pageMeta?.event?.image === "string") source.imageUrl = pageMeta.event.image;
    else if (typeof pageMeta?.image === "string" && pageMeta.image.startsWith("https://")) source.imageUrl = pageMeta.image;
    sw.end({ link: !!link, image: !!image, ai: !g.error });
    return { draft: { ...r.draft, place: pinned.place, source }, confidence: r.confidence, low: r.low, notes: [...notes, ...r.notes], ai: !g.error, guess: guessed, model: g.model };
  }

  /** Create a plan from a confirmed draft. */
  async function addPlan({ slug, token, body }) {
    const { crew, role, member } = await viewerOf(slug, token);
    if (role !== "member" || !member) throw new AppError(403, "members_only", "Join the crew first, then add plans.");
    const raw = body?.plan;
    if (raw?.kind === "ritual") throw invalid([{ field: "kind", message: "Ritual plans are made by Come Through." }]);
    const v = validateDraft(raw, { tz: crew.tz || regionOf(crew).timezone });
    if (!v.ok) throw invalid(v.errors);
    if (parseInstant(v.draft.end) < now()) throw invalid([{ field: "start", message: "That plan has already happened." }]);
    const sw = watch("plan_add");
    const members = await membersOf(crew.id);
    const draft = { ...v.draft, host: v.draft.host && members.some((m) => m.id === v.draft.host) ? v.draft.host : null };
    draft.place = (await sw.time("pin", pinWithin(draft.place, placeOf(crew)))).place;
    if (draft.source.flyerId) {
      const flyer = await store.get("flyers", draft.source.flyerId);
      if (flyer && flyer.crewId === crew.id) delete draft.source.imageUrl;
      else delete draft.source.flyerId;
    }
    let plan = createPlan(draft, { id: ids.id("p"), crewId: crew.id, createdBy: member.id, now: now() });
    plan = await sw.time("weather", within(withWeather(plan), budget.weatherMs, plan));
    if (plan.source.flyerId) {
      await store.update("flyers", plan.source.flyerId, { set: { planId: plan.id, expiresAt: plan.expiresAt } });
    }
    await store.put("plans", plan);
    log("plan_created", { crew: crew.id, plan: plan.id, kind: plan.kind });
    await sw.time("notify", notify(members.filter((m) => m.id !== member.id).map((m) => m.id), {
      title: `New plan: ${plan.title}`,
      body: `${member.name} added ${when(plan)}. Tap if you're coming.`,
      url: links.plan(crew, plan.id),
      tag: plan.id,
    }, `${plan.id}:new`));
    sw.end({ kind: plan.kind });
    return { plan: planView(plan, crew, members, "member", member) };
  }

  /**
   * RSVP and edits. An RSVP is one targeted write of that member's own answer (rsvps.<id>),
   * so answers made at the same moment all land. An edit is worked out from the plan as it
   * is now and written under its version, read again and retried when someone else wrote
   * first; the place's pin and the forecast are looked up once and reused on a retry.
   */
  async function patchPlan({ id, token, body }) {
    const { member, crew, plan } = await planFor(id, token);
    const b = body && typeof body === "object" ? body : {};
    const members = await membersOf(crew.id);
    /** @type {string[]} */
    let changed = [];
    const { rsvp, ...edits } = b;
    if ("rsvp" in b && b.rsvp !== null && b.rsvp !== "going" && b.rsvp !== "maybe") throw invalid([{ field: "rsvp", message: "rsvp must be going, maybe or null." }]);
    let current = plan;
    if (Object.keys(edits).length) {
      if (!canEdit(plan, member.id)) throw new AppError(403, "not_yours", "Only the person who added this plan or its host can change it.");
      /** @type {Map<string, any>} */
      const pins = new Map();
      /** @type {Map<string, any>} */
      const forecasts = new Map();
      const done = await editDoc(store, "plans", plan.id, async (fresh) => {
        const r = applyEdit(fresh, edits, { now: now() });
        if (!r.ok) throw invalid(r.errors);
        changed = r.changed;
        if (!r.changed.length) return null;
        let next = r.plan;
        if (r.changed.includes("place")) {
          const k = JSON.stringify(next.place);
          if (!pins.has(k)) pins.set(k, (await pinWithin(next.place, placeOf(crew))).place);
          next = { ...next, place: pins.get(k) };
        }
        if (r.changed.includes("start") || r.changed.includes("place")) {
          const k = JSON.stringify([next.start, next.end, next.place]);
          if (!forecasts.has(k)) {
            const bare = { ...next, weather: null };
            forecasts.set(k, (await within(withWeather(bare), budget.weatherMs, bare)).weather ?? null);
          }
          next = { ...next, weather: forecasts.get(k) };
        }
        return diffChange(fresh, next, ["rsvps"]);
      });
      if (!done) throw notFound("That plan");
      current = done.after;
    }
    let answered = false;
    /** @type {string|null} */
    let before = null;
    if ("rsvp" in b) {
      const path = `rsvps.${member.id}`;
      if (!safePath(path)) throw badToken();
      before = current.rsvps?.[member.id] ?? null;
      const stamp = { updatedAt: new Date(now()).toISOString() };
      const after = b.rsvp == null
        ? await store.update("plans", plan.id, { unset: [path], set: stamp, inc: { seq: 1 } }, { ifMatch: { [path]: { $exists: true } } })
        : await store.update("plans", plan.id, { set: { [path]: b.rsvp, ...stamp }, inc: { seq: 1 } }, { ifMatch: { [path]: { $ne: b.rsvp } } });
      answered = !!after;
      current = after ?? /** @type {Plan} */ ((await store.get("plans", plan.id)) ?? current);
    }
    if (!changed.length && !answered) return { plan: planView(current, crew, members, "member", member) };
    const next = current;
    const audience = Object.keys(next.rsvps || {}).filter((m) => m !== member.id);
    if (changed.includes("status") && next.status === "cancelled") {
      await notify(audience, { title: `Cancelled: ${next.title}`, body: `${member.name} called it off.`, url: links.plan(crew, next.id), tag: next.id }, `${next.id}:cancelled:${next.seq}`);
    } else if (changed.some((f) => ["start", "end", "place"].includes(f))) {
      await notify(audience, { title: `Changed: ${next.title}`, body: `Now ${when(next)}${next.place.name ? ` at ${next.place.name}` : ""}.`, url: links.plan(crew, next.id), tag: next.id }, `${next.id}:changed:${next.seq}`);
    }
    if (answered) {
      // the pods as they were just before this answer
      const rsvps = { ...next.rsvps };
      if (before == null) delete rsvps[member.id];
      else rsvps[member.id] = /** @type {any} */ (before);
      await notifyNewPods(next, crew, members, podKeys({ ...next, rsvps }, members, crew));
    }
    return { plan: planView(next, crew, members, "member", member) };
  }

  /** The riders for a plan: going members with their areas (the host is already there). */
  const riders = (/** @type {Plan} */ plan, /** @type {Member[]} */ members) =>
    members.filter((m) => plan.rsvps?.[m.id] === "going" && m.id !== plan.host).map((m) => ({ id: m.id, name: m.name, area: isLatLon(m.area) ? m.area : null }));

  /** Where a plan with no pin roughly is: a host's home is in the host's neighbourhood. */
  function nearOf(/** @type {Plan} */ plan, /** @type {Member[]} */ members) {
    if (isLatLon(plan.place)) return null;
    const near = /** @type {any} */ (plan.place)?.near;
    if (isLatLon(near)) return { label: near.label, lat: near.lat, lon: near.lon };
    if (!plan.host) return null;
    const host = members.find((m) => m.id === plan.host);
    return host && isLatLon(host.area) ? { label: /** @type {string} */ (host.area.label), lat: /** @type {number} */ (host.area.lat), lon: /** @type {number} */ (host.area.lon) } : null;
  }

  /** Pod membership only (no routes needed): who rides with whom. */
  const podGroups = (/** @type {Plan} */ plan, /** @type {Member[]} */ members, /** @type {Crew} */ crew) => podsForPlan(plan, riders(plan, members), { near: nearOf(plan, members), model: placeOf(crew).pack.travel });

  /** Pods with road routes for each pickup (OSRM, cached), falling back to the straight line; the crew's pack sets the traffic model. */
  async function computePods(/** @type {Plan} */ plan, /** @type {Member[]} */ members, /** @type {Crew} */ crew) {
    const going = riders(plan, members);
    const near = nearOf(plan, members);
    const model = placeOf(crew).pack.travel;
    /** @type {Map<string, any>} */
    const found = new Map();
    if (routes) {
      // all trips at once (OSRM's gate still spaces them; most are cached by tile)
      await Promise.all(podTrips(plan, going, { near, model }).map(async (t) => {
        const r = await routes.route(t.from, t.to).catch(() => null);
        if (r) found.set(tripKey(t.from, t.to), r);
      }));
    }
    return podsForPlan(plan, going, { near, model, route: (a, b) => found.get(tripKey(a, b)) ?? null });
  }

  /** Pod memberships as keys, to tell when a new pod of two or more has formed. */
  function podKeys(plan, members, crew) {
    if (!isLatLon(plan.place) && !nearOf(plan, members)) return new Set();
    return new Set(podGroups(plan, members, crew).pods.filter((p) => p.memberIds.length > 1).map((p) => p.memberIds.join(",")));
  }

  /**
   * What the pods depend on: the time, the place (or where it is near), the host and who is
   * going from where. Kept pods are used only while this is unchanged.
   */
  const podSig = (/** @type {Plan} */ plan, /** @type {Member[]} */ members) => JSON.stringify([plan.start, plan.place?.lat ?? null, plan.place?.lon ?? null, nearOf(plan, members), plan.host ?? null, riders(plan, members).map((r) => [r.id, r.area?.lat ?? null, r.area?.lon ?? null])]);

  /** The pods last worked out with road routes for this plan, when they still fit; else null. */
  async function keptPods(/** @type {Plan} */ plan, /** @type {Member[]} */ members) {
    const doc = await store.get("podcache", plan.id);
    return doc && doc.sig === podSig(plan, members) && doc.result ? doc.result : null;
  }

  /** Pods with road routes, worked out now and kept (background jobs and the answer's own pod check). */
  async function routedPods(/** @type {Plan} */ plan, /** @type {Member[]} */ members, /** @type {Crew} */ crew) {
    const r = await computePods(plan, members, crew);
    await store.put("podcache", { id: plan.id, crewId: crew.id, sig: podSig(plan, members), result: r, at: new Date(now()).toISOString(), expiresAt: plan.expiresAt });
    return r;
  }

  async function notifyNewPods(plan, crew, members, before) {
    if ((!isLatLon(plan.place) && !nearOf(plan, members)) || plan.status === "cancelled") return;
    for (const pod of (await routedPods(plan, members, crew)).pods) {
      const key = pod.memberIds.join(",");
      if (pod.memberIds.length < 2 || before.has(key)) continue;
      await notify(pod.memberIds, { title: `Ride pod for ${plan.title}`, body: pod.shareText, url: links.plan(crew, plan.id), tag: `${plan.id}-pod` }, `${plan.id}:pod:${key}`);
    }
  }

  /** One plan, for a member or a guest of its crew. */
  async function getPlan({ id, token }) {
    if (!token) throw noToken();
    const plan = /** @type {Plan|null} */ (await store.get("plans", String(id)));
    if (!plan || isExpired(plan, now())) throw notFound("That plan");
    const crew = /** @type {Crew|null} */ (await store.get("crews", plan.crewId));
    if (!crew) throw notFound("That plan");
    const { role, member } = await viewerOf(crew.slug, token);
    const members = await membersOf(crew.id);
    return { plan: planView(plan, crew, members, role, member), members: members.map(memberView), crew: crewView(crew, role), you: member ? memberView(member) : null };
  }

  /** A stored flyer thumbnail. Its id is an unguessable capability, like the calendar token. */
  async function getFlyer({ id }) {
    const f = await store.get("flyers", String(id));
    if (!f || Date.parse(f.expiresAt) <= now()) throw notFound("That flyer");
    return { mimeType: f.mimeType, data: Buffer.from(f.data, "base64") };
  }

  async function getPods({ id, token }) {
    const { crew, plan } = await planFor(id, token);
    const members = await membersOf(crew.id);
    // the ride apps the crew's pack has verified (in Lagos: Bolt, inDrive, LagRide; none
    // takes a drop-off from a link); elsewhere none, and "Get directions" instead
    const { pack } = placeOf(crew);
    const kept = await keptPods(plan, members);
    return { ...(kept ?? (await routedPods(plan, members, crew))), rides: ridesForApi(pack.rides), directions: directionsLinks(plan.place) };
  }

  /**
   * The member's pod line and leave-by for a plan, for the calendar. Calendar apps and
   * Google's servers read feeds on their own schedule, so a read never asks OSRM: it uses
   * the pods kept by the background (the heartbeat, an answer's pod check), else the
   * straight-line estimate, which says it is one.
   */
  async function podExtras(plan, members, memberId, crew) {
    if (plan.rsvps?.[memberId] !== "going" || (!isLatLon(plan.place) && !nearOf(plan, members))) return {};
    const pods = ((await keptPods(plan, members)) ?? podGroups(plan, members, crew)).pods;
    const pod = pods.find((/** @type {any} */ p) => p.memberIds.includes(memberId));
    return pod?.leaveBy ? { leaveBy: pod.leaveBy, podText: pod.shareText } : {};
  }

  /** One plan as a calendar file. */
  async function eventIcs({ id, token }) {
    const { member, crew, plan } = await planFor(id, token);
    const members = await membersOf(crew.id);
    const names = namesOf(members);
    const ics = singleEvent(plan, { memberId: member.id, uidDomain: cfg.uidDomain, zoneNames: placeOf(crew).pack.zoneNames, extras: { url: links.plan(crew, plan.id), going: goingIds(plan).map((i) => names[i]).filter(Boolean), ...(await podExtras(plan, members, member.id, crew)) } });
    return { ics, filename: icsFileName(plan.title) };
  }

  /** The member's subscribed feed. */
  async function feed({ calToken }) {
    const member = /** @type {Member|null} */ (await store.findOne("members", { calToken: String(calToken) }));
    if (!member) throw notFound("That calendar");
    const crew = /** @type {Crew|null} */ (await store.get("crews", member.crewId));
    if (!crew) throw notFound("That calendar");
    const members = await membersOf(crew.id);
    const names = namesOf(members);
    const plans = await plansOf(crew.id);
    /** @type {Map<string, any>} */
    const pods = new Map();
    for (const p of plans) pods.set(p.id, await podExtras(p, members, member.id, crew));
    // the feed's name is read by calendar apps and Google's servers: the outbound name only
    return calendarFeed({
      crew: { ...crew, name: outboundName(crew) ?? "your crew" }, member, plans, now: now(), uidDomain: cfg.uidDomain, zoneNames: placeOf(crew).pack.zoneNames,
      extras: (p) => ({ url: links.plan(crew, p.id), going: goingIds(p).map((i) => names[i]).filter(Boolean), ...pods.get(p.id) }),
    });
  }

  // ------------------------------------------------------------ push

  async function subscribePush({ memberId, token, body }) {
    const { member } = await memberOf(token);
    if (member.id !== memberId) throw badToken();
    const sub = body?.subscription;
    if (!isSubscription(sub)) throw invalid([{ field: "subscription", message: "That push subscription is not valid." }]);
    await store.put("push", { id: endpointId(sub.endpoint), memberId: member.id, crewId: member.crewId, endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, createdAt: new Date(now()).toISOString() });
    return null;
  }

  async function unsubscribePush({ memberId, token, body }) {
    const { member } = await memberOf(token);
    if (member.id !== memberId) throw badToken();
    if (typeof body?.endpoint === "string") {
      const id = endpointId(body.endpoint);
      const doc = await store.get("push", id);
      if (doc && doc.memberId === member.id) await store.delete("push", id);
    }
    return null;
  }

  /**
   * Push news to members, once per dedupe key (a retried request or a repeated edit does
   * not buzz anyone twice). Each subscription gets a delivery record (DELIVERY above): it is
   * inserted only when new, claimed with a lease, sent, and marked a success only once the
   * push service said 2xx. A failure for a moment is tried again by the heartbeat; a
   * subscription the browser dropped (404, 410) is deleted.
   * @returns {Promise<number>} messages accepted by the push service now
   */
  async function notify(memberIds, msg, dedupeKey) {
    if (!push.enabled || !memberIds.length) return 0;
    let sent = 0;
    const t = now();
    for (const memberId of [...new Set(memberIds)]) {
      const key = `${dedupeKey}:${memberId}`;
      // a marker from before delivery records (kept 14 days): that news went out already
      if (await store.get("sent", key)) continue;
      for (const s of await store.find("push", { memberId })) {
        const id = `${key}:${s.id}`;
        const fresh = await store.insert("deliveries", {
          id, key, memberId, subId: s.id, msg: { title: msg.title, body: msg.body, url: msg.url, tag: msg.tag },
          state: "pending", attempts: 0, nextAt: iso(t), leaseUntil: null, sendBy: iso(t + DELIVERY.ttlMs),
          createdAt: iso(t), expiresAt: iso(t + DELIVERY.keepMs),
        });
        // already recorded: it was sent, or the heartbeat owns its retries
        if (fresh && (await deliver(id))) sent++;
      }
    }
    return sent;
  }

  /**
   * One attempt at a delivery, if it can be claimed: due and not leased, or leased by a
   * worker whose lease ran out (it crashed, or the instance went to sleep). True when the
   * push service accepted it.
   *
   * The claim carries an attempt token (src/app/claims.mjs), and every outcome is written
   * only while this attempt still holds it: a worker that stalled past its lease while
   * another took over cannot turn the other's success back into a failure to retry (the
   * review of d01a23b reproduced that, and the retry sent the push again). The send itself
   * has a deadline (DELIVERY.sendMs) well inside the lease.
   */
  async function deliver(/** @type {string} */ id) {
    const t = now();
    const due = { state: { $in: ["pending", "retryable-failed"] }, nextAt: { $lte: iso(t) } };
    const stale = { state: "leased", leaseUntil: { $lt: iso(t) } };
    const job = await deliveryJobs.claim(id, { when: { $or: [due, stale] }, set: { state: "leased", leaseUntil: iso(t + DELIVERY.leaseMs) } });
    if (!job) return false;
    const d = job.doc;
    const finish = async (/** @type {string} */ state, /** @type {Record<string, any>} */ more = {}) => {
      const fields = { state, leaseUntil: null, updatedAt: iso(now()), ...more };
      const saved = state === "succeeded" ? await deliveryJobs.complete(job, fields) : await deliveryJobs.fail(job, fields);
      if (!saved) log("push_stale_outcome", { state, attempts: job.attempts });
      return saved;
    };
    if (Date.parse(d.sendBy) <= t) {
      await finish("expired");
      return false;
    }
    const s = await store.get("push", d.subId);
    if (!s) {
      await finish("permanent-failed", { error: "unsubscribed" });
      return false;
    }
    /** @type {{ ok: boolean, gone: boolean, permanent?: boolean, status?: number }} */
    let r;
    const noAnswer = { ok: false, gone: false, status: 0 };
    try {
      r = await within(push.send({ endpoint: s.endpoint, keys: s.keys }, d.msg), Math.min(budget.pushSendMs, DELIVERY.sendMs), noAnswer);
    } catch (e) {
      r = noAnswer;
    }
    if (r.ok) {
      const sentAt = iso(now());
      if (!(await finish("succeeded", { sentAt }))) {
        // this attempt's lease ran out and another worker took over, but the push service
        // took this one: the push is out, so that is recorded unless a final outcome already
        // is, and the newer claim is voided so its retry does not send it once more
        await store.update("deliveries", id, { set: { state: "succeeded", claim: null, leaseUntil: null, sentAt, updatedAt: sentAt } }, { ifMatch: { state: { $in: ["pending", "leased", "retryable-failed"] } } });
      }
      return true;
    }
    if (r.gone) await store.delete("push", s.id);
    const last = d.attempts >= DELIVERY.maxAttempts;
    if (r.gone || r.permanent || last) await finish("permanent-failed", { error: r.gone ? "gone" : last ? "gave_up" : `status_${r.status ?? 0}` });
    else await finish("retryable-failed", { error: `status_${r.status ?? 0}`, nextAt: iso(now() + DELIVERY.backoffMs[Math.min(d.attempts - 1, DELIVERY.backoffMs.length - 1)]) });
    log("push_failed", { status: r.status ?? 0, attempts: d.attempts, gone: r.gone });
    return false;
  }

  /** The heartbeat's part: deliveries due again, and leases left behind. Returns how many went out. */
  async function retryDeliveries() {
    if (!push.enabled) return 0;
    const t = iso(now());
    const due = await store.find("deliveries", { $or: [{ state: { $in: ["pending", "retryable-failed"] }, nextAt: { $lte: t } }, { state: "leased", leaseUntil: { $lt: t } }] }, { limit: 200 });
    let sent = 0;
    for (const d of due) if (await deliver(d.id)) sent++;
    return sent;
  }

  // ------------------------------------------------------------ weather

  /** Attach the forecast to an outdoor plan within the forecast range. Never fails. */
  async function withWeather(plan) {
    const at = weatherSpot(plan.place);
    if (!plan.place?.outdoor || !at) return plan;
    const start = parseInstant(plan.start);
    if (start - now() > 6 * DAY || start < now()) return plan;
    try {
      const hours = await weather.hourly(at, { tz: plan.tz });
      const w = weatherForPlan(hours, plan, now());
      return w ? { ...plan, weather: w } : plan;
    } catch {
      return plan;
    }
  }

  /**
   * The heartbeat's forecast refresh for one plan: a targeted write of `weather` (and seq
   * when the verdict flips), guarded by the version the forecast was worked out from. When
   * the plan changed meanwhile (an answer, a new time) it is read again and the forecast
   * redone (the adapter caches it), so nothing anyone wrote is undone.
   * @returns {Promise<{ before: Plan, after: Plan }|null>}  null: no forecast to write
   */
  async function updateWeather(/** @type {string} */ planId, /** @type {number} */ t) {
    const r = await editDoc(store, "plans", planId, async (p) => {
      if (!p.place?.outdoor || !weatherSpot(p.place) || p.status === "cancelled") return null;
      const fresh = await withWeather({ ...p, weather: null });
      if (!fresh.weather) return null;
      const flipped = !p.weather || p.weather.ok !== fresh.weather.ok;
      return { set: { weather: fresh.weather, ...(flipped ? { updatedAt: new Date(t).toISOString() } : {}) }, ...(flipped ? { inc: { seq: 1 } } : {}) };
    }).catch((e) => {
      log("weather_write_conflict", { plan: planId, message: String(e?.message).slice(0, 120) });
      return null;
    });
    return r?.changed ? r : null;
  }

  // ------------------------------------------------------------ the ritual

  /**
   * Where the crew is: the members' areas once two or more have joined; before that, the
   * areas named at setup as well (one early joiner in Yaba should not pull a Yaba and Lekki
   * crew's ritual to Yaba).
   */
  function crewPoints(crew, members) {
    const fromMembers = members.filter((m) => isLatLon(m.area)).map((m) => ({ id: m.id, name: m.name, area: m.area }));
    if (fromMembers.length >= 2) return fromMembers;
    const declared = (crew.areas || []).filter(isLatLon).map((a, i) => ({ id: `area${i}`, name: a.label, area: a }));
    const extra = declared.filter((d) => !fromMembers.some((m) => haversineKm(m.area, d.area) < 2));
    return [...fromMembers, ...extra];
  }

  /**
   * Candidate places near a point: live Overpass results merged with the pack's curated
   * spots (Lagos), or with Wikidata's parks and beaches near the crew (anywhere else).
   * Overpass and Wikidata are asked at the same time, so the heartbeat stays inside its
   * 100 s.
   * With a taste that names kinds of place beyond green ones (galleries, cafés, bookshops),
   * those are asked for too, in one more cached Overpass query; each comes back marked
   * `indoor` unless its kind is open-air.
   * With `budgetMs`, whatever has not answered by then is left out (the curated spots and
   * whatever did answer carry the pick) and goes on filling its cache for the next time.
   * @param {{ lat: number, lon: number }} center
   * @param {CityPack} [pack]
   * @param {import("../core/taste.mjs").Taste|null} [taste]
   * @param {{ budgetMs?: number }} [opts]
   */
  async function candidatesNear(center, pack = placeOf({}).pack, taste = null, { budgetMs = 0 } = {}) {
    const capped = (/** @type {Promise<any[]>} */ p, /** @type {string} */ what) => (budgetMs ? within(p, budgetMs, null).then((x) => {
      if (x === null) log("places_slow", { what, ms: budgetMs });
      return x ?? [];
    }) : p);
    const fromWikidata = capped(pack.wikidataSpots && wikidata
      ? wikidata.spotsNear(center, SEARCH_RADII_M[0] / 1000).catch((e) => {
        log("wikidata_error", { message: String(/** @type {any} */ (e).message).slice(0, 120) });
        return /** @type {any[]} */ ([]);
      })
      : Promise.resolve(/** @type {any[]} */ ([])), "wikidata");
    // the taste's own query runs beside the green one, so a crew with a taste waits no longer
    const fromTaste = capped(tastePlaces(center, taste), "taste");
    const live = await capped((async () => {
      /** @type {any[]} */
      let found = [];
      for (const r of SEARCH_RADII_M) {
        try {
          found = await places.greenNear(center, r);
        } catch (e) {
          // Overpass is down or at capacity: a wider search would only wait again, and the
          // heartbeat has to answer within 100 s. The curated spots carry this one.
          log("overpass_error", { message: String(/** @type {any} */ (e).message).slice(0, 120) });
          return [];
        }
        if (found.length >= 3) break;
      }
      return found;
    })(), "green");
    // outdoor spots, plus any spot a source says has a roof (offered only when it rains)
    const curated = (pack.curated ? spots : [])
      .filter((s) => (OUTDOOR_KINDS.includes(s.kind) || s.covered === true) && haversineKm(center, s) <= SPOT_RADIUS_KM)
      .map((s) => ({ name: s.name, lat: s.lat, lon: s.lon, osm: s.osm || undefined, ...(s.covered === true ? { outdoor: false, covered: true } : { outdoor: true }), ...(s.entry ? { entry: s.entry } : {}) }));
    const out = [...live, ...(await fromTaste)];
    for (const c of [...curated, ...(await fromWikidata)]) {
      const dup = out.some((o) => placeKey(o) === placeKey(c) || (haversineKm(o, c) < 0.3 && o.name.toLowerCase() === c.name.toLowerCase()));
      if (!dup) out.push(c);
    }
    return out;
  }

  /** Places of the kinds a crew's taste names (beyond parks and gardens), from Overpass. Never throws. */
  async function tastePlaces(/** @type {{ lat: number, lon: number }} */ center, /** @type {import("../core/taste.mjs").Taste|null} */ taste) {
    const kinds = (taste?.placeKinds || []).filter((k) => !["park", "garden", "beach"].includes(k));
    if (!kinds.length || !places.kindsNear) return [];
    try {
      const found = await places.kindsNear(center, SEARCH_RADII_M[0], osmTagsFor(kinds));
      return found.map((c) => {
        const kind = Object.entries(PLACE_KINDS).find(([, k]) => k.tags.some(([key, v]) => c.osm?.tags?.[key] === v));
        return kind && kind[1].outdoor ? { ...c, outdoor: true } : { ...c, indoor: true };
      });
    } catch (e) {
      log("overpass_error", { message: String(/** @type {any} */ (e).message).slice(0, 120) });
      return [];
    }
  }

  /**
   * Make the crew's ritual plan for a due slot. The plan id is derived from the crew and the
   * date, so two overlapping heartbeats write the same plan instead of two.
   */
  async function makeRitual(crew, due, plans, sw = watch("ritual"), { placesBudgetMs = 0, weatherBudgetMs = 0 } = {}) {
    const members = await membersOf(crew.id);
    const points = crewPoints(crew, members);
    const center = centroid(points.map((p) => p.area));
    if (!center) return { made: false, reason: "no_location" };
    const { pack, local } = placeOf(crew);
    const taste = crew.taste ?? null;
    const tz = crew.tz || regionOf(crew).timezone;
    // the places and the forecast need only the centre: both at once
    const forecast = weather.hourly(center, { tz, days: 7 }).catch(() => null);
    const [candidates, hours] = await Promise.all([
      sw.time("places", candidatesNear(center, pack, taste, { budgetMs: placesBudgetMs })),
      // no forecast in time: the crew's own window, without a weather line (honest, and the heartbeat checks it later)
      sw.time("weather", weatherBudgetMs ? within(forecast, weatherBudgetMs, null) : forecast),
    ]);
    // the crew's hard constraints (core/constraints.mjs): its own window, which the social
    // hours only narrow; its budget; nobody travelling more than MAX_TRIP_MIN; its needs
    const k = crewConstraints({ ...crew, rhythm: { ...crew.rhythm, window: due.window } }, { cheapMax: pack.cheapMax ?? null });
    const span = Math.min(3, Math.max(1, (minutesOfDay(due.window.to) - minutesOfDay(due.window.from)) / 60));
    const outdoorHours = clipToSocial(due.date, due.window, { social: pack.social });
    const coveredHours = clipToSocial(due.date, due.window, { outdoor: false, social: pack.social });
    if (!outdoorHours && !coveredHours) return { made: false, reason: "no_window" };
    const cut = (/** @type {{ from: string, to: string }} */ w) => ({ from: w.from, to: hhmm(Math.min(minutesOfDay(w.to), minutesOfDay(w.from) + span * 60)) });
    // the crew's window (inside the social hours) when it is dry; when it is wet, a dry
    // stretch in that window that day or the next, else a covered place, else the sloth
    // skips this one (core/weather.mjs, ritualWindow)
    const rw = hours && outdoorHours ? ritualWindow(hours, { date: due.date, from: due.window.from, to: due.window.to, hours: span }, pack.social) : null;
    let win = rw?.win ?? null;
    let date = rw?.date ?? due.date;
    /** @type {{ from: string, to: string }|null} */
    let window = rw ? rw.window : outdoorHours ? cut(outdoorHours) : null;
    /** @type {import("../core/weather.mjs").RainPlan|null} */
    let rainPlan = rw?.rainPlan ?? null;
    const open = outdoorHours ? candidates.filter((c) => c.covered !== true) : [];
    let pool = open;
    if (rainPlan?.kind === "skip" || !outdoorHours) {
      // a source says it has a roof: a curated covered spot, or a gallery, museum or the like
      // the crew is into (OpenStreetMap's tag says what it is). A crew whose hours are after
      // dark ("Saturday night") goes under a roof too, never to the afternoon.
      const covered = candidates.filter((c) => c.covered === true || (c.indoor === true && kindIndoor(c)));
      // the crew's own kinds of place (its taste, with the roofed kinds it implies) before a
      // generic covered spot: the gamers get the arcade, not the nearest hall (22 Oct eval)
      const kinds = new Set(taste?.placeKinds || []);
      const theirs = covered.filter((c) => kinds.has(/** @type {string} */ (kindOfTags(c.osm?.tags || c.tags || {}))));
      if (covered.length && coveredHours) {
        pool = theirs.length ? theirs : covered;
        window = cut(coveredHours);
        date = due.date;
        win = null;
      }
    }
    if (!window || !pool.length) return { made: false, reason: outdoorHours ? "no_places" : "no_window" };
    if (!pool.some((c) => c.covered !== true) && pool === open) return { made: false, reason: "no_places" };
    const at = zonedToMs(date, window.from, tz);
    let outdoor = pool === open;
    // the fairest few by straight line go to OSRM (its table takes 100 points at most)
    if (pool.length > 40) pool = scorePlaces({ members: points, candidates: pool, at, tz, vibeTags: crew.vibeTags || [], budget: crew.budget || "any", outdoor, recent: recentPlaces(plans, now()), now: now(), model: pack.travel, taste }).ranked.slice(0, 40).map((r) => r.candidate);
    // road distances from every member's area to every candidate, in one OSRM table request
    /** @type {Map<string, any>} */
    const roads = new Map();
    const located = points.filter((p) => isLatLon(p.area));
    if (routes && located.length) {
      const t = await sw.time("routes", routes.table(located.map((p) => p.area), pool).catch(() => null));
      if (t) located.forEach((p, i) => pool.forEach((c, j) => {
        const km = t.km[i]?.[j];
        const min = t.min[i]?.[j];
        if (km != null && min != null) roads.set(tripKey(p.area, c), { km, min });
      }));
    }
    const score = (/** @type {any[]} */ cs) => scorePlaces({ members: points, candidates: cs, at, tz, vibeTags: crew.vibeTags || [], budget: crew.budget || "any", outdoor, recent: recentPlaces(plans, now()), now: now(), route: (a, b) => roads.get(tripKey(a, b)) ?? null, model: pack.travel, taste });
    const slotWindow = /** @type {{ from: string, to: string }} */ (window);
    const asIdea = (/** @type {any} */ r) => ({ kind: "place", title: r.candidate.name, label: null, time: slotWindow, price: r.candidate.entry?.free === false ? { text: r.candidate.entry.text ?? "Paid entry", free: false } : null, travel: { maxMin: r.maxMin }, place: { name: r.candidate.name, outdoor: r.candidate.outdoor === true, osm: r.candidate.osm } });
    let scored = score(pool);
    // filter first, rank second: a place that breaks a constraint (a trip over 90 minutes, a
    // fee for a crew that wants free) is never the pick, however well it scores
    const allowed = scored.ranked.filter((r) => !candidateViolations(asIdea(r), k).length);
    if (!allowed.length) {
      const reason = scored.ranked.length && scored.ranked.every((r) => r.maxMin > k.maxTripMin) ? "too_far" : "no_places";
      log("ritual_not_made", { crew: crew.id, reason });
      return { made: false, reason };
    }
    if (allowed.length !== scored.ranked.length) scored = score(allowed.map((r) => r.candidate));
    if (!scored.pick || !scored.explanation) return { made: false, reason: "no_places" };
    const pick = scored.pick.candidate;
    // a gallery or café the crew is into is under a roof: no weather watch on it
    if (pick.indoor === true) outdoor = false;
    if (rainPlan?.kind === "skip" && !outdoor) rainPlan = { ...rainPlan, kind: "covered", note: coveredNote(rainPlan, pick.name, window) };
    const skipped = rainPlan?.kind === "skip";
    const draft = ritualDraft({ date, window, place: { ...pick, address: pick.address }, tz, outdoor });

    let why = null;
    let invite;
    if (skipped) {
      // nothing to explain or invite to: the note says why, and no Gemma call is spent
      invite = /** @type {string} */ (rainPlan?.note);
    } else {
      const ex = await sw.time("explain", gemma("explain-pick", explainMessages(promptFor("explain-pick", local), scored.explanation), EXPLAIN_SCHEMA));
      why = readExplain(ex.data, scored.explanation).why;
      const facts = { title: draft.title, day: DAY_NAMES[weekdayOf(date)], date, time: `${clockWords(window.from)} to ${clockWords(window.to)}`, place: pick.name, weather: win?.reason.text ?? null, rain: rainPlan?.note ?? null, why: crew.taste?.needs?.length ? null : why, vibe: crew.vibe };
      // the invite travels (calendar, push, the plain page): with needs, the explanation stays in the app
      const fallback = fallbackInvite({ title: draft.title, window, weatherText: rainPlan?.note ?? win?.reason.text ?? null });
      const inv = await sw.time("invite", gemma("write-invite", inviteMessages(promptFor("write-invite", local), facts), INVITE_SCHEMA));
      invite = readInvite(inv.data, facts, fallback).invite;
    }

    const v = validateDraft(draft, { tz });
    if (!v.ok) return { made: false, reason: "invalid_draft" };
    // checked again before anything is published: the plan's own hours, trips, price and needs
    const final = candidateViolations({ ...asIdea(scored.pick), time: { from: localParts(parseInstant(v.draft.start), tz).time, to: localParts(parseInstant(v.draft.end), tz).time } }, k);
    if (final.length) {
      log("ritual_not_made", { crew: crew.id, reason: "constraints", why: final.join("; ") });
      return { made: false, reason: "constraints" };
    }
    let plan = createPlan(v.draft, { id: `p_r_${crew.id.replace(/^c_/, "")}_${due.date.replace(/-/g, "")}`, crewId: crew.id, createdBy: "sloth", now: now(), why, invite, ritualFor: due.date });
    if (hours && outdoor) {
      const w = weatherForPlan(hours, plan, now());
      if (w) plan = { ...plan, weather: w };
    }
    if (rainPlan) plan = { ...plan, rainPlan };
    if (skipped) plan = { ...plan, status: "cancelled" };
    // written only when new: another heartbeat may have made it meanwhile
    if (!(await store.insert("plans", plan))) return { made: false, reason: "exists" };
    sw.end({ candidates: candidates.length, weather: !!hours, rain: rainPlan?.kind ?? null });
    log("ritual_made", { crew: crew.id, plan: plan.id, place: placeKey(pick), candidates: candidates.length, weather: !!hours, rain: rainPlan?.kind ?? null });
    await notify(members.map((m) => m.id), { title: skipped ? `The sloth is skipping ${DAY_NAMES[weekdayOf(date)]}` : plan.title, body: invite.slice(0, 180), url: links.plan(crew, plan.id), tag: plan.id }, `${plan.id}:new`);
    return { made: true, plan };
  }

  /**
   * The heartbeat: make due rituals, recheck the weather on outdoor plans in the coming
   * days (alerting within three), and delete expired plans. Safe to run late, twice or
   * concurrently.
   */
  function tick() {
    return inBackground(heartbeat);
  }

  async function heartbeat() {
    const t = now();
    const out = { rituals: 0, firstPicks: 0, weatherChecked: 0, rainAlerts: 0, pushes: 0, podsRouted: 0, expired: 0, errors: 0 };
    const crews = /** @type {Crew[]} */ (await store.find("crews"));
    for (const crew of crews) {
      try {
        // a first pick that failed, or was cut off by a restart (the free instance sleeps)
        if (shouldRun(crew.firstPick, t, { running: picking.has(crew.id) })) {
          const done = await kickFirstPick(crew.id, { force: true });
          if (done?.status === "ready" && done.planId) out.firstPicks++;
        }
        const plans = await plansOf(crew.id);
        for (const p of plans) {
          if (isExpired(p, t)) {
            await store.delete("plans", p.id);
            out.expired++;
          }
        }
        const live = plans.filter((p) => !isExpired(p, t));
        const due = ritualDue({ crew, now: t, plans: live });
        if (due.due) {
          const r = await makeRitual(crew, due, live);
          if (r.made) out.rituals++;
        }
        // the pods of the coming week's plans, with road routes, kept for calendar reads
        const members = live.some((p) => goingIds(p).length) ? await membersOf(crew.id) : [];
        for (const p of live) {
          const start = parseInstant(p.start);
          if (p.status === "cancelled" || start < t || start - t > 7 * DAY || !goingIds(p).length || (!isLatLon(p.place) && !nearOf(p, members))) continue;
          if (!(await keptPods(p, members))) {
            await routedPods(p, members, crew);
            out.podsRouted++;
          }
        }
        // outdoor plans in the forecast's useful range are rechecked; alerts only within 3 days,
        // because a forecast further out changes too often to be worth a buzz
        for (const p of live) {
          const start = parseInstant(p.start);
          if (!p.place?.outdoor || !weatherSpot(p.place) || p.status === "cancelled" || start < t || start - t > 6 * DAY) continue;
          const w = await updateWeather(p.id, t);
          if (!w) continue;
          out.weatherChecked++;
          if (rainMovedIn(w.before.weather, w.after.weather) && start - t <= 3 * DAY) {
            out.rainAlerts++;
            const audience = Object.keys(p.rsvps || {});
            const sent = await notify(audience.length ? audience : (await membersOf(crew.id)).map((m) => m.id), {
              title: `Rain watch: ${p.title}`,
              body: `${w.after.weather.summary}. Bring cover or move it.`,
              url: links.plan(crew, p.id),
              tag: p.id,
            }, `${p.id}:rain:${localParts(start, p.tz).date}`);
            out.pushes += sent;
          }
        }
      } catch (e) {
        out.errors++;
        log("tick_error", { crew: crew.id, message: String(/** @type {any} */ (e).message).slice(0, 200) });
      }
    }
    try {
      out.pushes += await retryDeliveries();
    } catch (e) {
      out.errors++;
      log("tick_error", { message: `deliveries: ${String(/** @type {any} */ (e).message).slice(0, 200)}` });
    }
    // MongoDB's TTL index removes expired flyers and deliveries by itself; the file store needs a sweep
    if (store.kind !== "mongo") {
      for (const c of ["flyers", "deliveries", "podcache"]) for (const f of await store.find(c)) if (Date.parse(f.expiresAt) <= t) await store.delete(c, f.id);
    }
    log("tick", out);
    return out;
  }

  async function health() {
    return { ok: true, store: await store.ping().then((x) => (x ? store.kind : "down")).catch(() => "down"), ai: ai.available, push: push.enabled };
  }

  return {
    draftCrew, createCrew, crewTaste, getCrew, joinCrew, setMyArea, areaNear, roughArea, firstPick, kickFirstPick, searchAreas, parsePlan, addPlan, patchPlan, getPlan, getFlyer, getPods, eventIcs, feed,
    pushKey: async () => ({ publicKey: push.publicKey }), subscribePush, unsubscribePush, tick, health,
    // renaming, name ideas, photos, one-time cards and link previews (src/app/growth.mjs)
    growth,
    // exposed for tests
    _internal: { makeRitual, candidatesNear, notify, retryDeliveries, firstPickJob, picking },
  };

  function when(/** @type {Plan} */ plan) {
    const s = parseInstant(plan.start);
    const p = localParts(s, plan.tz);
    const today = localParts(now(), plan.tz).date;
    const day = p.date === today ? "today" : Math.round((zonedToMs(p.date, "00:00", plan.tz) - zonedToMs(today, "00:00", plan.tz)) / DAY) === 1 ? "tomorrow" : DAY_NAMES[p.weekday];
    const h = p.h % 12 || 12;
    return `${day} at ${h}${p.mi ? `:${String(p.mi).padStart(2, "0")}` : ""}${p.h < 12 ? "am" : "pm"}`;
  }
}

/** Where to read the weather for a place: its pin, or the neighbourhood it is near. */
/** True when a place's OpenStreetMap tags say it is a kind that is under a roof (a gallery, a museum, a cinema). */
function kindIndoor(/** @type {any} */ c) {
  const tags = c?.osm?.tags || c?.tags || {};
  return Object.values(PLACE_KINDS).some((k) => k.indoor && k.tags.some(([key, v]) => tags[key] === v));
}

function weatherSpot(place) {
  if (isLatLon(place)) return { lat: Number(place.lat), lon: Number(place.lon) };
  if (isLatLon(place?.near)) return { lat: Number(place.near.lat), lon: Number(place.near.lon) };
  return null;
}

/**
 * Neighbourhood names in an address, last first ("14 Adeyemo Close, Surulere" gives
 * "Surulere"), skipping postcodes and the parts that name the city, state or country.
 * @param {string|null|undefined} address
 * @param {RegExp} [noise]  the parts to skip: the crew's pack says which (pack.addressNoise)
 */
export function neighbourhoodsIn(address, noise = /^$/) {
  return String(address || "").split(",").slice(1).map((x) => x.trim()).filter((x) => x && !/\d/.test(x) && !noise.test(x)).reverse().slice(0, 2);
}

const normName = (/** @type {any} */ s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** A trimmed single-line string up to max characters, or null. */
function clip(v, max) {
  return typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : null;
}

/**
 * A city named in the crew's own sentence ("Muslim sisters in Abuja"), as context for its
 * area names, with its country: the visitor's country first, then any we know, so a zone
 * never hides it ("in Lagos" typed in London). Null when none is.
 * @param {string} text
 * @param {string|null} countryCode
 */
function cityIn(text, countryCode) {
  return cityNamedIn(text, countryCode);
}

/** The first http(s) link in a text, for a shared message that carries the link in the text. */
export function firstUrl(text) {
  return text?.match(/https?:\/\/[^\s<>"']+/i)?.[0]?.replace(/[).,!?]+$/, "") ?? null;
}

