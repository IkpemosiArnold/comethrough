// @ts-check
// Each preference rests on the sentence by itself (the external review of d01a23b, P2): one
// grounded word had let every other preference Gemma added through, so "We want art
// galleries" kept cocktails and a bar. The 22 Oct fix still holds: Gemma's reading of
// "raves" in other words (nightlife, dancing, music) is kept, through a small, explicit map
// of close relatives (RELATED in src/core/taste.mjs).
import assert from "node:assert/strict";
import { test } from "node:test";
import { readCrewSetup } from "../src/core/tasks.mjs";
import { RELATED, cleanTaste } from "../src/core/taste.mjs";
import { LAGOS_LOCAL } from "../src/packs/lagos/index.mjs";

const IDENTITY = /queer|lesbian|gay|trans\b|muslim|christian|church|disab/i;
const blank = { basis: [], scenes: [], likes: [], placeKinds: [], eventKeywords: [], avoid: [], needs: [], ageBand: null, energy: null };

test("the reviewer's case: art galleries said, cocktails and a bar added by the model are dropped", () => {
  const t = cleanTaste({ ...blank, basis: ["art galleries"], likes: ["art", "cocktails", "bars"], placeKinds: ["gallery", "bar"], eventKeywords: ["art", "exhibition", "cocktails"] }, { sentence: "We want art galleries" });
  assert.deepEqual(t.likes, ["art"]);
  assert.ok(t.placeKinds.includes("gallery"), JSON.stringify(t));
  assert.ok(!t.placeKinds.includes("bar"), JSON.stringify(t));
  assert.deepEqual(t.eventKeywords, ["art", "exhibition"], "an exhibition is a close relative of a gallery");
  // close relatives of the anchored word stay
  const near = cleanTaste({ ...blank, likes: ["museums", "photography"], placeKinds: ["museum", "arts centre"], eventKeywords: ["exhibition"] }, { sentence: "We want art galleries" });
  assert.deepEqual(near.likes, ["museums", "photography", "art"]);
  assert.ok(near.placeKinds.includes("museum") && near.placeKinds.includes("arts centre"));
});

test("raves: Gemma's 22 Oct reading (nightlife, dancing, music, rave) is kept, an unrelated extra is not", () => {
  const sentence = "The Gurls, raves and chill vibes, around Ojota";
  const gemma = { ...blank, likes: ["nightlife", "dancing", "music"], placeKinds: ["nightclub", "live music"], eventKeywords: ["rave", "party", "dance"], energy: "lively" };
  const t = cleanTaste(gemma, { sentence });
  for (const l of ["nightlife", "dancing", "music", "raves"]) assert.ok(t.likes.includes(l), `${l}: ${JSON.stringify(t)}`);
  assert.ok(t.placeKinds.includes("nightclub") && t.placeKinds.includes("live music"));
  assert.ok(t.eventKeywords.includes("rave") && t.eventKeywords.includes("dance"));
  assert.equal(t.energy, "lively");
  const extra = cleanTaste({ ...gemma, likes: [...gemma.likes, "museums", "wine tasting"], placeKinds: [...gemma.placeKinds, "museum", "zoo"], eventKeywords: [...gemma.eventKeywords, "exhibition"] }, { sentence });
  assert.ok(!extra.likes.includes("museums") && !extra.likes.includes("wine tasting"), JSON.stringify(extra));
  assert.ok(!extra.placeKinds.includes("museum") && !extra.placeKinds.includes("zoo"), JSON.stringify(extra));
  assert.ok(!extra.eventKeywords.includes("exhibition"));
  // the whole setup read, as the service does
  const r = readCrewSetup({ name: "The Gurls", vibe: "raves and chill vibes", vibeTags: [], budget: null, every: null, day: null, from: null, to: null, areas: ["Ojota"], taste: gemma, confidence: {} }, { sentence }, LAGOS_LOCAL);
  assert.ok(r.draft.taste.likes.includes("nightlife") && r.draft.taste.placeKinds.includes("nightclub"), JSON.stringify(r.draft.taste));
});

test("two taste words: each grounds its own relatives and nothing else", () => {
  const t = cleanTaste({ ...blank, likes: ["art", "nightlife", "cocktails", "hiking"], placeKinds: ["gallery", "nightclub", "bar", "park"], eventKeywords: ["exhibition", "dj", "brunch"] }, { sentence: "art galleries and raves, around Yaba" });
  assert.deepEqual(t.likes, ["art", "nightlife", "raves"]);
  assert.ok(t.placeKinds.includes("gallery") && t.placeKinds.includes("nightclub"));
  assert.ok(!t.placeKinds.includes("bar") && !t.placeKinds.includes("park"), JSON.stringify(t));
  assert.deepEqual(t.eventKeywords.slice(0, 2), ["exhibition", "dj"]);
  assert.ok(!t.eventKeywords.includes("brunch"));
  // drinks said: the bar and the cocktails stand
  const d = cleanTaste({ ...blank, likes: ["cocktails", "art"], placeKinds: ["bar", "gallery"] }, { sentence: "cocktails and art galleries" });
  assert.ok(d.likes.includes("cocktails") && d.placeKinds.includes("bar") && d.placeKinds.includes("gallery"));
});

test("identities still become needs, never stored, and do not let unrelated preferences through", () => {
  const sentence = "queer and mostly girls, we want art galleries, around Yaba";
  const t = cleanTaste({ ...blank, basis: ["queer", "art"], likes: ["lesbian bars", "art", "cocktails"], placeKinds: ["gallery", "bar", "garden"], eventKeywords: ["queer", "art", "cocktails"], needs: ["safe"] }, { sentence });
  assert.deepEqual(t.needs, ["safe", "discreet", "women-friendly", "inclusive"]);
  assert.ok(!IDENTITY.test(JSON.stringify(t)), JSON.stringify(t));
  assert.deepEqual(t.likes, ["art"]);
  assert.ok(!t.placeKinds.includes("bar"));
  assert.ok(t.placeKinds.includes("garden"), "a low-key kind a need points to stays");
  assert.ok(!t.eventKeywords.includes("cocktails"));
  // a sentence that says only who the crew is keeps the model's reading of that (as before)
  const who = cleanTaste({ ...blank, basis: ["queer", "girls"], likes: ["art", "brunch"], placeKinds: ["cafe", "gallery"], eventKeywords: ["art", "open mic"] }, { sentence: "the girls, queer and mostly female, late 20s" });
  assert.deepEqual(who.likes, ["art", "brunch"]);
  assert.ok(!IDENTITY.test(JSON.stringify(who)));
});

test("a scene the sentence names keeps the model's reading of it; the related-words map stays small and city-free", () => {
  const t = cleanTaste({ ...blank, scenes: ["alte"], likes: ["art", "thrift", "live music"], placeKinds: ["gallery", "thrift"] }, { sentence: "alte, into galleries, around Yaba" });
  assert.deepEqual(t.scenes, ["alte"]);
  assert.ok(t.likes.includes("thrift") && t.likes.includes("live music"));
  assert.ok(RELATED.length <= 40);
  assert.ok(!/lagos|nigeria|alte|owambe/i.test(JSON.stringify(RELATED)), "the map holds no city's words");
  for (const g of RELATED) assert.ok(!g.related.some((w) => /cocktail|bar|wine|beer/.test(w)) || g.words.some((w) => /drink|cocktail|wine|beer|bar|pub|nightlife|karaoke|singing/.test(w)), `drink words only under drink words: ${g.words}`);
});
