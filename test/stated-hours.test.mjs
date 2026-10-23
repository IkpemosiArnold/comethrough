// @ts-check
// A crew's own stated time wins (Arnold, 23 Oct 2026): a 7 am run club gets a 7 am plan, a
// night crew an evening plan, and the social hours apply only to a crew that gave no time.
// The safety and weather rules stay: outdoors keeps to daylight by the forecast's is_day (a
// crew with a safety need is never outdoors in the dark), rain is handled as before, and a
// place whose opening hours say it is closed is never offered; at 7 am a roofed place is
// offered only when its hours say it is open, and the sloth says so when none is.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createService } from "../src/app/service.mjs";
import { createIdeas } from "../src/app/ideas.mjs";
import { memoryCache } from "../src/adapters/http.mjs";
import { makeIds } from "../src/app/ids.mjs";
import { loadPrompts } from "../src/app/prompts.mjs";
import { fakeAi, fakeGeocoder, fakeOverpass, fakePageMeta, fakePush, fakeWeather } from "../src/adapters/fakes.mjs";
import { memoryStore } from "../src/adapters/store.mjs";
import { crewHours, daylightPart, mayOffer, openDuring, openIntervals, timeSaid } from "../src/core/hours.mjs";
import { placeCandidates, slotFor } from "../src/core/ideas.mjs";
import { readCrewSetup } from "../src/core/tasks.mjs";
import { cleanTaste } from "../src/core/taste.mjs";
import { LAGOS_LOCAL, SOCIAL_HOURS } from "../src/packs/lagos/index.mjs";

const now = () => Date.parse("2026-10-21T09:00:00Z"); // a Wednesday
const cfg = { publicUrl: "https://x.test", webUrl: "https://x.test", uidDomain: "x.test" };
const SAT = "2026-10-24";
const node = (/** @type {string} */ name, /** @type {number} */ lat, /** @type {number} */ lon, /** @type {Record<string, string>} */ tags) => ({ name, lat, lon, osm: { type: /** @type {"node"} */ ("node"), id: Math.round((lat + lon) * 1e4), tags: { name, ...tags } } });
const YABA = { label: "Yaba", lat: 6.5095, lon: 3.3711 };
const SURULERE = { label: "Surulere", lat: 6.5, lon: 3.35 };
const PARK = node("Yaba Park", 6.506, 3.365, { leisure: "park" });

/** Lagos-like hours: light from 7:00 to 18:59 (Open-Meteo's is_day), rain as asked. */
function weatherWith({ rain = (/** @type {number} */ _h) => 10, light = true } = {}) {
  return {
    ...fakeWeather(),
    async hourly() {
      const out = [];
      for (const date of ["2026-10-23", SAT, "2026-10-25"]) {
        for (let h = 0; h < 24; h++) out.push({ date, time: `${String(h).padStart(2, "0")}:00`, rainProb: rain(h), feelsC: 28, uv: 2, precipMm: 0, ...(light ? { isDay: /** @type {0|1} */ (h >= 7 && h < 19 ? 1 : 0) } : {}) });
      }
      return out;
    },
  };
}

const crewOf = (/** @type {any} */ rhythm, /** @type {any} */ taste = null) => ({ id: "c_hours", slug: "hours", name: "Hours crew", vibe: null, vibeTags: [], budget: "any", taste, rhythm, areas: [YABA, SURULERE], tz: "Africa/Lagos", region: { center: { lat: 6.505, lon: 3.36 }, countryCode: "NG", city: "Lagos", timezone: "Africa/Lagos", tzSource: "open-meteo" }, createdAt: "2026-10-01T00:00:00.000Z", inviteToken: "inv_hours" });

async function ritual(/** @type {any} */ crew, { green = [PARK], kinds = /** @type {any[]} */ ([]), weather = weatherWith() } = {}) {
  const store = memoryStore();
  /** @type {any[]} */
  const logs = [];
  const svc = createService({ store, ai: fakeAi({ answers: {} }), geocoder: fakeGeocoder(), places: fakeOverpass(green, kinds), weather, pages: fakePageMeta(), push: fakePush(), spots: [], prompts: loadPrompts(), ids: makeIds(), now, cfg, log: (e, f) => logs.push({ e, ...f }) });
  await store.put("crews", crew);
  const r = await svc._internal.makeRitual(crew, { date: SAT, window: crew.rhythm.window }, []);
  return { ...r, logs };
}

