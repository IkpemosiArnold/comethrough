// @ts-check
// "The sloth has 3 ideas": the feed reader, the grounding of what Gemma reads from a weekly
// guide, the slot, the ranking check, the polite feed adapter, and the card end to end.
// The RSS fixtures are synthetic (test/fixtures/feeds): the structure of the two Lagos
// guides' feeds, with invented events, so none of the curators' text is stored here.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { createIdeas } from "../src/app/ideas.mjs";
import { createService } from "../src/app/service.mjs";
import { makeIds } from "../src/app/ids.mjs";
import { loadPrompts } from "../src/app/prompts.mjs";
import { createFeeds } from "../src/adapters/feeds.mjs";
import { fakeAi, fakeGeocoder, fakeOverpass, fakePageMeta, fakePush, fakeWeather } from "../src/adapters/fakes.mjs";
import { memoryCache } from "../src/adapters/http.mjs";
import { memoryStore } from "../src/adapters/store.mjs";
import { parseRss, postText, readEvents, robotsAllows } from "../src/core/feeds.mjs";
import { creditFor, fallbackOrder, groundedWhy, readRanking, slotFor } from "../src/core/ideas.mjs";
import { validateDraft } from "../src/core/plans.mjs";
import { config } from "../src/config.mjs";
import { createApi } from "../src/server/server.mjs";
import { AREAS, PLACES } from "./fixtures/lagos.mjs";

const fixture = (/** @type {string} */ f) => fs.readFileSync(new URL(`./fixtures/feeds/${f}`, import.meta.url), "utf8");
const A = { id: "guide-a", name: "Awe Lagos", feed: "https://guide-a.example.com/feed", home: "https://guide-a.example.com" };
const B = { id: "guide-b", name: "Nothing To Do In Lagos", feed: "https://guide-b.example.com/feed", home: "https://guide-b.example.com" };
const LAGOS_TZ = "Africa/Lagos";
// Thursday 22 Oct 2026, 16:00 in Lagos: both guides are out, Thursday's morning yoga has passed
const NOW = Date.parse("2026-10-22T15:00:00Z");

/** What a good model answers for each synthetic post, plus four things the checks must catch. */
function extractAnswer(/** @type {string} */ user) {
  if (user.includes("Title: Your Weekend Guide: 23")) {
    return { events: [
      { title: "Sunset Jazz on the Lawn", dates: ["2026-10-23"], startTime: "6 PM", endTime: null, venue: "Freedom Park, Lagos Island", area: null, priceText: "₦5,000", free: false, ticketLink: 1, outdoor: true, category: "Concert", confidence: { date: 0.95, time: 0.9 } },
      { title: "Makers Market", dates: ["2026-10-24"], startTime: "11 AM", endTime: "6 PM", venue: "Muri Okunola Park, Victoria Island", area: null, priceText: "Free entry", free: true, ticketLink: null, outdoor: true, category: "Market", confidence: { date: 0.95, time: 0.9 } },
      // the ticket link the model gives is the jazz one (1), not this event's own (2): dropped to null
      { title: "Neon Basement Rave", dates: ["2026-10-24"], startTime: "10 PM", endTime: null, venue: "The Basement, Oniru", area: "Oniru", priceText: "₦15,000", free: false, ticketLink: 1, outdoor: false, category: "Rave", confidence: { date: 0.9, time: 0.9 } },
      { title: "Quiet Book Swap", dates: ["2026-10-25"], startTime: "2 PM", endTime: null, venue: "Paper Cafe, Yaba", area: "Yaba", priceText: null, free: null, ticketLink: null, outdoor: false, category: null, confidence: { date: 0.9, time: 0.8 } },
      // not in the post at all
      { title: "Invented Gala Dinner", dates: ["2026-10-24"], startTime: "8 PM", endTime: null, venue: "Nowhere", area: null, priceText: null, free: null, ticketLink: null, outdoor: false, category: null, confidence: { date: 0.9, time: 0.9 } },
    ] };
  }
  if (user.includes("Title: This Weekend: October 22")) {
    return { events: [
      { title: "MORNING YOGA BY THE WATER", dates: ["2026-10-22"], startTime: "7:00AM", endTime: null, venue: "Jetty Deck, Ikoyi", area: "Ikoyi", priceText: "N2,000", free: false, ticketLink: null, outdoor: true, category: null, confidence: { date: 0.9, time: 0.9 } },
      // a date the post never states
      { title: "FILM CLUB NIGHT", dates: ["2026-11-02"], startTime: "6:00PM", endTime: "9:00PM", venue: "Example Hall, 1 Example Street, Ikoyi", area: "Ikoyi", priceText: "N10,000", free: false, ticketLink: 2, outdoor: false, category: null, confidence: { date: 0.9, time: 0.9 } },
      // the model is not sure of the date
      { title: "ART WALK", dates: ["2026-10-24"], startTime: "12:00PM", endTime: "4:00PM", venue: "Example Gallery, Yaba", area: "Yaba", priceText: "Open to All", free: true, ticketLink: null, outdoor: false, category: null, confidence: { date: 0.4, time: 0.9 } },
    ] };
  }
  return { events: [] };
}

