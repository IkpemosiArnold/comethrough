// @ts-check
// Event titles from web pages lose the site's tail (UX review 2, "Still open").
import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanEventTitle } from "../src/core/titles.mjs";
import { readPlan } from "../src/core/tasks.mjs";

test("a page's search-engine tail is dropped", () => {
  assert.equal(cleanEventTitle("Selfie Sunday at Alali VI! : Things to do in Lagos Every Sunday"), "Selfie Sunday at Alali VI");
  assert.equal(cleanEventTitle("Afrobeats Brunch | Tix Africa"), "Afrobeats Brunch");
  assert.equal(cleanEventTitle("Owambe Fest 2026 - Tickets | Nairabox"), "Owambe Fest 2026");
  assert.equal(cleanEventTitle("Sip & Paint | Lagos Events", { siteName: "Lagos Events" }), "Sip & Paint");
  assert.equal(cleanEventTitle("Eventbrite: Jazz on the Lawn"), "Jazz on the Lawn");
});

test("a title that is all event stays as it is", () => {
  assert.equal(cleanEventTitle("Rock, Paper, Scissors: the party"), "Rock, Paper, Scissors: the party");
  assert.equal(cleanEventTitle("Detty December: Lagos Edition"), "Detty December: Lagos Edition");
  assert.equal(cleanEventTitle("Jazz Every Sunday | Eventbrite"), "Jazz Every Sunday");
  assert.equal(cleanEventTitle("Hi!"), "Hi!");
  assert.equal(cleanEventTitle("Home"), "Home");
  assert.equal(cleanEventTitle(""), null);
  assert.equal(cleanEventTitle(null), null);
});

test("a link plan's title comes back clean; a typed one is left alone", () => {
  const base = { today: "2026-10-22", tz: "Africa/Lagos", member: { id: "m1", name: "Ada" } };
  const pageMeta = { title: "Selfie Sunday at Alali VI! : Things to do in Lagos Every Sunday", description: "", text: "Selfie Sunday at Alali VI", siteName: null };
  const fromLink = readPlan({ title: "Selfie Sunday at Alali VI! : Things to do in Lagos Every Sunday" }, { ...base, url: "https://example.com/e", pageMeta: /** @type {any} */ (pageMeta) });
  assert.equal(fromLink.draft.title, "Selfie Sunday at Alali VI");
  const typed = readPlan({ title: "Suya: tonight | maybe" }, { ...base, text: "Suya: tonight | maybe" });
  assert.equal(typed.draft.title, "Suya: tonight | maybe");
});
