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

import { centroid, haversineKm, isLatLon, tripKey } from "../core/geo.mjs";
import { NEAR_KM } from "../adapters/geocode.mjs";
import { cleanRegion, hintRegion, packFor, packView, regionOf } from "../packs/index.mjs";
import { calendarFeed, icsFileName, singleEvent } from "../core/ics.mjs";
import { entryFor, placeKey, scorePlaces } from "../core/places.mjs";
import { applyEdit, canEdit, createPlan, goingIds, isExpired, recentPlaces, setRsvp, upcoming, validateDraft, viewPlan } from "../core/plans.mjs";
import { podTrips, podsForPlan } from "../core/pods.mjs";
import { directionsLinks, ridesForApi } from "../core/rides.mjs";
import { fallbackInvite, ritualDraft, ritualDue } from "../core/ritual.mjs";
import {
  CREW_SCHEMA, EXPLAIN_SCHEMA, INVITE_SCHEMA, MAX_TOKENS, PLAN_SCHEMA, crewSetupMessages, explainMessages, inviteMessages, localisePrompt, planMessages,
  readCrewSetup, readExplain, readInvite, readPlan,
} from "../core/tasks.mjs";
import { HIGH_RISK, PLACE_KINDS, cleanTaste, hasSensitive, hasTaste, osmTagsFor, tasteView } from "../core/taste.mjs";
import { DAY, DAY_NAMES, hhmm, isTime, isValidZone, localParts, minutesOfDay, parseInstant, weekdayOf, zonedToMs } from "../core/time.mjs";
import { clipToSocial, clockWords, coveredNote, rainMovedIn, ritualWindow, weatherForPlan } from "../core/weather.mjs";
import { isSubscription } from "../adapters/push.mjs";
import { lockedMessage, lockedSite } from "../core/netguard.mjs";
import { AppError, badToken, invalid, noToken, notFound } from "./errors.mjs";
import { endpointId, safeEqual, slugify } from "./ids.mjs";

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
const OUTDOOR_KINDS = ["park", "garden", "nature", "beach", "waterfront", "square", "heritage"];

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
 */