test("RSS: items, titles with entities, links and dates; the post as text with numbered outside links", () => {
  const items = parseRss(fixture("guide-a.xml"));
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Your Weekend Guide: 23–25 October 2026");
  assert.equal(items[0].link, "https://guide-a.example.com/p/your-weekend-guide-2325-october");
  assert.equal(items[0].published, "2026-10-22T13:00:00.000Z");
  const { text, links } = postText(items[0].html, { ownHost: "guide-a.example.com" });
  assert.deepEqual(links, ["https://tickets.example.org/sunset-jazz", "https://tickets.example.org/neon-basement"], "no subscribe or image links, no tracking parameters");
  assert.match(text, /Click here to Buy Tickets \[1\]/);
  assert.match(text, /Where: Freedom Park, Lagos Island/);
  assert.ok(!/<|&#/.test(text), "no markup or entities left");
});

test("events from a guide: only what the post states; invented names, unstated dates and unsure dates are dropped", () => {
  const [itemA] = parseRss(fixture("guide-a.xml"));
  const a = postText(itemA.html, { ownHost: "guide-a.example.com" });
  const ra = readEvents(extractAnswer(`Title: ${itemA.title}`), { source: A, item: itemA, ...a });
  assert.deepEqual(ra.events.map((e) => e.title), ["Sunset Jazz on the Lawn", "Makers Market", "Neon Basement Rave", "Quiet Book Swap"]);
  assert.deepEqual(ra.dropped, [{ title: "Invented Gala Dinner", why: "name not in the post" }]);
  const jazz = ra.events[0];
  assert.equal(jazz.start, "18:00");
  assert.equal(jazz.ticketUrl, "https://tickets.example.org/sunset-jazz");
  assert.deepEqual(jazz.price, { text: "₦5,000", free: false });
  assert.deepEqual(jazz.source, { id: "guide-a", name: "Awe Lagos", url: itemA.link, title: itemA.title, published: itemA.published });
  assert.equal(ra.events[1].price?.free, true, '"Free entry" is free because the post says so');
  assert.equal(ra.events[1].end, "18:00");
  assert.equal(ra.events[2].ticketUrl, null, "a link number that is not in the event's own lines is not used");
  assert.equal(ra.events[3].price, null, "no price stated, none kept");

  const [itemB] = parseRss(fixture("guide-b.xml"));
  const b = postText(itemB.html, { ownHost: "guide-b.example.com" });
  const rb = readEvents(extractAnswer(`Title: ${itemB.title}`), { source: B, item: itemB, ...b });
  assert.deepEqual(rb.events.map((e) => e.title), ["MORNING YOGA BY THE WATER"]);
  assert.deepEqual(rb.dropped.map((d) => d.why), ["no date the post states", "unsure of the date"]);
});

test("a day heading far above a long block still dates the events under it; a heading for another day does not", () => {
  const item = { title: "Your Weekend Guide: 23–25 October 2026", link: "https://guide-a.example.com/p/x", published: "2026-10-22T13:00:00.000Z", html: "" };
  const text = `SATURDAY, OCTOBER 24\nFirst Thing\n${"Long words about the first thing. ".repeat(100)}\nLate Party\nWhere: The Roof, Ikoyi\nWhen: Saturday • 11 PM\nSUNDAY, OCTOBER 25\nBrunch Club\nWhen: Sunday • 1 PM`;
  const ask = (/** @type {string} */ title, /** @type {string} */ date) => readEvents({ events: [{ title, dates: [date], startTime: "11 PM", endTime: null, venue: null, area: null, priceText: null, free: null, ticketLink: null, outdoor: null, category: null, confidence: { date: 0.9, time: 0.9 } }] }, { source: A, item, text, links: [] });
  assert.deepEqual(ask("Late Party", "2026-10-24").events.map((e) => e.dates), [["2026-10-24"]]);
  assert.equal(ask("Late Party", "2026-10-24").events[0].start, "23:00");
  assert.deepEqual(ask("Brunch Club", "2026-10-24").dropped, [{ title: "Brunch Club", why: "no date the post states" }], "Sunday's heading does not say the 24th");
});

test("facts only: nothing of the post's prose is kept with an event", () => {
  const [item] = parseRss(fixture("guide-a.xml"));
  const r = readEvents(extractAnswer(`Title: ${item.title}`), { source: A, item, ...postText(item.html) });
  const kept = JSON.stringify(r.events);
  for (const prose of ["relaxed evening", "picnic feel", "designers, food stalls", "until sunrise", "take a book"]) assert.ok(!kept.includes(prose), prose);
});

test("robots.txt: the Substack rules allow /feed for us; a disallow, our own group and wildcards are honoured", () => {
  const robots = fixture("robots-substack-like.txt");
  assert.equal(robotsAllows(robots, "ComeThrough", "/feed"), true);
  assert.equal(robotsAllows(robots, "ComeThrough", "/feed/private"), false);
  assert.equal(robotsAllows(robots, "ComeThrough", "/p/x/comment/1"), false);
  assert.equal(robotsAllows(robots, "BLEXBot", "/feed"), false);
  assert.equal(robotsAllows("User-agent: *\nDisallow: /feed", "ComeThrough", "/feed"), false);
  assert.equal(robotsAllows("User-agent: comethrough\nDisallow: /\n\nUser-agent: *\nAllow: /", "ComeThrough", "/feed"), false);
  assert.equal(robotsAllows("", "ComeThrough", "/feed"), true);
});

test("the slot: tonight is the evening ahead; the weekend from a Wednesday is Friday evening, Saturday and Sunday", () => {
  const wed4pm = Date.parse("2026-10-21T15:00:00Z");
  const t = slotFor("tonight", wed4pm, LAGOS_TZ);
  assert.deepEqual(t.days.map((d) => d.date), ["2026-10-21"]);
  assert.deepEqual(t.days[0].covered, { from: "17:30", to: "21:00" });
  const w = slotFor("weekend", wed4pm, LAGOS_TZ);
  assert.deepEqual(w.days.map((d) => d.date), ["2026-10-23", "2026-10-24", "2026-10-25"]);
  assert.deepEqual(w.days[1].outdoor, { from: "11:00", to: "19:00" });
  // Saturday 20:40: less than an hour of tonight is left
  assert.deepEqual(slotFor("tonight", Date.parse("2026-10-24T19:40:00Z"), LAGOS_TZ).days, []);
  // on a Saturday morning the weekend is the rest of today and Sunday
  assert.deepEqual(slotFor("weekend", Date.parse("2026-10-24T08:00:00Z"), LAGOS_TZ).days.map((d) => d.date), ["2026-10-24", "2026-10-25"]);
});

test("ranking: Gemma's picks in its order; a reason with an invented number or not naming the idea is the code's; topped up to three", () => {
  const mk = (/** @type {string} */ id, /** @type {any} */ kind, /** @type {string} */ title, pre = 0.5) => ({
    id, kind, title, date: "2026-10-24", time: { from: "16:00", to: "19:00" }, place: { name: title, address: null, area: null, lat: 6.45, lon: 3.4, outdoor: true },
    price: null, travel: { maxMin: 35, trips: [{ from: "Yaba", minutes: 35 }] }, weather: null, pre, facts: { id, title, longestTripMinutes: 35 },
  });
  const cands = [mk("e1", "event", "Sunset Jazz on the Lawn", 0.7), mk("p1", "place", "Freedom Park", 0.6), mk("p2", "place", "Muri Okunola Park", 0.4), mk("u1", "usual", "Suya at Yakoyo", 0.5)];
  const r = readRanking({ picks: [
    { id: "p2", why: "Muri Okunola Park keeps every trip within 35 minutes." },
    { id: "e1", why: "Sunset Jazz is only 12 minutes away for everyone." },
    { id: "zz", why: "made up" },
    { id: "p1", why: "A lovely spot for the crew." },
  ] }, cands);
  assert.deepEqual(r.picks.map((p) => [p.candidate.id, p.by]), [["p2", "gemma"], ["e1", "code"], ["p1", "code"]]);
  assert.equal(r.by, "gemma");
  assert.equal(groundedWhy("Freedom Park — about 35 minutes for all.", cands[1]), "Freedom Park, about 35 minutes for all.", "dashes become commas");
  const none = readRanking(null, cands);
  assert.equal(none.by, "code");
  assert.deepEqual(none.picks.map((p) => p.candidate.id), ["e1", "p1", "u1"], "one of each kind first");
  assert.deepEqual(fallbackOrder(cands).map((c) => c.id), ["e1", "p1", "u1", "p2"]);
  assert.equal(creditFor("Awe Lagos"), "From Awe Lagos' weekly guide");
  assert.equal(creditFor("NTDIL"), "From NTDIL's weekly guide");
});

/** A fetch that serves the fixtures and counts what is asked for. */
function fakeFetch({ robots = fixture("robots-substack-like.txt"), feeds = /** @type {Record<string, string>} */ ({ "https://guide-a.example.com/feed": fixture("guide-a.xml"), "https://guide-b.example.com/feed": fixture("guide-b.xml") }) } = {}) {
  /** @type {{ url: string, headers: any }[]} */
  const calls = [];
  /** @type {typeof fetch} */
  const f = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers });
    const u = String(url);
    if (u.endsWith("/robots.txt")) return new Response(robots, { status: 200 });
    if (feeds[u] != null) {
      if (/** @type {any} */ (init?.headers)?.["if-none-match"] === '"v1"') return new Response(null, { status: 304 });
      return new Response(feeds[u], { status: 200, headers: { etag: '"v1"', "content-type": "application/xml" } });
    }
    return new Response("not here", { status: 404 });
  };
  return { f, calls };
}

