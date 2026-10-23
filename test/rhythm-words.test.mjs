// @ts-check
// "Saturday mornings around 7am" is a rhythm: a plural day or day part says it happens every
// week, and a clock time the sentence says is the start of the window, whatever word the
// model gave. Read the same by Gemma's reading and by code's own best guess when Gemma is
// busy. Other time-of-day phrasings are checked beside it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { everyIn, guessCrew, readCrewSetup } from "../src/core/tasks.mjs";
import { LAGOS_LOCAL } from "../src/packs/lagos/index.mjs";

const gemma = (/** @type {any} */ over) => ({ name: "Early birds", vibe: null, vibeTags: [], budget: null, every: null, day: null, from: null, to: null, areas: ["Yaba"], taste: {}, confidence: {}, ...over });
const rhythmOf = (/** @type {any} */ data, /** @type {string} */ sentence) => readCrewSetup(data, { sentence }, LAGOS_LOCAL).draft.rhythm;

test("Saturday mornings around 7am: every week, Saturday, from 7 in the morning", () => {
  const s = "Early birds, Saturday mornings around 7am, around Yaba";
  const want = { every: "1w", day: 6, window: { from: "07:00", to: "11:00" }, said: true };
  // Gemma left every out, as it does for a sentence with no "every"
  assert.deepEqual(rhythmOf(gemma({ day: "Saturday", from: "7am" }), s), want);
  // Gemma gave the day part, or the time with "around", or nothing at all
  assert.deepEqual(rhythmOf(gemma({ day: "Saturday", from: "morning" }), s), want);
  assert.deepEqual(rhythmOf(gemma({ day: "Saturday", from: "around 7am" }), s), want);
  assert.deepEqual(rhythmOf(gemma({}), s), want);
  // code's own best guess (Gemma busy)
  assert.deepEqual(rhythmOf(guessCrew(s), s), want);
  assert.equal(readCrewSetup(guessCrew(s), { sentence: s }, LAGOS_LOCAL).notes.some((n) => /needs both/.test(n)), false);
});

test("other time-of-day phrasings", () => {
  /** @type {[string, any][]} */
  const cases = [
    ["The guys, Sunday afternoons, around Yaba", { every: "1w", day: 0, window: { from: "13:00", to: "17:00" }, said: true }],
    ["The guys, Friday nights, around Yaba", { every: "1w", day: 5, window: { from: "19:00", to: "23:00" }, said: true }],
    ["The guys, Saturdays at 10am, around Yaba", { every: "1w", day: 6, window: { from: "10:00", to: "14:00" }, said: true }],
    ["The guys, Sat mornings 8am, around Yaba", { every: "1w", day: 6, window: { from: "08:00", to: "12:00" }, said: true }],
    ["The guys, every Saturday 7.30am, around Yaba", { every: "1w", day: 6, window: { from: "07:30", to: "11:30" }, said: true }],
    ["The guys, every other Saturday from 4pm to 8pm, around Yaba", { every: "2w", day: 6, window: { from: "16:00", to: "20:00" }, said: true }],
    ["The guys, every Saturday morning, around Yaba", { every: "1w", day: 6, window: { from: "09:00", to: "12:00" }, said: true }],
    ["The guys, Saturday afternoons between 2 and 6, around Yaba", { every: "1w", day: 6, window: { from: "14:00", to: "18:00" }, said: true }],
  ];
  for (const [s, want] of cases) assert.deepEqual(rhythmOf(guessCrew(s), s), want, s);
  // a night shift is not when they meet
  const shift = "We work night shift, Saturday afternoons, around Ikeja";
  assert.deepEqual(rhythmOf(gemma({ day: "Saturday" }), shift), { every: "1w", day: 6, window: { from: "13:00", to: "17:00" }, said: true });
  // what is not a rhythm stays one: a single Saturday morning, or no one day
  assert.equal(rhythmOf(guessCrew("The guys, this Saturday morning, around Yaba"), "The guys, this Saturday morning, around Yaba"), null);
  assert.equal(everyIn("weekend mornings around Yaba").every, null);
  assert.deepEqual(everyIn("Saturdays around Yaba"), { every: "1w", day: 6 });
  assert.deepEqual(everyIn("we do Sunday evenings"), { every: "1w", day: 0 });
  assert.deepEqual(everyIn("every other Saturday mornings"), { every: "2w", day: 6 }, "every other still wins");
});
