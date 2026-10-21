// @ts-check
// City packs: the core works anywhere, and Lagos keeps everything it had. These tests cover
// the default pack (a Berlin, a New York and a Bengaluru crew), the pack choice, and a whole
// Berlin crew through the service with fakes.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { createService } from "../src/app/service.mjs";
import { makeIds } from "../src/app/ids.mjs";
import { loadPrompts } from "../src/app/prompts.mjs";
import { fakeAi, fakeGeocoder, fakeOverpass, fakePageMeta, fakePush, fakeWeather, fakeWikidata } from "../src/adapters/fakes.mjs";
import { createGeocoder } from "../src/adapters/geocode.mjs";
import { memoryCache } from "../src/adapters/http.mjs";
import { memoryStore } from "../src/adapters/store.mjs";
import { readWikidata, spotsQuery } from "../src/adapters/wikidata.mjs";
import { FREE_FLOW, travelEstimate } from "../src/core/geo.mjs";
import { calendarFeed, singleEvent } from "../src/core/ics.mjs";
import { estimateText, podsForPlan } from "../src/core/pods.mjs";
import { directionsLinks, ridesForApi } from "../src/core/rides.mjs";
import { PROMPT_NAMES, localisePrompt, readPlan } from "../src/core/tasks.mjs";
import { resolveDateWords, zonedToMs } from "../src/core/time.mjs";
import { GENERIC_SOCIAL_HOURS, socialWindow } from "../src/core/weather.mjs";
import { DEFAULT, LAGOS, LAGOS_REGION, cleanRegion, hintRegion, packFor, regionOf } from "../src/packs/index.mjs";
import { LAGOS_LOCAL } from "../src/packs/lagos/index.mjs";
import { makePlan } from "./fixtures/plans.mjs";

/** @type {import("../src/packs/index.mjs").Region} */
const BERLIN = { center: { lat: 52.4986, lon: 13.4033 }, countryCode: "DE", city: "Berlin", timezone: "Europe/Berlin", tzSource: "open-meteo" };
/** @type {import("../src/packs/index.mjs").Region} */
const NYC = { center: { lat: 40.6782, lon: -73.9442 }, countryCode: "US", city: "New York", timezone: "America/New_York", tzSource: "open-meteo" };
/** @type {import("../src/packs/index.mjs").Region} */
const ABUJA = { center: { lat: 9.0765, lon: 7.3986 }, countryCode: "NG", city: "Abuja", timezone: "Africa/Lagos", tzSource: "open-meteo" };

test("the pack follows the region; a crew from before regions is in Lagos", () => {
  assert.equal(packFor(regionOf({})).id, "lagos");
  assert.equal(packFor(regionOf({ tz: "Africa/Lagos" })).id, "lagos");
  assert.equal(packFor(LAGOS_REGION).id, "lagos");
  assert.equal(packFor(BERLIN).id, "default");
  assert.equal(packFor(ABUJA).id, "default", "Nigeria outside Lagos has no pack yet");
  assert.equal(packFor({ ...LAGOS_REGION, center: null, city: "Lagos" }).id, "lagos");
  assert.equal(hintRegion(null).city, "Lagos", "no hint: Lagos, as before");
  assert.equal(hintRegion({ tz: "Africa/Lagos" }).city, "Lagos");
  assert.deepEqual(hintRegion({ tz: "Europe/Berlin" }), { center: null, countryCode: null, city: null, timezone: "Europe/Berlin", tzSource: "browser" });
  assert.equal(hintRegion({ tz: "Not/AZone" }).city, "Lagos", "a bad zone is ignored");
  assert.equal(cleanRegion({ timezone: "Mars/Olympus" }), null);
  assert.deepEqual(cleanRegion({ center: { lat: 52.5, lon: 13.4 }, countryCode: "de", city: " Berlin ", timezone: "Europe/Berlin", tzSource: "open-meteo" }), { center: { lat: 52.5, lon: 13.4 }, countryCode: "DE", city: "Berlin", timezone: "Europe/Berlin", tzSource: "open-meteo" });
});

