// @ts-check
// Builds data/lagos-spots.json: about 30 named outdoor spots in Lagos (parks, beaches,
// gardens, waterfronts, open-air hangouts) with coordinates from OpenStreetMap, never typed
// by hand. Overpass mapping of Lagos green space is thin (5 beaches in the whole city on
// 21 Oct 2026, most park polygons unnamed), so the ritual's place search merges this list
// with live Overpass results.
//
// Each spot records where its coordinates came from (the service, the query and the OSM
// id). A name that no service finds inside Lagos is left out and reported.
//
// Run: node scripts/build-spots.mjs        (about 40 lookups, one a second; be kind)

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, loadDotEnv } from "../src/config.mjs";
import { fetchJson, throttle, userAgent } from "../src/adapters/http.mjs";
import { inLagos } from "../src/packs/lagos/geo.mjs";

loadDotEnv();
const cfg = config();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UA = { "user-agent": userAgent(cfg.contact), accept: "application/json", "accept-language": "en" };

/** [query, kind, area, extra?]: the query is what we search for; kind is our label; extra is an OSM class accepted for that entry after review. */
/** @type {[string, string, string, Record<string,string>?][]} */
const WANTED = [
  ["Muri Okunola Park, Victoria Island", "park", "Victoria Island"],
  ["Freedom Park, Lagos Island", "park", "Lagos Island"],
  ["Lekki Conservation Centre", "nature", "Lekki"],
  ["Ndubuisi Kanu Park, Ikeja", "park", "Ikeja"],
  ["Johnson Jakande Tinubu Park, Ikeja", "park", "Ikeja"],
  ["Ikoyi Park, Ikoyi", "park", "Ikoyi"],
  ["Love Garden, UNILAG", "garden", "Yaba", { amenity: "fixme" }],
  ["Lufasi Nature Park, Lekki", "nature", "Ajah"],
  ["Tafawa Balewa Square, Lagos", "square", "Lagos Island"],
  ["Elegushi Beach, Lekki", "beach", "Lekki"],
  ["Tarkwa Bay, Lagos", "beach", "Tarkwa Bay"],
  ["Landmark Beach, Oniru", "beach", "Victoria Island"],
  ["Atican Beach, Lekki", "beach", "Lekki"],
  ["Oniru Beach, Lagos", "beach", "Victoria Island"],
  ["Alpha Beach, Lekki", "beach", "Lekki"],
  ["Eleko Beach, Ibeju-Lekki", "beach", "Ibeju-Lekki"],
  ["La Campagne Tropicana, Ibeju-Lekki", "beach", "Ibeju-Lekki"],
  ["National Stadium, Surulere", "sport", "Surulere"],
  ["Teslim Balogun Stadium, Surulere", "sport", "Surulere"],
  ["Jhalobia Recreation Park, Ikeja", "park", "Ikeja"],
  ["Omu Resort, Lekki", "park", "Ibeju-Lekki"],
  ["Lagos Polo Club, Ikoyi", "sport", "Ikoyi"],
  ["Ikoyi Club Golf Course", "sport", "Ikoyi"],
  ["Gani Fawehinmi Park, Ojota", "park", "Ojota"],
  ["Ilashe", "beach", "Ilashe"],
  ["Arts and Craft Market", "market", "Lekki", { shop: "gift" }],
  ["Lakowe Lakes Golf", "sport", "Lekki-Epe"],
  ["Lagos Yacht Club", "waterfront", "Lagos Island"],
  ["Mobolaji Johnson Arena", "sport", "Lagos Island"],
  ["Dreamworld Africana", "park", "Lekki"],
  ["Whispering Palms, Badagry", "park", "Badagry"],
  ["Agege Stadium", "sport", "Agege"],
  ["Lekki Leisure Lake", "waterfront", "Lekki"],
  ["Point of No Return, Badagry", "heritage", "Badagry"],
  ["Lighthouse Beach, Lagos", "beach", "Tarkwa Bay"],
];

/**
 * Named places from the Overpass harvest that are real places to meet (reviewed by hand on
 * 21 Oct 2026; the rest of the 27 named features were labels like "bbc", "open space", a
 * hotel or a proposed building site).
 */