const RUN_CLUB = { every: "1w", day: 6, window: { from: "07:00", to: "11:00" }, said: true };
const NIGHT = { every: "1w", day: 6, window: { from: "21:00", to: "23:59" }, said: true };

test("the 7 am run club gets a 7 am plan, at a park, in daylight", async () => {
  const r = await ritual(crewOf(RUN_CLUB));
  assert.ok(r.made, JSON.stringify({ reason: r.reason }));
  assert.equal(r.plan?.place.name, "Yaba Park");
  assert.match(String(r.plan?.start), /^2026-10-24T07:00/);
  // the sentence that says it is read as a stated rhythm
  const s = "Run club, Saturday mornings around 7am, around Yaba";
  const read = readCrewSetup({ name: "Run club", vibe: null, vibeTags: [], budget: null, every: null, day: "Saturday", from: "7am", to: null, areas: ["Yaba"], taste: {}, confidence: {} }, { sentence: s }, LAGOS_LOCAL).draft.rhythm;
  assert.deepEqual(read, { every: "1w", day: 6, window: { from: "07:00", to: "11:00" }, said: true });
});

test("a night crew gets an evening plan under a roof, at a place open then", async () => {
  const kinds = [
    node("Late Lounge", 6.507, 3.366, { amenity: "bar", opening_hours: "Mo-Su 18:00-02:00" }),
    node("Day Bar", 6.505, 3.365, { amenity: "bar", opening_hours: "Mo-Su 10:00-20:00" }),
    node("Mystery Bar", 6.504, 3.364, { amenity: "bar" }),
  ];
  const r = await ritual(crewOf(NIGHT, cleanTaste({ placeKinds: ["bar"] })), { kinds });
  assert.ok(r.made, JSON.stringify({ reason: r.reason }));
  assert.equal(r.plan?.place.name, "Late Lounge", "not the bar that closes at 8 pm, nor one whose hours are unknown at 9 pm");
  assert.match(String(r.plan?.start), /^2026-10-24T21:00/);
  assert.equal(r.plan?.place.outdoor, false, "after dark, under a roof");
});

test("a crew with no stated time keeps the social hours; a time the model made up is not the crew's", async () => {
  const usual = await ritual(crewOf({ every: "1w", day: 6, window: { from: "15:00", to: "19:00" }, said: false }));
  assert.ok(usual.made);
  assert.ok(String(usual.plan?.end) <= "2026-10-24T18:30:00+01:00", `ends by the social hours' 6:30 pm: ${usual.plan?.end}`);
  // a 7 am window that is not the crew's own (the model's guess): the social hours still apply
  const guessed = await ritual(crewOf({ ...RUN_CLUB, said: false }));
  assert.equal(guessed.made, false);
  assert.equal(guessed.reason, "no_window");
  const notSaid = readCrewSetup({ every: "2w", day: "Saturday", from: "3pm", to: "7pm", areas: ["Yaba"], taste: {}, confidence: {} }, { sentence: "the uni guys, every other Saturday, around Yaba" }, LAGOS_LOCAL).draft.rhythm;
  assert.equal(notSaid?.said, false, "a 3pm the sentence does not say");
  assert.equal(timeSaid({ window: { from: "15:00", to: "19:00" } }), false, "an old crew with the default window");
  assert.equal(timeSaid({ window: { from: "09:00", to: "12:00" } }), true, "an old crew that said a morning");
  assert.equal(crewHours(SOCIAL_HOURS, { from: "07:00", to: "11:00" }, false), SOCIAL_HOURS);
});

test("safety: a crew with a safety need is never outdoors in the dark, by the forecast's daylight", async () => {
  const dawn = { every: "1w", day: 6, window: { from: "05:00", to: "08:00" }, said: true };
  const safe = cleanTaste({ needs: ["safe"] });
  const r = await ritual(crewOf(dawn, safe));
  assert.ok(r.made, JSON.stringify({ reason: r.reason }));
  assert.match(String(r.plan?.start), /^2026-10-24T07:00/, "from first light, not 5 am");
  // no daylight in the forecast: a safety crew keeps to the pack's outdoor hours, so 5 to 8 am has none
  const dark = await ritual(crewOf(dawn, safe), { weather: weatherWith({ light: false }) });
  assert.equal(dark.made, false);
  // a night crew with a safety need gets no park at 9 pm, even on a dry night
  const night = await ritual(crewOf(NIGHT, safe));
  assert.equal(night.made, false);
  assert.ok(["nothing_open", "no_places", "no_window"].includes(String(night.reason)), String(night.reason));
});

