// @ts-check
// "Gemma keeps leaving a lot empty" (22 Oct 2026): a real crew lost its taste, got no first
// pick, and its first plan got a made-up noon start, "come freshly waxed" as a thing to
// bring and no confidence. One test per cause, on an anonymised copy of that crew.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createService } from "../src/app/service.mjs";
import { makeIds } from "../src/app/ids.mjs";
import { loadPrompts } from "../src/app/prompts.mjs";
import { fakeAi, fakeGeocoder, fakeOverpass, fakePageMeta, fakePush, fakeWeather } from "../src/adapters/fakes.mjs";
import { geminiGenerate, retryAfterMs } from "../src/adapters/gemini.mjs";
import { diagnosedAi } from "../src/adapters/llm.mjs";
import { memoryStore } from "../src/adapters/store.mjs";
import { droppedFields, emptyFields } from "../src/core/diagnose.mjs";
import { eventLines } from "../src/core/ics.mjs";
import { createPlan, memberInvite, planAsks, validateDraft, viewPlan } from "../src/core/plans.mjs";
import { guessCrew, guessPlan, readCrewSetup, readPlan } from "../src/core/tasks.mjs";
import { cleanTaste, plainTaste, stem, withVibe } from "../src/core/taste.mjs";
import { planMessage, planAsks as webAsks } from "../web/src/lib/share.js";
import { LAGOS_LOCAL } from "../src/packs/lagos/index.mjs";
import { AREAS, PLACES } from "./fixtures/lagos.mjs";

const now = () => Date.parse("2026-10-21T09:00:00Z"); // a Wednesday
const cfg = { publicUrl: "https://x.test", webUrl: "https://x.test", uidDomain: "x.test" };
const OJOTA = { label: "Ojota", lat: 6.5833, lon: 3.3833 };
// the crew, anonymised: a name, its vibe, and who they are said in the same sentence
const SENTENCE = "Our lot, queer and mostly girls, raves and chill vibes, around Ojota";
const PLAIN = "Our lot, raves and chill vibes, around Ojota";
// Gemma's real answer on 22 Oct 2026 for the plain sentence: a fine taste, none of it word
// for word in the sentence, which the old check threw away whole
const GEMMA_22_OCT = {
  name: "Our lot", vibe: "raves and chill vibes", vibeTags: ["party", "chill"], budget: null, every: null, day: null, from: null, to: null, areas: ["Ojota"],
  taste: { basis: [], scenes: [], likes: ["nightlife", "dancing", "music"], placeKinds: ["nightclub", "bar", "live music"], eventKeywords: ["rave", "party", "dance"], avoid: [], needs: ["women-friendly"], ageBand: null, energy: "lively" },
  confidence: { name: 1, vibe: 1, rhythm: 1, areas: 1 },
};
const PLAN_TEXT = "Games night at Ada's, bring wine, come freshly waxed";
const busy = () => { throw Object.assign(new Error("Gemini API 500: Internal error encountered."), { status: 500, transient: true, hint: "Gemma is slow or busy right now. Try again in a minute." }); };
const make = (/** @type {any} */ over = {}) => {
  const store = memoryStore();
  /** @type {any[]} */
  const logs = [];
  const svc = createService({ store, ai: fakeAi({ answers: {} }), geocoder: fakeGeocoder({ areas: [{ ...OJOTA, detail: "Kosofe, Lagos", country: "NG", city: "Lagos" }] }), places: fakeOverpass([PLACES.freedom]), weather: fakeWeather(), pages: fakePageMeta(), push: fakePush(), spots: [], prompts: loadPrompts(), ids: makeIds(), now, cfg, log: (e, f) => logs.push({ e, ...f }), ...over });
  return { store, svc, logs };
};

// ------------------------------------------------------------------ bug 1: the taste was lost

test("bug 1: Gemma's taste is kept when it says the sentence's words in other forms (rave, raves)", () => {
  assert.equal(stem("raves"), stem("rave"));
  assert.equal(stem("parties"), stem("party"));
  const t = cleanTaste(GEMMA_22_OCT.taste, { sentence: PLAIN });
  assert.ok(t.likes.includes("raves") && t.likes.includes("dancing"), JSON.stringify(t));
  assert.ok(t.placeKinds.includes("nightclub"));
  assert.ok(t.eventKeywords.includes("rave"));
  assert.equal(t.energy, "lively");
  // the old check: none of likes, kinds or keywords word for word, so all of it went
  const r = readCrewSetup(GEMMA_22_OCT, { sentence: PLAIN }, LAGOS_LOCAL);
  assert.ok(r.draft.taste.likes.length > 0 && r.draft.taste.placeKinds.length > 0);
});