test("the feed adapter: robots first, an honest User-Agent, at most once a day, then a conditional request", async () => {
  let clock = NOW;
  const { f, calls } = fakeFetch();
  const feeds = createFeeds({ cache: memoryCache({ now: () => clock }), contact: "https://github.com/x/comethrough", fetchImpl: f, now: () => clock });
  const first = await feeds.pull(A);
  assert.equal(first.reason, "fetched");
  assert.equal(first.items?.length, 2);
  assert.deepEqual(calls.map((c) => c.url), ["https://guide-a.example.com/robots.txt", "https://guide-a.example.com/feed"]);
  assert.match(calls[1].headers["user-agent"], /^ComeThrough\/0\.1 \(\+https:\/\/github\.com\/x\/comethrough\)$/);
  assert.equal((await feeds.pull(A)).reason, "checked_today");
  assert.equal(calls.length, 2, "no second fetch the same day");
  clock += 25 * 3_600_000;
  assert.equal((await feeds.pull(A)).reason, "not_modified");
  assert.equal(calls.at(-1)?.headers["if-none-match"], '"v1"');
  assert.equal(calls.filter((c) => c.url.endsWith("robots.txt")).length, 1, "robots.txt is cached for the week");
});

test("the feed adapter: a robots.txt that disallows the feed means no feed request at all", async () => {
  const { f, calls } = fakeFetch({ robots: "User-agent: *\nDisallow: /feed" });
  const feeds = createFeeds({ cache: memoryCache({ now: () => NOW }), contact: "x", fetchImpl: f, now: () => NOW });
  assert.equal((await feeds.pull(A)).reason, "robots");
  assert.deepEqual(calls.map((c) => c.url), ["https://guide-a.example.com/robots.txt"]);
});

