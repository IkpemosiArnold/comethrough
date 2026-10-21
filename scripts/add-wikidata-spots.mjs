// @ts-check
// Adds the Lagos places people actually go that OpenStreetMap does not have by name (Elegushi
// Beach, JJT Park and others) to data/lagos-spots.json, with coordinates read live from
// Wikidata (CC0), never typed by hand. Each item was matched by name, place and description
// on 21 Oct 2026 (docs/LOCAL-FACTS.md, "Famous spots"); this script fetches its coordinate
// location (P625) and records the source. A place whose item has no coordinate, or whose
// coordinate falls outside Lagos, is left out and reported.
//
// Run: node scripts/add-wikidata-spots.mjs   (one request a second)

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, loadDotEnv } from "../src/config.mjs";
import { userAgent } from "../src/adapters/http.mjs";
import { inLagos } from "../src/packs/lagos/geo.mjs";

loadDotEnv();
const cfg = config();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "data/lagos-spots.json");

/**
 * [Wikidata id, our name, kind, area, note?, aliases?]. kind "gallery" is indoor: a place
 * with a roof the sloth may offer when rain blocks every outdoor window. Aliases are other
 * names a flyer may use.
 * @type {[string, string, string, string, (string|null)?, string[]?][]}
 */
const ITEMS = [
  ["Q28232226", "Elegushi Beach", "beach", "Lekki"],
  ["Q108924711", "Landmark Beach", "beach", "Victoria Island"],
  ["Q109516089", "Atican Beach", "beach", "Lekki", "The Wikidata item is Atican Beach Resort; there is no separate item for the beach."],
  ["Q25042473", "Eleko Beach", "beach", "Ibeju-Lekki"],
  ["Q109290920", "JJT Park", "park", "Ikeja", null, ["Johnson Jakande Tinubu Park"]],
  ["Q109291010", "Ndubuisi Kanu Park", "park", "Ikeja"],
  ["Q109421702", "Jhalobia Recreation Park", "park", "Ikeja", null, ["Jhalobia Park"]],
  ["Q109266995", "Omu Resort", "park", "Ibeju-Lekki"],
  ["Q22570266", "Lagos Yacht Club", "waterfront", "Lagos Island"],
  ["Q22080800", "Dreamworld Africana", "park", "Lekki"],
  ["Q20891702", "Point of No Return", "heritage", "Badagry", "The coordinate is the centre of Gberefu Island, not the monument itself.", ["Gberefu Island"]],
  ["Q25044062", "Nike Art Gallery", "gallery", "Lekki"],
];

const UA = { "user-agent": userAgent(cfg.contact), accept: "application/json" };
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
const today = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);

const data = JSON.parse(await fs.readFile(file, "utf8"));
const norm = (/** @type {string} */ s) => s.toLowerCase().replace(/centre/g, "center").replace(/[^a-z0-9]+/g, " ").trim();
let added = 0;
for (const [qid, name, kind, area, note, aliases] of ITEMS) {
  const url = `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`;
  const r = await fetch(url, { headers: UA });
  await sleep(1000);
  if (!r.ok) {
    console.log(`- ${name} (${qid}): HTTP ${r.status}, left out`);
    continue;
  }
  const ent = (await r.json()).entities?.[qid];
  const c = ent?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
  const label = ent?.labels?.en?.value ?? null;
  if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) {
    console.log(`- ${name} (${qid}): no coordinate location, left out`);
    continue;
  }
  const at = { lat: Number(c.latitude.toFixed(6)), lon: Number(c.longitude.toFixed(6)) };
  if (!inLagos(at)) {
    console.log(`- ${name} (${qid}): ${at.lat}, ${at.lon} is outside Lagos, left out`);
    continue;
  }
  const spot = {
    name,
    kind,
    area,
    lat: at.lat,
    lon: at.lon,
    osm: null,
    ...(aliases?.length ? { aliases } : {}),
    ...(kind === "gallery" ? { covered: true } : {}),
    source: { service: "wikidata", qid, label, url: `https://www.wikidata.org/wiki/${qid}`, data: url, licence: "CC0", checkedAt: today, ...(note ? { note } : {}) },
    verifiedAt: today,
  };
  const i = data.spots.findIndex((s) => s.source?.qid === qid || norm(s.name) === norm(name));
  if (i >= 0) data.spots[i] = { ...data.spots[i], ...spot, entry: data.spots[i].entry ?? spot.entry };
  else data.spots.push(spot);
  added++;
  console.log(`+ ${name} (${qid}, "${label}") ${at.lat}, ${at.lon}`);
}
// drop the stale ones from earlier runs, and give every spot the date its coordinate was checked
data.spots = data.spots.filter((s) => !(s.source?.service === "wikidata" && !ITEMS.some(([q]) => q === s.source.qid)));
for (const s of data.spots) if (!s.verifiedAt) s.verifiedAt = s.source?.checkedAt;
const have = data.spots.flatMap((s) => [s.name, ...(s.aliases || [])]).map(norm);
data.missing = data.missing.filter((m) => {
  const n = norm(m.split(",")[0]);
  return !have.some((h) => h === n || h.startsWith(`${n} `) || n.startsWith(`${h} `));
});
data.about = "Named spots in Lagos for the ritual's place search, merged with live Overpass results. Coordinates come from OpenStreetMap (© OpenStreetMap contributors, ODbL) through the service named in each source, or from Wikidata (CC0) where OpenStreetMap does not have the place by name. Built by scripts/build-spots.mjs and scripts/add-wikidata-spots.mjs; never edit coordinates by hand. `missing` lists places no open source has coordinates for.";
data.builtAt = today;
await fs.writeFile(file, `${JSON.stringify(data, null, 1)}\n`);
console.log(`\n${added} Wikidata spots written; still missing: ${data.missing.join("; ") || "none"}`);
