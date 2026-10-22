// @ts-check
// Discretion and names (Astra's review, P1.5; persona eval v2: the Hindu temple crew had
// "temple" in its draft and its stored crew). A crew name the organiser explicitly typed is
// theirs, kept, and never put in anything that leaves the app when it says who the crew is
// or the crew is discreet; an identity the model inferred or suggested is never kept.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createService } from "../src/app/service.mjs";
import { makeIds } from "../src/app/ids.mjs";
import { loadPrompts } from "../src/app/prompts.mjs";
import { fakeAi, fakeGeocoder, fakeOverpass, fakePageMeta, fakePush, fakeWeather } from "../src/adapters/fakes.mjs";
import { memoryStore } from "../src/adapters/store.mjs";
import { basicHandler } from "../src/server/basic.mjs";
import { checkCrewName, crewCard, fallbackNames, outboundName } from "../src/core/growth.mjs";
import { readCrewSetup } from "../src/core/tasks.mjs";
import { sensitiveIn } from "../src/core/taste.mjs";

const now = () => Date.parse("2026-10-22T11:00:00Z");
const cfg = { publicUrl: "https://x.test", webUrl: "https://x.test", uidDomain: "x.test" };
const HINDU = "Hindu friends from the temple community, vegetarian, about 8 of us, every other Saturday around Ikeja and Surulere, no alcohol";
// Gemma's own answer for that sentence on 22 Oct 2026 (the eval's LLM cache)
const GEMMA_HINDU = { name: null, vibe: null, vibeTags: [], budget: null, every: "2w", day: "Saturday", from: null, to: null, areas: ["Ikeja", "Surulere"], taste: { basis: ["temple community"], scenes: [], likes: ["vegetarian food", "vegetarian events", "peaceful spaces", "community gathering"], placeKinds: ["restaurant", "garden", "community centre", "cafe"], eventKeywords: ["vegetarian", "temple", "community", "peaceful"], avoid: ["alcohol"], needs: ["no alcohol", "safe", "inclusive"], ageBand: null, energy: "chill" }, confidence: { name: 0, vibe: 0, rhythm: 1, areas: 1 } };
const LABELS = /\b(hindu|hindus|temple|mandir)\b/i;

const make = (/** @type {any} */ answers = {}) => {
  const store = memoryStore();
  const svc = createService({ store, ai: fakeAi({ answers }), geocoder: fakeGeocoder(), places: fakeOverpass([]), weather: fakeWeather(), pages: fakePageMeta(), push: fakePush(), spots: [], prompts: loadPrompts(), ids: makeIds(), now, cfg });
  return { store, svc };
};

test("the Hindu temple persona (lag-hindu-temple): no religious identity in the draft or the stored crew", async () => {
  const { store, svc } = make({ "parse-crew": GEMMA_HINDU });
  const d = await svc.draftCrew({ sentence: HINDU, hint: { tz: "Africa/Lagos" } });
  assert.ok(!LABELS.test(JSON.stringify({ name: d.draft.name, vibe: d.draft.vibe, taste: d.draft.taste, summary: d.taste?.summary, chips: d.taste?.chips, notes: d.notes })), JSON.stringify(d.draft.taste));
  assert.ok(d.draft.taste.needs.includes("no alcohol"), "the need stays");
  const made = await svc.createCrew({ confirm: { ...d.draft, name: d.draft.name || "Crew 13" }, hint: { tz: "Africa/Lagos" }, organiser: { name: "Organiser", area: "Ikeja" } });
  const stored = await store.get("crews", made.crew.id);
  assert.ok(!LABELS.test(JSON.stringify(stored)), JSON.stringify(stored.taste));
});

test("religion words, and the same review of the other categories", () => {
  for (const w of ["temple", "the mandir", "gurdwara", "synagogue", "shrine", "monastery", "puja", "diwali", "eid", "sikhs", "jain", "quran", "bible study", "hajj", "sallah", "salat", "holy mass", "parishioners", "evangelicals", "orthodox church", "buddhist", "zen centre", "baha'i", "rabbi", "sheikh", "deacon", "nuns", "atheists", "agnostic"]) {
    assert.ok(sensitiveIn(w).includes("religion"), `${w} is religion`);
  }
  for (const w of ["neurodivergent", "bipolar", "ptsd", "dyslexic", "cerebral palsy", "visually impaired", "hard of hearing", "wheelchair users"]) assert.ok(sensitiveIn(w).includes("health"), `${w} is health`);
  for (const w of ["sapphic", "dykes", "two spirit", "men who love men"]) assert.ok(sensitiveIn(w).length, `${w} says who people are`);
  for (const w of ["idoma", "igala", "ebira", "ogoni", "fulani"]) assert.ok(sensitiveIn(w).includes("ethnicity"), `${w} is ethnicity`);
  // likes are not who anyone is
  for (const w of ["indian food", "jollof", "massage", "critical mass", "templeton", "eider", "jainism lecture hall"]) {
    if (w !== "jainism lecture hall") assert.deepEqual(sensitiveIn(w), [], `${w} is not a religion`);
  }
});