// ---------------------------------------------------------------- the card, end to end

/** The id Gemma was shown for an idea, from the rank-ideas message (one JSON object a line). */
const idOf = (/** @type {string} */ user, /** @type {string} */ title) => {
  const line = user.split("\n").find((l) => l.includes(`"title":${JSON.stringify(title)}`));
  return line ? JSON.parse(line).id : "none";
};

const CREW = {
  id: "c_ideas", slug: "uni-guys", name: "The uni guys", vibe: "outside and music", vibeTags: ["outside", "music"], budget: /** @type {"cheap"} */ ("cheap"),
  rhythm: null, areas: [AREAS.yaba, AREAS.lekki], tz: LAGOS_TZ, createdAt: "2026-10-01T10:00:00.000Z", inviteToken: "inv_ideas_token",
  region: { center: { lat: 6.478, lon: 3.42 }, countryCode: "NG", city: "Lagos", timezone: LAGOS_TZ, tzSource: "open-meteo" },
};

async function setup({ rank = /** @type {any} */ (undefined), extract = /** @type {any} */ (extractAnswer), rain = (/** @type {string} */ _d, /** @type {number} */ _h) => 10 } = {}) {
  const store = memoryStore();
  const cache = memoryCache({ now: () => NOW });
  const answers = /** @type {Record<string, any>} */ ({});
  if (extract) answers["extract-events"] = extract;
  if (rank) answers["rank-ideas"] = rank;
  const ai = fakeAi({ answers });
  const { f, calls } = fakeFetch();
  // the Lagos pack's guides, pointed at the fixtures
  const feeds = createFeeds({ cache, contact: "x", fetchImpl: async (url, init) => f(String(url).replace("awelagos.substack.com", "guide-a.example.com").replace("nothingtodoinlagos.substack.com", "guide-b.example.com"), init), now: () => NOW });
  const now = () => NOW;
  const weather = fakeWeather({ rain });
  const cfg = { publicUrl: "https://x.test", webUrl: "https://x.test", uidDomain: "x.test" };
  const service = createService({ store, ai, geocoder: fakeGeocoder(), places: fakeOverpass([PLACES.freedom, PLACES.muri, PLACES.jakande, PLACES.ikoyiGarden]), weather, pages: fakePageMeta(), push: fakePush(), spots: [], prompts: loadPrompts(), ids: makeIds(), now, cfg });
  const venues = /** @type {Record<string, { lat: number, lon: number }>} */ ({ "Freedom Park, Lagos Island": PLACES.freedom, "Muri Okunola Park, Victoria Island": PLACES.muri, "The Basement, Oniru": { lat: 6.435, lon: 3.44 }, "Paper Cafe, Yaba": AREAS.yaba });
  const geocoder = { lookup: async (/** @type {string} */ q) => venues[q] ?? null, lookupArea: async () => null };
  const ideas = createIdeas({ store, cache, ai, feeds, weather, geocoder, candidatesNear: service._internal.candidatesNear, prompts: loadPrompts(), now });
  await store.put("crews", CREW);
  await store.put("members", { id: "m1", crewId: CREW.id, name: "Tolu", area: AREAS.yaba, token: "tok_tolu", calToken: "cal_tolu", joinedAt: "2026-10-01T10:00:00.000Z" });
  await store.put("members", { id: "m2", crewId: CREW.id, name: "Amaka", area: AREAS.lekki, token: "tok_amaka", calToken: "cal_amaka", joinedAt: "2026-10-01T11:00:00.000Z" });
  // the crew's history: a hangout at Ikoyi Garden two weeks ago that three people came to
  await store.put("plans", {
    id: "p_old", crewId: CREW.id, kind: "quick", title: "Picnic at Ikoyi Garden", start: "2026-10-10T15:00:00+01:00", end: "2026-10-10T18:00:00+01:00", tz: LAGOS_TZ,
    place: { name: "Ikoyi Garden", address: null, lat: PLACES.ikoyiGarden.lat, lon: PLACES.ikoyiGarden.lon, outdoor: true, private: false }, price: null, host: null, hostName: null, bring: [],
    source: {}, why: null, invite: null, weather: null, status: "on", confidence: {}, rsvps: { m1: "going", m2: "going", m3: "going" }, createdBy: "m1", createdAt: "2026-10-05T10:00:00.000Z", updatedAt: "2026-10-05T10:00:00.000Z", seq: 0, expiresAt: "2026-11-09T17:00:00.000Z",
  });
  return { store, cache, ai, ideas, service, calls };
}