test("bug 1: needs add constraints on top of the taste and never replace it", () => {
  // Gemma busy (the 500 at 18:16:14): code reads the sentence alone
  const fallback = readCrewSetup(null, { sentence: SENTENCE }, LAGOS_LOCAL).draft.taste;
  assert.deepEqual(fallback.needs, ["safe", "discreet", "women-friendly", "inclusive"]);
  assert.ok(fallback.likes.includes("raves"), JSON.stringify(fallback));
  assert.ok(fallback.placeKinds.includes("nightclub"), "the raves are still the point");
  assert.ok(!fallback.placeKinds.every((k) => ["garden", "cafe", "gallery", "museum", "bookshop"].includes(k)), "not only the quiet default");
  // Gemma answering with a quiet default for a safe crew: the sentence's raves are added back
  const quiet = cleanTaste({ basis: [], scenes: [], likes: [], placeKinds: ["garden", "cafe", "gallery"], eventKeywords: [], avoid: [], needs: ["safe", "discreet", "inclusive"], ageBand: null, energy: null }, { sentence: SENTENCE });
  assert.ok(quiet.likes.includes("raves") && quiet.placeKinds.includes("nightclub"), JSON.stringify(quiet));
  // a need that rules drink out still does
  const dry = cleanTaste({}, { sentence: "church youth group, raves and chill vibes, around Ojota" });
  assert.ok(dry.needs.includes("no alcohol") && !dry.placeKinds.includes("nightclub") && !dry.placeKinds.includes("bar"), JSON.stringify(dry));
  // and a sentence with no taste words gets no invented taste
  assert.deepEqual(cleanTaste({}, { sentence: "Our lot, around Ojota" }).likes, []);
});

test("bug 1: the prompt no longer swaps a safe crew's taste for quiet places", () => {
  const p = loadPrompts()["parse-crew"].system;
  assert.ok(!p.includes("A crew that needs safe or discreet gets quiet place kinds"));
  assert.match(p, /Needs add to what the crew likes and never replace it/);
});

test("bug 1: a vibe typed by hand fills an empty taste (the stored crew of 22 Oct)", async () => {
  // what was saved: vibe typed by hand, taste from the needs only
  const saved = cleanTaste({ needs: ["safe", "discreet", "inclusive"], placeKinds: ["garden", "cafe", "gallery", "museum", "bookshop"] });
  const t = withVibe(saved, "Raves and chill vibes");
  assert.deepEqual(t.likes, ["raves"]);
  assert.deepEqual(t.needs, ["safe", "discreet", "inclusive"]);
  assert.equal(t.placeKinds[0], "nightclub");
  assert.deepEqual(withVibe(saved, "somewhere nice"), saved, "no taste words, no change");
  const { svc } = make();
  const made = await svc.createCrew({ confirm: { name: "Our lot", vibe: "Raves and chill vibes", areas: [OJOTA], taste: saved }, organiser: { name: "Ada", area: "Ojota" } });
  const crew = (await svc.getCrew({ slug: made.crew.slug, token: /** @type {string} */ (made.memberToken) })).crew;
  assert.ok(crew.taste?.likes.includes("raves"), JSON.stringify(crew.taste));
});

// ------------------------------------------------------------------ bug 2: no first pick

test("bug 2: a crew with no regular day still gets the sloth's pick for this weekend", async () => {
  const { svc, store } = make();
  const made = await svc.createCrew({ confirm: { name: "Our lot", areas: [OJOTA], rhythm: null }, organiser: { name: "Ada", area: "Ojota" } });
  assert.equal(made.crew.rhythm, null);
  assert.equal(made.crew.firstPick?.status, "pending", "a first pick is queued");
  const pick = await svc.firstPick({ slug: made.crew.slug, token: /** @type {string} */ (made.memberToken) });
  assert.equal(pick.plan?.ritualFor, "2026-10-24", "this Saturday");
  assert.equal((/** @type {any} */ (await store.findOne("crews", { slug: made.crew.slug }))).rhythm, null, "the crew still has no regular day");
});

