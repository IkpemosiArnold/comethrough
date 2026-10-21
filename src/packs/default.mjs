// @ts-check
// The default pack: how Come Through behaves in a city it has no pack for. It knows the
// crew's region (centre, country, city and zone, from the crew's own areas) and nothing
// else, so it makes no local claims:
//   - geocoding is biased to the crew's centre and never adds a city name, except to retry a
//     name that found nothing near the crew;
//   - places come from OpenStreetMap (Overpass) and Wikidata's parks and beaches near the
//     crew; entry fees are unknown unless OpenStreetMap tags them;
//   - travel times are OSRM's driving time with empty roads, labelled a rough estimate, with
//     no claims about local traffic;
//   - no ride app is named (none is verified here); "Get directions" opens the phone's maps
//     app, and "Copy address" does the rest;
//   - social hours are generic: weekends 11:00 to 19:00, weekday evenings 17:30 to 21:00;
//   - prices are taken as the source writes them; the local currency comes from the country,
//     and is left unknown rather than guessed;
//   - Pidgin hints only for Nigeria and Ghana.

import { FREE_FLOW } from "../core/geo.mjs";
import { GENERIC_SOCIAL_HOURS } from "../core/weather.mjs";
import { nairaSign } from "./lagos/index.mjs";

/** @typedef {import("./index.mjs").Region} Region */
/** @typedef {import("./index.mjs").CityPack} CityPack */
/** @typedef {import("../core/tasks.mjs").Local} Local */

/**
 * The currency of a country (ISO 3166-1 alpha-2 to ISO 4217), for the countries most likely
 * to start a crew. A country not listed has no known currency, and no price note is made.
 */
export const CURRENCY_BY_COUNTRY = Object.freeze({
  NG: "NGN", GH: "GHS", KE: "KES", ZA: "ZAR", EG: "EGP", MA: "MAD", TZ: "TZS", UG: "UGX", RW: "RWF", ET: "ETB", SN: "XOF", CI: "XOF", CM: "XAF",
  US: "USD", CA: "CAD", MX: "MXN", BR: "BRL", AR: "ARS", CL: "CLP", CO: "COP", PE: "PEN",
  GB: "GBP", IE: "EUR", DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", PT: "EUR", NL: "EUR", BE: "EUR", AT: "EUR", FI: "EUR", GR: "EUR", LU: "EUR", SK: "EUR", SI: "EUR", EE: "EUR", LV: "EUR", LT: "EUR", HR: "EUR", MT: "EUR", CY: "EUR",
  CH: "CHF", SE: "SEK", NO: "NOK", DK: "DKK", PL: "PLN", CZ: "CZK", HU: "HUF", RO: "RON", TR: "TRY", UA: "UAH",
  IN: "INR", PK: "PKR", BD: "BDT", LK: "LKR", NP: "NPR", CN: "CNY", JP: "JPY", KR: "KRW", SG: "SGD", MY: "MYR", ID: "IDR", PH: "PHP", TH: "THB", VN: "VND",
  AE: "AED", SA: "SAR", QA: "QAR", IL: "ILS", AU: "AUD", NZ: "NZD",
});

/** Countries that write numeric dates month first ("10/23"). */
const MONTH_FIRST = new Set(["US"]);

/** Pidgin hints: Nigeria outside Lagos, and Ghana. */
const PIDGIN = {
  NG: ' People in Nigeria often write in Nigerian Pidgin or mix Pidgin, English and their own languages. Read it the same way as English: "abeg" is please, "make we" is let us, "dey" is is or are, "wan" is want, "carry" can mean bring, "for" often means at or in, "my place" is a home, "go chop" is to eat, "padi" is friend, and "3k" is 3,000 naira.',
  GH: ' People in Ghana often write in Ghanaian Pidgin or mix it with Twi and English. Read it the same way as English: "abeg" is please, "dey" is is or are, "wan" is want, "chop" is to eat, "chale" is friend, and "my place" is a home.',
};

/** "Germany" for "DE", in English; the code itself when the runtime has no name for it. */
export function countryName(code) {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) || code;
  } catch {
    return code;
  }
}

/** What the prompts and readers may know about a crew's region. @returns {Local} */
export function genericLocal(/** @type {Region} */ r) {
  const city = r.city || null;
  const cc = r.countryCode ? r.countryCode.toUpperCase() : null;
  const country = countryName(cc);
  const currency = cc ? /** @type {Record<string, string>} */ (CURRENCY_BY_COUNTRY)[cc] ?? null : null;
  return {
    inCity: city ? ` in ${city}` : country ? ` in ${country}` : "",
    inCityCountry: city && country && city !== country ? ` in ${city}, ${country}` : city ? ` in ${city}` : country ? ` in ${country}` : "",
    areaNoun: city ? `${city} neighbourhoods` : "neighbourhoods or areas",
    areaNounOne: city ? `a ${city} neighbourhood` : "a neighbourhood or area",
    localNotes: cc && cc in PIDGIN ? PIDGIN[/** @type {keyof typeof PIDGIN} */ (cc)] : "",
    cityWords: city ? city.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3) : [],
    currency,
    currencyName: cc === "NG" ? "naira" : undefined,
    fixPrice: cc === "NG" ? (/** @type {string} */ s) => /** @type {string} */ (nairaSign(s)) : undefined,
    monthFirst: !!cc && MONTH_FIRST.has(cc),
  };
}

/** @type {CityPack} */
export const DEFAULT = Object.freeze({
  id: "default",
  name: "Anywhere",
  matches: () => true,
  travel: FREE_FLOW,
  social: GENERIC_SOCIAL_HOURS,
  rides: [],
  curated: false,
  wikidataSpots: true,
  data: null,
  geocode: (/** @type {Region} */ r) => ({ near: r.center || null, country: r.countryCode || null, appendCity: null, cityFallback: r.city || null }),
  local: genericLocal,
  zoneNames: {},
  addressNoise: (/** @type {Region} */ r) => {
    const esc = (/** @type {string} */ x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const words = [r.city, r.city ? `${r.city} state` : null, r.countryCode, countryName(r.countryCode)].filter(Boolean).map((x) => esc(String(x)));
    return words.length ? new RegExp(`^(${words.join("|")})$`, "i") : /^$/;
  },
  ui: {
    example: null,
    areaPlaceholder: "Your neighbourhood",
    pricePlaceholder: "Free, or the price at the door",
  },
});
