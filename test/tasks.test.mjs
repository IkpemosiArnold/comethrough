// @ts-check
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { extractJson, parseModelJson, repairJson, schemaHint } from "../src/core/json.mjs";
import { PLACES, AREAS } from "./fixtures/lagos.mjs";
import { scorePlaces } from "../src/core/places.mjs";
import {
  CREW_SCHEMA, PLAN_SCHEMA, PROMPT_NAMES, crewSetupMessages, explainFallback, explainMessages, fill, groundedShare, inviteMessages, noDashes,
  numbersGrounded, parseEventDate, planMessages, readCrewSetup, readExplain, readFeedback, readInvite, readPlan, splitPrompt,
} from "../src/core/tasks.mjs";

const prompt = (/** @type {string} */ n) => splitPrompt(fs.readFileSync(new URL(`../src/core/prompts/${n}.md`, import.meta.url), "utf8"), n);
const today = "2026-10-21"; // a Wednesday
const member = { id: "m1", name: "Tolu" };

test("every prompt file splits and has no dashes in what the model reads", () => {
  for (const n of PROMPT_NAMES) {
    const p = prompt(n);
    assert.ok(p.system.length > 50 && p.user.includes("{{"), n);
    assert.ok(!/—/.test(p.system + p.user), `${n} has an em dash`);
  }
  assert.equal(fill("a {{x}} {{y}}", { x: 1 }), "a 1 ");
});

test("JSON from a model: fenced, chatty, cut off", () => {
  assert.deepEqual(extractJson('Sure! ```json\n{"a": "b}", "c": [1]}\n``` hope that helps'), { a: "b}", c: [1] });
  assert.deepEqual(repairJson('{"title": "Wine", "bring": ["a bot'), { title: "Wine", bring: ["a bot"] });
  assert.deepEqual(repairJson('{"title": "Wine", "start'), { title: "Wine" });
  assert.deepEqual(repairJson('{"a": {"b": 1,'), { a: { b: 1 } });
  assert.deepEqual(parseModelJson('{"ok": true}'), { ok: true });
  assert.equal(parseModelJson("no json here"), null);
  const hint = schemaHint(PLAN_SCHEMA);
  assert.match(hint, /"date": "YYYY-MM-DD" or null/);
  assert.match(hint, /"kind": "found" or "hosted" or "quick"/);
  assert.match(schemaHint(CREW_SCHEMA), /"every": "1w" or "2w" or "4w" or null/);
});

test("crew setup: the sentence's rhythm, vibe and areas; invented areas dropped", () => {
  const sentence = "the uni guys, every other Saturday, somewhere outside and cheap, around Yaba and Lekki";
  const msgs = crewSetupMessages(prompt("parse-crew"), { sentence });
  assert.equal(msgs.length, 2);
  assert.ok(msgs[1].content.endsWith(sentence));
  const r = readCrewSetup({ name: "the uni guys", vibe: "outside and cheap", vibeTags: ["outside", "cheap", "chill"], budget: "cheap", every: "2w", day: "Saturday", from: null, to: null, areas: ["Yaba", "Lekki Phase 1", "Ikeja"], confidence: { name: 0.9, vibe: 0.9, rhythm: 0.9, areas: 0.9 } }, { sentence });
  assert.deepEqual(r.draft.rhythm, { every: "2w", day: 6, window: { from: "15:00", to: "19:00" } });
  assert.deepEqual(r.draft.areaLabels, ["Yaba", "Lekki Phase 1"]);
  assert.deepEqual(r.draft.vibeTags, ["outside", "chill"]);
  assert.equal(r.draft.budget, "cheap");
  assert.ok(r.low.includes("rhythm.window"), "a defaulted window is flagged");
  assert.ok(r.notes.some((n) => n.includes("Ikeja")));
  const evening = readCrewSetup({ every: "1w", day: "fri", from: "evening", areas: [], confidence: {} }, { sentence: "every friday evening" });
  assert.deepEqual(evening.draft.rhythm?.window, { from: "17:00", to: "21:00" });
  const none = readCrewSetup(null, { sentence: "hello" });
  assert.deepEqual(none.draft, { name: null, vibe: null, vibeTags: [], budget: "any", rhythm: null, areaLabels: [] });
});

test("plan from one sentence: code resolves Friday and reads 7 as 7 pm, flagged", () => {
  const text = "wine and monopoly at mine friday 7, bring a bottle";
  const msgs = planMessages(prompt("parse-plan"), { text, today });
  assert.match(msgs[0].content, /Today is Wednesday 2026-10-21/);
  assert.match(msgs[1].content, /^Message: wine and monopoly/);
  const answer = { kind: "hosted", title: "Wine and monopoly", dateWords: "friday", date: "2026-10-24", startTime: "7", endTime: null, atHost: true, venueName: null, address: null, outdoor: false, priceText: null, free: null, hostName: null, bring: ["a bottle"], confidence: { title: 0.9, date: 0.9, time: 0.8, place: 0.7, price: 0, host: 0.8 } };
  const r = readPlan(answer, { text, today, member });
  assert.equal(r.draft.start, "2026-10-23T19:00:00+01:00", "Friday is the 23rd, whatever the model said");
  assert.ok(r.notes.includes('Read "friday" as 2026-10-23.'));
  assert.ok(r.notes.includes('Read "7" as 19:00.'));
  assert.ok(r.low.includes("start"));
  assert.equal(r.draft.kind, "hosted");
  assert.equal(r.draft.host, "m1");
  assert.deepEqual(r.draft.place, { name: "Tolu's place", address: null, lat: null, lon: null, outdoor: false, private: true });
  assert.deepEqual(r.draft.bring, ["a bottle"]);
  assert.equal(r.draft.price, null);
  assert.equal(r.draft.end, null, "no end time was given, so none is invented");
});

