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

// ---------------------------------------------------------------- never an empty kind list
// The pinned run of d1770d0: per-item grounding left two crews with no kinds of place at all
// (one into meetups and hackathons, one after free things only), so a wet Saturday had
// nothing under a roof to offer, and a family crew lost "community centre".

test("grounding never leaves a crew that says what it is into with no kinds of place", () => {
  const meetups = cleanTaste({ ...blank, basis: ["meetups", "hackathons"], likes: ["meetups", "hackathons", "tech"], placeKinds: ["community centre", "cafe", "library"], eventKeywords: ["meetup", "hackathon", "tech"] }, { sentence: "Dev friends, meetups and hackathons, every other Saturday around Yaba" });
  assert.ok(meetups.placeKinds.length > 0, JSON.stringify(meetups));
  assert.ok(meetups.placeKinds.includes("community centre") && meetups.placeKinds.includes("cafe"), "meetups and hackathons ground their own kinds");
  const free = cleanTaste({ ...blank, likes: ["origami", "free events"], placeKinds: ["bar", "cinema"], eventKeywords: ["free", "origami"], budget: "free" }, { sentence: "Free things only, we fold origami, around Ajah" });
  assert.ok(free.placeKinds.length > 0, JSON.stringify(free));
  assert.ok(!free.placeKinds.includes("bar") && !free.placeKinds.includes("cinema"), "the model's unrelated kinds stay out");
  assert.ok(free.placeKinds.includes("park"), "a free crew gets free kinds of place");
  // a taste word no list knows, and every kind the model gave unrelated: the default kinds
  const odd = cleanTaste({ ...blank, likes: ["origami"], placeKinds: ["nightclub", "bar"] }, { sentence: "We fold origami, around Yaba" });
  assert.ok(odd.placeKinds.length > 0 && !odd.placeKinds.includes("bar"), JSON.stringify(odd));
  assert.ok(odd.placeKinds.some((k) => ["cafe", "museum", "restaurant", "library", "community centre"].includes(k)), "something under a roof for a wet day");
});

test("dev set, 23 Oct: who a crew is and what it can spend are not taste words; a book club is not clubbing", () => {
  // Gemma's answers for three dev crews (eval personas, dev split), read again by code
  const church = cleanTaste({ basis: ["youth", "teens and early 20s"], scenes: [], likes: ["gospel music", "games", "cinema", "bowling", "park"], placeKinds: ["park", "playground", "community centre", "cinema", "bowling", "arcade"], eventKeywords: ["gospel", "youth", "games", "community", "fun"], avoid: ["alcohol", "nightclubs", "bars"], needs: ["no alcohol", "daytime"], ageBand: "teens and early 20s", energy: "chill" }, { sentence: "Our church youth fellowship, teens and early 20s, 15 of us, every other Saturday around Festac and Satellite Town, no alcohol and nothing late" });
  for (const k of ["bowling", "arcade", "cinema", "community centre"]) assert.ok(church.placeKinds.includes(k), `${k}: ${JSON.stringify(church.placeKinds)}`);
  const free = cleanTaste({ basis: [], scenes: [], likes: ["street food", "park", "library", "community centre"], placeKinds: ["park", "library", "community centre", "street food"], eventKeywords: ["free", "community", "outdoor"], avoid: [], needs: ["quiet", "daytime"], ageBand: null, energy: "chill", budget: "free" }, { sentence: "Abeg we no get money o, na free things only, 5 of us for Ajah, every other Saturday, anything wey no cost" });
  assert.deepEqual(free.placeKinds.slice(0, 4), ["park", "library", "community centre", "street food"]);
  const books = cleanTaste({ basis: ["Book club"], scenes: [], likes: ["reading", "coffee", "conversation", "books"], placeKinds: ["bookshop", "cafe", "gallery", "museum"], eventKeywords: ["book", "reading", "pop-up", "book-club", "discussion"], avoid: [], needs: ["quiet"], ageBand: "late 20s to 30s", energy: "chill" }, { sentence: "Book club, 7 of us, late 20s to 30s, we meet every other Saturday around Yaba and Gbagada, quiet places please" });
  assert.ok(!books.placeKinds.includes("nightclub") && !books.placeKinds.includes("bar"), JSON.stringify(books.placeKinds));
  assert.ok(books.placeKinds.includes("bookshop") && books.placeKinds.includes("cafe"), JSON.stringify(books.placeKinds));
  // one kind left (Gemma repeated "gallery" six times): students and a cheap budget top it up
  const art = cleanTaste({ basis: ["art students"], scenes: [], likes: ["sketching", "art", "exhibitions"], placeKinds: ["gallery", "gallery", "gallery"], eventKeywords: ["exhibition", "sketching", "art"], avoid: [], needs: ["daytime"], ageBand: "19 to 23", energy: "chill", budget: "cheap" }, { sentence: "Art students from Yaba Tech, 19 to 23, sketching and exhibitions, every other Saturday around Yaba and Surulere, very cheap" });
  assert.equal(art.placeKinds[0], "gallery");
  assert.ok(art.placeKinds.length >= 3 && art.placeKinds.includes("cafe"), JSON.stringify(art.placeKinds));
});

test("a family crew keeps the community centre its group words point to", () => {
  const t = cleanTaste({ ...blank, likes: ["picnics", "crafts"], placeKinds: ["park", "playground", "community centre"], needs: ["kid-friendly"] }, { sentence: "Families with young kids, into picnics and crafts, every other Saturday around Festac" });
  assert.ok(t.placeKinds.includes("community centre"), JSON.stringify(t));
  assert.ok(t.placeKinds.includes("playground") && t.placeKinds.includes("park"));
  // the art crew is unchanged: one kind, its own
  const art = cleanTaste({ ...blank, likes: ["art", "cocktails"], placeKinds: ["gallery", "bar"] }, { sentence: "We want art galleries" });
  assert.deepEqual(art.placeKinds, ["gallery"]);
});