test("the card: three ideas from the guides, open data and the crew's history, each grounded, the events credited and linked", async () => {
  const rank = (/** @type {string} */ user) => ({ picks: [
    { id: idOf(user, "Sunset Jazz on the Lawn"), why: "Sunset Jazz on the Lawn is Friday at 6 pm in Freedom Park, and nobody travels more than 99 minutes." }, // 99 is invented
    { id: idOf(user, "Picnic at Ikoyi Garden"), why: "Ikoyi Garden again: 3 of you came last time." },
    { id: idOf(user, "Freedom Park"), why: "Freedom Park is open air and the forecast is dry." },
  ] });
  const { ideas, ai, cache } = await setup({ rank });
  let charged = 0;
  const card = await ideas.getIdeas({ slug: "uni-guys", token: "tok_tolu", when: "weekend", onMiss: () => charged++ });
  assert.equal(card.ideas.length, 3);
  assert.equal(card.by, "gemma");
  assert.deepEqual(card.ideas.map((i) => i.kind), ["event", "usual", "place"]);
  const [ev, usual, place] = card.ideas;
  // the event: credited to its guide and linked to the post, with the post's own ticket link
  assert.equal(ev.title, "Sunset Jazz on the Lawn");
  assert.deepEqual(ev.source, { name: "Awe Lagos", url: "https://guide-a.example.com/p/your-weekend-guide-2325-october", credit: "From Awe Lagos' weekly guide" });
  assert.equal(ev.ticketUrl, "https://tickets.example.org/sunset-jazz");
  assert.equal(ev.when, "Tomorrow, 6 pm to 9 pm");
  assert.equal(ev.by, "code", "the invented 99 minutes was not kept");
  assert.match(ev.why, /^Awe Lagos lists Sunset Jazz on the Lawn \(₦5,000\)/);
  assert.equal(usual.by, "gemma");
  assert.equal(usual.title, "Picnic at Ikoyi Garden");
  assert.equal(place.title, "Freedom Park");
  assert.ok(!("source" in usual) && !("source" in place), "only events carry a source");
  // each draft goes through the existing create flow as it is
  for (const i of card.ideas) assert.equal(validateDraft(i.draftPlan, { tz: LAGOS_TZ }).ok, true, i.title);
  assert.equal(ev.draftPlan.kind, "found");
  assert.equal(ev.draftPlan.start, "2026-10-23T18:00:00+01:00");
  assert.equal(ev.draftPlan.source.url, "https://tickets.example.org/sunset-jazz");
  // the guides' events that passed (Thursday's 7 am yoga) never show
  const pool = JSON.stringify(ai.calls.find((c) => c.task === "rank-ideas")?.messages);
  assert.ok(!pool.includes("YOGA"), "the past event is filtered before ranking");
  assert.ok(!pool.includes("Tolu") && !pool.includes("Amaka"), "no member names go to Gemma");
  // stored: facts only, never the posts' text
  const facts = await cache.get("feedfacts:https://guide-a.example.com/p/your-weekend-guide-2325-october");
  assert.equal(facts.events.length, 4);
  assert.ok(!JSON.stringify(facts).includes("relaxed evening"));
  // cached for three hours: no new Gemma calls, no rate-limit charge
  const n = ai.calls.length;
  const again = await ideas.getIdeas({ slug: "uni-guys", token: "tok_tolu", when: "weekend", onMiss: () => charged++ });
  assert.equal(again.cached, true);
  assert.equal(ai.calls.length, n);
  assert.equal(charged, 1);
});

