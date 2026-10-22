// @ts-check
// The small things that help a crew grow without asking anyone to open the app more:
// renaming a crew, the sloth's name ideas, "We came through" (the day-after card), "Got
// another crew?", and what a WhatsApp preview card may say. Pure: the caller passes the
// clock, the crew's zone and the plans.
//
// The rules that matter most:
//   - a crew whose needs include "discreet" never has its name, its members' names, faces
//     or a status card in anything that leaves the app;
//   - a name never says who the crew is (the same check as a new crew's name);
//   - the sloth's name ideas come only from the crew's areas, its day and what it is into,
//     never from its needs, and every word must be one the crew gave or a plain one.

import { HIGH_RISK, hasSensitive } from "./taste.mjs";
import { DAY_NAMES, localParts, parseInstant } from "./time.mjs";

export const NAME_MAX = 40;

const seg = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter("en", { granularity: "grapheme" }) : null;
/** Characters as people count them: "🎧" and "Ọ́" are one each. */
export const graphemes = (/** @type {string} */ s) => (seg ? Array.from(seg.segment(s), (x) => x.segment) : Array.from(s));

/**
 * A crew name someone typed, checked: 1 to 40 characters (emoji welcome), no control
 * characters, nothing that says who the crew is.
 * @param {any} raw
 * @returns {{ name: string, error: null } | { name: null, error: string }}
 */
export function checkCrewName(raw) {
  const name = typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f-\u009f\u200b\u2028\u2029]/g, "").replace(/\s+/g, " ").trim() : "";
  if (!name) return { name: null, error: "Give the crew a name." };
  if (graphemes(name).length > NAME_MAX) return { name: null, error: `Keep it to ${NAME_MAX} characters.` };
  if (hasSensitive(name, HIGH_RISK)) return { name: null, error: "Crew names show in WhatsApp previews and calendars. Pick one that is fine for anyone to see." };
  return { name, error: null };
}

/** True for a crew that asked to stay low-key: nothing about it leaves the app. */
export const isDiscreet = (/** @type {any} */ crew) => Array.isArray(crew?.taste?.needs) && crew.taste.needs.includes("discreet");

const endOf = (/** @type {any} */ p) => parseInstant(p.end || p.start);
const goingCount = (/** @type {any} */ p) => Object.values(p.rsvps || {}).filter((v) => v === "going").length;
const happened = (/** @type {any} */ p, /** @type {number} */ now) => p.status !== "cancelled" && Number.isFinite(endOf(p)) && endOf(p) < now;

/**
 * The plans that came off: in the past, not cancelled, with someone going.
 * @param {any[]} plans
 * @param {number} now
 */
export function linkupIds(plans, now) {
  return plans.filter((p) => happened(p, now) && goingCount(p) >= 1).map((p) => p.id);
}

/**
 * Every linkup the crew has had: the ones already counted (plans expire after 30 days, so the
 * crew keeps their ids) and any new ones. At most 500 ids are kept.
 * @param {string[]|undefined} known
 * @param {string[]} fresh
 */
export function mergeLinkups(known, fresh) {
  const all = [...new Set([...(Array.isArray(known) ? known : []), ...fresh])];
  return all.slice(-500);
}

/**
 * "We came through": the plan to make a Status card for, the day after it happened. A plan
 * qualifies when 2 or more were going, it was not cancelled, and today (in the crew's zone)
 * is a later day than the plan's own, within 3 days of its end. The newest one wins.
 * @param {any[]} plans
 * @param {number} now
 * @param {string} tz
 * @returns {{ planId: string, title: string, going: number, date: string } | null}
 */
export function recapPlan(plans, now, tz) {
  const today = localParts(now, tz).date;
  const best = plans
    .filter((p) => happened(p, now) && goingCount(p) >= 2 && now - endOf(p) <= 3 * 86_400_000 && localParts(parseInstant(p.start), tz).date < today)
    .sort((a, b) => endOf(b) - endOf(a))[0];
  return best ? { planId: best.id, title: best.title, going: goingCount(best), date: localParts(parseInstant(best.start), tz).date } : null;
}

/**
 * True once this member has been to a plan that happened (they said going, and it's over).
 * @param {any[]} plans
 * @param {string|null} memberId
 * @param {number} now
 */
export function cameThrough(plans, memberId, now) {
  return !!memberId && plans.some((p) => happened(p, now) && p.rsvps?.[memberId] === "going");
}