test("bug 2: a crew made before, with no pick and nothing on, gets one when a member opens it", async () => {
  const { svc, store } = make();
  const made = await svc.createCrew({ confirm: { name: "Our lot", areas: [OJOTA], rhythm: null }, organiser: { name: "Ada", area: "Ojota" } });
  const id = (/** @type {any} */ (await store.findOne("crews", { slug: made.crew.slug }))).id;
  await store.update("crews", id, { unset: ["firstPick"] }).catch(async () => {
    const c = /** @type {any} */ (await store.get("crews", id));
    delete c.firstPick;
    await store.put("crews", c);
  });
  const token = /** @type {string} */ (made.memberToken);
  const seen = await svc.getCrew({ slug: made.crew.slug, token });
  assert.equal(seen.crew.firstPick?.status, "pending");
  const pick = await svc.firstPick({ slug: made.crew.slug, token });
  assert.equal(pick.status, "ready");
  assert.ok(pick.plan, pick.reason);
});

// ------------------------------------------------------------------ bug 3: a silent noon, and confidence lost

test("bug 3: no time in the text means no start, and the day is kept to ask only the time", () => {
  const member = { id: "m1", name: "Tolu" };
  const none = readPlan({ kind: "hosted", title: "Games night at Ada's", dateWords: null, date: null, startTime: null, endTime: null, atHost: true, venueName: null, address: null, outdoor: null, priceText: null, free: null, hostName: "Ada", bring: ["wine"], note: null, confidence: {} }, { text: PLAN_TEXT, today: "2026-10-21", member });
  assert.equal(none.draft.start, null);
  assert.equal(/** @type {any} */ (none.draft).day, undefined);
  assert.ok(none.notes.includes("Which day is it?"));
  const sat = readPlan({ kind: "hosted", title: "Games night", dateWords: "Saturday", date: null, startTime: null, endTime: null, atHost: true, venueName: null, address: null, outdoor: null, priceText: null, free: null, hostName: "Ada", bring: [], note: null, confidence: {} }, { text: "Games night at Ada's Saturday", today: "2026-10-21", member });
  assert.equal(sat.draft.start, null, "never noon");
  assert.equal(/** @type {any} */ (sat.draft).day, "2026-10-24");
  assert.ok(sat.notes.includes("What time does it start?"));
  // "at Ada's" names the place as clearly as the host: not marked as a guess
  assert.ok(none.confidence.place >= 0.6, JSON.stringify(none.confidence));
});

test("bug 3: the plan keeps the confidence the screen sends with it", async () => {
  const { svc, store } = make();
  const made = await svc.createCrew({ confirm: { name: "Our lot", areas: [OJOTA] }, organiser: { name: "Ada", area: "Ojota" } });
  const confidence = { title: 0.9, start: 1, end: 0, place: 0.9, price: 0, host: 1 };
  const r = await svc.addPlan({ slug: made.crew.slug, token: made.memberToken, body: { plan: { kind: "hosted", title: "Games night", start: "2026-10-24T19:00:00+01:00", place: { name: "Ada's place" }, bring: ["wine"], note: "Come freshly waxed.", confidence } } });
  const saved = /** @type {any} */ (await store.get("plans", r.plan.id));
  assert.deepEqual(saved.confidence, confidence);
  assert.equal(saved.note, "Come freshly waxed.");
});

// ------------------------------------------------------------------ bug 4: a joke is not a thing to bring

test("bug 4: 'come freshly waxed' is a note, not a thing to bring, and stays visible", () => {
  const member = { id: "m1", name: "Tolu" };
  // Gemma's answer on 22 Oct 2026
  const r = readPlan({ kind: "hosted", title: "Games night at Ada's", dateWords: null, date: null, startTime: null, endTime: null, atHost: true, venueName: null, address: null, outdoor: null, priceText: null, free: null, hostName: "Ada", bring: ["wine", "come freshly waxed"], confidence: { title: 0.9, host: 1 } }, { text: PLAN_TEXT, today: "2026-10-21", member });
  assert.deepEqual(r.draft.bring, ["wine"]);
  assert.equal(r.draft.note, "Come freshly waxed.");
  // Gemma's own note field, and a note it made up, which is dropped
  const own = readPlan({ kind: "hosted", title: "Beach day", bring: ["snacks"], note: "wear white", confidence: {} }, { text: "Beach day, bring snacks, wear white", today: "2026-10-21", member });
  assert.equal(own.draft.note, "Wear white.");
  const made = readPlan({ kind: "hosted", title: "Beach day", bring: [], note: "dress to impress", confidence: {} }, { text: "Beach day Saturday", today: "2026-10-21", member });
  assert.equal(made.draft.note, null);
  assert.equal(validateDraft({ title: "x", start: "2026-10-24T19:00:00+01:00", note: "  Come freshly waxed.  " }).draft.note, "Come freshly waxed.");
});

