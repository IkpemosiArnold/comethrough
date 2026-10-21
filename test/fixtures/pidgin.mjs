// @ts-check
// Nigerian Pidgin and mixed English inputs, the way a Lagos crew types them, with the fields
// the app should end up with (after Gemma reads and code resolves). "Today" is Wednesday
// 21 Oct 2026. Used by scripts/pidgin-eval.mjs (live, against the Gemini API) and by
// test/pidgin.test.mjs (on the answers recorded from the last live run).
//
// An expected value of undefined means "not checked" (the input is ambiguous there).

import { crewSetupMessages, feedbackMessages, localisePrompt, planMessages, readCrewSetup, readFeedback, readPlan, CREW_SCHEMA, FEEDBACK_SCHEMA, PLAN_SCHEMA } from "../../src/core/tasks.mjs";
// These are Lagos inputs: the prompts and readers get the Lagos city pack's locale.
import { LAGOS_LOCAL } from "../../src/packs/lagos/index.mjs";
const L = (/** @type {any} */ p) => localisePrompt(p, LAGOS_LOCAL);
import { resolveDateWords, isDate } from "../../src/core/time.mjs";

export const TODAY = "2026-10-21";
export const MEMBER = { id: "m1", name: "Tolu" };

/**
 * @typedef {{ id: string, task: "parse-crew"|"parse-plan"|"parse-feedback", input: string, expect: Record<string, any> }} PidginCase
 */

/** @type {PidginCase[]} */
export const CASES = [
  // ---- crew setup
  { id: "crew-yaba-sunday", task: "parse-crew", input: "Na we be the Yaba boys o, every other Sunday we dey find somewhere cool outside, around Yaba and Surulere",
    expect: { every: "2w", day: 0, areas: ["Yaba", "Surulere"], vibe: "outside" } },
  { id: "crew-uni-babes", task: "parse-crew", input: "My babes from uni. We dey hang out once a month, Saturday evening, for Ikeja side, food and gist",
    expect: { every: "4w", day: 6, areas: ["Ikeja"], vibe: "food" } },
  { id: "crew-office-vi", task: "parse-crew", input: "Abeg the office crew, every Friday after work around VI and Ikoyi, drinks, nothing too expensive",
    expect: { every: "1w", day: 5, areas: ["Victoria Island|VI", "Ikoyi"], vibe: "drinks", budget: "cheap" } },
  { id: "crew-church-ajah", task: "parse-crew", input: "Church youth guys, we fit meet any weekend, Ajah or Sangotedo, make e no cost plenty money",
    expect: { every: null, day: null, areas: ["Ajah", "Sangotedo"], budget: "cheap" } },
  { id: "crew-gym-lekki", task: "parse-crew", input: "Gym padi dem: every Saturday morning for Lekki Phase 1, after training we go chop together",
    expect: { every: "1w", day: 6, areas: ["Lekki"], vibe: "food|active|sport" } },

  // ---- plans
  { id: "plan-link-up-lekki", task: "parse-plan", input: "abeg make we link up Saturday for Lekki, I no get money",
    expect: { kind: "quick", date: "2026-10-24", time: null, place: "Lekki", price: null, free: null, host: null } },
  { id: "plan-olisa-monopoly", task: "parse-plan", input: "Olisa dey host wine and monopoly for him house Friday 7, carry your own drink",
    expect: { kind: "hosted", date: "2026-10-23", time: "19:00", title: "monopoly", hostName: "Olisa", bring: "drink", price: null } },
  { id: "plan-afrobeats-eko", task: "parse-plan", input: "who wan follow me go Afrobeats rave for Eko Hotels Saturday night",
    expect: { kind: "found|quick", date: "2026-10-24", place: "Eko Hotel", title: "Afrobeats", price: null, host: null } },
  { id: "plan-suya-glover", task: "parse-plan", input: "Suya for Glover Court tonight around 8, e go be like 3k per person",
    expect: { kind: "quick", date: "2026-10-21", time: "20:00", place: "Glover Court", price: "3k" } },
  { id: "plan-elegushi-sunday", task: "parse-plan", input: "Make we go Elegushi beach Sunday afternoon, gate na 2k, bring towel",
    expect: { kind: "quick|found", date: "2026-10-25", place: "Elegushi", price: "2k", outdoor: true, bring: "towel" } },
  { id: "plan-nike-free", task: "parse-plan", input: "Na free entry o! Art exhibition for Nike Art Gallery Lekki this Saturday 12pm",
    expect: { kind: "found", date: "2026-10-24", time: "12:00", place: "Nike", free: true } },
  { id: "plan-movie-my-place", task: "parse-plan", input: "Movie night for my place Sunday by 6, I don cook jollof, just come",
    expect: { kind: "hosted", date: "2026-10-25", time: "18:00", selfHosted: true, price: null } },
  { id: "plan-owambe-gra", task: "parse-plan", input: "My cousin wedding na Sat 31st Oct for Ikeja GRA, owambe full ground, come chop rice. Start 2pm",
    expect: { date: "2026-10-31", time: "14:00", place: "Ikeja GRA", title: "wedding|owambe" } },

  // ---- feedback
  { id: "fb-closer-ikeja", task: "parse-feedback", input: "Abeg next time make e dey closer to Ikeja, this Lekki own too far",
    expect: { closerTo: "Ikeja", budget: null } },
  { id: "fb-shade-cheaper", task: "parse-feedback", input: "The sun too hot for that park o, find place wey get shade, and make e cheap pass this one",
    expect: { prefer: "shade", budget: "cheaper" } },
  { id: "fb-no-freedom-later", task: "parse-feedback", input: "We no wan go Freedom Park again, and make we start later small",
    expect: { avoid: "Freedom Park", time: "later" } },
];