test("the Lagos pack renders the prompts exactly as they were before the app went global", () => {
  const before = JSON.parse(fs.readFileSync(new URL("./fixtures/lagos-prompts.json", import.meta.url), "utf8"));
  const now = loadPrompts();
  for (const n of PROMPT_NAMES) assert.deepEqual(localisePrompt(now[n], LAGOS_LOCAL), before[n], n);
});

test("elsewhere the prompts name the crew's city, and Pidgin hints only for Nigeria and Ghana", () => {
  const p = loadPrompts();
  const berlin = localisePrompt(p["parse-plan"], DEFAULT.local(BERLIN));
  assert.match(berlin.system, /Today is \{\{weekday\}\} \{\{today\}\} in Berlin, Germany\./);
  assert.ok(!/Lagos|Pidgin|naira|Lekki/i.test(berlin.system), "nothing from Lagos");
  const crew = localisePrompt(p["parse-crew"], DEFAULT.local(BERLIN)).system;
  assert.match(crew, /meetups in Berlin, Germany\./);
  assert.match(crew, /- areas: the Berlin neighbourhoods they mention, as written, or an empty list\./);
  const anywhere = localisePrompt(p["parse-crew"], {}).system;
  assert.match(anywhere, /for an app that organises meetups\. Extract/);
  assert.match(anywhere, /- areas: the neighbourhoods or areas they mention, as written, or an empty list\./);
  for (const n of PROMPT_NAMES) assert.ok(!/\{\{(inCity|inCityCountry|areaNoun|areaNounOne|areaExamples|areaExample|priceExample|localNotes|crewNotes)\}\}/.test(JSON.stringify(localisePrompt(p[n], {}))), `${n}: every place slot filled`);
  assert.match(localisePrompt(p["parse-plan"], DEFAULT.local(ABUJA)).system, /Nigerian Pidgin/);
  assert.match(localisePrompt(p["parse-plan"], DEFAULT.local({ ...BERLIN, countryCode: "GH", city: "Accra" })).system, /Ghanaian Pidgin/);
  assert.match(localisePrompt(p["explain-pick"], DEFAULT.local(NYC)).system, /a group of friends in New York why/);
});

test("generic travel: OSRM's own driving time, no traffic bands, no water crossing, and it says so", () => {
  const a = { lat: 52.4986, lon: 13.4033 };
  const b = { lat: 52.4811, lon: 13.4353 };
  const road = travelEstimate(a, b, { at: zonedToMs("2026-10-23", "18:00", "Europe/Berlin"), tz: "Europe/Berlin", route: { km: 3.4, min: 7.2, bridges: ["Oberbaumbrücke"] } });
  assert.deepEqual({ minutes: road.minutes, band: road.band, crosses: road.crossesLagoon, bridge: road.bridge, source: road.source }, { minutes: 7, band: null, crosses: false, bridge: null, source: "road" });
  assert.equal(estimateText(road), "A rough estimate, not live traffic: 3.4 km by road, at OSRM's driving time with empty roads, so allow for traffic. Route: OSRM, OpenStreetMap data.");
  const straight = travelEstimate(a, b);
  assert.equal(straight.minutes, Math.max(5, Math.round(((straight.km * 1.4) / 25) * 60)));
  assert.match(estimateText(straight, { bufferMin: 15 }), /km at about 25 km\/h \(the road route was not available, so this is the straight line plus 40%\)\. Leave-by adds 15 min to spare\.$/);
  assert.ok(!/lagoon|rush|Saturday/i.test(estimateText(straight)));
  const plan = { start: "2026-10-25T15:00:00+01:00", tz: "Europe/Berlin", place: { name: "Tempelhofer Feld", address: null, lat: 52.4733, lon: 13.4017 } };
  const { pods } = podsForPlan(plan, [{ id: "a", name: "Lena", area: { label: "Kreuzberg", ...a } }, { id: "b", name: "Jonas", area: { label: "Neukölln", ...b } }], { model: FREE_FLOW });
  assert.equal(pods.length, 1, "neighbours share a ride; no lagoon splits them");
  assert.equal(pods[0].estimate?.speedKmh, null);
  assert.equal(pods[0].crossesLagoon, false);
  assert.match(pods[0].leaveBy || "", /^2026-10-25T14:\d\d:00\+01:00$/, "Berlin time, after the clocks went back that morning");
});