test("one tap: an idea's draftPlan becomes a plan through the existing create flow", async () => {
  const { ideas, service } = await setup({ rank: (/** @type {string} */ user) => ({ picks: [{ id: idOf(user, "Sunset Jazz on the Lawn"), why: "x" }] }) });
  const card = await ideas.getIdeas({ slug: "uni-guys", token: "tok_amaka", when: "weekend" });
  const ev = card.ideas.find((i) => i.kind === "event");
  const r = await service.addPlan({ slug: "uni-guys", token: "tok_amaka", body: { plan: ev?.draftPlan } });
  assert.equal(r.plan.title, "Sunset Jazz on the Lawn");
  assert.equal(r.plan.kind, "found");
  assert.equal(r.plan.source.url, "https://tickets.example.org/sunset-jazz");
});

test("Gemma away: the card still comes, in the code's order with the code's reasons; rain leaves outdoor places out", async () => {
  const { ideas } = await setup({ extract: null, rain: () => 90 });
  const card = await ideas.getIdeas({ slug: "uni-guys", token: "inv_ideas_token", when: "weekend" });
  assert.equal(card.by, "code");
  assert.ok(card.ideas.every((i) => !i.place.outdoor), "no outdoor idea in the rain");
  assert.ok(card.notes.some((n) => /Rain is forecast/.test(n)));
  assert.ok(card.ideas.every((i) => i.kind !== "event"), "no guide events without Gemma to read them");
});

