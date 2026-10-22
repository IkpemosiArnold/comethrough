// @ts-check
// City packs: a global core plus what we know about particular cities.
//
// A crew has a region, derived once from its own areas when they are first geocoded:
//   { center, countryCode, city, timezone, tzSource }
// countryCode and city come from Photon (OpenStreetMap), the timezone from Open-Meteo
// (timezone=auto answers with the IANA zone of a point), and tzSource says which: "open-meteo",
// "browser" (the visitor's own zone, when Open-Meteo could not be asked), "legacy" (a crew
// from before regions, all in Lagos) or "utc" (nothing known). The pack is picked from the
// region: the first pack that matches, else DEFAULT.
//
// A pack is pure data plus small functions. The core never imports one: the app layer picks
// the pack and passes its parts (the travel model, the social hours, the ride list, the
// prompt locale) into the core's functions as parameters.
//
// To add a city, see docs/CITY-PACKS.md.

import { isLatLon } from "../core/geo.mjs";
import { isValidZone } from "../core/time.mjs";
import { DEFAULT } from "./default.mjs";
import { LAGOS, LAGOS_REGION } from "./lagos/index.mjs";
import { LAGOS_TZ } from "./lagos/geo.mjs";
import { NG_AREA_ALIASES, NG_CITIES } from "./nigeria.mjs";

/**
 * @typedef {object} Region
 * @property {{ lat: number, lon: number }|null} center
 * @property {string|null} countryCode  ISO 3166-1 alpha-2, upper case
 * @property {string|null} city
 * @property {string} timezone          IANA
 * @property {"open-meteo"|"browser"|"legacy"|"utc"} tzSource
 */

/**
 * @typedef {object} GeocodeContext
 * @property {{ lat: number, lon: number }|null} near   bias results toward this point
 * @property {string|null} country                       keep results in this country (ISO alpha-2)
 * @property {string|null} appendCity                    add ", <city>" to every bare name (Lagos only, as before)
 * @property {string|null} cityFallback                  retry with ", <city>" when nothing is found near the crew
 * @property {string} [viewbox]                          Nominatim's viewbox, "west,north,east,south"
 */

/**
 * @typedef {object} CityPack
 * @property {string} id
 * @property {string} name
 * @property {(r: Region) => boolean} matches
 * @property {import("../core/geo.mjs").TravelModel} travel
 * @property {import("../core/weather.mjs").SocialHours} social
 * @property {import("../core/rides.mjs").RideProvider[]} rides   verified ride apps; [] means "Get directions" only
 * @property {boolean} curated          has a curated spots file (data)
 * @property {boolean} wikidataSpots    ask Wikidata for parks and beaches near the crew
 * @property {{ spots: string, fees: string }|null} data   files under the repo root
 * @property {(r: Region) => GeocodeContext} geocode
 * @property {(r: Region) => import("../core/tasks.mjs").Local} local
 * @property {Record<string, string>} zoneNames   short zone names for calendar files
 * @property {(r: Region) => RegExp} addressNoise  address parts that name the city, state or country, never a neighbourhood
 * @property {{ example: string|null, areaPlaceholder: string, pricePlaceholder: string }} ui
 * @property {number} [cheapMax]        the most a "cheap" crew pays for an event, in the local currency (none: no ceiling is assumed)
 */

/** Every pack but the default, in the order they are tried. @type {CityPack[]} */
export const PACKS = [LAGOS];
export { DEFAULT, LAGOS, LAGOS_REGION };

/** The pack for a region. */
export function packFor(/** @type {Region|null|undefined} */ region) {
  if (!region) return DEFAULT;
  return PACKS.find((p) => p.matches(region)) ?? DEFAULT;
}