test("rides elsewhere: no provider named, and directions that work on every phone", () => {
  assert.deepEqual(ridesForApi(DEFAULT.rides), []);
  assert.deepEqual(ridesForApi(LAGOS.rides).map((r) => r.id), ["bolt", "indrive", "lagride"]);
  const d = directionsLinks({ name: "Görlitzer Park", address: "Görlitzer Straße", lat: 52.4966, lon: 13.4375 });
  assert.deepEqual(d, {
    android: "geo:0,0?q=52.496600%2C13.437500(G%C3%B6rlitzer%20Park)",
    ios: "https://maps.apple.com/directions?destination=52.496600%2C13.437500&mode=driving",
    web: "https://www.google.com/maps/dir/?api=1&destination=52.496600%2C13.437500&travelmode=driving",
  });
  assert.deepEqual(directionsLinks({ name: "The Mango Yard", address: "14 Adeyemo Close, Surulere", lat: null, lon: null })?.web, "https://www.google.com/maps/dir/?api=1&destination=The%20Mango%20Yard%2C%2014%20Adeyemo%20Close%2C%20Surulere&travelmode=driving");
  assert.equal(directionsLinks({ name: "Tolu's place", address: null, lat: null, lon: null, private: true }), null, "a home with no address has nowhere to go");
});

test("generic social hours: weekends 11 to 7, weekday evenings 5:30 to 9", () => {
  assert.deepEqual(socialWindow("2026-10-24"), { from: "11:00", to: "19:00" });
  assert.deepEqual(socialWindow("2026-10-21"), { from: "17:30", to: "21:00" });
  assert.deepEqual(GENERIC_SOCIAL_HOURS.weekendCovered, { from: "11:00", to: "19:00" });
  assert.deepEqual(socialWindow("2026-10-24", { social: LAGOS.social }), { from: "11:00", to: "18:30" }, "Lagos keeps its own");
});

test("dates, prices and currency: from the source and the country, never assumed", () => {
  assert.equal(resolveDateWords("10/23", "2026-10-21", { monthFirst: true }), "2026-10-23");
  assert.equal(resolveDateWords("23/10", "2026-10-21"), "2026-10-23");
  assert.equal(resolveDateWords("10/23", "2026-10-21"), null, "day first, there is no month 23");
  const member = { id: "m", name: "Ana" };
  const ny = readPlan({ title: "Rooftop", dateWords: "10/24", startTime: "7pm", confidence: {} }, { text: "Rooftop 10/24 7pm", today: "2026-10-21", tz: "America/New_York", member, local: DEFAULT.local(NYC) });
  assert.equal(ny.draft.start, "2026-10-24T19:00:00-04:00");
  const usdPage = { title: "Show", event: { name: "Show", startDate: "2026-10-31T20:00:00+01:00", price: "USD 20", free: false, currency: "USD" } };
  const berlin = readPlan({}, { url: "https://e.test", pageMeta: usdPage, today: "2026-10-21", tz: "Europe/Berlin", member, local: DEFAULT.local(BERLIN) });
  assert.ok(berlin.notes.includes("The page lists the price in USD, not the local currency (EUR). Check what you will pay with the organiser."));
  assert.equal(berlin.draft.start, "2026-10-31T20:00:00+01:00");
  const nowhere = readPlan({}, { url: "https://e.test", pageMeta: usdPage, today: "2026-10-21", tz: "UTC", member });
  assert.ok(!nowhere.notes.some((n) => /local currency|naira/.test(n)), "no known currency, no note");
  const caret = readPlan({ title: "Gig", priceText: "^15", confidence: {} }, { image: { mimeType: "image/png", data: "x" }, today: "2026-10-21", tz: "Europe/Berlin", member, local: DEFAULT.local(BERLIN) });
  assert.equal(caret.draft.price?.text, "^15", "the naira repair is for Nigeria only");
});

