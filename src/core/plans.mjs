// @ts-check
// Plans: validating and normalising drafts, creating, editing, RSVPs, expiry and who may
// see what. Pure: ids and the clock come in as arguments, and every function returns a new
// object instead of changing its input.
//
// Visibility rule: a hosted place marked private (someone's home) shows its address and
// coordinates only to members of the crew. A guest (someone holding only the invite link)
// sees "a member's place" and nothing that could locate it, including the source text.

import { isLatLon } from "./geo.mjs";
import { placeKey } from "./places.mjs";
import { DAY, HOUR, DEFAULT_TZ, isValidZone, parseInstant, toIsoLocal } from "./time.mjs";

/** @typedef {import("./types.mjs").Plan} Plan */
/** @typedef {import("./types.mjs").Rsvp} Rsvp */
/** @typedef {{ field: string, message: string }} FieldError */

export const KINDS = /** @type {const} */ (["found", "hosted", "ritual", "quick"]);
export const STATUSES = /** @type {const} */ (["on", "moved", "cancelled"]);
export const EXPIRY_DAYS = 30;
/** How long a plan lasts when nobody said, by kind (hours). */
export const DEFAULT_HOURS = { found: 3, hosted: 4, ritual: 3, quick: 2 };
export const LIMITS = { title: 120, placeName: 120, address: 200, priceText: 60, bringItems: 10, bringItem: 60, hostName: 60, sourceText: 2000, url: 2000, maxDays: 7 };
/** Fields below this confidence are highlighted on the confirm screen. */
export const LOW_CONFIDENCE = 0.6;

const str = (/** @type {any} */ v, /** @type {number} */ max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) || null : null);
const isHttpUrl = (/** @type {any} */ u) => {
  if (typeof u !== "string" || u.length > LIMITS.url) return false;
  try {
    const x = new URL(u);
    return x.protocol === "https:" || x.protocol === "http:";
  } catch {
    return false;
  }
};

/**
 * Validate and normalise a plan draft (from the parse step, edited by a person).
 * @param {any} draft
 * @param {{ tz?: string }} [opts]
 * @returns {{ ok: boolean, draft: any, errors: FieldError[], filled: string[] }}
 *   filled lists the fields set by a default (for example an end time nobody gave)
 */