/** A region from untrusted input, or null when it is not one. */
export function cleanRegion(/** @type {any} */ r) {
  if (!r || typeof r !== "object") return null;
  const center = isLatLon(r.center) ? { lat: Number(r.center.lat), lon: Number(r.center.lon) } : null;
  const countryCode = typeof r.countryCode === "string" && /^[a-z]{2}$/i.test(r.countryCode) ? r.countryCode.toUpperCase() : null;
  const city = typeof r.city === "string" && r.city.trim() ? r.city.trim().slice(0, 60) : null;
  const timezone = typeof r.timezone === "string" && isValidZone(r.timezone) ? r.timezone : null;
  if (!timezone) return null;
  const tzSource = ["open-meteo", "browser", "legacy", "utc"].includes(r.tzSource) ? r.tzSource : "browser";
  return { center, countryCode, city, timezone, tzSource };
}

/**
 * A crew's region. Crews made before regions existed were all in Lagos, so they get Lagos.
 * @param {{ region?: any, tz?: string }} crew
 * @returns {Region}
 */
export function regionOf(crew) {
  return cleanRegion(crew?.region) ?? { ...LAGOS_REGION, timezone: crew?.tz && isValidZone(crew.tz) ? crew.tz : LAGOS_REGION.timezone };
}

/** The country a zone can vouch for, when it is one we know (a zone is never a city). */
const ZONE_COUNTRY = { [LAGOS_TZ]: "NG", "Africa/Accra": "GH" };

/**
 * A provisional region for a crew sentence, before any area is on the map, from the
 * visitor's own zone (the browser sends it). The zone says a country at most: Africa/Lagos
 * is all of Nigeria (and Benin, Cameroon and more), so it never makes a crew a Lagos crew.
 * Where the crew is comes only from its areas on the map (Astra's review, 25 Oct). No hint
 * at all (an old client) is read as the Lagos zone, as before, which is also country level.
 * @param {{ tz?: string|null }|null|undefined} hint
 * @returns {Region}
 */
export function hintRegion(hint) {
  const given = hint && typeof hint.tz === "string" && isValidZone(hint.tz) ? hint.tz : null;
  const tz = given ?? LAGOS_TZ;
  return { center: null, countryCode: ZONE_COUNTRY[/** @type {keyof typeof ZONE_COUNTRY} */ (tz)] ?? null, city: null, timezone: tz, tzSource: given ? "browser" : "legacy" };
}

/**
 * The region whose prompts read a new crew's sentence: a Lagos zone (or none) reads it with
 * the Lagos prompts (Pidgin, "VI"), as before. Only the wording of the prompts; never where
 * the crew is (hintRegion).
 * @param {{ tz?: string|null }|null|undefined} hint
 * @returns {Region}
 */
export function localeRegion(hint) {
  const tz = hint && typeof hint.tz === "string" && isValidZone(hint.tz) ? hint.tz : null;
  if (!tz || tz === LAGOS_TZ) return { ...LAGOS_REGION };
  return hintRegion(hint);
}

/**
 * The queries to try for an area name, in order: the names people write mapped to the
 * names the map knows ("Lekki" is Lekki Phase I, "Gwarimpa" is Gwarinpa), then the name
 * itself. Only Nigeria has a list so far.
 * @param {string} label
 * @param {string|null|undefined} countryCode
 * @returns {string[]}
 */
export function areaQueries(label, countryCode) {
  const key = String(label || "").toLowerCase().replace(/\s+/g, " ").trim();
  return (countryCode === "NG" ? NG_AREA_ALIASES[key] : null) ?? [label];
}

/** Cities to ask about when no area of a crew is on the map, for a country we know. */
export function citiesFor(/** @type {string|null|undefined} */ countryCode) {
  return countryCode === "NG" ? [...NG_CITIES] : [];
}

/** What the web app may know about a crew's pack: its id, name and context-aware examples. */
export function packView(/** @type {CityPack} */ pack, /** @type {Region} */ region) {
  return { id: pack.id, name: pack.name, directions: pack.rides.length === 0, ...pack.ui, city: region.city, countryCode: region.countryCode };
}