test("calendar files: a fixed-offset zone gets a VTIMEZONE; a zone with daylight saving is written in UTC", () => {
  const kolkata = singleEvent(makePlan({ tz: "Asia/Kolkata", start: "2026-10-24T16:00:00+05:30", end: "2026-10-24T19:00:00+05:30" }), { uidDomain: "x" });
  assert.match(kolkata, /\r\nDTSTART;TZID=Asia\/Kolkata:20261024T160000\r\n/);
  assert.match(kolkata, /\r\nBEGIN:VTIMEZONE\r\nTZID:Asia\/Kolkata\r\nX-LIC-LOCATION:Asia\/Kolkata\r\nBEGIN:STANDARD\r\nTZOFFSETFROM:\+0530\r\nTZOFFSETTO:\+0530\r\nDTSTART:19700101T000000\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n/);
  const nairobi = singleEvent(makePlan({ tz: "Africa/Nairobi", start: "2026-10-24T16:00:00+03:00", end: "2026-10-24T19:00:00+03:00" }), { uidDomain: "x" });
  assert.match(nairobi, /TZOFFSETFROM:\+0300/);
  const berlin = singleEvent(makePlan({ tz: "Europe/Berlin", start: "2026-10-25T15:00:00+01:00", end: "2026-10-25T18:00:00+01:00" }), { uidDomain: "x" });
  assert.match(berlin, /\r\nDTSTART:20261025T140000Z\r\n/);
  assert.ok(!/VTIMEZONE|TZID/.test(berlin));
  const ny = calendarFeed({ crew: { name: "NY", tz: "America/New_York" }, member: { id: "m1" }, plans: [makePlan({ tz: "America/New_York", start: "2026-10-24T19:00:00-04:00", end: "2026-10-24T22:00:00-04:00" })], now: Date.parse("2026-10-21T00:00:00Z"), uidDomain: "x" });
  assert.match(ny, /\r\nDTSTART:20261024T230000Z\r\n/);
  const lagos = singleEvent(makePlan(), { uidDomain: "x", zoneNames: LAGOS.zoneNames });
  assert.match(lagos, /\r\nTZOFFSETTO:\+0100\r\nTZNAME:WAT\r\n/, "Lagos keeps its WAT block");
});