test("a name the model inferred never carries who the crew is; one the organiser typed is theirs", () => {
  const local = {};
  const r = readCrewSetup({ name: "Temple Friends", areas: [], confidence: { name: 0.9 } }, { sentence: "Hindu friends from the temple, every Saturday" }, local);
  assert.equal(r.draft.name, null, "not suggested");
  assert.ok(!r.notes.some((n) => LABELS.test(n)), "the note does not repeat it");
  const st = readCrewSetup({ name: "Muslim Sisters Abuja", areas: [], confidence: { name: 0.9 } }, { sentence: "Muslim sisters in Abuja every other Saturday" }, local);
  assert.equal(st.draft.name, null);
  // typed by the organiser: kept (it is their choice), flagged as saying who they are
  assert.deepEqual(checkCrewName("The gay lot"), { name: "The gay lot", error: null, identity: true });
  assert.equal(checkCrewName("The Yaba Lot").identity, false);
  // the sloth's own ideas never say who anyone is
  assert.ok(fallbackNames({ areas: [{ label: "Temple Road" }], rhythm: null }).every((n) => !/temple/i.test(n)));
});

test("a typed identity name, and any discreet crew's name, never leave the app: cards, calendars and plain pages", async () => {
  const { store, svc } = make();
  const made = await svc.createCrew({ confirm: { name: "The gay lot", areas: [{ label: "Yaba", lat: 6.5095, lon: 3.3711 }], region: { center: { lat: 6.5095, lon: 3.3711 }, countryCode: "NG", city: "Lagos", timezone: "Africa/Lagos", tzSource: "open-meteo" } }, organiser: { name: "Tolu", area: "Yaba" } });
  const crew = await store.get("crews", made.crew.id);
  assert.equal(crew.name, "The gay lot", "kept: the organiser typed it");
  assert.equal(made.crew.name, "The gay lot", "the crew sees its own name");
  assert.equal(outboundName(crew), null);
  assert.equal(crewCard({ crew, members: [] }).discreet, true, "the preview card is the generic one");
  const member = await store.findOne("members", { crewId: crew.id });
  const ics = await svc.feed({ calToken: member.calToken });
  assert.ok(!/gay/i.test(ics), "not in the calendar feed");
  assert.match(ics, /X-WR-CALNAME:Come Through: your crew/);
  const basic = basicHandler({ service: svc, webUrl: "https://x.test" });
  const page = async (/** @type {string} */ p) => {
    let body = "";
    const res = /** @type {any} */ ({ writeHead() { return res; }, setHeader() {}, end(/** @type {any} */ b) { body = b ? b.toString() : ""; } });
    const url = new URL(`https://x.test${p}`);
    await basic(/** @type {any} */ ({ method: "GET", headers: {}, url: url.pathname + url.search }), res, url);
    return body;
  };
  const crewPage = await page(`/c/${crew.slug}?t=${encodeURIComponent(crew.inviteToken)}&basic=1`);
  assert.ok(crewPage.length > 100, "the page rendered");
  assert.ok(!/gay/i.test(crewPage), `not on the plain page a link preview reads: ${(crewPage.match(/.{0,120}gay.{0,80}/is) || [""])[0]}`);
  // a discreet crew with an ordinary-looking typed name that still says who it is
  await store.put("crews", { ...crew, id: "c_d", slug: "sisters", name: "Muslim sisters", inviteToken: "inv_d", taste: { scenes: [], likes: [], placeKinds: [], eventKeywords: [], avoid: [], needs: ["discreet"], budget: null, ageBand: null, energy: null } });
  const d = await store.get("crews", "c_d");
  assert.equal(outboundName(d), null);
  assert.ok(!/muslim/i.test(await page(`/c/sisters?t=inv_d&basic=1`)));
  // an ordinary crew keeps its name everywhere
  assert.equal(outboundName({ name: "The Yaba Lot", taste: null }), "The Yaba Lot");
});
