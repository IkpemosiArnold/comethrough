// @ts-check
// The crew's taste: describing the crew changes what the sloth suggests, and who the crew
// is never gets stored or sent anywhere (src/core/taste.mjs; docs/LOCAL-FACTS.md,
// "Sensitive attributes").
import assert from "node:assert/strict";
import { test } from "node:test";
import { createService } from "../src/app/service.mjs";
import { makeIds } from "../src/app/ids.mjs";
import { loadPrompts } from "../src/app/prompts.mjs";
import { fakeAi, fakeGeocoder, fakeOverpass, fakePageMeta, fakePush, fakeWeather } from "../src/adapters/fakes.mjs";
import { memoryStore } from "../src/adapters/store.mjs";
import { scorePlaces } from "../src/core/places.mjs";
import { readCrewSetup, readExplain, readInvite } from "../src/core/tasks.mjs";
import { eventCandidates, groundedWhy, homeCandidate, slotFor } from "../src/core/ideas.mjs";
import {
  PLACE_KIND_NAMES, cleanTaste, eventFit, hasSensitive, impliedNeeds, kindOfTags, osmTagsFor, overBudget, priceAmount, scrubDeep, scrubSensitive, tasteFit, tasteView,
} from "../src/core/taste.mjs";
import { LAGOS_LOCAL } from "../src/packs/lagos/index.mjs";
import { AREAS, PLACES } from "./fixtures/lagos.mjs";

const IDENTITY = /queer|lesbian|gay|lgbt|sapphic|church|christian|muslim/i;

const gallery = { name: "Kaleidoscope Art Space", lat: 6.5, lon: 3.38, osm: { type: /** @type {"node"} */ ("node"), id: 2001, tags: { name: "Kaleidoscope Art Space", tourism: "gallery" } } };
const gardenCafe = { name: "Mango Garden Cafe", lat: 6.47, lon: 3.42, osm: { type: /** @type {"node"} */ ("node"), id: 2002, tags: { name: "Mango Garden Cafe", amenity: "cafe", outdoor_seating: "yes" } } };
const bar = { name: "Loud Bar", lat: 6.49, lon: 3.4, osm: { type: /** @type {"node"} */ ("node"), id: 2003, tags: { name: "Loud Bar", amenity: "bar" } } };

test("place kinds map to OpenStreetMap tags, deterministically", () => {
  assert.deepEqual(osmTagsFor(["gallery", "arts centre", "cafe", "bar", "pub", "bookshop", "thrift", "park"]), {
    tourism: ["gallery"], amenity: ["arts_centre", "cafe", "bar", "pub", "biergarten"], shop: ["books", "second_hand", "charity"], leisure: ["park"],
  });
  assert.equal(kindOfTags({ tourism: "gallery" }), "gallery");
  assert.equal(kindOfTags({ shop: "second_hand" }), "thrift");
  assert.equal(kindOfTags({ amenity: "toilets" }), null);
  assert.ok(PLACE_KIND_NAMES.includes("museum"));
});

test("sensitive words: found, scrubbed, and not confused with places or rhythms", () => {
  assert.ok(hasSensitive("queer and mostly female"));
  assert.equal(scrubSensitive("queer and mostly female"), "mostly female");
  assert.ok(!hasSensitive("every bi-weekly Saturday"), "bi-weekly is a rhythm");
  assert.ok(!hasSensitive("around Trans-Amadi"), "a Port Harcourt neighbourhood");
  assert.ok(!hasSensitive("we love Lebanese food"), "a cuisine is a like");
  assert.ok(hasSensitive("the church youth group"));
  assert.deepEqual(scrubDeep({ vibe: "queer and chill", likes: ["lesbian bars", "art"] }), { vibe: "chill", likes: ["bars", "art"] });
});

test("who the crew is becomes needs, from code alone", () => {
  assert.deepEqual(impliedNeeds("queer and mostly female, late 20s"), ["safe", "discreet", "women-friendly", "inclusive"]);
  assert.deepEqual(impliedNeeds("church youth group, every other Saturday"), ["no alcohol"]);
  assert.deepEqual(impliedNeeds("parents with toddlers"), ["kid-friendly", "daytime"]);
  assert.deepEqual(impliedNeeds("my friend uses a wheelchair"), ["step-free"]);
  assert.deepEqual(impliedNeeds("alte, mostly male, mid to late 20s"), []);
});