test("check: a hosted plan's shareable invite line, in the view, the calendar and WhatsApp", () => {
  const d = validateDraft({ kind: "hosted", title: "Games night at Ada's", start: "2026-10-24T19:00:00+01:00", place: { name: "Ada's place", private: true }, bring: ["wine", "ice"], note: "Come freshly waxed." }).draft;
  const plan = createPlan(d, { id: "p1", crewId: "c1", createdBy: "m1", now: now() });
  assert.equal(plan.invite, null, "nothing from Gemma is stored for a member's plan");
  assert.equal(planAsks(plan), "Bring wine and ice. Come freshly waxed.");
  assert.equal(memberInvite(plan), "Bring wine and ice. Come freshly waxed. Come through if you can.");
  assert.equal(viewPlan(plan, { role: "member", names: { m1: "Ada" } }).invite, memberInvite(plan));
  const ics = eventLines(plan, { uidDomain: "x.test" }).join("\n").replace(/\r?\n /g, "");
  assert.match(ics, /Bring wine and ice\. Come freshly waxed\. Come through if you can\./);
  assert.equal(memberInvite({ ...plan, kind: "found" }), null, "an event found on a page speaks for itself");
  assert.equal(webAsks(plan), planAsks(plan), "the web app words it the same");
  const msg = planMessage({ title: plan.title, when: "Saturday, 7 to 11pm", place: "Ada's place", kind: "hosted", links: { url: "u", in: "i", maybe: "m" }, asks: webAsks(plan) });
  assert.match(msg, /^Games night at Ada's, Saturday, 7 to 11pm at Ada's place\. Bring wine and ice\. Come freshly waxed\. Come through\?\n/);
});

// ------------------------------------------------------------------ bug 5: a 500, then a silent fallback

test("bug 5: a 429 is retried once after the wait it asks for; a long wait is not sat through", async () => {
  /** @type {number[]} */
  const at = [];
  const seq = (/** @type {[number, any, Record<string,string>?][]} */ answers) => {
    let i = 0;
    return async () => {
      at.push(Date.now());
      const [status, body, headers = {}] = answers[Math.min(i++, answers.length - 1)];
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
    };
  };
  const ok = { candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] };
  const r = await geminiGenerate({ key: "k", model: "m", messages: [{ role: "user", content: "x" }], fetchImpl: /** @type {any} */ (seq([[429, { error: { message: "quota" } }, { "retry-after": "0.3" }], [200, ok]])), backoffMs: 10 });
  assert.equal(r.attempts, 2);
  assert.ok(at[1] - at[0] >= 280, `waited ${at[1] - at[0]} ms`);
  await assert.rejects(geminiGenerate({ key: "k", model: "m", messages: [{ role: "user", content: "x" }], fetchImpl: /** @type {any} */ (seq([[429, { error: { message: "quota", details: [{ retryDelay: "40s" }] } }], [200, ok]])), backoffMs: 10 }), (e) => /** @type {any} */ (e).attempts === 1);
  assert.equal(retryAfterMs(new Headers({ "retry-after": "2" }), null), 2000);
  assert.equal(retryAfterMs(null, { error: { details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "17s" }] } }), 17000);
  // a 500 was already retried once with a short backoff
  const five = await geminiGenerate({ key: "k", model: "m", messages: [{ role: "user", content: "x" }], fetchImpl: /** @type {any} */ (seq([[500, { error: { message: "Internal error encountered." } }], [200, ok]])), backoffMs: 1 });
  assert.equal(five.attempts, 2);
});