test("geocoding elsewhere: biased to the crew, no city added, and the city only to rescue a far-away hit", async () => {
  const feature = (/** @type {string} */ name, /** @type {number} */ lat, /** @type {number} */ lon, /** @type {string} */ cc, /** @type {string} */ city) => ({ geometry: { coordinates: [lon, lat] }, properties: { name, countrycode: cc, city, osm_key: "place", type: "district" } });
  /** @type {{ url: string }[]} */
  const calls = [];
  const fetchImpl = /** @type {any} */ (async (/** @type {string} */ url) => {
    calls.push({ url });
    const q = new URL(url).searchParams.get("q");
    const body = q === "westlands" ? { features: [feature("Westlands", 51.43, -0.1, "GB", "London")] }
      : q === "westlands, nairobi" ? { features: [feature("Westlands", -1.2676, 36.8108, "KE", "Nairobi")] }
      : { features: [feature("Kreuzberg", 52.4986, 13.4033, "DE", "Berlin")] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
  const geo = createGeocoder({ provider: "photon", photonUrl: "https://photon.test", nominatimUrl: "", contact: "t", cache: memoryCache(), fetchImpl });
  const k = await geo.lookupArea("Kreuzberg", DEFAULT.geocode(BERLIN));
  assert.deepEqual({ label: k?.label, country: k?.country, city: k?.city }, { label: "Kreuzberg", country: "DE", city: "Berlin" });
  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get("q"), "kreuzberg", "no city appended");
  assert.equal(u.searchParams.get("lat"), "52.4986");
  const nairobi = { center: { lat: -1.2921, lon: 36.8219 }, countryCode: null, city: "Nairobi", timezone: "Africa/Nairobi", tzSource: /** @type {const} */ ("open-meteo") };
  const w = await geo.lookupArea("Westlands", DEFAULT.geocode(nairobi));
  assert.equal(w?.country, "KE", "the London one is too far from the crew; the city is added and the Nairobi one wins");
  assert.ok(calls.some((c) => new URL(c.url).searchParams.get("q") === "westlands, nairobi"));
});

test("Wikidata: a bounded query by coordinates, and named parks, gardens and beaches back", () => {
  const q = spotsQuery({ lat: 52.5, lon: 13.4 }, 6);
  assert.match(q, /wikibase:center "Point\(13\.40000 52\.50000\)"\^\^geo:wktLiteral/);
  assert.match(q, /wikibase:radius "6\.0"/);
  assert.match(q, /VALUES \?type \{ wd:Q22698 wd:Q22746 wd:Q1107656 wd:Q167346 wd:Q40080 \}/);
  assert.match(q, /LIMIT 60$/);
  const json = { results: { bindings: [
    { item: { value: "http://www.wikidata.org/entity/Q694599" }, itemLabel: { value: "Görlitzer Park" }, type: { value: "http://www.wikidata.org/entity/Q22698" }, coord: { value: "Point(13.4375 52.4966)" } },
    { item: { value: "http://www.wikidata.org/entity/Q694599" }, itemLabel: { value: "Görlitzer Park" }, type: { value: "http://www.wikidata.org/entity/Q22746" }, coord: { value: "Point(13.4375 52.4966)" } },
    { item: { value: "http://www.wikidata.org/entity/Q1" }, itemLabel: { value: "Q1" }, type: { value: "http://www.wikidata.org/entity/Q22698" }, coord: { value: "Point(13 52)" } },
  ] } };
  const r = readWikidata(json, "2026-10-21");
  assert.equal(r.length, 1, "once each, and never an unlabelled item");
  assert.deepEqual({ name: r[0].name, lat: r[0].lat, lon: r[0].lon, tags: r[0].tags, outdoor: r[0].outdoor, url: r[0].source?.url }, { name: "Görlitzer Park", lat: 52.4966, lon: 13.4375, tags: { name: "Görlitzer Park", leisure: "park" }, outdoor: true, url: "https://www.wikidata.org/wiki/Q694599" });
});

test("a Berlin crew end to end: region, Berlin times, Wikidata's park, directions instead of ride apps", async () => {
  const store = memoryStore();
  const goerli = { name: "Görlitzer Park", lat: 52.4966, lon: 13.4375, tags: { name: "Görlitzer Park", leisure: "park" }, outdoor: true, wikidata: "Q694599" };
  const answers = {
    "parse-crew": { name: "the Kreuzberg lot", vibe: "somewhere green, cheap", vibeTags: ["green"], budget: "cheap", every: "2w", day: "Sunday", from: null, to: null, areas: ["Kreuzberg"], confidence: { name: 0.9, vibe: 0.9, rhythm: 0.9, areas: 0.9 } },
    "parse-plan": { kind: "quick", title: "Späti hang", dateWords: "sunday", date: null, startTime: "3pm", endTime: null, atHost: false, venueName: "Görlitzer Park", address: null, outdoor: true, priceText: null, free: null, hostName: null, bring: [], confidence: { title: 0.9, date: 0.9, time: 0.9, place: 0.9, price: 0, host: 0 } },
  };
  const ai = fakeAi({ answers });
  const wikidata = fakeWikidata([goerli]);
  const now = () => Date.parse("2026-10-21T09:00:00Z");
  const svc = createService({ store, ai, geocoder: fakeGeocoder(), places: fakeOverpass([]), weather: fakeWeather({ rain: () => 5 }), wikidata, pages: fakePageMeta(), push: fakePush(), spots: [{ name: "Freedom Park", lat: 6.4488, lon: 3.3965, kind: "park" }], prompts: loadPrompts(), ids: makeIds(), now, cfg: { publicUrl: "https://x.test", webUrl: "https://x.test", uidDomain: "x.test" } });

  const sentence = "the Kreuzberg lot, every other Sunday, somewhere green, cheap";
  const d = await svc.draftCrew({ sentence, hint: { tz: "Europe/Berlin" } });
  assert.ok(!/Lagos|Pidgin/.test(ai.calls[0].messages[0].content), "the crew prompt says nothing about Lagos");
  assert.deepEqual(d.draft.region, { center: { lat: 52.4986, lon: 13.4033 }, countryCode: "DE", city: "Berlin", timezone: "Europe/Berlin", tzSource: "open-meteo" });
  assert.equal(d.pack.id, "default");
  assert.equal(d.pack.directions, true);
  assert.equal(d.draft.rhythm?.day, 0);

  const made = await svc.createCrew({ confirm: d.draft, organiser: { name: "Lena", area: "Neukölln" } });
  assert.equal(made.crew.tz, "Europe/Berlin");
  assert.equal(made.crew.region.city, "Berlin");
  assert.equal(made.crew.pack.id, "default");
  assert.equal(made.crew.pack.areaPlaceholder, "Your neighbourhood");
  const lena = /** @type {any} */ (made).memberToken;
  const crew = await store.get("crews", made.crew.id);
  assert.equal((await store.get("members", /** @type {any} */ (made).member.id)).area.label, "Neukölln");

  const parsed = await svc.parsePlan({ slug: made.crew.slug, token: lena, text: "späti hang at görli sunday 3pm" });
  assert.ok(/in Berlin, Germany/.test(ai.calls[1].messages[0].content), "the plan prompt names Berlin");
  assert.equal(parsed.draft.start, "2026-10-25T15:00:00+01:00", "Sunday 3 pm in Berlin, after the clocks went back");
  const added = await svc.addPlan({ slug: made.crew.slug, token: lena, body: { plan: { ...parsed.draft, place: { ...parsed.draft.place, lat: goerli.lat, lon: goerli.lon } } } });
  await svc.patchPlan({ id: added.plan.id, token: lena, body: { rsvp: "going" } });
  const pods = await svc.getPods({ id: added.plan.id, token: lena });
  assert.deepEqual(pods.rides, [], "no ride app named in Berlin");
  assert.match(pods.directions?.ios || "", /^https:\/\/maps\.apple\.com\/directions\?destination=52\.496600%2C13\.437500&mode=driving$/);
  assert.match(pods.pods[0].estimate?.text || "", /^A rough estimate, not live traffic: [\d.]+ km at about 25 km\/h/);

  const r = await svc._internal.makeRitual(crew, { date: "2026-11-01", window: { from: "15:00", to: "19:00" } }, []);
  assert.equal(r.made, true);
  assert.equal(r.plan?.place.name, "Görlitzer Park", "Wikidata's park, not a Lagos spot");
  assert.equal(r.plan?.tz, "Europe/Berlin");
  assert.match(r.plan?.start || "", /^2026-11-01T1[5-6]:00:00\+01:00$/, "Berlin time (CET), after the heat in the fake forecast");
  assert.ok((r.plan?.end || "") <= "2026-11-01T19:00:00+01:00", "inside the generic social hours");
  assert.equal(wikidata.calls.length, 1);
  const explain = ai.calls.find((c) => c.task === "explain-pick");
  assert.match(explain?.messages[0].content || "", /a group of friends in Berlin why/);
  const ics = await svc.feed({ calToken: (await store.get("members", /** @type {any} */ (made).member.id)).calToken });
  assert.match(ics, /\r\nDTSTART:20261025T140000Z\r\n/, "Berlin has daylight saving, so UTC: 3 pm CET is 14:00Z");
  assert.ok(!/VTIMEZONE/.test(ics));
  assert.match(ics, /X-WR-TIMEZONE:Europe\/Berlin/);
});

test("a crew from before regions still gets Lagos: ride apps, the lagoon, Lagos times", async () => {
  const store = memoryStore();
  const svc = createService({ store, ai: fakeAi({ answers: {} }), geocoder: fakeGeocoder(), places: fakeOverpass([]), weather: fakeWeather(), pages: fakePageMeta(), push: fakePush(), spots: [], prompts: loadPrompts(), ids: makeIds(), now: () => Date.parse("2026-10-21T09:00:00Z"), cfg: { publicUrl: "https://x.test", webUrl: "https://x.test", uidDomain: "x.test" } });
  const made = await svc.createCrew({ confirm: { name: "Old crew", areas: [{ label: "Yaba", lat: 6.5095, lon: 3.3711 }] } });
  assert.equal(made.crew.pack.id, "lagos");
  assert.equal(made.crew.tz, "Africa/Lagos");
  assert.equal(made.crew.pack.areaPlaceholder, "Yaba, Lekki Phase 1, Ikeja...");
  const legacy = { id: "c_old", slug: "old", name: "Old", rhythm: null, areas: [], createdAt: "2026-10-01T00:00:00.000Z", inviteToken: "inv", tz: "Africa/Lagos" };
  await store.put("crews", legacy);
  const view = await svc.getCrew({ slug: "old", token: "inv" });
  assert.equal(view.crew.pack.id, "lagos");
  assert.equal(view.crew.region.city, "Lagos");
});