test("a queer crew: needs kept, the label nowhere in the draft, even when Gemma repeats it", () => {
  const sentence = "the girls, queer and mostly female, late 20s, every other Saturday, around Yaba and Lekki";
  const gemma = {
    name: "the queer girls", vibe: "queer and mostly female", vibeTags: ["chill"], budget: null, every: "2w", day: "Saturday", from: null, to: null, areas: ["Yaba", "Lekki"],
    taste: { basis: ["queer", "girls"], scenes: ["queer"], likes: ["lesbian bars", "art", "brunch"], placeKinds: ["cafe", "gallery", "bar"], eventKeywords: ["queer", "art", "open mic"], avoid: [], needs: ["safe", "discreet"], ageBand: "late 20s", energy: "chill" },
    confidence: { name: 0.9, vibe: 0.9, rhythm: 0.9, areas: 0.9 },
  };
  const r = readCrewSetup(gemma, { sentence }, LAGOS_LOCAL);
  assert.ok(!IDENTITY.test(JSON.stringify(r.draft)), JSON.stringify(r.draft));
  assert.equal(r.draft.name, null, "the name went: names travel");
  assert.ok(r.notes.some((n) => /Pick a crew name yourself/.test(n)));
  assert.equal(r.draft.vibe, null);
  assert.deepEqual(r.draft.taste.needs, ["safe", "discreet", "women-friendly", "inclusive"]);
  assert.deepEqual(r.draft.taste.likes, ["art", "brunch"]);
  assert.deepEqual(r.draft.taste.eventKeywords, ["art", "open mic"]);
  assert.equal(r.draft.taste.ageBand, "late 20s");
  const view = tasteView(r.draft.taste, { areas: ["Yaba", "Lekki Phase 1"] });
  assert.ok(!IDENTITY.test(JSON.stringify(view)));
  assert.ok(view.chips.some((c) => c.label === "Low-key places"));
});

test("an alte crew: the scene is kept as said, and the taste rests on the sentence", () => {
  const sentence = "alte, mostly male, mid to late 20s, every other Saturday, around Yaba and Lekki";
  const r = readCrewSetup({
    name: null, vibe: "anything goes", vibeTags: [], budget: null, every: "2w", day: "Saturday", from: null, to: null, areas: ["Yaba", "Lekki"],
    taste: { basis: ["alte"], scenes: ["alte"], likes: ["art", "live music", "thrift"], placeKinds: ["gallery", "arts centre", "cafe", "live music"], eventKeywords: ["art", "indie", "exhibition"], avoid: [], needs: [], ageBand: "late 20s", energy: "chill" },
    confidence: {},
  }, { sentence }, LAGOS_LOCAL);
  assert.equal(r.draft.vibe, null, "\"anything goes\" is not in the sentence (the bug Arnold found)");
  assert.deepEqual(r.draft.taste.scenes, ["alte"]);
  assert.deepEqual(r.draft.taste.placeKinds, ["gallery", "arts centre", "cafe", "live music"]);
  assert.equal(tasteView(r.draft.taste, { areas: ["Yaba", "Lekki Phase 1"] }).summary, "Got it: alte, art and live music, late 20s, around Yaba and Lekki Phase 1.");
  // nothing said about taste: nothing invented
  const bare = readCrewSetup({ taste: { basis: ["friends"], scenes: ["alte"], likes: ["art"], placeKinds: ["gallery"], eventKeywords: ["indie"], avoid: [], needs: ["quiet"], ageBand: "late 20s", energy: "chill" } }, { sentence: "the guys, every Saturday, around Yaba" }, LAGOS_LOCAL);
  assert.deepEqual(bare.draft.taste.scenes, []);
  assert.deepEqual(bare.draft.taste.placeKinds, []);
  assert.equal(bare.draft.taste.ageBand, null);
  assert.equal(bare.draft.taste.energy, null);
});

test("edited chips are checked again: vocabularies, and no word for who anyone is", () => {
  const t = cleanTaste({ scenes: ["queer", "alte"], likes: ["gay bars", "art"], placeKinds: ["gallery", "spaceship"], needs: ["discreet", "vip"], energy: "wild", ageBand: "lesbian" });
  assert.deepEqual(t.scenes, ["alte"]);
  assert.deepEqual(t.likes, ["art"]);
  assert.deepEqual(t.placeKinds, ["gallery"]);
  assert.deepEqual(t.needs, ["discreet"]);
  assert.deepEqual(cleanTaste({ likes: ["playgrounds", "도락"], placeKinds: ["playground"] }, { sentence: "parents with young kids" }).likes, ["playgrounds"], "a slip into another script is dropped");
  assert.equal(t.energy, null);
  assert.equal(t.ageBand, null);
  assert.deepEqual(cleanTaste({ placeKinds: ["bar", "cafe"], needs: ["no alcohol"] }).placeKinds, ["cafe"]);
});