test("bug 5: still failing, the sloth makes a best guess the organiser can fix, and says so", async () => {
  const { svc } = make({ ai: fakeAi({ answers: { "parse-crew": busy, "parse-plan": busy } }) });
  const d = await svc.draftCrew({ sentence: SENTENCE, hint: { tz: "Africa/Lagos" } });
  assert.equal(d.ai, false);
  assert.equal(d.guess, true);
  assert.match(d.notes[0], /best guess/);
  assert.equal(d.draft.name, "Our lot");
  assert.equal(d.draft.vibe, "raves and chill vibes");
  assert.deepEqual(d.draft.areas.map((/** @type {any} */ a) => a.label), ["Ojota"]);
  assert.ok(d.draft.taste.likes.includes("raves"));
  assert.ok(d.low.includes("name") && d.low.includes("vibe"), "every guess is marked");
  assert.ok(!/queer|girls/i.test(JSON.stringify(d.draft)), "who they are stays out");
  const made = await svc.createCrew({ confirm: { name: "Our lot", areas: [OJOTA] }, organiser: { name: "Ada", area: "Ojota" } });
  const p = await svc.parsePlan({ slug: made.crew.slug, token: /** @type {string} */ (made.memberToken), text: PLAN_TEXT });
  assert.equal(p.guess, true);
  assert.equal(p.draft.title, "Games night at Ada's");
  assert.equal(p.draft.kind, "hosted");
  assert.deepEqual(p.draft.bring, ["wine"]);
  assert.equal(p.draft.note, "Come freshly waxed.");
  assert.equal(p.draft.start, null);
});

test("code's guesses read the common shapes", () => {
  const g = guessCrew("the uni guys, every other Saturday, somewhere outside and cheap, around Yaba and Lekki");
  assert.equal(g.name, "the uni guys");
  assert.deepEqual(g.areas, ["Yaba", "Lekki"]);
  const p = guessPlan("Wine and monopoly at mine, Friday 7pm, bring a bottle");
  assert.equal(p.title, "Wine and monopoly at mine", "monopoly is not Monday");
  assert.equal(p.dateWords, "Friday");
  assert.equal(p.startTime, "7pm");
  assert.equal(p.atHost, true);
  assert.deepEqual(plainTaste("we love art and live music").placeKinds.slice(0, 3), ["live music", "gallery", "arts centre"]);
});

// ------------------------------------------------------------------ diagnostics: field names, never content

test("diagnostics: empty fields by name, and the fields code dropped, never what anyone wrote", async () => {
  assert.deepEqual(emptyFields({ name: "Our lot", vibe: null, taste: { likes: [], needs: ["safe"], basis: [] }, confidence: {} }), ["taste.likes", "vibe"]);
  assert.deepEqual(droppedFields({ vibe: "raves", taste: { likes: ["raves"] } }, { vibe: "raves", taste: { likes: [] } }), ["taste.likes"]);
  /** @type {any[]} */
  const lines = [];
  const ai = diagnosedAi(fakeAi({ answers: { "parse-crew": () => GEMMA_22_OCT, "parse-plan": busy } }), (e, f) => lines.push({ e, ...f }));
  await ai.generate({ task: "parse-crew", messages: [{ role: "user", content: SENTENCE }] });
  await assert.rejects(ai.generate({ task: "parse-plan", messages: [{ role: "user", content: PLAN_TEXT }] }));
  assert.deepEqual(lines.map((l) => [l.e, l.task, l.parsed]), [["gemma_fields", "parse-crew", true], ["gemma_fields", "parse-plan", false]]);
  assert.ok(lines[0].empty.includes("day") && lines[0].empty.includes("taste.scenes"));
  const { svc, logs } = make({ ai: fakeAi({ answers: { "parse-crew": () => GEMMA_22_OCT } }) });
  await svc.draftCrew({ sentence: PLAIN, hint: { tz: "Africa/Lagos" } });
  const read = logs.find((l) => l.e === "gemma_read");
  assert.equal(read.fallback, false);
  assert.ok(!read.dropped.includes("taste.likes"), "the taste is no longer dropped");
  const all = JSON.stringify([...lines, ...logs]);
  for (const words of ["raves", "Ojota", "Our lot", "queer", "wine", "waxed"]) assert.ok(!all.includes(words), `the logs carry "${words}"`);
});
