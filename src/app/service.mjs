// @ts-check
// The use cases: the imperative shell around the pure core. Each function checks who is
// asking, loads what it needs through the ports (store, Gemma, geocoder, places, weather,
// link reader, push), calls the core to decide, saves, and returns what the HTTP layer
// sends. Nothing here knows about HTTP, and nothing in the core knows about this.
//
// Outside services fail; the app should not. Gemma being busy gives an empty draft to fill
// by hand, a failed geocode leaves a place without a pin, Overpass at capacity falls back to
// the curated spots, and the ritual still goes out with a plain invite written by code.

import { centroid, haversineKm, isLatLon } from "../core/geo.mjs";
import { calendarFeed, icsFileName, singleEvent } from "../core/ics.mjs";
import { placeKey, scorePlaces } from "../core/places.mjs";
import { applyEdit, canEdit, createPlan, goingIds, isExpired, recentPlaces, setRsvp, upcoming, validateDraft, viewPlan } from "../core/plans.mjs";
import { podsForPlan } from "../core/pods.mjs";
import { fallbackInvite, ritualDraft, ritualDue } from "../core/ritual.mjs";
import {
  CREW_SCHEMA, EXPLAIN_SCHEMA, INVITE_SCHEMA, MAX_TOKENS, PLAN_SCHEMA, crewSetupMessages, explainMessages, inviteMessages, planMessages,
  readCrewSetup, readExplain, readInvite, readPlan,
} from "../core/tasks.mjs";
import { DAY, DAY_NAMES, DEFAULT_TZ, hhmm, isTime, localParts, minutesOfDay, parseInstant, weekdayOf, zonedToMs } from "../core/time.mjs";
import { clipToSocial, clockWords, coveredNote, rainMovedIn, ritualWindow, weatherForPlan } from "../core/weather.mjs";
import { isSubscription } from "../adapters/push.mjs";
import { lockedMessage, lockedSite } from "../core/netguard.mjs";
import { AppError, badToken, invalid, noToken, notFound } from "./errors.mjs";
import { endpointId, safeEqual, slugify } from "./ids.mjs";

/** @typedef {import("../core/types.mjs").Crew} Crew */
/** @typedef {import("../core/types.mjs").Member} Member */
/** @typedef {import("../core/types.mjs").Plan} Plan */

/** A flyer thumbnail is kept only when it is this small (the browser sends a ~400 px copy). */
export const FLYER_MAX_BYTES = 200 * 1024;
export const LIMITS = { sentence: 500, planText: 2000, url: 2000, memberName: 40, crewName: 60, membersPerCrew: 60, areas: 8 };
/** The ritual looks for places this far from the crew's middle, then wider if it finds too few. */
export const SEARCH_RADII_M = [6000, 12000];
const SPOT_RADIUS_KM = 15;
const OUTDOOR_KINDS = ["park", "garden", "nature", "beach", "waterfront", "square", "heritage"];

/**
 * @param {object} deps
 * @param {import("../adapters/store.mjs").Store} deps.store
 * @param {import("../adapters/gemini.mjs").AiPort} deps.ai
 * @param {import("../adapters/geocode.mjs").Geocoder} deps.geocoder
 * @param {{ greenNear(at: { lat: number, lon: number }, radiusM: number): Promise<any[]> }} deps.places
 * @param {{ hourly(at: { lat: number, lon: number }, opts?: { tz?: string, days?: number }): Promise<any[]> }} deps.weather
 * @param {{ fetchPage(url: string): Promise<{ meta: any, image: any, note: string|null }> }} deps.pages
 * @param {import("../adapters/push.mjs").PushPort} deps.push
 * @param {any[]} deps.spots           curated outdoor spots (data/lagos-spots.json)
 * @param {Record<string, import("../core/tasks.mjs").Prompt>} deps.prompts
 * @param {import("./ids.mjs").Ids} deps.ids
 * @param {() => number} deps.now
 * @param {{ publicUrl: string, webUrl: string, uidDomain: string, uberLinkStyle: "looking"|"legacy" }} deps.cfg
 * @param {(event: string, fields?: Record<string, any>) => void} [deps.log]
 */