test("taste picks the place: a gallery for an alte crew, a park for a crew with no taste, never a bar for no alcohol", () => {
  const members = [{ id: "a", name: "A", area: AREAS.yaba }, { id: "b", name: "B", area: AREAS.lekki }];
  const candidates = [PLACES.freedom, PLACES.ikoyiGarden, gallery, gardenCafe, bar];
  const alte = cleanTaste({ scenes: ["alte"], likes: ["art"], placeKinds: ["gallery", "arts centre", "cafe"] });
  const plain = scorePlaces({ members, candidates: [PLACES.freedom, PLACES.ikoyiGarden], outdoor: true });
  const withTaste = scorePlaces({ members, candidates, outdoor: true, taste: alte });
  assert.ok(["gallery", "cafe"].includes(/** @type {string} */ (withTaste.pick && kindOfTags(withTaste.pick.candidate.osm?.tags))), withTaste.pick?.candidate.name);
  assert.ok(withTaste.explanation?.taste?.matched.length, "the explanation knows why");
  assert.ok(withTaste.explanation?.reasons.includes("taste"));
  assert.deepEqual(scorePlaces({ members, candidates: [PLACES.freedom, PLACES.ikoyiGarden], outdoor: true, taste: cleanTaste({}) }).ranked.map((r) => r.score), plain.ranked.map((r) => r.score), "no taste: scored as before");
  const church = cleanTaste({ needs: ["no alcohol"], placeKinds: ["park"] });
  const r = scorePlaces({ members, candidates: [bar], taste: church });
  assert.equal(r.pick, null, "a bar is ruled out");
  assert.equal(tasteFit(bar.osm.tags, church).blocked, "serves alcohol");
  assert.equal(tasteFit(gardenCafe.osm.tags, alte).matched[0], "a garden café");
  // with no taste, a pick explanation reads as it always did
  const ex = /** @type {any} */ (withTaste.explanation);
  assert.match(readExplain(null, ex).why, /^(Kaleidoscope Art Space|Mango Garden Cafe)(:| is) (an art gallery|a garden café)/);
});

test("events: keywords rank, needs and budget rule out", () => {
  const church = cleanTaste({ needs: ["no alcohol"], eventKeywords: ["gospel", "picnic"] });
  assert.equal(eventFit({ title: "Wine and Paint Night" }, church).blocked, "drinks or a party");
  assert.equal(eventFit({ title: "Sunday Gospel Picnic" }, church).blocked, null);
  assert.ok(eventFit({ title: "Sunday Gospel Picnic" }, church).score > 0);
  assert.equal(eventFit({ title: "Toddler Art Morning", start: "21:00" }, cleanTaste({ needs: ["kid-friendly"] })).blocked, "too late");
  assert.equal(priceAmount({ text: "₦15,000", free: false }), 15000);
  assert.equal(priceAmount({ text: "5k at the gate", free: false }), 5000);
  assert.ok(overBudget({ text: "₦15,000", free: false }, "cheap", 5000));
  assert.ok(!overBudget({ text: "₦3,000", free: false }, "cheap", 5000));
  assert.ok(overBudget({ text: "₦3,000", free: false }, "free"));
  const slot = slotFor("weekend", Date.parse("2026-10-21T09:00:00Z"), "Africa/Lagos");
  const ev = (/** @type {string} */ title, /** @type {string} */ price) => ({ title, dates: ["2026-10-24"], start: "16:00", end: "19:00", venue: null, area: "Yaba", price: { text: price, free: price === "Free" }, ticketUrl: null, outdoor: false, category: null, confidence: { date: 1, time: 1 }, at: null, source: { id: "g", name: "Guide", url: "https://g.test/p", title: "p", published: null } });
  const got = eventCandidates([ev("Indie Art Exhibition", "Free"), ev("Rooftop Cocktail Party", "₦20,000"), ev("Jazz Brunch", "₦12,000")], { slot, center: AREAS.yaba, points: [], hours: null, taste: cleanTaste({ eventKeywords: ["art", "indie"], needs: ["no alcohol"] }), budget: "cheap", cheapMax: 5000 });
  assert.deepEqual(got.map((c) => c.title), ["Indie Art Exhibition"]);
});

