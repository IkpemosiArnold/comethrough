// @ts-check
// Nigeria, at country level: what the visitor's zone can say (Africa/Lagos is the zone of
// all Nigeria, and of more countries besides), and area names as people write them,
// mapped to the names OpenStreetMap knows. Data only; checked against Nominatim and Photon
// on 22 Oct 2026 (docs/LOCAL-FACTS.md, "Area names").
//
// The zone never picks a city. A name here is only a better query: where an area is still
// comes from the map.

/** Cities to offer when no area could be found ("Which city is the crew in?"). */
export const NG_CITIES = Object.freeze(["Lagos", "Abuja", "Port Harcourt", "Ibadan", "Kano", "Enugu", "Benin City"]);

/**
 * Short and misspelt area names, by the name as written (lower case, spaces collapsed), to
 * the queries to try in order (the first that finds anything wins). "Lekki" alone finds the Ibeju-Lekki boundary, 38 km east of
 * where people mean (persona eval v2, 22 Oct 2026); "Lekki Phase I" is the place node.
 * @type {Readonly<Record<string, string[]>>}
 */
export const NG_AREA_ALIASES = Object.freeze({
  // Lagos
  vi: ["Victoria Island"],
  "v i": ["Victoria Island"],
  "v.i": ["Victoria Island"],
  "v.i.": ["Victoria Island"],
  lekki: ["Lekki Phase I", "Lekki Phase 1", "Lekki"],
  "lekki 1": ["Lekki Phase I", "Lekki Phase 1"],
  "lekki phase 1": ["Lekki Phase I", "Lekki Phase 1"],
  "lekki phase one": ["Lekki Phase I", "Lekki Phase 1"],
  "lekki ph 1": ["Lekki Phase I", "Lekki Phase 1"],
  vgc: ["Victoria Garden City"],
  festac: ["Festac Town", "Festac"],
  "gra ikeja": ["Ikeja GRA"],
  "ikeja g.r.a": ["Ikeja GRA"],
  "island": ["Lagos Island"],
  // Abuja
  gwarimpa: ["Gwarinpa"],
  "gwarinpa estate": ["Gwarinpa"],
  "wuse 2": ["Wuse II", "Wuse"],
  "wuse ii": ["Wuse II", "Wuse"],
  wuse2: ["Wuse II", "Wuse"],
  "garki 2": ["Garki II", "Garki"],
  "garki ii": ["Garki II", "Garki"],
  "area 11": ["Area 11", "Garki"],
  "life camp": ["Life Camp"],
  "lifecamp": ["Life Camp"],
  // Port Harcourt
  ph: ["Port Harcourt"],
  phc: ["Port Harcourt"],
});