export function createService({ store, ai, geocoder, places, weather, pages, push, spots, prompts, ids, now, cfg, log = () => {} }) {
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

  const crewView = (/** @type {Crew} */ c) => ({
    id: c.id, slug: c.slug, name: c.name, vibe: c.vibe, vibeTags: c.vibeTags || [], budget: c.budget || "any",
    rhythm: c.rhythm, areas: (c.areas || []).map((a) => ({ label: a.label })), tz: c.tz || DEFAULT_TZ, inviteToken: c.inviteToken, createdAt: c.createdAt,
  });
  const memberView = (/** @type {Member} */ m) => ({ id: m.id, name: m.name, area: { label: m.area?.label ?? null } });

  function planView(/** @type {Plan} */ plan, /** @type {Crew} */ crew, /** @type {Member[]} */ members, /** @type {"member"|"guest"} */ role, /** @type {Member|null} */ me) {
    return viewPlan(plan, {
      role,
      memberId: me?.id ?? null,
      names: namesOf(members),
      eventIcsUrl: role === "member" && me ? links.eventIcs(plan.id, me) : null,
      planUrl: links.plan(crew, plan.id),
      flyerUrl: links.flyer,
    });
  }

  // ------------------------------------------------------------ places and areas

  /** Geocode an area: a label ("Yaba") or a picked { label, lat, lon }. */
  async function resolveArea(area) {
    if (area && typeof area === "object") {
      const label = clip(area.label, 60);
      if (!label) return { area: null, note: null };
      if (isLatLon(area)) return { area: { label, lat: Number(area.lat), lon: Number(area.lon) }, note: null };
      return resolveArea(label);
    }
    const label = clip(area, 60);
    if (!label) return { area: null, note: null };
    try {
      const hit = await geocoder.lookupArea(label);
      if (hit) return { area: { label, lat: hit.lat, lon: hit.lon }, note: null };
    } catch (e) {
      log("geocode_error", { message: String(/** @type {any} */ (e).message).slice(0, 120) });
    }
    return { area: { label, lat: null, lon: null }, note: `Could not find "${label}" on the map. Rides and fair picks will skip it until it is fixed.` };
  }

  /** A curated spot with this name ("FREEDOM PARK" on a flyer is Freedom Park), or null. */
  function knownSpot(name) {
    const n = normName(name);
    if (n.length < 4) return null;
    return spots.find((s) => normName(s.name) === n || normName(s.name).replace(/ (park|beach|garden)$/, "") === n) ?? null;
  }

  /**
   * Put a plan's place on the map when it has a name or an address but no pin. When the
   * exact place is not on the map, the neighbourhood named in its address ("..., Surulere")
   * is kept as `near`: good enough for ride times and the weather, never for a ride link.
   */
  async function pinPlace(place) {
    if (!place || isLatLon(place) || !(place.address || place.name) || (/'s place$/.test(place.name || "") && !place.address)) return { place, note: null };
    const { near: _old, ...bare } = place;
    const spot = !place.private && knownSpot(place.name);
    if (spot) {
      const outdoor = place.outdoor || OUTDOOR_KINDS.includes(spot.kind);
      return { place: { ...bare, name: spot.name, lat: spot.lat, lon: spot.lon, outdoor, ...(spot.osm ? { osm: spot.osm } : {}) }, note: `Pinned at ${spot.name}${outdoor && !place.outdoor ? ", an outdoor spot, so the weather is watched" : ""}.` };
    }
    try {
      const hit = await geocoder.lookup(place.address || place.name);
      if (hit) return { place: { ...bare, lat: hit.lat, lon: hit.lon }, note: `Pinned on the map at ${hit.label}${hit.detail ? `, ${hit.detail}` : ""}. Check it.` };
    } catch {}
    for (const label of neighbourhoodsIn(place.address)) {
      try {
        const hit = await geocoder.lookupArea(label);
        if (hit) return { place: { ...bare, near: { label, lat: hit.lat, lon: hit.lon } }, note: `Could not find the exact address on the map, so ride times and the weather are guessed from ${label}. Ride links will need the address.` };
      } catch {}
    }
    return { place: bare, note: "Could not pin the place on the map, so ride links will need the address." };
  }

  // ------------------------------------------------------------ crews

  /** Step 1: Gemma reads the setup sentence; areas are geocoded; nothing is saved. */
  async function draftCrew({ sentence }) {
    const s = clip(sentence, LIMITS.sentence);
    if (!s || s.length < 3) throw invalid([{ field: "sentence", message: "Describe the crew in a sentence." }]);
    const g = await gemma("parse-crew", crewSetupMessages(prompts["parse-crew"], { sentence: s }), CREW_SCHEMA);
    const r = readCrewSetup(g.data, { sentence: s });
    const notes = [...r.notes];
    if (g.error) notes.unshift(`${g.error} Fill this in yourself.`);
    const areas = [];
    for (const label of r.draft.areaLabels) {
      const { area, note } = await resolveArea(label);
      if (area) areas.push(area);
      if (note) notes.push(note);
    }
    const { areaLabels, ...rest } = r.draft;
    return { draft: { ...rest, areas }, confidence: r.confidence, low: r.low, notes, ai: !g.error };
  }

  /** Step 2: create the crew from the confirmed draft; the organiser may join at once. */
  async function createCrew({ confirm, organiser }) {
    const c = confirm && typeof confirm === "object" ? confirm : {};
    /** @type {{ field: string, message: string }[]} */
    const errors = [];
    const name = clip(c.name, LIMITS.crewName);
    if (!name) errors.push({ field: "name", message: "Give the crew a name." });
    const rhythm = checkRhythm(c.rhythm, errors);
    const areas = (Array.isArray(c.areas) ? c.areas : []).slice(0, LIMITS.areas).map((/** @type {any} */ a) => ({ label: clip(a?.label, 60), lat: isLatLon(a) ? Number(a.lat) : null, lon: isLatLon(a) ? Number(a.lon) : null })).filter((/** @type {any} */ a) => a.label);
    if (errors.length) throw invalid(errors);
    const t = now();
    const tz = DEFAULT_TZ;
    /** @type {Crew} */
    const crew = {
      id: ids.id("c"),
      slug: `${slugify(name)}-${ids.suffix()}`,
      name: /** @type {string} */ (name),
      vibe: clip(c.vibe, 80),
      vibeTags: (Array.isArray(c.vibeTags) ? c.vibeTags : []).map((/** @type {any} */ v) => clip(v, 20)?.toLowerCase()).filter(Boolean).slice(0, 8),
      budget: ["free", "cheap", "any"].includes(c.budget) ? c.budget : "any",
      rhythm: rhythm ? { ...rhythm, anchor: localParts(t, tz).date } : null,
      areas: /** @type {any} */ (areas),
      tz,
      createdAt: new Date(t).toISOString(),
      inviteToken: ids.token(),
    };
    await store.put("crews", crew);
    log("crew_created", { crew: crew.id, rhythm: !!crew.rhythm });
    const out = { crew: crewView(crew), inviteUrl: links.invite(crew), inviteToken: crew.inviteToken };
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

  /** The crew page: the crew, its members (names and area labels), upcoming plans, and who you are. */
  async function getCrew({ slug, token }) {
    const { crew, role, member } = await viewerOf(slug, token);
    const members = await membersOf(crew.id);
    const plans = upcoming(await plansOf(crew.id), now());
    return {
      crew: crewView(crew),
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
    const { area, note } = await resolveArea(body?.area);
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

  /** Area type-ahead. */
  async function searchAreas({ q }) {
    const query = clip(q, 80);
    if (!query || query.length < 2) return { results: [] };
    try {
      let rs = await geocoder.search(query, { limit: 5, areas: true });
      if (!rs.length) rs = await geocoder.search(query, { limit: 5 });
      return { results: rs.map((r) => ({ label: r.label, detail: r.detail, lat: r.lat, lon: r.lon })) };
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
    const tz = crew.tz || DEFAULT_TZ;
    const today = localParts(now(), tz).date;
    const input = { text: t, url: link, pageMeta, image: img, today, tz };
    const g = await gemma("parse-plan", planMessages(prompts["parse-plan"], input), PLAN_SCHEMA);
    if (g.error) notes.unshift(pageMeta?.event ? `${g.error} Used the page's own event details.` : `${g.error} Fill this in yourself.`);
    const r = readPlan(g.data, { ...input, member: { id: member.id, name: member.name } });
    const pinned = await pinPlace(r.draft.place);
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
    const v = validateDraft(raw, { tz: crew.tz || DEFAULT_TZ });
    if (!v.ok) throw invalid(v.errors);
    if (parseInstant(v.draft.end) < now()) throw invalid([{ field: "start", message: "That plan has already happened." }]);
    const members = await membersOf(crew.id);
    const draft = { ...v.draft, host: v.draft.host && members.some((m) => m.id === v.draft.host) ? v.draft.host : null };
    draft.place = (await pinPlace(draft.place)).place;
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
      if (changed.includes("place")) next = { ...next, place: (await pinPlace(next.place)).place };
      if (changed.includes("start") || changed.includes("place")) next = await withWeather({ ...next, weather: null });
    }
    if ("rsvp" in b) {
      if (b.rsvp !== null && b.rsvp !== "going" && b.rsvp !== "maybe") throw invalid([{ field: "rsvp", message: "rsvp must be going, maybe or null." }]);
      next = setRsvp(next, member.id, b.rsvp, now());
    }
    if (next === plan) return { plan: planView(plan, crew, members, "member", member) };
    const podsBefore = podKeys(plan, members);
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

  const computePods = (/** @type {Plan} */ plan, /** @type {Member[]} */ members) => podsForPlan(plan, riders(plan, members), { uberStyle: cfg.uberLinkStyle, near: nearOf(plan, members) });

  /** Pod memberships as keys, to tell when a new pod of two or more has formed. */
  function podKeys(plan, members) {
    if (!isLatLon(plan.place) && !nearOf(plan, members)) return new Set();
    return new Set(computePods(plan, members).pods.filter((p) => p.memberIds.length > 1).map((p) => p.memberIds.join(",")));
  }

  async function notifyNewPods(plan, crew, members, before) {
    if ((!isLatLon(plan.place) && !nearOf(plan, members)) || plan.status === "cancelled") return;
    for (const pod of computePods(plan, members).pods) {
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
    return { plan: planView(plan, crew, members, role, member), members: members.map(memberView), crew: crewView(crew), you: member ? memberView(member) : null };
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
    return computePods(plan, members);
  }

  /** The member's pod line and leave-by for a plan, for the calendar. */
  function podExtras(plan, members, memberId) {
    if (plan.rsvps?.[memberId] !== "going" || (!isLatLon(plan.place) && !nearOf(plan, members))) return {};
    const pod = computePods(plan, members).pods.find((p) => p.memberIds.includes(memberId));
    return pod?.leaveBy ? { leaveBy: pod.leaveBy, podText: pod.shareText } : {};
  }

  /** One plan as a calendar file. */
  async function eventIcs({ id, token }) {
    const { member, crew, plan } = await planFor(id, token);
    const members = await membersOf(crew.id);
    const names = namesOf(members);
    const ics = singleEvent(plan, { memberId: member.id, uidDomain: cfg.uidDomain, extras: { url: links.plan(crew, plan.id), going: goingIds(plan).map((i) => names[i]).filter(Boolean), ...podExtras(plan, members, member.id) } });
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
    return calendarFeed({
      crew, member, plans, now: now(), uidDomain: cfg.uidDomain,
      extras: (p) => ({ url: links.plan(crew, p.id), going: goingIds(p).map((i) => names[i]).filter(Boolean), ...podExtras(p, members, member.id) }),
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

  /** Candidate places near a point: live Overpass results merged with the curated spots. */
  async function candidatesNear(center) {
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
    const curated = spots
      .filter((s) => (OUTDOOR_KINDS.includes(s.kind) || s.covered === true) && haversineKm(center, s) <= SPOT_RADIUS_KM)
      .map((s) => s.covered === true ? { name: s.name, lat: s.lat, lon: s.lon, osm: s.osm || undefined, outdoor: false, covered: true } : { name: s.name, lat: s.lat, lon: s.lon, osm: s.osm || undefined, outdoor: true });
    const out = [...live];
    for (const c of curated) {
      const dup = out.some((o) => placeKey(o) === placeKey(c) || (haversineKm(o, c) < 0.3 && o.name.toLowerCase() === c.name.toLowerCase()));
      if (!dup) out.push(c);
    }
    return out;
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
    const candidates = await candidatesNear(center);
    if (!candidates.some((c) => c.covered !== true)) return { made: false, reason: "no_places" };
    const tz = crew.tz || DEFAULT_TZ;
    const span = Math.min(3, Math.max(1, (minutesOfDay(due.window.to) - minutesOfDay(due.window.from)) / 60));
    let hours = null;
    try {
      hours = await weather.hourly(center, { tz, days: 7 });
    } catch {}
    // the crew's window (inside the social hours) when it is dry; when it is wet, a dry
    // stretch that day or the next, else a covered place, else the sloth skips this one
    // (core/weather.mjs, ritualWindow)
    const rw = hours ? ritualWindow(hours, { date: due.date, from: due.window.from, to: due.window.to, hours: span }) : null;
    let win = rw?.win ?? null;
    let date = rw?.date ?? due.date;
    let window = rw ? rw.window : clipToSocial(due.date, { from: due.window.from, to: hhmm(minutesOfDay(due.window.from) + span * 60) });
    /** @type {import("../core/weather.mjs").RainPlan|null} */
    let rainPlan = rw?.rainPlan ?? null;
    const open = candidates.filter((c) => c.covered !== true);
    let pool = open;
    if (rainPlan?.kind === "skip") {
      const covered = candidates.filter((c) => c.covered === true);
      if (covered.length) {
        pool = covered;
        window = clipToSocial(due.date, due.window, { outdoor: false });
        window = { from: window.from, to: hhmm(Math.min(minutesOfDay(window.to), minutesOfDay(window.from) + span * 60)) };
        date = due.date;
        win = null;
      }
    }
    const at = zonedToMs(date, window.from, tz);
    const outdoor = pool === open;
    const scored = scorePlaces({ members: points, candidates: pool, at, tz, vibeTags: crew.vibeTags || [], budget: crew.budget || "any", outdoor, recent: recentPlaces(plans, now()), now: now() });
    if (!scored.pick || !scored.explanation) return { made: false, reason: "no_places" };
    const pick = scored.pick.candidate;
    if (rainPlan?.kind === "skip" && !outdoor) rainPlan = { ...rainPlan, kind: "covered", note: coveredNote(rainPlan, pick.name, window) };
    const skipped = rainPlan?.kind === "skip";
    const draft = ritualDraft({ date, window, place: { ...pick, address: pick.address }, tz, outdoor });

    let why = null;
    let invite;
    if (skipped) {
      // nothing to explain or invite to: the note says why, and no Gemma call is spent
      invite = /** @type {string} */ (rainPlan?.note);
    } else {
      const ex = await gemma("explain-pick", explainMessages(prompts["explain-pick"], scored.explanation), EXPLAIN_SCHEMA);
      why = readExplain(ex.data, scored.explanation).why;
      const facts = { title: draft.title, day: DAY_NAMES[weekdayOf(date)], date, time: `${clockWords(window.from)} to ${clockWords(window.to)}`, place: pick.name, weather: win?.reason.text ?? null, rain: rainPlan?.note ?? null, why, vibe: crew.vibe };
      const fallback = fallbackInvite({ title: draft.title, window, weatherText: rainPlan?.note ?? win?.reason.text ?? null });
      const inv = await gemma("write-invite", inviteMessages(prompts["write-invite"], facts), INVITE_SCHEMA);
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
    draftCrew, createCrew, getCrew, joinCrew, searchAreas, parsePlan, addPlan, patchPlan, getPlan, getFlyer, getPods, eventIcs, feed,
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
function weatherSpot(place) {
  if (isLatLon(place)) return { lat: Number(place.lat), lon: Number(place.lon) };
  if (isLatLon(place?.near)) return { lat: Number(place.near.lat), lon: Number(place.near.lon) };
  return null;
}

/** Neighbourhood names in an address, last first ("14 Adeyemo Close, Surulere" gives "Surulere"), skipping the city, state, country and postcodes. */
export function neighbourhoodsIn(address) {
  return String(address || "").split(",").slice(1).map((x) => x.trim()).filter((x) => x && !/\d/.test(x) && !/^(lagos( state)?|nigeria|la|ng)$/i.test(x)).reverse().slice(0, 2);
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

