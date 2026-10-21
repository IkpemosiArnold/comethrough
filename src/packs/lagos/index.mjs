// @ts-check
// The Lagos city pack: everything Come Through knows about Lagos, as data plus a few small
// functions. It is what the whole app was before it went global, moved here unchanged:
//   - the curated spots (data/lagos-spots.json: OpenStreetMap and Wikidata, each with its
//     source) and their sourced entry fees (data/spot-entry-fees.json);
//   - the ride apps that run in Lagos (Bolt, inDrive, LagRide; ./rides.mjs);
//   - the traffic bands, the lagoon and its bridges (./geo.mjs);
//   - the social hours (outdoor weekends end at 18:30, before dark);
//   - geocoding biased to Lagos, with ", Lagos" added to a bare name;
//   - prompts that say Lagos and read Nigerian Pidgin, "VI" for Victoria Island, naira.
// Every claim is sourced in docs/LOCAL-FACTS.md. To add a city, see docs/CITY-PACKS.md.

import { LAGOS_BBOX, LAGOS_TRAVEL, LAGOS_TZ, inLagos } from "./geo.mjs";
import { RIDE_PROVIDERS } from "./rides.mjs";

/** @typedef {import("../index.mjs").Region} Region */
/** @typedef {import("../index.mjs").CityPack} CityPack */

/** Where Lagos geocoding is biased. */
export const LAGOS_BIAS = { lat: 6.52, lon: 3.38 };

/** The region of every crew made before regions existed (they were all in Lagos). */
export const LAGOS_REGION = Object.freeze({ center: LAGOS_BIAS, countryCode: "NG", city: "Lagos", timezone: LAGOS_TZ, tzSource: "legacy" });

/**
 * When people in Lagos actually meet up, by kind of plan. Assumptions, written down so
 * they can be argued with (docs/LOCAL-FACTS.md, "Social hours"):
 *   - weekend outdoor: 11:00 to 18:30. Late enough to be up and out, done before dark
 *     (sunset in Lagos ran from 18:25 to 19:06 in 2025, per Open-Meteo's archive).
 *   - weekday evening: 17:30 to 21:00, for indoor or covered plans after work.
 *   - a weekday outdoor plan gets only the light part of the evening, 17:30 to 18:30.
 *   - a weekend covered or indoor plan: 11:00 to 21:00.
 */
export const SOCIAL_HOURS = Object.freeze({
  weekendOutdoor: { from: "11:00", to: "18:30" },
  weekendCovered: { from: "11:00", to: "21:00" },
  weekdayOutdoor: { from: "17:30", to: "18:30" },
  weekdayEvening: { from: "17:30", to: "21:00" },
});

/** How people in Lagos write: Nigerian Pidgin, mixed with Yoruba and English. */
export const PIDGIN_NOTES = ' People in Lagos often write in Nigerian Pidgin or mix Pidgin, Yoruba and English. Read it the same way as English: "abeg" is please, "make we" is let us, "dey" is is or are, "wan" is want, "carry" can mean bring, "for" often means at or in ("for Lekki" is in Lekki), "him house" or "my place" is a home, "go chop" is to eat, "padi" is friend, and "3k" is 3,000 naira.';

/**
 * The naira sign as it should be. A model reading a flyer sometimes returns the sign's
 * look-alikes: on 21 Oct 2026 Gemma read "GATE ₦3,000" as "Gate ‸3,000" (U+2038, a caret).
 * A caret before a number becomes ₦; "N" and "NGN" before a number are left as written.
 * @param {string|null} s
 */
export function nairaSign(s) {
  return s ? s.replace(/[‸⁁^ˆ](\s?)(?=\d)/g, "₦") : s;
}

/**
 * What Gemma should know to read a Lagos crew's taste (docs/LOCAL-FACTS.md, "Taste"): "alte"
 * (Dazed, 2019; i-D, 2023) and what money words mean for a crew.
 */
export const TASTE_NOTES = ' In Lagos, "alte" (alté) is the alternative scene: fashion, art, and indie, alternative and Afro-fusion music, a lifestyle as much as a sound. An alte crew usually likes galleries, art spaces, cafés, bookshops, thrift and live music, and chill creative spaces. Students and "broke" crews want free or cheap places.';

/** Short names Lagosians write, as the place a map knows ("VI" is Victoria Island). */
const AREA_FULL = { vi: "Victoria Island", "v i": "Victoria Island" };
/** Short names Lagosians write for areas: "VI" is Victoria Island. */
const AREA_SHORT = { "victoria island": ["vi"], "lekki phase 1": ["lekki"], "lekki phase i": ["lekki"], "ikeja gra": ["gra"], ikoyi: ["ikoyi"] };

/** @type {import("../../core/tasks.mjs").Local} */
export const LAGOS_LOCAL = Object.freeze({
  inCity: " in Lagos",
  inCityCountry: " in Lagos, Nigeria",
  areaNoun: "Lagos neighbourhoods",
  areaNounOne: "a Lagos neighbourhood",
  areaExamples: ' ("Yaba", "Lekki")',
  areaExample: '("for Lekki", "Ikeja GRA")',
  priceExample: '"N5,000"',
  localNotes: PIDGIN_NOTES,
  crewNotes: ' "VI" is Victoria Island.',
  tasteNotes: TASTE_NOTES,
  areaFull: AREA_FULL,
  areaShort: AREA_SHORT,
  cityWords: ["lagos"],
  windowNote: "No time was given, so the window is 3 pm to 7 pm, after the worst heat.",
  currency: "NGN",
  currencyName: "naira",
  fixPrice: (/** @type {string} */ s) => /** @type {string} */ (nairaSign(s)),
  monthFirst: false,
});

/** @type {CityPack} */
export const LAGOS = Object.freeze({
  id: "lagos",
  name: "Lagos",
  /** Lagos crews: in Nigeria, inside the metro box (or named Lagos when there is no centre yet). */
  matches: (/** @type {Region} */ r) => r.countryCode === "NG" && (r.center ? inLagos(r.center) : /^lagos$/i.test(r.city || "")),
  travel: LAGOS_TRAVEL,
  // an assumption, written down (docs/LOCAL-FACTS.md, "Taste"): ₦5,000 is about 7% of the
  // ₦70,000 monthly minimum wage (2024), the most a "broke" or "cheap" crew pays for a ticket
  cheapMax: 5000,
  social: SOCIAL_HOURS,
  rides: RIDE_PROVIDERS,
  curated: true,
  wikidataSpots: false,
  data: { spots: "data/lagos-spots.json", fees: "data/spot-entry-fees.json" },
  geocode: () => ({ near: LAGOS_BIAS, country: "NG", appendCity: "Lagos", cityFallback: null, viewbox: `${LAGOS_BBOX.west.toFixed(2)},${LAGOS_BBOX.north.toFixed(2)},${LAGOS_BBOX.east.toFixed(2)},${LAGOS_BBOX.south.toFixed(2)}` }),
  local: () => LAGOS_LOCAL,
  zoneNames: { [LAGOS_TZ]: "WAT" },
  /** "Lagos", "Lagos State", "Nigeria", and the codes "LA" (the state) and "NG" */
  addressNoise: () => /^(lagos( state)?|nigeria|la|ng)$/i,
  ui: {
    example: "The uni guys, every other Saturday, somewhere outside and cheap, around Yaba and Lekki",
    areaPlaceholder: "Yaba, Lekki Phase 1, Ikeja...",
    pricePlaceholder: "Free, or ₦5,000 at the gate",
  },
});