export function validateDraft(draft, { tz = DEFAULT_TZ } = {}) {
  /** @type {FieldError[]} */
  const errors = [];
  /** @type {string[]} */
  const filled = [];
  const d = draft && typeof draft === "object" ? draft : {};
  const zone = typeof d.tz === "string" && isValidZone(d.tz) ? d.tz : tz;

  const source = {};
  if (d.source?.url != null) {
    if (isHttpUrl(d.source.url)) source.url = d.source.url;
    else errors.push({ field: "source.url", message: "The link must start with http:// or https://." });
  }
  if (typeof d.source?.text === "string" && d.source.text.trim()) source.text = d.source.text.trim().slice(0, LIMITS.sourceText);
  if (d.source?.image === true) source.image = true;
  // a flyer thumbnail: an unguessable id from the parse step, or the page's own https image
  if (typeof d.source?.flyerId === "string" && /^f_[A-Za-z0-9_-]{20,64}$/.test(d.source.flyerId)) source.flyerId = d.source.flyerId;
  if (typeof d.source?.imageUrl === "string" && /^https:\/\//.test(d.source.imageUrl) && d.source.imageUrl.length <= LIMITS.url) source.imageUrl = d.source.imageUrl;

  let kind = d.kind;
  if (kind == null) {
    kind = d.host || d.hostName ? "hosted" : source.url || source.image ? "found" : "quick";
    filled.push("kind");
  } else if (!KINDS.includes(kind)) errors.push({ field: "kind", message: `kind must be one of ${KINDS.join(", ")}.` });

  const title = str(d.title, LIMITS.title);
  if (!title) errors.push({ field: "title", message: "Give the plan a name." });

  const start = parseInstant(d.start);
  if (!Number.isFinite(start)) errors.push({ field: "start", message: "When does it start? A date and time are needed." });
  let end = parseInstant(d.end);
  if (Number.isFinite(start)) {
    if (!Number.isFinite(end) || end <= start) {
      if (d.end != null && Number.isFinite(end)) errors.push({ field: "end", message: "It has to end after it starts." });
      else {
        end = start + (DEFAULT_HOURS[/** @type {keyof typeof DEFAULT_HOURS} */ (kind)] ?? 3) * HOUR;
        filled.push("end");
      }
    } else if (end - start > LIMITS.maxDays * DAY) errors.push({ field: "end", message: "A plan can last at most a week." });
  }

  const p = d.place && typeof d.place === "object" ? d.place : {};
  const hasLat = p.lat != null || p.lon != null;
  const coords = { lat: Number(p.lat), lon: Number(p.lon) };
  if (hasLat && !isLatLon(coords)) errors.push({ field: "place", message: "The place's map position is not valid." });
  const place = {
    name: str(p.name, LIMITS.placeName),
    address: str(p.address, LIMITS.address),
    lat: hasLat && isLatLon(coords) ? coords.lat : null,
    lon: hasLat && isLatLon(coords) ? coords.lon : null,
    outdoor: p.outdoor === true,
    private: typeof p.private === "boolean" ? p.private : kind === "hosted",
  };
  if (typeof p.private !== "boolean") filled.push("place.private");
  // where an unpinned place roughly is (its neighbourhood), for ride times and weather only
  if (place.lat == null && p.near && typeof p.near === "object" && isLatLon(p.near) && str(p.near.label, 60)) {
    /** @type {any} */ (place).near = { label: str(p.near.label, 60), lat: Number(p.near.lat), lon: Number(p.near.lon) };
  }
  if (p.osm && ["node", "way", "relation"].includes(p.osm.type) && Number.isFinite(p.osm.id)) {
    place.osm = { type: p.osm.type, id: p.osm.id, tags: Object.fromEntries(Object.entries(p.osm.tags || {}).filter(([k, v]) => typeof k === "string" && typeof v === "string").slice(0, 40)) };
  }

  let price = null;
  if (d.price && typeof d.price === "object") {
    const text = str(d.price.text, LIMITS.priceText);
    const free = d.price.free === true;
    if (text || free) price = { text: text || "Free", free };
  }

  const bring = Array.isArray(d.bring) ? d.bring.map((/** @type {any} */ b) => str(b, LIMITS.bringItem)).filter(Boolean).slice(0, LIMITS.bringItems) : [];

  const out = {
    kind,
    title,
    start: Number.isFinite(start) ? toIsoLocal(start, zone) : null,
    end: Number.isFinite(end) ? toIsoLocal(end, zone) : null,
    tz: zone,
    place,
    price,
    host: typeof d.host === "string" && d.host ? d.host : null,
    hostName: str(d.hostName, LIMITS.hostName),
    bring,
    source,
    confidence: cleanConfidence(d.confidence),
  };
  return { ok: errors.length === 0, draft: out, errors, filled };
}

/** Confidence values clamped to 0..1, non-numbers dropped. */
export function cleanConfidence(c) {
  /** @type {Record<string, number>} */
  const out = {};
  if (!c || typeof c !== "object") return out;
  for (const [k, v] of Object.entries(c)) if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.min(1, Math.max(0, Math.round(v * 100) / 100));
  return out;
}

/** The fields to highlight: below LOW_CONFIDENCE, or filled by a default. */
export function lowFields(confidence = {}, filled = []) {
  return [...new Set([...Object.entries(confidence).filter(([, v]) => v < LOW_CONFIDENCE).map(([k]) => k), ...filled])].sort();
}

/** When a plan that ends at `end` stops existing. */
export const expiresAtFor = (/** @type {string} */ end) => new Date(parseInstant(end) + EXPIRY_DAYS * DAY).toISOString();

/** True once a plan is past its expiry. */
export const isExpired = (/** @type {Plan} */ plan, /** @type {number} */ now) => Date.parse(plan.expiresAt) <= now;

/**
 * A new plan from a validated draft. The creator is marked going (a member who shares a
 * plan is usually going); the ritual's creator is "sloth" and marks nobody.
 * @param {any} draft  validateDraft(...).draft
 * @param {{ id: string, crewId: string, createdBy: string, now: number, why?: string|null, invite?: string|null, ritualFor?: string }} meta
 * @returns {Plan}
 */
export function createPlan(draft, { id, crewId, createdBy, now, why = null, invite = null, ritualFor }) {
  const at = new Date(now).toISOString();
  /** @type {Plan} */
  const plan = {
    id,
    crewId,
    kind: draft.kind,
    title: draft.title,
    start: draft.start,
    end: draft.end,
    tz: draft.tz,
    place: draft.place,
    price: draft.price,
    host: draft.host,
    hostName: draft.hostName ?? null,
    bring: draft.bring,
    source: draft.source,
    why,
    invite,
    weather: null,
    status: "on",
    confidence: draft.confidence || {},
    rsvps: createdBy === "sloth" ? {} : { [createdBy]: "going" },
    createdBy,
    createdAt: at,
    updatedAt: at,
    seq: 0,
    expiresAt: expiresAtFor(draft.end),
  };
  if (ritualFor) plan.ritualFor = ritualFor;
  return plan;
}

export const EDITABLE = ["title", "start", "end", "place", "price", "bring", "status"];

/** Members may edit a plan they created or host; anyone may edit the ritual's plans. */
export const canEdit = (/** @type {Plan} */ plan, /** @type {string} */ memberId) => plan.createdBy === memberId || plan.host === memberId || plan.createdBy === "sloth";

/**
 * Apply edits. Every real change bumps seq (the calendar SEQUENCE) and updatedAt; a new
 * time or place on a live plan marks it "moved".
 * @param {Plan} plan
 * @param {Record<string, any>} patch
 * @param {{ now: number }} opts
 * @returns {{ ok: boolean, plan: Plan, errors: FieldError[], changed: string[] }}
 */
export function applyEdit(plan, patch, { now }) {
  const unknown = Object.keys(patch).filter((k) => !EDITABLE.includes(k));
  if (unknown.length) return { ok: false, plan, errors: unknown.map((f) => ({ field: f, message: `${f} cannot be edited.` })), changed: [] };
  if (patch.status != null && !STATUSES.includes(patch.status)) return { ok: false, plan, errors: [{ field: "status", message: `status must be one of ${STATUSES.join(", ")}.` }], changed: [] };
  // an edit to the start without an end keeps the plan's length
  // a new place drops the old OpenStreetMap link unless the edit brings its own
  const merged = { ...plan, ...patch, place: patch.place ? { ...plan.place, osm: undefined, ...patch.place } : plan.place };
  if (patch.start && !patch.end) {
    const len = parseInstant(plan.end) - parseInstant(plan.start);
    const s = parseInstant(patch.start);
    if (Number.isFinite(s)) merged.end = toIsoLocal(s + len, plan.tz);
  }
  const v = validateDraft(merged, { tz: plan.tz });
  if (!v.ok) return { ok: false, plan, errors: v.errors, changed: [] };
  const next = { ...plan, title: v.draft.title, start: v.draft.start, end: v.draft.end, place: v.draft.place, price: v.draft.price, bring: v.draft.bring, status: patch.status ?? plan.status };
  const changed = ["title", "start", "end", "place", "price", "bring", "status"].filter((k) => JSON.stringify(/** @type {any} */ (next)[k]) !== JSON.stringify(/** @type {any} */ (plan)[k]));
  if (!changed.length) return { ok: true, plan, errors: [], changed };
  if (plan.status === "on" && patch.status == null && (changed.includes("start") || changed.includes("place"))) next.status = "moved";
  if (next.status !== plan.status && !changed.includes("status")) changed.push("status");
  // a person's edit replaces the model's guess, so those fields are now certain
  const confidence = { ...plan.confidence };
  for (const k of changed) if (k in confidence) confidence[k] = 1;
  return { ok: true, plan: { ...next, confidence, seq: (plan.seq || 0) + 1, updatedAt: new Date(now).toISOString(), expiresAt: expiresAtFor(next.end) }, errors: [], changed };
}

/**
 * Set or clear one member's RSVP. Bumps seq when it changes (it changes that member's
 * calendar entry).
 * @param {Plan} plan
 * @param {string} memberId
 * @param {Rsvp|null} value
 * @param {number} now
 */
export function setRsvp(plan, memberId, value, now) {
  if (value != null && value !== "going" && value !== "maybe") throw new TypeError("rsvp must be going, maybe or null");
  if ((plan.rsvps[memberId] ?? null) === value) return plan;
  const rsvps = { ...plan.rsvps };
  if (value == null) delete rsvps[memberId];
  else rsvps[memberId] = value;
  return { ...plan, rsvps, seq: (plan.seq || 0) + 1, updatedAt: new Date(now).toISOString() };
}

/** Ids of members going. */
export const goingIds = (/** @type {Plan} */ plan) => Object.keys(plan.rsvps || {}).filter((k) => plan.rsvps[k] === "going").sort();

/** A WhatsApp share link (opens the app with the text ready to send). */
export const whatsappLink = (/** @type {string} */ text) => `https://wa.me/?text=${encodeURIComponent(text)}`;

/**
 * A plan as a viewer may see it.
 * @param {Plan} plan
 * @param {{ role: "member"|"guest", memberId?: string|null, names: Record<string,string>, eventIcsUrl?: string|null, planUrl?: string|null, flyerUrl?: (flyerId: string) => string }} viewer
 */
export function viewPlan(plan, { role, memberId = null, names, eventIcsUrl = null, planUrl = null, flyerUrl }) {
  const isMember = role === "member";
  const hide = plan.place?.private && !isMember;
  const place = hide ? { name: plan.place.name && plan.host ? `${names[plan.host] || "A member"}'s place` : "A member's place", address: null, lat: null, lon: null, outdoor: plan.place.outdoor, private: true, hidden: true } : { ...plan.place };
  const byStatus = (/** @type {Rsvp} */ s) => Object.entries(plan.rsvps || {}).filter(([, v]) => v === s).map(([id]) => names[id]).filter(Boolean).sort();
  /** @type {any} */
  const view = {
    id: plan.id,
    crewId: plan.crewId,
    kind: plan.kind,
    title: plan.title,
    start: plan.start,
    end: plan.end,
    tz: plan.tz,
    place,
    price: plan.price,
    host: plan.host,
    hostName: plan.host ? names[plan.host] || null : plan.hostName ?? null,
    bring: plan.bring,
    source: hide ? {} : sourceView(plan.source, flyerUrl),
    why: plan.why,
    invite: plan.invite,
    weather: plan.weather,
    status: plan.status,
    confidence: plan.confidence,
    rsvps: { ...(plan.rsvps || {}) },
    going: byStatus("going"),
    maybe: byStatus("maybe"),
    you: isMember && memberId ? plan.rsvps?.[memberId] ?? null : null,
    createdBy: plan.createdBy,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    seq: plan.seq,
    expiresAt: plan.expiresAt,
  };
  if (plan.ritualFor) view.ritualFor = plan.ritualFor;
  if (plan.rainPlan) view.rainPlan = plan.rainPlan;
  if (isMember) view.eventIcsUrl = eventIcsUrl;
  if (plan.weather && !plan.weather.ok && plan.status !== "cancelled") {
    const text = `Heads up: ${plan.weather.summary.toLowerCase()} for ${plan.title}.${planUrl ? ` ${planUrl}` : ""}`;
    view.headsUp = { text, whatsappUrl: whatsappLink(text) };
  }
  return view;
}

/** The source as shown: a stored flyer becomes its URL; the internal id stays inside. */
function sourceView(source = {}, flyerUrl) {
  const { flyerId, ...rest } = source;
  return flyerId && flyerUrl ? { ...rest, imageUrl: flyerUrl(flyerId) } : rest;
}

/**
 * Plans worth showing: not expired and not long over, soonest first.
 * @param {Plan[]} plans
 * @param {number} now
 * @param {number} [graceHours] keep a plan this long after it ends
 */
export function upcoming(plans, now, graceHours = 12) {
  return plans
    .filter((p) => !isExpired(p, now) && parseInstant(p.end) + graceHours * HOUR > now)
    .sort((a, b) => parseInstant(a.start) - parseInstant(b.start) || a.id.localeCompare(b.id));
}

/** Where the crew went or is going within a week (for the variety penalty), from plans not cancelled. */
export function recentPlaces(plans, now) {
  return plans
    .filter((p) => p.status !== "cancelled" && parseInstant(p.start) <= now + 7 * DAY && (p.place?.osm || p.place?.name))
    .map((p) => ({ key: placeKey(p.place), at: parseInstant(p.start) }));
}