test("tonight: only what starts this evening; a bad slot is refused; a wrong token is refused", async () => {
  const { ideas } = await setup({ rank: { picks: [] } });
  const card = await ideas.getIdeas({ slug: "uni-guys", token: "tok_tolu", when: "tonight" });
  for (const i of card.ideas) assert.match(i.start, /^2026-10-22T(1[6-9]|2\d)/, i.title);
  await assert.rejects(ideas.getIdeas({ slug: "uni-guys", token: "tok_tolu", when: "brunch" }), /tonight/);
  await assert.rejects(ideas.getIdeas({ slug: "uni-guys", token: "nope", when: "tonight" }), (e) => /** @type {any} */ (e).code === "bad_token");
});

test("HTTP: GET /api/crews/:slug/ideas?when= answers the card; a bad slot is a 400; a server without ideas says so", async () => {
  const { ideas, service } = await setup({ rank: { picks: [] } });
  const cfg = config({ PUBLIC_URL: "https://x.test", STATIC_DIR: "/nonexistent" });
  for (const [withIdeas, checks] of /** @type {const} */ ([[true, "on"], [false, "off"]])) {
    const server = createApi({ service, cfg, now: () => NOW, ideas: withIdeas ? ideas : null });
    await new Promise((r) => server.listen(0, "127.0.0.1", () => r(null)));
    const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
    const get = (/** @type {string} */ q) => fetch(`${base}/api/crews/uni-guys/ideas${q}`, { headers: { authorization: "Bearer tok_tolu" } });
    try {
      if (checks === "on") {
        const ok = await get("?when=weekend");
        assert.equal(ok.status, 200);
        const body = await ok.json();
        assert.equal(body.ideas.length, 3);
        assert.ok(body.ideas.every((/** @type {any} */ i) => i.draftPlan && i.why && i.when));
        assert.equal((await get("?when=brunch")).status, 400);
      } else {
        const off = await get("?when=weekend");
        assert.equal(off.status, 503);
        assert.equal((await off.json()).error.code, "ideas_off");
      }
    } finally {
      server.close();
    }
  }
});

test("a slow map and a guide still being read: the curated spots stand in, and the card says it is partial (kept ten minutes, not three hours)", async () => {
  const { store, cache, ai } = await setup({ rank: { picks: [] } });
  const never = new Promise(() => {});
  // still reading long after the card is made, even on a loaded machine (300 ms was not)
  const slowFeeds = { async pull() { await new Promise((r) => setTimeout(r, 2000)); return { items: null, reason: "error", checkedAt: null }; } };
  const spots = [{ name: "Freedom Park", kind: "park", lat: PLACES.freedom.lat, lon: PLACES.freedom.lon }, { name: "Covered Hall", kind: "venue", covered: true, lat: 6.45, lon: 3.42 }];
  const ideas = createIdeas({
    store, cache, ai, feeds: /** @type {any} */ (slowFeeds), weather: fakeWeather({ rain: () => 10 }), geocoder: { lookup: async () => null, lookupArea: async () => null },
    candidatesNear: () => /** @type {any} */ (never), spots, prompts: loadPrompts(), now: () => NOW, placesBudgetMs: 30, refreshBudgetMs: 30,
  });
  const card = await ideas.getIdeas({ slug: "uni-guys", token: "tok_tolu", when: "weekend" });
  assert.ok(card.ideas.some((/** @type {any} */ i) => i.title === "Freedom Park"), "a curated spot");
  assert.ok(card.notes.includes("The map was slow, so fewer places were checked."));
  assert.ok(card.notes.some((/** @type {string} */ n) => /Still reading this week's guides/.test(n)));
  assert.equal(card.partial, true);
});