const HARVEST_KEEP = ["Atlas Beach", "Lekki Conservation Center", "Victoria Garden City Recreational Park", "Tinubu Square", "Suntan Beach", "Oniru Private Beach"];

/** OSM classes that can be a meetup spot; roads, buildings and offices cannot. */
const ALLOWED = {
  leisure: ["park", "garden", "nature_reserve", "recreation_ground", "stadium", "golf_course", "sports_centre", "pitch", "beach_resort", "resort", "picnic_site", "common"],
  natural: ["beach", "bay", "wood"],
  tourism: ["attraction", "theme_park", "zoo", "resort", "picnic_site", "viewpoint"],
  landuse: ["recreation_ground", "grass", "village_green"],
  place: ["square", "locality", "island", "islet", "village"],
  amenity: ["marketplace", "arts_centre"],
  highway: ["pedestrian"],
  building: ["stadium"],
  historic: ["memorial", "monument", "heritage", "ruins"],
};
/** @param {Record<string,string>} tag @param {Record<string,string>} [extra] a class accepted for this one entry, after review */
const allowedTag = (tag, extra = {}) => Object.entries(tag).some(([k, v]) => ALLOWED[/** @type {keyof typeof ALLOWED} */ (k)]?.includes(v) || extra[k] === v);

const photonGate = throttle(1000);
const nominatimGate = throttle(1100);
const norm = (/** @type {string} */ s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const OSM = { N: "node", W: "way", R: "relation" };

/** True when the found name has every main word of the query's name part ("Elegushi Beach"). */
function nameMatches(query, found) {
  const stop = new Set(["the", "and", "of", "lagos"]);
  const want = norm(query.split(",")[0]).split(" ").filter((w) => w.length > 2 && !stop.has(w));
  const have = ` ${norm(found)} `;
  return want.length > 0 && want.every((w) => have.includes(` ${w} `) || (w === "tarkwa" && have.includes(" takwa ")));
}

async function photon(q, extra = {}) {
  const u = new URL("/api/", cfg.geocoder.photonUrl);
  u.searchParams.set("q", q);
  u.searchParams.set("limit", "8");
  u.searchParams.set("lat", "6.5");
  u.searchParams.set("lon", "3.4");
  const json = await photonGate(() => fetchJson(u.href, { headers: UA, timeoutMs: 10000, retries: 1 }));
  for (const f of json.features || []) {
    const p = f.properties || {};
    const [lon, lat] = f.geometry?.coordinates || [];
    const tag = p.osm_key && p.osm_value ? { [p.osm_key]: p.osm_value } : {};
    if (String(p.countrycode).toUpperCase() !== "NG" || !inLagos({ lat, lon }) || !nameMatches(q, p.name || "") || !allowedTag(tag, extra)) continue;
    return { name: p.name, lat, lon, osm: p.osm_type ? { type: OSM[/** @type {keyof typeof OSM} */ (p.osm_type)], id: p.osm_id } : null, tag, source: { service: "photon", query: q, url: u.href } };
  }
  return null;
}

async function nominatim(q, extra = {}) {
  const u = new URL("/search", cfg.geocoder.nominatimUrl);
  u.searchParams.set("q", q);
  u.searchParams.set("format", "jsonv2");
  u.searchParams.set("limit", "8");
  u.searchParams.set("countrycodes", "ng");
  const json = await nominatimGate(() => fetchJson(u.href, { headers: UA, timeoutMs: 10000, retries: 1 }));
  for (const r of json || []) {
    const lat = Number(r.lat), lon = Number(r.lon);
    const tag = r.category && r.type ? { [r.category]: r.type } : {};
    if (!inLagos({ lat, lon }) || !nameMatches(q, r.name || "") || !allowedTag(tag, extra)) continue;
    return { name: r.name, lat, lon, osm: { type: r.osm_type, id: Number(r.osm_id) }, tag, source: { service: "nominatim", query: q, url: u.href } };
  }
  return null;
}

/** Every named beach, park, garden and nature reserve Overpass has in metropolitan Lagos. */
async function overpassHarvest() {
  const bbox = "6.38,3.05,6.72,3.75";
  const q = `[out:json][timeout:60];(nwr["leisure"~"^(park|garden|nature_reserve|recreation_ground)$"]["name"](${bbox});nwr["natural"="beach"]["name"](6.38,2.70,6.72,4.10););out center tags 400;`;
  const url = cfg.overpassUrls[0];
  const json = await fetchJson(url, { method: "POST", headers: { ...UA, "content-type": "application/x-www-form-urlencoded" }, body: `data=${encodeURIComponent(q)}`, timeoutMs: 90000, retries: 2, backoffMs: 3000 });
  const generic = /^(park|garden|playground|recreation ground|children'?s? park|green area|open space)$/i;
  return (json.elements || [])
    .map((/** @type {any} */ el) => ({ el, lat: el.lat ?? el.center?.lat, lon: el.lon ?? el.center?.lon }))
    .filter(({ el, lat, lon }) => el.tags?.name && !generic.test(el.tags.name.trim()) && el.tags.access !== "private" && Number.isFinite(lat) && inLagos({ lat, lon }))
    .map(({ el, lat, lon }) => ({
      name: el.tags.name, lat, lon, osm: { type: el.type, id: el.id },
      tag: Object.fromEntries(["leisure", "natural", "fee"].filter((k) => el.tags[k]).map((k) => [k, el.tags[k]])),
      kind: el.tags.natural === "beach" ? "beach" : el.tags.leisure === "nature_reserve" ? "nature" : el.tags.leisure === "garden" ? "garden" : "park",
      source: { service: "overpass", query: q, url },
    }));
}

const spots = [];
const missing = [];
const seen = new Set();
for (const [q, kind, area, extra] of WANTED) {
  let hit = null;
  try {
    hit = (await photon(q, extra)) || (await nominatim(q, extra));
  } catch (e) {
    console.error(`  ${q}: ${/** @type {any} */ (e).message}`);
  }
  if (!hit) {
    missing.push(q);
    console.log(`- ${q}: not found in Lagos, left out`);
    continue;
  }
  const key = hit.osm ? `${hit.osm.type}/${hit.osm.id}` : `${hit.lat.toFixed(4)},${hit.lon.toFixed(4)}`;
  if (seen.has(key)) continue;
  seen.add(key);
  spots.push({
    name: hit.name,
    kind,
    area,
    lat: Number(hit.lat.toFixed(6)),
    lon: Number(hit.lon.toFixed(6)),
    osm: hit.osm ? { ...hit.osm, tags: { name: hit.name, ...hit.tag } } : null,
    source: { ...hit.source, checkedAt: new Date().toISOString().slice(0, 10) },
  });
  console.log(`+ ${q} -> ${hit.name} (${hit.lat.toFixed(4)}, ${hit.lon.toFixed(4)}) via ${hit.source.service}`);
}

// then everything Overpass has by name (only names we do not have yet)
try {
  for (const h of await overpassHarvest()) {
    const key = `${h.osm.type}/${h.osm.id}`;
    if (!HARVEST_KEEP.includes(h.name) || seen.has(key) || spots.some((sp) => norm(sp.name) === norm(h.name))) continue;
    seen.add(key);
    spots.push({ name: h.name, kind: h.kind, area: null, lat: Number(h.lat.toFixed(6)), lon: Number(h.lon.toFixed(6)), osm: { ...h.osm, tags: { name: h.name, ...h.tag } }, source: { service: "overpass", query: "named parks, gardens, nature reserves and beaches in the Lagos bounding box", url: h.source.url, checkedAt: new Date().toISOString().slice(0, 10) } });
    console.log(`+ ${h.name} (${h.lat.toFixed(4)}, ${h.lon.toFixed(4)}) via overpass`);
  }
} catch (e) {
  console.error(`Overpass harvest failed: ${/** @type {any} */ (e).message}`);
}

const out = {
  about: "Named outdoor spots in Lagos for the ritual's place search, merged with live Overpass results. Coordinates come from OpenStreetMap through the service named in each source (© OpenStreetMap contributors, ODbL). Built by scripts/build-spots.mjs; never edit coordinates by hand.",
  builtAt: new Date().toISOString().slice(0, 10),
  missing,
  spots,
};
await fs.mkdir(path.join(root, "data"), { recursive: true });
await fs.writeFile(path.join(root, "data/lagos-spots.json"), `${JSON.stringify(out, null, 1)}\n`);
console.log(`\n${spots.length} spots written, ${missing.length} not found.`);