test("rain at 7 am: a roofed place only when its hours say it is open; else the sloth says nothing is open", async () => {
  const wet = weatherWith({ rain: (h) => (h < 12 ? 90 : 10) });
  const closed = [node("Brunch Spot", 6.507, 3.366, { amenity: "cafe", opening_hours: "Mo-Su 10:00-18:00" }), node("Quiet Cafe", 6.506, 3.367, { amenity: "cafe" })];
  const none = await ritual(crewOf(RUN_CLUB, cleanTaste({ placeKinds: ["cafe"] })), { kinds: closed, weather: wet });
  assert.equal(none.made, false);
  assert.equal(none.reason, "nothing_open");
  assert.ok(none.logs.some((l) => l.e === "ritual_not_made" && l.reason === "nothing_open"));
  const early = [...closed, node("Early Bird Cafe", 6.508, 3.368, { amenity: "cafe", opening_hours: "Mo-Su 06:30-15:00" })];
  const r = await ritual(crewOf(RUN_CLUB, cleanTaste({ placeKinds: ["cafe"] })), { kinds: early, weather: wet });
  assert.equal(r.plan?.place.name, "Early Bird Cafe");
  assert.match(String(r.plan?.start), /^2026-10-24T07:00/);
});

test("ideas: a stated window shapes the days, and places are offered only when open", () => {
  const t = Date.parse("2026-10-21T09:00:00Z");
  const stated = slotFor("weekend", t, "Africa/Lagos", crewHours(SOCIAL_HOURS, RUN_CLUB.window, true), RUN_CLUB.window, { stated: true, usual: SOCIAL_HOURS });
  const sat = stated.days.find((d) => d.date === SAT);
  assert.deepEqual(sat, { date: SAT, outdoor: { from: "07:00", to: "11:00" }, covered: { from: "07:00", to: "11:00" } });
  assert.ok(!stated.days.some((d) => d.date === "2026-10-23"), "no Friday evening for a morning crew");
  const usual = slotFor("weekend", t, "Africa/Lagos", SOCIAL_HOURS, RUN_CLUB.window);
  assert.equal(usual.days.length, 0, "the social hours alone leave a 7 am crew nothing, as before");
  const hours = [];
  for (const date of [SAT, "2026-10-25"]) for (let h = 0; h < 24; h++) hours.push({ date, time: `${String(h).padStart(2, "0")}:00`, rainProb: 10, feelsC: 26, uv: 1, precipMm: 0, isDay: /** @type {0|1} */ (h >= 7 && h < 19 ? 1 : 0) });
  const places = [{ ...PARK, outdoor: true }, { ...node("Quiet Cafe", 6.506, 3.367, { amenity: "cafe" }), indoor: true }, { ...node("Early Bird Cafe", 6.508, 3.368, { amenity: "cafe", opening_hours: "Mo-Su 06:30-15:00" }), indoor: true }];
  const pl = placeCandidates(places, { slot: stated, center: { lat: 6.505, lon: 3.36 }, points: [{ id: "a", name: "A", area: YABA }], hours, crew: { budget: "any", taste: null }, recent: [], now: t });
  const names = pl.candidates.map((c) => c.title);
  assert.ok(names.includes("Yaba Park") && names.includes("Early Bird Cafe"), names.join(", "));
  assert.ok(!names.includes("Quiet Cafe"), "unknown hours at 7 am: not offered");
  assert.ok(pl.candidates.every((c) => c.time.from >= "07:00" && c.time.to <= "11:00"));
});