test("a discreet crew gets a night in first; nobody else does", () => {
  const slot = slotFor("weekend", Date.parse("2026-10-21T09:00:00Z"), "Africa/Lagos");
  const home = homeCandidate(slot, cleanTaste({ needs: ["discreet"] }));
  assert.equal(home?.kind, "home");
  assert.equal(home?.title, "A night in at one of yours", "neutral: titles travel");
  assert.equal(homeCandidate(slot, cleanTaste({ needs: ["no alcohol"] })), null);
});

test("reasons and invites never name who the crew is, or call a venue friendly without a source", () => {
  const c = /** @type {any} */ ({ id: "p1", kind: "place", title: "Mango Garden Cafe", place: { name: "Mango Garden Cafe" }, facts: { longestTripMinutes: 20 } });
  assert.equal(groundedWhy("Mango Garden Cafe is queer-friendly and 20 minutes away.", c), null);
  assert.equal(groundedWhy("Mango Garden Cafe is a safe space, 20 minutes for everyone.", c), null);
  assert.ok(groundedWhy("Mango Garden Cafe is quiet and low-key, 20 minutes for everyone.", c));
  const facts = { title: "Saturday at Mango Garden Cafe", day: "Saturday", date: "2026-10-24", time: "3 pm to 6 pm", place: "Mango Garden Cafe" };
  assert.equal(readInvite({ invite: "Saturday at Mango Garden Cafe, 3 to 6. A discreet spot for us. Come through!" }, facts, "fallback").by, "code");
  assert.equal(readInvite({ invite: "Saturday at Mango Garden Cafe, 3 to 6. Come through, no need to reply." }, facts, "fallback").by, "gemma");
});

// ---------------------------------------------------------------- end to end, with the service

const now = () => Date.parse("2026-10-21T09:00:00Z");
const cfg = { publicUrl: "https://x.test", webUrl: "https://x.test", uidDomain: "x.test" };