test("plan reading never keeps an invented value at full confidence", () => {
  const text = "suya at Yaba tonight?";
  const answer = { kind: "quick", title: "Suya", dateWords: "tonight", date: null, startTime: null, endTime: null, atHost: false, venueName: "Glover Court Suya", address: null, outdoor: null, priceText: "N3,000", free: false, hostName: null, bring: [], confidence: { title: 0.9, date: 0.9, time: 0, place: 0.9, price: 0.9, host: 0 } };
  const r = readPlan(answer, { text, today, member });
  assert.equal(r.draft.start, null, "no time, no start");
  assert.ok(r.notes.includes("What time does it start?"));
  assert.ok(r.confidence.place <= 0.3 && r.confidence.price <= 0.3);
  assert.ok(r.low.includes("place") && r.low.includes("price"));
  // a flyer cannot be checked word for word, so the model's confidence stands
  const flyer = readPlan(answer, { image: { mimeType: "image/png", data: "" }, today, member });
  assert.equal(flyer.confidence.place, 0.9);
  assert.equal(flyer.draft.kind, "quick");
  assert.deepEqual(flyer.draft.source, { image: true });
});

test("a page's schema.org Event wins over the reading", () => {
  const pageMeta = { title: "Afrobeats Night", event: { name: "Afrobeats Night at Hard Rock", startDate: "2026-10-31T20:00:00+01:00", endDate: "2026-11-01T02:00", venue: "Hard Rock Cafe", address: "Landmark Village, Oniru", price: "NGN 10000", free: false } };
  const r = readPlan({ title: "Afrobeats", dateWords: null, startTime: null, confidence: {} }, { url: "https://tix.africa/e/1", pageMeta, today, member });
  assert.equal(r.draft.title, "Afrobeats Night at Hard Rock");
  assert.equal(r.draft.start, "2026-10-31T20:00:00+01:00");
  assert.equal(r.draft.end, "2026-11-01T02:00:00+01:00");
  assert.equal(r.draft.place.name, "Hard Rock Cafe");
  assert.equal(r.draft.kind, "found");
  assert.equal(r.confidence.start, 0.95);
  assert.equal(parseEventDate("2026-10-31"), null, "a date alone is not a start time");
  assert.equal(parseEventDate("2026-10-31T19:00:00Z"), "2026-10-31T20:00:00+01:00");
  assert.equal(parseEventDate("2026-10-31T20:00:00+0100"), "2026-10-31T20:00:00+01:00");
});

test("an image goes in the user message", () => {
  const msgs = planMessages(prompt("parse-plan"), { image: { mimeType: "image/jpeg", data: "AAAA" }, today });
  assert.deepEqual(msgs[1].images, [{ mimeType: "image/jpeg", data: "AAAA" }]);
  assert.match(msgs[1].content, /Flyer: the attached image/);
});

test("explanations and invites: grounded numbers or the code's sentence", () => {
  const { explanation } = scorePlaces({ members: [{ id: "a", name: "Tolu", area: AREAS.yaba }, { id: "b", name: "Kene", area: AREAS.lekki }], candidates: [PLACES.freedom, PLACES.jakande], at: Date.parse("2026-10-24T15:00:00Z") });
  assert.ok(explanation);
  const msgs = explainMessages(prompt("explain-pick"), explanation);
  assert.match(msgs[1].content, /"place": "Freedom Park"/);
  const good = readExplain({ why: `Freedom Park sits between you all, so nobody travels more than ${explanation.maxMinutes} minutes.` }, explanation);
  assert.equal(good.by, "gemma");
  const invented = readExplain({ why: "Freedom Park is 5 minutes from everyone and costs N2000." }, explanation);
  assert.equal(invented.by, "code");
  assert.equal(invented.why, explainFallback(explanation));
  assert.match(invented.why, /^Freedom Park keeps everyone within about \d+ minutes/);
  const facts = { title: "Saturday at Freedom Park", day: "Saturday", date: "2026-10-24", window: { from: "16:00", to: "19:00" }, place: "Freedom Park", weather: "Dry", vibe: "outside and cheap" };
  assert.match(inviteMessages(prompt("write-invite"), facts)[0].content, /vibe: outside and cheap/);
  assert.equal(readInvite({ invite: "Freedom Park this Saturday from 4pm to 7pm — come through!" }, facts, "fallback").invite, "Freedom Park this Saturday from 4pm to 7pm, come through!");
  assert.equal(readInvite({ invite: "Saturday at 2pm" }, facts, "fallback").by, "code");
  assert.ok(numbersGrounded("from 4 to 7", facts));
  assert.equal(noDashes("a – b - c"), "a, b, c");
});

test("feedback: only what the comment says", () => {
  const r = readFeedback({ closerTo: "Ikeja", avoid: ["Freedom Park", "Muri"], prefer: ["shade", "beach", "rockets"], budget: "cheaper", time: null, confidence: { closerTo: 0.9 } }, { text: "closer to Ikeja next time, and not Freedom Park again, somewhere with shade and cheaper" });
  assert.equal(r.feedback.closerTo, "Ikeja");
  assert.deepEqual(r.feedback.avoid, ["Freedom Park"]);
  assert.deepEqual(r.feedback.prefer, ["shade", "beach"]);
  assert.equal(r.feedback.budget, "cheaper");
  assert.equal(r.feedback.time, null);
  assert.ok(groundedShare("Freedom Park", "not freedom park again") === 1);
});