test("ideas card: the 7 am run club's weekend ideas are in its own hours; the honest note when nothing roofed is open", async () => {
  const store = memoryStore();
  const t = () => Date.parse("2026-10-22T11:00:00Z");
  const weather = weatherWith();
  const places = fakeOverpass([PARK], [node("Quiet Cafe", 6.506, 3.367, { amenity: "cafe" })]);
  const svc = createService({ store, ai: fakeAi({ answers: {} }), geocoder: fakeGeocoder(), places, weather, pages: fakePageMeta(), push: fakePush(), spots: [], prompts: loadPrompts(), ids: makeIds(), now: t, cfg });
  await store.put("crews", { ...crewOf(RUN_CLUB, cleanTaste({ placeKinds: ["park", "cafe"] })), anchor: undefined });
  const ideas = createIdeas({ store, cache: memoryCache({ now: t }), ai: fakeAi({ answers: {} }), feeds: null, weather, geocoder: fakeGeocoder(), candidatesNear: svc._internal.candidatesNear, prompts: loadPrompts(), now: t });
  const card = await ideas.getIdeas({ slug: "hours", token: "inv_hours", when: "weekend" });
  assert.ok(card.ideas.length > 0, card.notes.join(" | "));
  for (const i of card.ideas) assert.ok(i.start.slice(11, 16) >= "07:00" && i.end.slice(11, 16) <= "11:00", `${i.title} ${i.start} to ${i.end}`);
  assert.ok(!card.ideas.some((i) => i.title === "Quiet Cafe"), "a cafe with unknown hours is not offered at 7 am");
  assert.ok(card.notes.some((n) => /No place nearby says it is open at 7 am/.test(n)), card.notes.join(" | "));
});

test("opening hours: the common OpenStreetMap forms, and nothing guessed", () => {
  assert.deepEqual(openIntervals("24/7", 6), [[0, 1440]]);
  assert.deepEqual(openIntervals("Mo-Fr 08:00-18:00; Sa 09:00-14:00; Su off", 6), [[540, 840]]);
  assert.deepEqual(openIntervals("Mo-Fr 08:00-18:00; Sa 09:00-14:00; Su off", 0), []);
  assert.deepEqual(openIntervals("Mo-Su 18:00-02:00", 6), [[1080, 1560]]);
  assert.deepEqual(openIntervals("10:00-22:00", 3), [[600, 1320]]);
  assert.deepEqual(openIntervals("Mo,We,Fr 10:00-12:00,14:00-18:00", 5), [[600, 720], [840, 1080]]);
  assert.deepEqual(openIntervals("Mo-Su 09:00-17:00; Sa 10:00-14:00", 6), [[600, 840]], "a later rule replaces an earlier one");
  assert.deepEqual(openIntervals("Tu-Su 10:00-18:00", 1), [], "Monday is not in Tu-Su");
  assert.deepEqual(openIntervals("Sa-Mo 10:00-18:00", 0), [[600, 1080]], "a range across the week's end");
  assert.equal(openIntervals("Jan-Mar Mo-Fr 08:00-17:00", 1), null);
  assert.equal(openIntervals("sunrise-sunset", 6), null);
  assert.equal(openIntervals("Mo-Fr 08:00-17:00 || \"by appointment\"", 1), null);
  assert.equal(openDuring("Mo-Su 06:30-15:00", SAT, { from: "07:00", to: "10:00" }), true);
  assert.equal(openDuring("Mo-Su 10:00-18:00", SAT, { from: "07:00", to: "10:00" }), false);
  assert.equal(openDuring(null, SAT, { from: "07:00", to: "10:00" }), null);
  assert.equal(mayOffer({ tags: {}, outdoor: true }, SAT, { from: "07:00", to: "10:00" }, { usual: false }), true, "a park needs no opening time");
  assert.equal(mayOffer({ tags: {}, outdoor: false }, SAT, { from: "07:00", to: "10:00" }, { usual: false }), false);
  assert.equal(mayOffer({ tags: {}, outdoor: false }, SAT, { from: "15:00", to: "18:00" }, { usual: true }), true, "unknown hours in the usual hours: as before");
  assert.equal(mayOffer({ tags: { opening_hours: "Mo-Fr 09:00-17:00" }, outdoor: false }, SAT, { from: "15:00", to: "18:00" }, { usual: true }), false, "closed on Saturdays: never offered");
  assert.deepEqual(daylightPart([{ date: SAT, time: "06:00", isDay: 0 }, { date: SAT, time: "07:00", isDay: 1 }, { date: SAT, time: "08:00", isDay: 1 }], SAT, { from: "05:00", to: "09:00" }), { from: "07:00", to: "09:00" });
  assert.equal(daylightPart([{ date: SAT, time: "21:00", isDay: 0 }], SAT, { from: "21:00", to: "23:00" }), null);
  assert.equal(daylightPart([{ date: SAT, time: "21:00" }], SAT, { from: "21:00", to: "23:00" }), undefined);
});