test("end to end: a queer crew's setup leaves needs only, in every store, view, invite, calendar and push", async () => {
  const sentence = "The girls: queer and mostly female, late 20s, every other Saturday, around Yaba and Lekki";
  const into = "art, brunch, somewhere we can relax without stares";
  /** @type {any[]} */
  const logs = [];
  const answers = {
    "parse-crew": () => ({
      name: "The queer girls", vibe: "queer, art and brunch", vibeTags: ["chill", "art"], budget: null, every: "2w", day: "Saturday", from: null, to: null, areas: ["Yaba", "Lekki Phase 1"],
      taste: { basis: ["queer", "art", "brunch"], scenes: ["queer"], likes: ["art", "brunch"], placeKinds: ["gallery", "cafe", "garden"], eventKeywords: ["queer", "art"], avoid: ["clubs"], needs: ["safe", "discreet"], ageBand: "late 20s", energy: "chill" },
      confidence: { name: 0.9, vibe: 0.9, rhythm: 0.9, areas: 0.9 },
    }),
    "explain-pick": () => ({ why: "" }),
    "write-invite": () => ({ invite: "" }),
  };
  const store = memoryStore();
  const push = fakePush();
  const svc = createService({
    store, ai: fakeAi({ answers }), geocoder: fakeGeocoder(), places: fakeOverpass([PLACES.freedom], [gallery, gardenCafe, bar]), weather: fakeWeather(), pages: fakePageMeta(), push, spots: [], prompts: loadPrompts(), ids: makeIds(), now, cfg,
    log: (e, f) => logs.push({ e, ...f }),
  });
  const draft = await svc.draftCrew({ sentence, into });
  assert.ok(!IDENTITY.test(JSON.stringify(draft)), JSON.stringify(draft));
  assert.deepEqual(draft.draft.taste.needs, ["safe", "discreet", "women-friendly", "inclusive"]);
  assert.ok(draft.taste.summary?.startsWith("Got it: "));
  const made = await svc.createCrew({ confirm: { ...draft.draft, name: "Saturday girls" }, organiser: { name: "Ada", area: "Yaba" } });
  // a name the organiser types is theirs (25 Oct, Astra's review): kept for the crew, and kept
  // out of its links, previews and calendar (test/discretion.test.mjs has the rest)
  const own = await svc.createCrew({ confirm: { ...draft.draft, name: "Lagos Queer Collective" } });
  assert.equal(own.crew.name, "Lagos Queer Collective");
  assert.equal(own.crew.shareName, null);
  assert.ok(!/queer/i.test(own.crew.slug) && !/queer/i.test(own.inviteUrl), own.inviteUrl);
  // the scan below is about what the app itself writes
  await store.delete("crews", own.crew.id);
  // the edited chips are checked again
  const typed = await svc.createCrew({ confirm: { ...draft.draft, name: "Brunch club", taste: { ...draft.draft.taste, scenes: ["lesbian"], likes: ["queer art"] } } });
  assert.ok(!IDENTITY.test(JSON.stringify(typed)));

  const crew = /** @type {any} */ (await store.findOne("crews", { slug: made.crew.slug }));
  const pick = await svc.firstPick({ slug: crew.slug, token: /** @type {string} */ (made.memberToken) });
  assert.ok(pick.plan, pick.reason);
  assert.notEqual(pick.plan.place.name, "Loud Bar");
  // a garden café fits its taste (brunch) and is quiet: the reason says so, never who they are
  assert.match(pick.plan.why || "", /low-key|quiet/, "the explanation says it, without saying who");
  const me = /** @type {any} */ (await store.findOne("members", { token: made.memberToken }));
  const ics = await svc.feed({ calToken: me.calToken });
  for (const [what, text] of [["store", JSON.stringify(await store.find("crews", {})) + JSON.stringify(await store.find("plans", {}))], ["logs", JSON.stringify(logs)], ["calendar", ics], ["push", JSON.stringify(push.sent)], ["invite", pick.plan.invite]]) {
    assert.ok(!IDENTITY.test(String(text)), `${what} names who the crew is`);
    assert.ok(!text?.includes(sentence) && !text?.includes(into), `${what} keeps the raw setup text`);
  }
  // taste and needs stay in the app: not in the invite, the calendar or a push
  for (const [what, text] of [["calendar", ics], ["push", JSON.stringify(push.sent)], ["invite", pick.plan.invite]]) {
    assert.ok(!/discreet|low-key|women-friendly|inclusive|\bsafe\b/i.test(String(text)), `${what} carries the crew's needs`);
  }
  // guests (the invite link) do not see the taste; members do
  assert.equal("taste" in (await svc.getCrew({ slug: crew.slug, token: crew.inviteToken })).crew, false);
  assert.deepEqual((await svc.getCrew({ slug: crew.slug, token: /** @type {string} */ (made.memberToken) })).crew.taste?.needs, ["safe", "discreet", "women-friendly", "inclusive"]);
});

test("tell the sloth what you're into, later: read (nothing saved), then save the edited chips", async () => {
  const answers = { "parse-crew": () => ({ taste: { basis: ["thrift"], scenes: [], likes: ["thrift", "galleries"], placeKinds: ["thrift", "gallery"], eventKeywords: ["thrift", "art"], avoid: [], needs: [], ageBand: null, energy: "chill" }, confidence: {} }) };
  const store = memoryStore();
  const svc = createService({ store, ai: fakeAi({ answers }), geocoder: fakeGeocoder(), places: fakeOverpass([]), weather: fakeWeather(), pages: fakePageMeta(), push: fakePush(), spots: [], prompts: loadPrompts(), ids: makeIds(), now, cfg });
  const made = await svc.createCrew({ confirm: { name: "Thrifters", areas: [AREAS.yaba] }, organiser: { name: "Ada", area: "Yaba" } });
  const token = /** @type {string} */ (made.memberToken);
  const read = await svc.crewTaste({ slug: made.crew.slug, token, body: { sentence: "thrift runs and galleries" } });
  assert.equal(read.saved, false);
  assert.deepEqual(read.taste.placeKinds, ["thrift", "gallery"]);
  assert.ok(!(/** @type {any} */ (await store.findOne("crews", { slug: made.crew.slug }))).taste?.likes.length, "reading saves nothing");
  const saved = await svc.crewTaste({ slug: made.crew.slug, token, body: { taste: { ...read.taste, likes: ["thrift"] } } });
  assert.equal(saved.saved, true);
  assert.deepEqual((/** @type {any} */ (await store.findOne("crews", { slug: made.crew.slug }))).taste.likes, ["thrift"]);
  await assert.rejects(svc.crewTaste({ slug: made.crew.slug, token: made.inviteToken, body: { sentence: "x y z" } }), (e) => /** @type {any} */ (e).code === "members_only");
});