/** The messages and schema for one case. */
export function request(/** @type {PidginCase} */ c, /** @type {Record<string, any>} */ prompts) {
  if (c.task === "parse-crew") return { messages: crewSetupMessages(L(prompts["parse-crew"]), { sentence: c.input }), schema: CREW_SCHEMA };
  if (c.task === "parse-feedback") return { messages: feedbackMessages(L(prompts["parse-feedback"]), { text: c.input }), schema: FEEDBACK_SCHEMA };
  return { messages: planMessages(L(prompts["parse-plan"]), { text: c.input, today: TODAY }), schema: PLAN_SCHEMA };
}

const has = (/** @type {any} */ v, /** @type {string} */ want) => want.split("|").some((w) => String(v ?? "").toLowerCase().includes(w.toLowerCase()));

/**
 * What the app ends up with for a case, field by field, and whether each expected field is right.
 * @param {PidginCase} c
 * @param {any} data  Gemma's parsed answer
 * @returns {{ field: string, ok: boolean, got: any, want: any }[]}
 */
export function score(c, data) {
  /** @type {{ field: string, ok: boolean, got: any, want: any }[]} */
  const out = [];
  const check = (/** @type {string} */ field, /** @type {any} */ got, /** @type {(g: any) => boolean} */ ok) => {
    if (!(field in c.expect)) return;
    out.push({ field, ok: ok(got), got, want: c.expect[field] });
  };
  const e = c.expect;
  if (c.task === "parse-crew") {
    const r = readCrewSetup(data, { sentence: c.input }, LAGOS_LOCAL);
    const d = r.draft;
    check("every", d.rhythm?.every ?? null, (g) => g === e.every);
    check("day", d.rhythm?.day ?? null, (g) => g === e.day);
    check("areas", d.areaLabels, (g) => e.areas.every((/** @type {string} */ a) => g.some((/** @type {string} */ x) => has(x, a))));
    check("vibe", d.vibeTags, (g) => e.vibe.split("|").some((/** @type {string} */ v) => g.includes(v)));
    check("budget", d.budget, (g) => g === e.budget);
    return out;
  }
  if (c.task === "parse-feedback") {
    const r = readFeedback(data, { text: c.input }).feedback;
    check("closerTo", r.closerTo ?? null, (g) => (e.closerTo == null ? g == null : has(g, e.closerTo)));
    check("budget", r.budget, (g) => g === e.budget);
    check("prefer", r.prefer, (g) => g.includes(e.prefer));
    check("avoid", r.avoid, (g) => g.some((/** @type {string} */ x) => has(x, e.avoid)));
    check("time", r.time, (g) => g === e.time);
    return out;
  }
  const r = readPlan(data, { text: c.input, today: TODAY, member: MEMBER, tz: "Africa/Lagos", local: LAGOS_LOCAL });
  const d = r.draft;
  const raw = data && typeof data === "object" ? data : {};
  const date = d.start ? d.start.slice(0, 10) : resolveDateWords(raw.dateWords, TODAY) ?? (isDate(raw.date) ? raw.date : null);
  const where = [d.place.name, d.place.address].filter(Boolean).join(", ");
  check("kind", d.kind, (g) => e.kind.split("|").includes(g));
  check("date", date, (g) => g === e.date);
  check("time", d.start ? d.start.slice(11, 16) : null, (g) => g === e.time);
  check("place", where || null, (g) => (e.place == null ? g == null : has(g, e.place)));
  check("title", d.title, (g) => has(g, e.title));
  check("price", d.price?.text ?? null, (g) => (e.price == null ? g == null : has(g, e.price)));
  check("free", d.price ? d.price.free : null, (g) => (e.free == null ? !g : g === e.free));
  check("hostName", d.hostName ?? null, (g) => has(g, e.hostName));
  check("host", d.hostName ?? d.host ?? null, (g) => g == null);
  check("selfHosted", d.host === MEMBER.id, (g) => g === e.selfHosted);
  check("bring", d.bring, (g) => g.some((/** @type {string} */ x) => has(x, e.bring)));
  check("outdoor", d.place.outdoor, (g) => g === e.outdoor);
  return out;
}