/**
 * What the crew page adds for these features, for a member (guests get none of it).
 * @param {{ crew: any, member: any|null, plans: any[], now: number, tz: string }} p
 */
export function growthView({ crew, member, plans, now, tz }) {
  if (!member) return null;
  const ids = mergeLinkups(crew.linkups, linkupIds(plans, now));
  return {
    linkups: ids.length,
    recap: recapPlan(plans, now, tz),
    cameThrough: cameThrough(plans, member.id, now),
    discreet: isDiscreet(crew),
    seen: Array.isArray(member.seen) ? member.seen : [],
  };
}

// ---------------------------------------------------------------- the sloth's name ideas

/** Plain words any crew name may use, with the crew's own words. */
const PLAIN = new Set(`the a an of and & n at on in to for with our your
crew lot gang squad club society collective circle people posse fam family linkup linkups link ups hangout hangouts hang
sloth sloths slow steady lazy lazies chill chilled chillers nappers loungers yawners dozers loafers snoozers sleepy
weekend weekenders sunday sundays monday mondays tuesday tuesdays wednesday wednesdays thursday thursdays friday fridays saturday saturdays
every other week weekly monthly night nights evening evenings afternoon afternoons day days outside outdoors
league united association committee crowd tribe table mates friends regulars faithful council`.split(/\s+/));