test("from the 22 Oct eval: no clubs for a dry or kid crew, a roof for rain by taste, and invites that do not all end the same", async () => {
  const { closingFor, INVITE_CLOSINGS } = await import("../src/core/tasks.mjs");
  const { rainKinds } = await import("../src/core/taste.mjs");
  const church = cleanTaste({ needs: ["no alcohol"] });
  assert.equal(tasteFit({ name: "Syrian Club", amenity: "community_centre" }, church).blocked, "a club or bar");
  assert.equal(tasteFit({ name: "Skyline Lounge", amenity: "restaurant" }, cleanTaste({ needs: ["kid-friendly"] })).blocked, "a club or bar");
  assert.equal(tasteFit({ name: "Syrian Club", amenity: "community_centre" }, cleanTaste({ likes: ["art"] })).blocked, null, "other crews may go");
  assert.equal(eventFit({ title: "Sunset Lounge Sessions" }, church).blocked, "drinks or a party");
  assert.deepEqual(rainKinds(["playground", "park", "zoo"], ["kid-friendly"]), ["cinema", "mall", "cafe", "restaurant"]);
  assert.deepEqual(rainKinds(["gallery"], []), []);
  const parents = readCrewSetup({ taste: { basis: ["kids"], placeKinds: ["playground", "park"], needs: [] } }, { sentence: "parents with young kids" }, LAGOS_LOCAL).draft.taste;
  assert.ok(parents.placeKinds.includes("cinema") && parents.placeKinds.includes("mall"));
  const closings = new Set(["Nike Art Gallery", "Love Garden", "National Museum", "Silverbird Cinemas", "Mango Cafe", "Freedom Park"].map((place) => closingFor({ title: `Saturday at ${place}`, date: "2026-10-24", place, vibe: null })));
  assert.ok(closings.size >= 3, "the closing varies with the plan");
  assert.ok([...closings].every((c) => INVITE_CLOSINGS.includes(c)));
  // 80 minutes loses to a reasonable closer option, whatever the taste says
  const members = [{ id: "a", name: "A", area: AREAS.yaba }, { id: "b", name: "B", area: AREAS.lekki }];
  const far = { name: "Far Gallery", lat: 6.62, lon: 3.25, osm: { type: /** @type {"node"} */ ("node"), id: 3001, tags: { name: "Far Gallery", tourism: "gallery" } } };
  const near = { name: "Near Cafe", lat: 6.48, lon: 3.42, osm: { type: /** @type {"node"} */ ("node"), id: 3002, tags: { name: "Near Cafe", amenity: "cafe" } } };
  assert.equal(scorePlaces({ members, candidates: [far, near], taste: cleanTaste({ placeKinds: ["gallery"] }) }).pick?.candidate.name, "Near Cafe");
});

test("a reason that reads a fact's name back (\"fitsTaste\", \"fair and fresh\") is replaced by the code's", async () => {
  const ex = /** @type {any} */ ({ pick: { name: "TCA Gallery", kind: "gallery", green: false, fee: null }, members: [{ from: "Yaba", minutes: 60 }], maxMinutes: 60, vibeMatched: [], lastUsedDaysAgo: null, reasons: ["fair", "fresh", "taste"], notChosen: [], taste: { matched: ["an art gallery"], lowKey: true } });
  assert.equal(readExplain({ why: "TCA Gallery fitsTaste as an art gallery, about 60 minutes." }, ex).by, "code");
  assert.equal(readExplain({ why: "TCA Gallery: fair and fresh, and about 60 minutes for whoever is furthest." }, ex).by, "code");
  assert.equal(readExplain({ why: "TCA Gallery: quiet art under a roof, about 60 minutes for whoever is furthest." }, ex).by, "gemma");
  assert.equal(readExplain(null, ex).why, "TCA Gallery: an art gallery, quiet enough to hear each other, with the longest trip about 60 minutes.");
  // the same facts in a few phrasings, picked by the place, never one sentence for every crew
  const { explainFallback } = await import("../src/core/tasks.mjs");
  const shapes = new Set(["TCA Gallery", "Nike Art Gallery", "Rele Gallery", "Kaleidoscope", "Art Twenty One", "Omenka"].map((name) => explainFallback({ ...ex, pick: { ...ex.pick, name } }).replace(name, "X")));
  assert.ok(shapes.size >= 2, [...shapes].join(" | "));
});
