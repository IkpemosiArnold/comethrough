// @ts-check
// Pidgin and mixed English: the readers on Gemma's answers recorded from the live run of
// scripts/pidgin-eval.mjs (21 Oct 2026, gemma-4-26b-a4b-it), and the code fallbacks that
// run whatever the model says. Per-field results are in docs/LOCAL-FACTS.md.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { CHEAP_WORDS, everyIn, readCrewSetup as coreReadCrewSetup, readPlan as coreReadPlan } from "../src/core/tasks.mjs";
import { LAGOS_LOCAL } from "../src/packs/lagos/index.mjs";
// The crew in these tests is in Lagos: its zone, short names ("VI"), naira and Pidgin come
// from the Lagos city pack now, so the readers get it passed in.
const LAGOS_TZ = "Africa/Lagos";
/** @type {typeof coreReadPlan} */
const readPlan = (d, input) => coreReadPlan(d, { tz: LAGOS_TZ, local: LAGOS_LOCAL, ...input });
/** @type {typeof coreReadCrewSetup} */
const readCrewSetup = (d, input, local = LAGOS_LOCAL) => coreReadCrewSetup(d, input, local);

import { CASES, MEMBER, TODAY, score } from "./fixtures/pidgin.mjs";

const recorded = JSON.parse(fs.readFileSync(new URL("./fixtures/pidgin-answers.json", import.meta.url), "utf8"));

test("every Pidgin case has a recorded answer, and the readers get every expected field right", () => {
  assert.ok(CASES.length >= 15);
  /** @type {string[]} */
  const wrong = [];
  let n = 0;
  for (const c of CASES) {
    const a = recorded.answers[c.id];
    assert.ok(a && a.data, `${c.id} has a recorded answer`);
    for (const r of score(c, a.data)) {
      n++;
      if (!r.ok) wrong.push(`${c.id}.${r.field}: got ${JSON.stringify(r.got)}`);
    }
  }
  assert.ok(n >= 60, `${n} fields checked`);
  assert.deepEqual(wrong, []);
});

test("rhythm words in English and Pidgin are read by code too", () => {
  assert.deepEqual(everyIn("every Saturday morning for Lekki Phase 1, after training we go chop"), { every: "1w", day: 6 });
  assert.deepEqual(everyIn("Na we be the Yaba boys o, every other Sunday we dey find somewhere"), { every: "2w", day: 0 });
  assert.deepEqual(everyIn("We dey hang out once a month, Saturday evening"), { every: "4w", day: 6 });
  assert.deepEqual(everyIn("we fit meet any weekend"), { every: null, day: null });
  // Gemma said nothing about "every"; the sentence did
  const r = readCrewSetup({ name: "Gym padi dem", every: null, day: "Saturday", from: "morning", areas: ["Lekki Phase 1"], vibeTags: ["food"], confidence: {} }, { sentence: "Gym padi dem: every Saturday morning for Lekki Phase 1, after training we go chop together" });
  assert.deepEqual(r.draft.rhythm, { every: "1w", day: 6, window: { from: "09:00", to: "12:00" }, said: true });
});

test("money words in Pidgin mean cheap; VI is Victoria Island; after work is the evening", () => {
  for (const s of ["I no get money", "nothing too expensive", "make e no cost plenty money", "small money abeg"]) assert.ok(CHEAP_WORDS.test(s), s);
  assert.ok(!CHEAP_WORDS.test("money no be problem"));
  const r = readCrewSetup({ every: "1w", day: "Friday", from: "after work", areas: ["VI", "Ikoyi", "Ikeja"], confidence: {} }, { sentence: "every Friday after work around VI and Ikoyi" });
  assert.deepEqual(r.draft.areaLabels, ["Victoria Island", "Ikoyi"], "Ikeja is not in the sentence");
  assert.deepEqual(r.draft.rhythm?.window, { from: "17:30", to: "21:00" });
});

test("what to bring must be in the message; one clear clock time is read by code", () => {
  const input = "Olisa dey host wine and monopoly for him house Friday 7, carry your own drink";
  const r = readPlan({ kind: "hosted", title: "wine and monopoly", dateWords: "Friday", startTime: "7", atHost: true, hostName: "Olisa", bring: ["a bottle", "your own drink"], confidence: {} }, { text: input, today: TODAY, member: MEMBER });
  assert.deepEqual(r.draft.bring, ["your own drink"]);
  assert.ok(r.notes.includes('Left out "a bottle" from what to bring: the message does not say it.'));
  const w = readPlan({ kind: "found", title: "My cousin wedding", dateWords: "Sat 31st Oct", startTime: "2nd", address: "Ikeja GRA", confidence: {} }, { text: "My cousin wedding na Sat 31st Oct for Ikeja GRA, owambe full ground, come chop rice. Start 2pm", today: TODAY, member: MEMBER });
  assert.equal(w.draft.start, "2026-10-31T14:00:00+01:00");
  assert.ok(w.confidence.start <= 0.7);
});

test("a naira sign read as a caret is put back", async () => {
  const { nairaSign } = await import("../src/packs/lagos/index.mjs");
  assert.equal(nairaSign("Gate \u20383,000"), "Gate \u20a63,000");
  assert.equal(nairaSign("^5,000 at the door"), "\u20a65,000 at the door");
  assert.equal(nairaSign("N5,000"), "N5,000");
  const r = readPlan({ kind: "found", title: "Highlife", priceText: "Gate \u20383,000", confidence: {} }, { image: { mimeType: "image/png", data: "x" }, today: TODAY, member: MEMBER });
  assert.equal(r.draft.price?.text, "Gate \u20a63,000");
});