const wordsOf = (/** @type {string} */ s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(Boolean);

/**
 * The words a name idea may use: the crew's areas, its regular day, its vibe and what it is
 * into (scenes, likes, kinds of place, energy), its city, the plain words above, and the
 * pack's flavour words. Never its needs or what it avoids.
 * @param {any} crew
 * @param {{ city?: string|null, flavour?: string[] }} [opts]
 */
export function nameVocab(crew, { city = null, flavour = [] } = {}) {
  const t = crew?.taste || {};
  const from = [
    ...(crew?.areas || []).map((/** @type {any} */ a) => a.label),
    crew?.rhythm ? DAY_NAMES[crew.rhythm.day] : "",
    crew?.vibe || "",
    ...(crew?.vibeTags || []),
    ...(t.scenes || []), ...(t.likes || []), ...(t.placeKinds || []), t.energy || "",
    city || "",
    ...flavour,
  ];
  const words = new Set(PLAIN);
  for (const f of from) for (const w of wordsOf(f)) {
    if (hasSensitive(w)) continue;
    words.add(w);
    // "parks" for "park", "Saturdays" for "Saturday"
    words.add(`${w}s`);
    if (w.endsWith("s")) words.add(w.slice(0, -1));
  }
  return words;
}

/**
 * The model's name ideas, kept only when grounded: every word is in the crew's vocabulary,
 * no word says who anyone is, at most 40 characters, not the current name, no repeats.
 * @param {any} raw  the model's answer ({ names: [string] })
 * @param {Set<string>} vocab
 * @param {string} current
 */
export function groundedNames(raw, vocab, current = "") {
  const list = Array.isArray(raw?.names) ? raw.names : [];
  /** @type {string[]} */
  const out = [];
  for (const n of list) {
    if (typeof n !== "string") continue;
    const { name } = checkCrewName(n.replace(/["“”]/g, "").replace(/[—–]/g, " "));
    if (!name || hasSensitive(name)) continue;
    const ws = wordsOf(name);
    if (!ws.length || !ws.every((w) => vocab.has(w) || /^\d+$/.test(w))) continue;
    if (name.toLowerCase() === String(current).toLowerCase() || out.some((o) => o.toLowerCase() === name.toLowerCase())) continue;
    out.push(name);
  }
  return out.slice(0, 3);
}

const title = (/** @type {string} */ s) => s.replace(/(^|\s)(\p{L})/gu, (_, sp, c) => sp + c.toUpperCase());

/**
 * Name ideas from code alone (Gemma away, or too few grounded ones): the crew's first area,
 * its day and what it is into, with a sloth now and then.
 * @param {any} crew
 * @param {{ flavour?: string[] }} [opts]
 */
export function fallbackNames(crew, { flavour = [] } = {}) {
  const area = (crew?.areas || [])[0]?.label || null;
  const day = crew?.rhythm ? DAY_NAMES[crew.rhythm.day] : null;
  const like = [...(crew?.taste?.likes || []), ...(crew?.taste?.scenes || [])].find((x) => typeof x === "string" && x.length <= 14 && !hasSensitive(x)) || null;
  const fl = flavour[0] || null;
  const ideas = [
    area && `The ${area} Lot`,
    day && `${day} Sloths`,
    like && `${title(like)} Club`,
    area && day && `${area} ${day}s`,
    fl && area && `${area} ${title(fl)} Crew`,
    "Slow and Steady Society",
    "The Lazy Linkup",
  ].filter((x) => typeof x === "string" && checkCrewName(x).name);
  const out = [];
  for (const i of ideas) if (!out.some((o) => o.toLowerCase() === i.toLowerCase()) && i.toLowerCase() !== String(crew?.name || "").toLowerCase()) out.push(i);
  return out.slice(0, 3);
}

// ---------------------------------------------------------------- what a preview card says

/** Text a card can draw: letters, marks, digits, punctuation, spaces and money signs; emoji and pictographs go. */
export const cardText = (/** @type {any} */ s, max = 80) => {
  const t = String(s ?? "").replace(/[^\p{L}\p{M}\p{N}\p{P}\p{Zs}₦$€£+=&@]/gu, "").replace(/\s+/g, " ").trim();
  return graphemes(t).length > max ? `${graphemes(t).slice(0, max - 1).join("").trimEnd()}…` : t;
};

/** "4pm", "4:30pm". */
const clock = (/** @type {string} */ hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
};

/**
 * "Saturday 24 Oct, 4pm to 7pm" in the crew's zone.
 * @param {string} start
 * @param {string|null} end
 * @param {string} tz
 */
export function cardWhen(start, end, tz) {
  const s = localParts(parseInstant(start), tz);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = `${DAY_NAMES[s.weekday]} ${s.d} ${months[s.m - 1]}`;
  const e = end ? localParts(parseInstant(end), tz) : null;
  return e && e.date === s.date ? `${day}, ${clock(s.time)} to ${clock(e.time)}` : `${day}, ${clock(s.time)}`;
}

/**
 * What a plan's preview card and its tags say. Discreet crews get the generic card: no
 * title, no place, no crew name, no names, no faces.
 * @param {{ crew: any, plan: any, members: any[], tz: string }} p
 */
export function planCard({ crew, plan, members, tz }) {
  if (isDiscreet(crew)) return discreetCard("plan");
  const host = plan.host ? members.find((m) => m.id === plan.host) : null;
  const hostFirst = cardText((host?.name || plan.hostName || "").split(/\s+/)[0], 20);
  const place = plan.place?.private || !plan.place?.name ? (hostFirst ? `At ${hostFirst}'s` : null) : cardText(plan.place.name, 48);
  const going = Object.entries(plan.rsvps || {}).filter(([, v]) => v === "going").map(([id]) => id);
  const title = cardText(plan.title, 70) || "A plan";
  const when = cardWhen(plan.start, plan.end, tz);
  const n = going.length;
  return {
    kind: "plan",
    discreet: false,
    title,
    when,
    place,
    going,
    count: n ? `${n} going` : "Be the first to say you're in",
    ogTitle: title,
    ogDescription: `${when}${place ? ` at ${place.replace(/^At /, "")}` : ""}. ${n ? `${n} going. ` : ""}Tap to say if you're coming.`,
  };
}

/**
 * The crew invite's card: the crew's name and how many are in, or the generic card.
 * @param {{ crew: any, members: any[] }} p
 */
export function crewCard({ crew, members }) {
  if (isDiscreet(crew)) return discreetCard("crew");
  const name = cardText(crew.name, 40) || "Your crew";
  return {
    kind: "crew",
    discreet: false,
    title: name,
    when: null,
    place: null,
    going: members.slice(0, 8).map((m) => m.id),
    count: members.length === 1 ? "1 of you so far" : `${members.length} of you`,
    ogTitle: `${name} on Come Through`,
    ogDescription: `Plans for ${name} live here now. See what's on and tap once to come through.`,
  };
}

/** The same card for every discreet crew. */
export function discreetCard(/** @type {"plan"|"crew"} */ kind) {
  return {
    kind,
    discreet: true,
    title: kind === "plan" ? "A plan with your crew" : "Your crew's plans",
    when: null,
    place: null,
    going: /** @type {string[]} */ ([]),
    count: null,
    ogTitle: kind === "plan" ? "A plan with your crew" : "Your crew's plans",
    ogDescription: "Tap to see it and say if you're coming.",
  };
}