export function createService({ store, ai, geocoder, places, weather, pages, push, spots, prompts, ids, now, cfg, log = () => {}, routes = null, wikidata = null }) {
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
    // the city at the centre, at city level (Nominatim), names it best; the areas' own say otherwise
    let at = null;
    if (geocoder.cityAt) {
      try {
        at = await geocoder.cityAt(center);
      } catch (e) {
        log("geocode_error", { message: String(/** @type {any} */ (e).message).slice(0, 120) });
      }
    }
    const countryCode = at?.country ?? mode(pts.map((p) => p.country)) ?? base.countryCode;
    const city = at?.city ?? mode(pts.map((p) => p.city)) ?? base.city;
    const tz = await zoneAt(center);
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

  /** One Gemma task. Returns the parsed answer, or null with the reason when Gemma is unavailable. */
  async function gemma(task, messages, schema) {
    if (!ai.available) return { data: null, model: null, error: "Gemma is not set up on this server." };
    try {
      const r = await ai.generate({ task, messages, schema, maxTokens: MAX_TOKENS[/** @type {keyof typeof MAX_TOKENS} */ (task)] });
      log("gemma", { task, model: r.model, sec: r.wallSec, json: r.jsonMode, parsed: r.data != null });
      return { data: r.data, model: r.model, error: r.data == null ? "Gemma's answer could not be read." : null };
    } catch (e) {
      const err = /** @type {any} */ (e);
      log("gemma_error", { task, status: err.status, message: String(err.message).slice(0, 160) });
      return { data: null, model: null, error: err.hint || "Gemma is busy right now." };
    }
  }

  // ------------------------------------------------------------ views

  /** The crew as the web app sees it. Its taste (what it is into and needs) only for its members. */
  const crewView = (/** @type {Crew} */ c, /** @type {"member"|"guest"} */ role = "guest") => ({
    id: c.id, slug: c.slug, name: c.name, vibe: c.vibe, vibeTags: c.vibeTags || [], budget: c.budget || "any",
    rhythm: c.rhythm, areas: (c.areas || []).map((a) => ({ label: a.label })), tz: c.tz || regionOf(c).timezone, inviteToken: c.inviteToken, createdAt: c.createdAt,
    ...regionFields(c),
    ...(role === "member" ? { taste: c.taste ?? null } : {}),
  });
  /** The crew's region and pack, as the web app sees them (for times, examples and the ride card). */
  function regionFields(/** @type {Crew} */ c) {
    const { region, pack } = placeOf(c);
    return { region: { center: region.center, countryCode: region.countryCode, city: region.city, timezone: region.timezone }, pack: packView(pack, region) };
  }
  const memberView = (/** @type {Member} */ m) => ({ id: m.id, name: m.name, area: { label: m.area?.label ?? null } });

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
    try {
      const hit = await geocoder.lookupArea(label, ctx);
      if (hit) return { area: { label, lat: hit.lat, lon: hit.lon }, note: null, country: hit.country, city: hit.city };
    } catch (e) {
      log("geocode_error", { message: String(/** @type {any} */ (e).message).slice(0, 120) });
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

  // ------------------------------------------------------------ crews

  /**
   * Step 1: Gemma reads the setup sentence; areas are geocoded; nothing is saved.
   * `hint.tz` is the visitor's own zone (the browser's): with none, or a Lagos zone, the
   * crew starts out in Lagos as every crew did; any other zone starts it anywhere, and its
   * areas decide where. The first area found anywhere fixes the centre, and the rest are
   * looked up near it, so "Westlands" after "Kilimani" is the one in Nairobi.
   */
  async function draftCrew({ sentence, into = null, hint = null }) {
    const s = clip(sentence, LIMITS.sentence);
    if (!s || s.length < 3) throw invalid([{ field: "sentence", message: "Describe the crew in a sentence." }]);
    // the optional "what you're into" line; like the sentence, it is read here and never kept
    const i = clip(into, LIMITS.into);
    const start = hintRegion(hint);
    const first = placeOf({ region: start });
    const g = await gemma("parse-crew", crewSetupMessages(promptFor("parse-crew", first.local), { sentence: s, into: i }), CREW_SCHEMA);
    const r = readCrewSetup(g.data, { sentence: s, into: i }, first.local);
    const notes = [...r.notes];
    if (g.error) notes.unshift(`${g.error} Fill this in yourself.`);
    const located = await locateAreas(r.draft.areaLabels, start, hint == null, notes);
    const region = (await regionFrom(located.found, start)) ?? start;
    const { areaLabels, ...rest } = r.draft;
    const { pack } = placeOf({ region });
    const tv = tasteView(r.draft.taste, { areas: located.areas.map((a) => a.label) });
    return { draft: { ...rest, areas: located.areas, region }, pack: packView(pack, region), taste: tv, confidence: r.confidence, low: r.low, notes, ai: !g.error };
  }

  /**
   * Geocode a new crew's area names. In Lagos (the start region is Lagos's), each is looked
   * up as it always was; when none is found there and the visitor gave no zone, they are
   * looked for anywhere, so an old client starting a Berlin crew still works.
   *
   * Anywhere else, a bare name is ambiguous ("Kilimani" is a village in Tanzania before it is
   * a Nairobi suburb; "Park Slope" is also in North Carolina), so every name gets a few
   * candidates, the ones in the visitor's country first (the country of the city in the
   * visitor's zone name, "Africa/Nairobi"), and the set that sits together wins: the first
   * name's best candidates are tried as anchors, and each other name takes its candidate
   * nearest the anchor, within 50 km.
   * @param {string[]} labels
   * @param {Region} start
   * @param {boolean} noHint
   * @param {string[]} notes
   */
  async function locateAreas(labels, start, noHint, notes) {
    const startPack = packFor(start);
    if (startPack.id !== "default") {
      const lagos = [];
      for (const label of labels) lagos.push(await resolveArea(label, startPack.geocode(start)));
      if (!(noHint && labels.length && lagos.every((g) => !isLatLon(g.area)))) return collect(lagos, notes);
    }
    return collect(await anywhere(labels, start.timezone), notes);
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
   * Area names looked up anywhere, as a set that sits together (see locateAreas).
   * @param {string[]} labels
   * @param {string} tz  the visitor's zone, for a country to prefer
   */
  async function anywhere(labels, tz) {
    const prefer = await zoneCountry(tz);
    /** @type {any[][]} */
    const lists = [];
    for (const label of labels) {
      const q = clip(label, 60) || "";
      let rs = [];
      try {
        rs = q.length >= 2 ? await geocoder.search(q, { limit: 5, areas: true }) : [];
        if (!rs.length && q.length >= 2) rs = await geocoder.search(q, { limit: 5 });
      } catch (e) {
        log("geocode_error", { message: String(/** @type {any} */ (e).message).slice(0, 120) });
      }
      lists.push(prefer ? [...rs.filter((r) => r.country === prefer), ...rs.filter((r) => r.country !== prefer)] : rs);
    }
    const firstList = lists.find((l) => l.length) || [];
    let best = { anchor: /** @type {any} */ (null), picks: /** @type {any[]} */ ([]), n: -1 };
    for (const anchor of firstList.slice(0, 3)) {
      const picks = lists.map((l) => l.filter((r) => haversineKm(anchor, r) <= NEAR_KM).sort((a, b) => haversineKm(anchor, a) - haversineKm(anchor, b))[0] ?? null);
      const n = picks.filter(Boolean).length;
      if (n > best.n) best = { anchor, picks, n };
    }
    /** @type {Awaited<ReturnType<typeof resolveArea>>[]} */
    const out = [];
    for (let i = 0; i < labels.length; i++) {
      const label = /** @type {string} */ (clip(labels[i], 60));
      const hit = best.picks[i];
      if (hit) out.push({ area: { label, lat: hit.lat, lon: hit.lon }, note: null, country: hit.country, city: hit.city });
      else if (best.anchor) out.push(await resolveArea(label, { near: best.anchor, country: best.anchor.country ?? null, cityFallback: best.anchor.city ?? null }));
      else out.push({ area: { label, lat: null, lon: null }, note: `Could not find "${label}" on the map. Rides and fair picks will skip it until it is fixed.` });
    }
    return out;
  }

  /** The country of the city a zone is named after ("Africa/Nairobi" is in KE), or null. */
  async function zoneCountry(/** @type {string} */ tz) {
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
    // a crew's name travels (WhatsApp previews, calendars, push): it never says who the crew is
    else if (hasSensitive(name, HIGH_RISK)) errors.push({ field: "name", message: "Crew names show in WhatsApp previews and calendars. Pick one that is fine for anyone to see." });
    const rhythm = checkRhythm(c.rhythm, errors);
    const areas = (Array.isArray(c.areas) ? c.areas : []).slice(0, LIMITS.areas).map((/** @type {any} */ a) => ({ label: clip(a?.label, 60), lat: isLatLon(a) ? Number(a.lat) : null, lon: isLatLon(a) ? Number(a.lon) : null })).filter((/** @type {any} */ a) => a.label);
    if (errors.length) throw invalid(errors);
    const t = now();
    const given = cleanRegion(c.region);
    const base = given ?? hintRegion(hint);
    const located = areas.filter(isLatLon).map((/** @type {any} */ a) => ({ lat: a.lat, lon: a.lon }));
    const moved = located.length && (!base.center || haversineKm(base.center, /** @type {any} */ (centroid(located))) > 1);
    /** @type {Region} */
    const region = moved && (given || base.tzSource !== "legacy") ? (await regionFrom(located, base)) ?? base : base;
    const tz = region.timezone;
    /** @type {Crew} */
    const crew = {
      id: ids.id("c"),
      slug: `${slugify(name)}-${ids.suffix()}`,
      name: /** @type {string} */ (name),
      vibe: hasSensitive(c.vibe) ? null : clip(c.vibe, 80),
      vibeTags: (Array.isArray(c.vibeTags) ? c.vibeTags : []).map((/** @type {any} */ v) => clip(v, 20)?.toLowerCase()).filter(Boolean).slice(0, 8),
      budget: ["free", "cheap", "any"].includes(c.budget) ? c.budget : "any",
      // the edited chips, checked again: vocabularies, limits, and no word for who anyone is
      taste: cleanTaste(c.taste),
      rhythm: rhythm ? { ...rhythm, anchor: localParts(t, tz).date } : null,
      areas: /** @type {any} */ (areas),
      tz,
      region,
      createdAt: new Date(t).toISOString(),
      inviteToken: ids.token(),
    };
    await store.put("crews", crew);
    log("crew_created", { crew: crew.id, rhythm: !!crew.rhythm, pack: packFor(region).id, country: region.countryCode, tzSource: region.tzSource, taste: hasTaste(crew.taste) });
    const out = { crew: crewView(crew, "member"), inviteUrl: links.invite(crew), inviteToken: crew.inviteToken };
    if (organiser && typeof organiser === "object" && clip(organiser.name, LIMITS.memberName)) {
      const joined = await addMember(crew, organiser);
      return { ...out, ...joined };
    }
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
      await store.put("crews", { ...crew, taste });
      log("crew_taste", { crew: crew.id, taste: hasTaste(taste) });
      return { taste, ...tasteView(taste, { areas: labels }), saved: true };
    }
    const s = clip(b.sentence, LIMITS.into);
    if (!s || s.length < 3) throw invalid([{ field: "sentence", message: "Tell the sloth what the crew is into." }]);
    const { local } = placeOf(crew);
    const g = await gemma("parse-crew", crewSetupMessages(promptFor("parse-crew", local), { sentence: "(the crew is already set up)", into: s }), CREW_SCHEMA);
    const r = readCrewSetup(g.data, { sentence: "", into: s }, local);
    const taste = r.draft.taste;
    return { taste, ...tasteView(taste, { areas: labels }), saved: false, ai: !g.error, notes: g.error ? [`${g.error} Pick the chips yourself.`] : [] };
  }

  /** The crew page: the crew, its members (names and area labels), upcoming plans, and who you are. */
  async function getCrew({ slug, token }) {
    const { crew, role, member } = await viewerOf(slug, token);
    const members = await membersOf(crew.id);
    const plans = upcoming(await plansOf(crew.id), now());
    return {
      crew: crewView(crew, role),
      members: members.map(memberView),
      plans: plans.map((p) => planView(p, crew, members, role, member)),
      you: member ? { id: member.id, name: member.name, area: { label: member.area?.label ?? null } } : null,
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
    const { area, note, country, city } = !where.region.center && typeof body?.area === "string" && where.pack.id === "default"
      ? (await anywhere([body.area], where.region.timezone))[0]
      : await resolveArea(body?.area, where.geo);
    // a crew whose region has no centre yet (no area was found at setup) takes it from its
    // first member on the map
    if (area && isLatLon(area) && !where.region.center && crew.region) {
      const region = await regionFrom([{ lat: /** @type {number} */ (area.lat), lon: /** @type {number} */ (area.lon), country, city }], where.region);
      if (region) {
        crew.region = region;
        crew.tz = region.timezone;
        await store.put("crews", crew);
      }
    }
    /** @type {Member} */
    const member = { id: ids.id("m"), crewId: crew.id, name, area: /** @type {any} */ (area), token: ids.token(), calToken: ids.token(), joinedAt: new Date(now()).toISOString() };
    await store.put("members", member);
    log("member_joined", { crew: crew.id, member: member.id, located: isLatLon(area) });
    return { member: memberView(member), memberToken: member.token, memberUrl: links.member(crew, member), calendarUrl: links.calendar(member), webcalUrl: links.webcal(member), notes: note ? [note] : [] };
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

  /** Set your own area: a typed or picked area, or `near` (a rounded point) for the rough location. */
  async function setMyArea({ memberId, token, body }) {
    const { member, crew } = await memberOf(token);
    if (member.id !== memberId) throw badToken();
    const where = placeOf(crew);
    const input = body?.near ? await areaNear(body.near, where.geo) : body?.area;
    const { area, note } = await resolveArea(input, where.geo);
    if (!area) throw invalid([{ field: "area", message: "Add the area you're coming from." }]);
    const next = { ...member, area: /** @type {any} */ (area) };
    await store.put("members", next);
    log("member_area", { crew: crew.id, member: member.id, located: isLatLon(area), rough: !!body?.near });
    return { you: memberView(next), notes: note ? [note] : [] };
  }

  /**
   * The sloth's first pick, right after a crew with a regular day is made, so the invite has
   * something to come to. It is the ritual for the next slot of the rhythm, made now instead
   * of two or three days before; the heartbeat then finds it and leaves it be. Asking again
   * returns the same plan.
   */
  async function firstPick({ slug, token }) {
    const { crew, role, member } = await viewerOf(slug, token);
    if (!crew.rhythm) return { plan: null, reason: "no_rhythm" };
    const plans = (await plansOf(crew.id)).filter((p) => !isExpired(p, now()));
    const members = await membersOf(crew.id);
    const view = (/** @type {Plan} */ p) => planView(p, crew, members, role, member);
    const mine = plans.find((p) => p.kind === "ritual");
    if (mine) return { plan: view(mine), reason: "exists" };
    const due = ritualDue({ crew, now: now(), plans, lead: { min: 1, max: 31 } });
    if (!due.due) return { plan: null, reason: due.reason };
    const r = await makeRitual(crew, due, plans);
    if (!r.made || !r.plan) {
      const again = (await plansOf(crew.id)).find((p) => p.kind === "ritual");
      return { plan: again ? view(again) : null, reason: r.reason || "not_made" };
    }
    return { plan: view(r.plan), reason: "made" };
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
    let pageMeta = null;
    let img = image ? { mimeType: image.mimeType, data: image.data.toString("base64") } : null;
    if (link) {
      try {
        const page = await pages.fetchPage(link);
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
    const g = await gemma("parse-plan", planMessages(promptFor("parse-plan", where.local), input), PLAN_SCHEMA);
    if (g.error) notes.unshift(pageMeta?.event ? `${g.error} Used the page's own event details.` : `${g.error} Fill this in yourself.`);
    const r = readPlan(g.data, { ...input, member: { id: member.id, name: member.name }, local: where.local });
    const pinned = await pinPlace(r.draft.place, where);
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
    return { draft: { ...r.draft, place: pinned.place, source }, confidence: r.confidence, low: r.low, notes: [...notes, ...r.notes], ai: !g.error, model: g.model };
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
    const members = await membersOf(crew.id);
    const draft = { ...v.draft, host: v.draft.host && members.some((m) => m.id === v.draft.host) ? v.draft.host : null };
    draft.place = (await pinPlace(draft.place, placeOf(crew))).place;
    if (draft.source.flyerId) {
      const flyer = await store.get("flyers", draft.source.flyerId);
      if (flyer && flyer.crewId === crew.id) delete draft.source.imageUrl;
      else delete draft.source.flyerId;
    }
    let plan = createPlan(draft, { id: ids.id("p"), crewId: crew.id, createdBy: member.id, now: now() });
    plan = await withWeather(plan);
    if (plan.source.flyerId) {
      const flyer = await store.get("flyers", plan.source.flyerId);
      await store.put("flyers", { ...flyer, planId: plan.id, expiresAt: plan.expiresAt });
    }
    await store.put("plans", plan);
    log("plan_created", { crew: crew.id, plan: plan.id, kind: plan.kind });
    await notify(members.filter((m) => m.id !== member.id).map((m) => m.id), {
      title: `New plan: ${plan.title}`,
      body: `${member.name} added ${when(plan)}. Tap if you're coming.`,
      url: links.plan(crew, plan.id),
      tag: plan.id,
    }, `${plan.id}:new`);
    return { plan: planView(plan, crew, members, "member", member) };
  }

  /** RSVP and edits. */
  async function patchPlan({ id, token, body }) {
    const { member, crew, plan } = await planFor(id, token);
    const b = body && typeof body === "object" ? body : {};
    const members = await membersOf(crew.id);
    let next = plan;
    /** @type {string[]} */
    let changed = [];
    const { rsvp, ...edits } = b;
    if (Object.keys(edits).length) {
      if (!canEdit(plan, member.id)) throw new AppError(403, "not_yours", "Only the person who added this plan or its host can change it.");
      const r = applyEdit(plan, edits, { now: now() });
      if (!r.ok) throw invalid(r.errors);
      next = r.plan;
      changed = r.changed;
      if (changed.includes("place")) next = { ...next, place: (await pinPlace(next.place, placeOf(crew))).place };
      if (changed.includes("start") || changed.includes("place")) next = await withWeather({ ...next, weather: null });
    }
    if ("rsvp" in b) {
      if (b.rsvp !== null && b.rsvp !== "going" && b.rsvp !== "maybe") throw invalid([{ field: "rsvp", message: "rsvp must be going, maybe or null." }]);
      next = setRsvp(next, member.id, b.rsvp, now());
    }
    if (next === plan) return { plan: planView(plan, crew, members, "member", member) };
    const podsBefore = podKeys(plan, members, crew);
    await store.put("plans", next);
    const audience = Object.keys(next.rsvps).filter((m) => m !== member.id);
    if (changed.includes("status") && next.status === "cancelled") {
      await notify(audience, { title: `Cancelled: ${next.title}`, body: `${member.name} called it off.`, url: links.plan(crew, next.id), tag: next.id }, `${next.id}:cancelled:${next.seq}`);
    } else if (changed.some((f) => ["start", "end", "place"].includes(f))) {
      await notify(audience, { title: `Changed: ${next.title}`, body: `Now ${when(next)}${next.place.name ? ` at ${next.place.name}` : ""}.`, url: links.plan(crew, next.id), tag: next.id }, `${next.id}:changed:${next.seq}`);
    }
    if ("rsvp" in b) await notifyNewPods(next, crew, members, podsBefore);
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
      for (const t of podTrips(plan, going, { near, model })) {
        const r = await routes.route(t.from, t.to).catch(() => null);
        if (r) found.set(tripKey(t.from, t.to), r);
      }
    }
    return podsForPlan(plan, going, { near, model, route: (a, b) => found.get(tripKey(a, b)) ?? null });
  }

  /** Pod memberships as keys, to tell when a new pod of two or more has formed. */
  function podKeys(plan, members, crew) {
    if (!isLatLon(plan.place) && !nearOf(plan, members)) return new Set();
    return new Set(podGroups(plan, members, crew).pods.filter((p) => p.memberIds.length > 1).map((p) => p.memberIds.join(",")));
  }

  async function notifyNewPods(plan, crew, members, before) {
    if ((!isLatLon(plan.place) && !nearOf(plan, members)) || plan.status === "cancelled") return;
    for (const pod of (await computePods(plan, members, crew)).pods) {
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
    return { ...(await computePods(plan, members, crew)), rides: ridesForApi(pack.rides), directions: directionsLinks(plan.place) };
  }

  /** The member's pod line and leave-by for a plan, for the calendar. */
  async function podExtras(plan, members, memberId, crew) {
    if (plan.rsvps?.[memberId] !== "going" || (!isLatLon(plan.place) && !nearOf(plan, members))) return {};
    const pod = (await computePods(plan, members, crew)).pods.find((p) => p.memberIds.includes(memberId));
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
    return calendarFeed({
      crew, member, plans, now: now(), uidDomain: cfg.uidDomain, zoneNames: placeOf(crew).pack.zoneNames,
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
   * Send a push message to members, once per dedupe key (a retried heartbeat or a repeated
   * edit does not buzz anyone twice). Subscriptions the browser dropped are deleted.
   * @returns {Promise<number>} messages sent
   */
  async function notify(memberIds, msg, dedupeKey) {
    if (!push.enabled || !memberIds.length) return 0;
    let sent = 0;
    for (const memberId of [...new Set(memberIds)]) {
      const key = `${dedupeKey}:${memberId}`;
      if (await store.get("sent", key)) continue;
      const subs = await store.find("push", { memberId });
      if (!subs.length) continue;
      await store.put("sent", { id: key, expiresAt: new Date(now() + 14 * DAY).toISOString() });
      for (const s of subs) {
        const r = await push.send({ endpoint: s.endpoint, keys: s.keys }, msg);
        if (r.ok) sent++;
        if (r.gone) await store.delete("push", s.id);
      }
    }
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
   * @param {{ lat: number, lon: number }} center
   * @param {CityPack} [pack]
   * @param {import("../core/taste.mjs").Taste|null} [taste]
   */
  async function candidatesNear(center, pack = placeOf({}).pack, taste = null) {
    const fromWikidata = pack.wikidataSpots && wikidata
      ? wikidata.spotsNear(center, SEARCH_RADII_M[0] / 1000).catch((e) => {
        log("wikidata_error", { message: String(/** @type {any} */ (e).message).slice(0, 120) });
        return /** @type {any[]} */ ([]);
      })
      : Promise.resolve(/** @type {any[]} */ ([]));
    /** @type {any[]} */
    let live = [];
    for (const r of SEARCH_RADII_M) {
      try {
        live = await places.greenNear(center, r);
      } catch (e) {
        // Overpass is down or at capacity: a wider search would only wait again, and the
        // heartbeat has to answer within 100 s. The curated spots carry this one.
        log("overpass_error", { message: String(/** @type {any} */ (e).message).slice(0, 120) });
        live = [];
        break;
      }
      if (live.length >= 3) break;
    }
    // outdoor spots, plus any spot a source says has a roof (offered only when it rains)
    const curated = (pack.curated ? spots : [])
      .filter((s) => (OUTDOOR_KINDS.includes(s.kind) || s.covered === true) && haversineKm(center, s) <= SPOT_RADIUS_KM)
      .map((s) => ({ name: s.name, lat: s.lat, lon: s.lon, osm: s.osm || undefined, ...(s.covered === true ? { outdoor: false, covered: true } : { outdoor: true }), ...(s.entry ? { entry: s.entry } : {}) }));
    const out = [...live, ...(await tastePlaces(center, taste))];
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
  async function makeRitual(crew, due, plans) {
    const members = await membersOf(crew.id);
    const points = crewPoints(crew, members);
    const center = centroid(points.map((p) => p.area));
    if (!center) return { made: false, reason: "no_location" };
    const { pack, local } = placeOf(crew);
    const taste = crew.taste ?? null;
    const candidates = await candidatesNear(center, pack, taste);
    if (!candidates.some((c) => c.covered !== true)) return { made: false, reason: "no_places" };
    const tz = crew.tz || regionOf(crew).timezone;
    const span = Math.min(3, Math.max(1, (minutesOfDay(due.window.to) - minutesOfDay(due.window.from)) / 60));
    let hours = null;
    try {
      hours = await weather.hourly(center, { tz, days: 7 });
    } catch {}
    // the crew's window (inside the social hours) when it is dry; when it is wet, a dry
    // stretch that day or the next, else a covered place, else the sloth skips this one
    // (core/weather.mjs, ritualWindow)
    const rw = hours ? ritualWindow(hours, { date: due.date, from: due.window.from, to: due.window.to, hours: span }, pack.social) : null;
    let win = rw?.win ?? null;
    let date = rw?.date ?? due.date;
    let window = rw ? rw.window : clipToSocial(due.date, { from: due.window.from, to: hhmm(minutesOfDay(due.window.from) + span * 60) }, { social: pack.social });
    /** @type {import("../core/weather.mjs").RainPlan|null} */
    let rainPlan = rw?.rainPlan ?? null;
    const open = candidates.filter((c) => c.covered !== true);
    let pool = open;
    if (rainPlan?.kind === "skip") {
      // a source says it has a roof: a curated covered spot, or a gallery, museum or the like
      // the crew is into (OpenStreetMap's tag says what it is)
      const covered = candidates.filter((c) => c.covered === true || (c.indoor === true && kindIndoor(c)));
      if (covered.length) {
        pool = covered;
        window = clipToSocial(due.date, due.window, { outdoor: false, social: pack.social });
        window = { from: window.from, to: hhmm(Math.min(minutesOfDay(window.to), minutesOfDay(window.from) + span * 60)) };
        date = due.date;
        win = null;
      }
    }
    const at = zonedToMs(date, window.from, tz);
    let outdoor = pool === open;
    // the fairest few by straight line go to OSRM (its table takes 100 points at most)
    if (pool.length > 40) pool = scorePlaces({ members: points, candidates: pool, at, tz, vibeTags: crew.vibeTags || [], budget: crew.budget || "any", outdoor, recent: recentPlaces(plans, now()), now: now(), model: pack.travel, taste }).ranked.slice(0, 40).map((r) => r.candidate);
    // road distances from every member's area to every candidate, in one OSRM table request
    /** @type {Map<string, any>} */
    const roads = new Map();
    const located = points.filter((p) => isLatLon(p.area));
    if (routes && located.length) {
      const t = await routes.table(located.map((p) => p.area), pool).catch(() => null);
      if (t) located.forEach((p, i) => pool.forEach((c, j) => {
        const km = t.km[i]?.[j];
        const min = t.min[i]?.[j];
        if (km != null && min != null) roads.set(tripKey(p.area, c), { km, min });
      }));
    }
    const scored = scorePlaces({ members: points, candidates: pool, at, tz, vibeTags: crew.vibeTags || [], budget: crew.budget || "any", outdoor, recent: recentPlaces(plans, now()), now: now(), route: (a, b) => roads.get(tripKey(a, b)) ?? null, model: pack.travel, taste });
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
      const ex = await gemma("explain-pick", explainMessages(promptFor("explain-pick", local), scored.explanation), EXPLAIN_SCHEMA);
      why = readExplain(ex.data, scored.explanation).why;
      const facts = { title: draft.title, day: DAY_NAMES[weekdayOf(date)], date, time: `${clockWords(window.from)} to ${clockWords(window.to)}`, place: pick.name, weather: win?.reason.text ?? null, rain: rainPlan?.note ?? null, why: crew.taste?.needs?.length ? null : why, vibe: crew.vibe };
      // the invite travels (calendar, push, the plain page): with needs, the explanation stays in the app
      const fallback = fallbackInvite({ title: draft.title, window, weatherText: rainPlan?.note ?? win?.reason.text ?? null });
      const inv = await gemma("write-invite", inviteMessages(promptFor("write-invite", local), facts), INVITE_SCHEMA);
      invite = readInvite(inv.data, facts, fallback).invite;
    }

    const v = validateDraft(draft, { tz });
    if (!v.ok) return { made: false, reason: "invalid_draft" };
    let plan = createPlan(v.draft, { id: `p_r_${crew.id.replace(/^c_/, "")}_${due.date.replace(/-/g, "")}`, crewId: crew.id, createdBy: "sloth", now: now(), why, invite, ritualFor: due.date });
    if (hours && outdoor) {
      const w = weatherForPlan(hours, plan, now());
      if (w) plan = { ...plan, weather: w };
    }
    if (rainPlan) plan = { ...plan, rainPlan };
    if (skipped) plan = { ...plan, status: "cancelled" };
    // the last check before writing: another heartbeat may have made it meanwhile
    if (await store.get("plans", plan.id)) return { made: false, reason: "exists" };
    await store.put("plans", plan);
    log("ritual_made", { crew: crew.id, plan: plan.id, place: placeKey(pick), candidates: candidates.length, weather: !!hours, rain: rainPlan?.kind ?? null });
    await notify(members.map((m) => m.id), { title: skipped ? `The sloth is skipping ${DAY_NAMES[weekdayOf(date)]}` : plan.title, body: invite.slice(0, 180), url: links.plan(crew, plan.id), tag: plan.id }, `${plan.id}:new`);
    return { made: true, plan };
  }

  /**
   * The heartbeat: make due rituals, recheck the weather on outdoor plans in the coming
   * days (alerting within three), and delete expired plans. Safe to run late, twice or
   * concurrently.
   */
  async function tick() {
    const t = now();
    const out = { rituals: 0, weatherChecked: 0, rainAlerts: 0, pushes: 0, expired: 0, errors: 0 };
    const crews = /** @type {Crew[]} */ (await store.find("crews"));
    for (const crew of crews) {
      try {
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
        // outdoor plans in the forecast's useful range are rechecked; alerts only within 3 days,
        // because a forecast further out changes too often to be worth a buzz
        for (const p of live) {
          const start = parseInstant(p.start);
          if (!p.place?.outdoor || !weatherSpot(p.place) || p.status === "cancelled" || start < t || start - t > 6 * DAY) continue;
          const fresh = await withWeather({ ...p, weather: null });
          if (!fresh.weather) continue;
          out.weatherChecked++;
          const flipped = !!p.weather && p.weather.ok !== fresh.weather.ok;
          const next = { ...p, weather: fresh.weather, ...(flipped || !p.weather ? { seq: (p.seq || 0) + 1, updatedAt: new Date(t).toISOString() } : {}) };
          await store.put("plans", next);
          if (rainMovedIn(p.weather, fresh.weather) && start - t <= 3 * DAY) {
            out.rainAlerts++;
            const audience = Object.keys(p.rsvps || {});
            const sent = await notify(audience.length ? audience : (await membersOf(crew.id)).map((m) => m.id), {
              title: `Rain watch: ${p.title}`,
              body: `${fresh.weather.summary}. Bring cover or move it.`,
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
    // MongoDB's TTL index removes expired flyers by itself; the file store needs a sweep
    if (store.kind !== "mongo") {
      for (const f of await store.find("flyers")) if (Date.parse(f.expiresAt) <= t) await store.delete("flyers", f.id);
    }
    log("tick", out);
    return out;
  }

  async function health() {
    return { ok: true, store: await store.ping().then((x) => (x ? store.kind : "down")).catch(() => "down"), ai: ai.available, push: push.enabled };
  }

  return {
    draftCrew, createCrew, crewTaste, getCrew, joinCrew, setMyArea, areaNear, firstPick, searchAreas, parsePlan, addPlan, patchPlan, getPlan, getFlyer, getPods, eventIcs, feed,
    pushKey: async () => ({ publicKey: push.publicKey }), subscribePush, unsubscribePush, tick, health,
    // exposed for tests
    _internal: { makeRitual, candidatesNear, notify },
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

/** The first http(s) link in a text, for a shared message that carries the link in the text. */
export function firstUrl(text) {
  return text?.match(/https?:\/\/[^\s<>"']+/i)?.[0]?.replace(/[).,!?]+$/, "") ?? null;
}

