// @ts-check
// Builds eval/personas/v2.json: 60 crews from explicit dimensions, each with its setup sentence
// (as people type it, some in Pidgin), its areas (with where they really are, for the map
// check) and its hard constraints as machine checks. Split with a fixed seed into dev (30) and
// test (30), stratified over the dimensions. Run once, then frozen: eval/personas/FROZEN.md.
//
//   node eval/personas/build-v2.mjs            writes v2.json and prints its SHA-256
//   node eval/personas/build-v2.mjs --check    exits 1 if v2.json differs from what this builds
//
// Area coordinates are the neighbourhoods' rough centres (OpenStreetMap, as of Oct 2026),
// with a tolerance that covers how big the neighbourhood is. They are used only to check
// that the app put each area in the right place; the app never sees them.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SEED = 20261022;
const here = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(here, "v2.json");

// ---------------------------------------------------------------- places

/** @type {Record<string, { tz: string, center: [number, number], km?: number, bbox?: { south: number, north: number, west: number, east: number }, currency: string }>} */
const CITIES = {
  Lagos: { tz: "Africa/Lagos", center: [6.52, 3.38], bbox: { south: 6.35, north: 6.75, west: 2.7, east: 4.4 }, currency: "NGN" },
  Abuja: { tz: "Africa/Lagos", center: [9.06, 7.47], km: 40, currency: "NGN" },
  Accra: { tz: "Africa/Accra", center: [5.6, -0.19], km: 35, currency: "GHS" },
  Nairobi: { tz: "Africa/Nairobi", center: [-1.29, 36.82], km: 35, currency: "KES" },
  London: { tz: "Europe/London", center: [51.507, -0.128], km: 35, currency: "GBP" },
  Berlin: { tz: "Europe/Berlin", center: [52.52, 13.405], km: 30, currency: "EUR" },
  Bengaluru: { tz: "Asia/Kolkata", center: [12.97, 77.59], km: 35, currency: "INR" },
  "São Paulo": { tz: "America/Sao_Paulo", center: [-23.55, -46.633], km: 35, currency: "BRL" },
  Totnes: { tz: "Europe/London", center: [50.432, -3.684], km: 15, currency: "GBP" },
};

/** Neighbourhood centres and how far off a pin may land (km). */
/** @type {Record<string, [number, number, number]>} */
const AREAS = {
  // Lagos
  Yaba: [6.509, 3.378, 4], Surulere: [6.497, 3.354, 5], Ikeja: [6.601, 3.351, 6], "Ikeja GRA": [6.578, 3.355, 4], Maryland: [6.571, 3.367, 4],
  Ikorodu: [6.619, 3.511, 10], Ajah: [6.468, 3.577, 8], Festac: [6.466, 3.284, 5], "Satellite Town": [6.441, 3.256, 5],
  VI: [6.428, 3.422, 4], Lekki: [6.447, 3.472, 8], "Lekki Phase 1": [6.448, 3.472, 4], Ikoyi: [6.452, 3.435, 4], Gbagada: [6.555, 3.389, 4],
  Akoka: [6.523, 3.388, 4], Ojota: [6.587, 3.381, 4], Ogba: [6.627, 3.339, 4], Obalende: [6.448, 3.404, 4],
  // Abuja
  "Wuse 2": [9.08, 7.475, 5], Jabi: [9.068, 7.425, 5], Garki: [9.035, 7.49, 6], Wuse: [9.07, 7.47, 6], Gwarinpa: [9.105, 7.405, 6], Kubwa: [9.155, 7.335, 8],
  // Accra
  Osu: [5.556, -0.182, 4], Labone: [5.566, -0.171, 4], "East Legon": [5.636, -0.161, 6], Cantonments: [5.579, -0.172, 4], Madina: [5.683, -0.165, 6], Adenta: [5.705, -0.163, 6],
  // Nairobi
  Westlands: [-1.268, 36.811, 5], Kilimani: [-1.29, 36.785, 4], Kileleshwa: [-1.28, 36.778, 4], "South B": [-1.31, 36.838, 4], "South C": [-1.318, 36.83, 4],
  // London
  Peckham: [51.474, -0.069, 4], Brixton: [51.461, -0.116, 4], Hackney: [51.545, -0.055, 5], Stratford: [51.541, -0.003, 5], Croydon: [51.372, -0.1, 6],
  // Berlin
  Kreuzberg: [52.497, 13.403, 4], "Neukölln": [52.481, 13.435, 5], Wedding: [52.55, 13.36, 4], Moabit: [52.53, 13.34, 4], "Prenzlauer Berg": [52.539, 13.424, 4], Friedrichshain: [52.515, 13.454, 4],
  // Bengaluru
  Koramangala: [12.935, 77.624, 4], "HSR Layout": [12.912, 77.638, 4], Indiranagar: [12.978, 77.64, 4], Whitefield: [12.97, 77.75, 7], Jayanagar: [12.925, 77.593, 4], Malleshwaram: [13.003, 77.57, 4],
  // São Paulo
  Pinheiros: [-23.567, -46.69, 4], "Vila Madalena": [-23.556, -46.69, 4], Mooca: [-23.55, -46.6, 5], Liberdade: [-23.559, -46.635, 3], "Butantã": [-23.572, -46.72, 6],
  // Totnes
  Totnes: [50.432, -3.684, 4], Dartington: [50.45, -3.7, 4],
};

// ---------------------------------------------------------------- interests: the taste proxy

/**
 * What each interest should bring up, as a deterministic proxy: OpenStreetMap place kinds (the
 * app's own PLACE_KINDS names) and words in an event's title, category or venue.
 * @type {Record<string, { kinds: string[], keywords: string[] }>}
 */
const INTERESTS = {
  alte: { kinds: ["gallery", "arts centre", "cafe", "bookshop", "thrift", "live music"], keywords: ["art", "exhibition", "alte", "indie", "fashion", "thrift", "gallery", "poetry", "live music", "vintage"] },
  "afrobeats nightlife": { kinds: ["nightclub", "bar", "live music", "restaurant", "pub"], keywords: ["afrobeats", "amapiano", "party", "club", "dj", "concert", "rave", "live", "highlife", "night"] },
  gospel: { kinds: ["community centre", "theatre", "live music", "park", "garden"], keywords: ["gospel", "worship", "praise", "choir", "concert", "hymn"] },
  "football watch parties": { kinds: ["sports", "bar", "pub", "restaurant", "street food"], keywords: ["football", "match", "viewing", "premier league", "champions league", "screening", "watch party", "derby", "sports"] },
  gamers: { kinds: ["arcade", "bowling", "cinema", "cafe"], keywords: ["gaming", "games", "game", "esports", "arcade", "fifa", "playstation", "board game", "console"] },
  foodies: { kinds: ["restaurant", "street food", "market", "cafe", "ice cream"], keywords: ["food", "brunch", "tasting", "suya", "market", "chef", "dinner", "buka", "grill", "jollof", "feira", "street food", "pop-up"] },
  "book club": { kinds: ["bookshop", "library", "cafe", "garden"], keywords: ["book", "books", "reading", "author", "literary", "poetry", "library", "writers"] },
  fitness: { kinds: ["park", "sports", "beach", "garden"], keywords: ["run", "running", "fitness", "yoga", "workout", "hike", "walk", "cycling", "5k", "bootcamp"] },
  art: { kinds: ["gallery", "museum", "arts centre"], keywords: ["art", "exhibition", "gallery", "museum", "painting", "craft", "installation", "opening"] },
  "tech meetups": { kinds: ["cafe", "community centre", "library"], keywords: ["tech", "startup", "developer", "developers", "meetup", "ai", "hackathon", "coding", "product", "founders"] },
  owambe: { kinds: ["restaurant", "community centre", "market", "live music"], keywords: ["owambe", "party", "fuji", "juju", "highlife", "food", "dance", "aso ebi", "celebration"] },
  chess: { kinds: ["park", "cafe", "library", "community centre"], keywords: ["chess", "board game", "board games", "tournament", "draughts"] },
  family: { kinds: ["playground", "park", "zoo", "ice cream", "theme park", "garden"], keywords: ["kids", "family", "children", "fun day", "carnival", "storytime", "puppet"] },
  quiet: { kinds: ["garden", "park", "cafe", "museum", "gallery", "library", "bookshop"], keywords: ["garden", "walk", "tea", "lunch", "exhibition"] },
  hangout: { kinds: ["park", "garden", "cafe", "restaurant", "beach", "cinema"], keywords: ["hangout", "picnic", "games", "comedy", "film", "brunch"] },
};

// ---------------------------------------------------------------- the crews

/**
 * One crew. `dims` drive the split and the subgroup tables; `hard` are the machine checks
 * (see eval/checks.mjs). Every crew also gets areasOnMap, cityCorrect and timezoneCorrect.
 * @typedef {object} Def
 * @property {string} id
 * @property {string} label
 * @property {string} city
 * @property {string} sentence
 * @property {string[]} areas
 * @property {string} [hintTz]   the organiser's browser zone (default: the city's)
 * @property {{ budget: "broke"|"cheap"|"mid"|"comfortable", age: "teens"|"students"|"20s"|"30s"|"40s+"|"retirees", size: "small"|"medium"|"large", interests: string[], constraints: string[], sensitive: null|"lgbtq"|"religious-minority", language: "pidgin"|"mixed"|"plain" }} dims
 * @property {Record<string, any>} [hard]
 */

const LGBTQ = "queer|lesbian|lesbians|\\bgay\\b|\\bgays\\b|lgbt\\w*|sapphic|bisexual|\\bbi\\b|homosexual|same[- ]sex";

/** @type {Def[]} */
const DEFS = [
  // ---- Lagos
  { id: "lag-alte-yaba", label: "Alte crew, mid 20s", city: "Lagos", areas: ["Yaba", "Surulere"], sentence: "Alte crew, 6 of us, mid 20s, thrift and gallery people, every other Saturday around Yaba and Surulere", dims: { budget: "cheap", age: "20s", size: "medium", interests: ["alte"], constraints: [], sensitive: null, language: "plain" }, hard: { maxPrice: 5000 } },
  { id: "lag-turnup-vi", label: "Afrobeats turn-up squad", city: "Lagos", areas: ["VI", "Lekki"], sentence: "Na we be the turn up squad, 8 of us for VI and Lekki, Afrobeats and amapiano every Saturday night, money no be problem", dims: { budget: "comfortable", age: "20s", size: "medium", interests: ["afrobeats nightlife"], constraints: [], sensitive: null, language: "pidgin" } },
  { id: "lag-choir-ikeja", label: "Choir friends, gospel", city: "Lagos", areas: ["Ikeja", "Maryland"], sentence: "Choir friends from church, about 10 of us, gospel music lovers, every other Saturday afternoon around Ikeja and Maryland, nothing with alcohol", dims: { budget: "mid", age: "30s", size: "large", interests: ["gospel"], constraints: ["no alcohol: church"], sensitive: null, language: "plain" }, hard: { noAlcohol: true, needsInclude: ["no alcohol"] } },
  { id: "lag-football-surulere", label: "Football boys, Surulere", city: "Lagos", areas: ["Surulere"], sentence: "Na we dey watch match for Surulere every Saturday, Arsenal and Chelsea boys, 12 of us, small money abeg", dims: { budget: "broke", age: "20s", size: "large", interests: ["football watch parties"], constraints: [], sensitive: null, language: "pidgin" }, hard: { maxPrice: 5000, budgetRead: ["cheap", "free"] } },
  { id: "lag-gamers-ikorodu", label: "Gamers, Ikorodu", city: "Lagos", areas: ["Ikorodu"], sentence: "Gamers from Ikorodu, FIFA and PS5 heads, 5 of us, early 20s, every other Saturday, cheap things only", dims: { budget: "cheap", age: "20s", size: "small", interests: ["gamers"], constraints: [], sensitive: null, language: "mixed" }, hard: { maxPrice: 5000, budgetRead: ["cheap", "free"] } },
  { id: "lag-foodie-girls-lekki", label: "Foodie girls, 30s", city: "Lagos", areas: ["Lekki", "Ikoyi"], sentence: "Foodie girls, 4 of us in our 30s, we try new restaurants every other Saturday around Lekki and Ikoyi, budget is fine", dims: { budget: "comfortable", age: "30s", size: "small", interests: ["foodies"], constraints: ["women-only"], sensitive: null, language: "plain" }, hard: { needsInclude: ["women-friendly"] } },
  { id: "lag-bookclub-yaba", label: "Book club, quiet", city: "Lagos", areas: ["Yaba", "Gbagada"], sentence: "Book club, 7 of us, late 20s to 30s, we meet every other Saturday around Yaba and Gbagada, quiet places please", dims: { budget: "mid", age: "30s", size: "medium", interests: ["book club"], constraints: [], sensitive: null, language: "plain" }, hard: { noNightlife: true } },
  { id: "lag-runclub-lekki", label: "Run club, 7am", city: "Lagos", areas: ["Lekki Phase 1", "VI"], sentence: "Run club, 15 of us, we run Saturday mornings around 7am in Lekki Phase 1 and VI, then breakfast after", dims: { budget: "mid", age: "30s", size: "large", interests: ["fitness"], constraints: [], sensitive: null, language: "plain" }, hard: { withinHours: ["06:00", "11:00"] } },
  { id: "lag-art-ikoyi", label: "Art lovers, comfortable", city: "Lagos", areas: ["Ikoyi", "VI"], sentence: "Art lovers in our 30s and 40s, galleries and exhibitions every other Saturday around Ikoyi and VI, money is not an issue", dims: { budget: "comfortable", age: "40s+", size: "small", interests: ["art"], constraints: [], sensitive: null, language: "plain" } },
  { id: "lag-tech-yaba", label: "Techies, Yaba", city: "Lagos", areas: ["Yaba", "Ikeja"], sentence: "Techies from Yaba, devs and product people in our 20s, we like meetups and hackathons, every other Saturday around Yaba and Ikeja", dims: { budget: "mid", age: "20s", size: "medium", interests: ["tech meetups"], constraints: [], sensitive: null, language: "plain" } },
  { id: "lag-owambe-aunties", label: "Owambe aunties", city: "Lagos", areas: ["Surulere", "Festac"], sentence: "Owambe aunties from Surulere and Festac, we love party, fuji music and good food, every other Saturday afternoon, 10 of us in our 50s", dims: { budget: "mid", age: "40s+", size: "large", interests: ["owambe"], constraints: [], sensitive: null, language: "mixed" } },
  { id: "lag-chess-ikeja", label: "Chess club, Ikeja GRA", city: "Lagos", areas: ["Ikeja GRA"], sentence: "Chess club, 6 guys of mixed ages, every Saturday afternoon around Ikeja GRA, cheap or free", dims: { budget: "cheap", age: "30s", size: "medium", interests: ["chess"], constraints: [], sensitive: null, language: "plain" }, hard: { maxPrice: 5000, budgetRead: ["cheap", "free"] } },
  { id: "lag-teens-festac", label: "Teens with a parent, Festac", city: "Lagos", areas: ["Festac"], sentence: "My teenagers and their friends, 13 to 16, I come with them, every other Saturday around Festac, no parties and nothing late", dims: { budget: "mid", age: "teens", size: "medium", interests: ["hangout"], constraints: ["kids"], sensitive: null, language: "plain" }, hard: { noAlcohol: true, noNightlife: true } },
  { id: "lag-unilag-broke", label: "Broke UNILAG students", city: "Lagos", areas: ["Yaba", "Akoka"], sentence: "Broke UNILAG students, 8 of us, every other Saturday around Yaba and Akoka, free or very cheap only", dims: { budget: "broke", age: "students", size: "medium", interests: ["hangout"], constraints: [], sensitive: null, language: "plain" }, hard: { maxPrice: 5000, budgetRead: ["cheap", "free"] } },
  { id: "lag-ajah-free", label: "Free things only, Ajah (Pidgin)", city: "Lagos", areas: ["Ajah"], sentence: "Abeg we no get money o, na free things only, 5 of us for Ajah, every other Saturday, anything wey no cost", dims: { budget: "broke", age: "20s", size: "small", interests: ["hangout"], constraints: [], sensitive: null, language: "pidgin" }, hard: { maxPrice: 0, budgetRead: ["free"] } },
  { id: "lag-mosque-ikeja", label: "Brothers from the mosque", city: "Lagos", areas: ["Ikeja", "Ojota"], sentence: "Brothers from the mosque, 20s and 30s, every other Saturday after Asr around Ikeja and Ojota, no alcohol", dims: { budget: "mid", age: "30s", size: "medium", interests: ["hangout"], constraints: ["no alcohol: mosque"], sensitive: null, language: "plain" }, hard: { noAlcohol: true, needsInclude: ["no alcohol"] } },
  { id: "lag-sober-lekki", label: "Sober crew, in recovery", city: "Lagos", areas: ["Lekki", "Ajah"], sentence: "Sober crew, 30s, all of us in recovery, no bars or drinks at all, every other Saturday around Lekki and Ajah", dims: { budget: "mid", age: "30s", size: "small", interests: ["hangout"], constraints: ["no alcohol: sober"], sensitive: null, language: "plain" }, hard: { noAlcohol: true, needsInclude: ["no alcohol"] } },
  { id: "lag-wheelchair-ikeja", label: "Wheelchair user in the crew", city: "Lagos", areas: ["Ikeja", "Maryland"], sentence: "One of us uses a wheelchair, so step-free places only, 5 friends in our 30s, every other Saturday around Ikeja and Maryland", dims: { budget: "mid", age: "30s", size: "small", interests: ["hangout"], constraints: ["step-free"], sensitive: null, language: "plain" }, hard: { stepFree: true, needsInclude: ["step-free"] } },
  { id: "lag-nightshift-ikeja", label: "Night-shift call centre crew", city: "Lagos", areas: ["Ikeja", "Ogba"], sentence: "We all work night shift at a call centre, 20s, Saturday afternoons between 2 and 6 are our only free time, around Ikeja and Ogba", dims: { budget: "cheap", age: "20s", size: "medium", interests: ["hangout"], constraints: ["night-shift"], sensitive: null, language: "plain" }, hard: { withinHours: ["14:00", "18:00"] } },
  { id: "lag-nightshift-vi-pidgin", label: "Night workers, VI (Pidgin)", city: "Lagos", areas: ["VI", "Obalende"], sentence: "Na night work we dey do for VI, security and nurses, we only free Saturday afternoon from 1 to 5, 6 of us, around VI and Obalende", dims: { budget: "cheap", age: "30s", size: "medium", interests: ["hangout"], constraints: ["night-shift"], sensitive: null, language: "pidgin" }, hard: { withinHours: ["13:00", "17:00"] } },
  { id: "lag-sisterhood-surulere", label: "Women only, 30s and 40s", city: "Lagos", areas: ["Surulere", "Yaba"], sentence: "Women only, 9 of us in our 30s and 40s, a sisterhood that hangs out every other Saturday around Surulere and Yaba, nothing rowdy", dims: { budget: "mid", age: "40s+", size: "large", interests: ["quiet"], constraints: ["women-only"], sensitive: null, language: "plain" }, hard: { needsInclude: ["women-friendly"], noNightlife: true } },
  { id: "lag-queer-girls-pidgin", label: "Queer women (Pidgin)", city: "Lagos", areas: ["Yaba", "Lekki"], sentence: "Na my girls, we be queer women, 5 of us, late 20s, abeg somewhere quiet every other Saturday for Yaba and Lekki", dims: { budget: "mid", age: "20s", size: "small", interests: ["quiet"], constraints: ["women-only"], sensitive: "lgbtq", language: "pidgin" }, hard: { needsInclude: ["safe", "discreet"], discreetNoLabel: LGBTQ } },
  { id: "lag-gay-men-ikoyi", label: "Gay men, early 30s", city: "Lagos", areas: ["Ikoyi", "Surulere"], sentence: "Gay guys, 4 of us, early 30s, we need somewhere discreet where nobody stares, every other Saturday around Ikoyi and Surulere", dims: { budget: "comfortable", age: "30s", size: "small", interests: ["quiet"], constraints: [], sensitive: "lgbtq", language: "plain" }, hard: { needsInclude: ["safe", "discreet"], discreetNoLabel: LGBTQ } },
  { id: "lag-hindu-temple", label: "Hindu temple friends", city: "Lagos", areas: ["Ikeja", "Surulere"], sentence: "Hindu friends from the temple community, vegetarian, about 8 of us, every other Saturday around Ikeja and Surulere, no alcohol", dims: { budget: "mid", age: "30s", size: "medium", interests: ["foodies"], constraints: ["no alcohol: faith"], sensitive: "religious-minority", language: "plain" }, hard: { noAlcohol: true, needsInclude: ["no alcohol"], discreetNoLabel: "hindu|hindus|temple|mandir" } },
  { id: "lag-toddlers-lekki", label: "Parents with toddlers, mornings", city: "Lagos", areas: ["Lekki", "Ajah"], sentence: "Parents with toddlers, 4 families, every other Saturday morning around Lekki and Ajah, kid-friendly only", dims: { budget: "mid", age: "30s", size: "medium", interests: ["family"], constraints: ["kids"], sensitive: null, language: "plain" }, hard: { kidFriendly: true, needsInclude: ["kid-friendly"], withinHours: ["08:00", "13:00"] } },
  { id: "lag-pikin-ikorodu", label: "Families with small pikin (Pidgin)", city: "Lagos", areas: ["Ikorodu"], sentence: "Mama and papa dem with small pikin, 6 families for Ikorodu, every other Saturday, somewhere wey pikin fit play, no too cost", dims: { budget: "cheap", age: "30s", size: "large", interests: ["family"], constraints: ["kids"], sensitive: null, language: "pidgin" }, hard: { kidFriendly: true, needsInclude: ["kid-friendly"], maxPrice: 5000 } },
  { id: "lag-retirees-ikoyi", label: "Retired couples, Ikoyi", city: "Lagos", areas: ["Ikoyi", "VI"], sentence: "Retired couples, 60s and 70s, 8 of us, a quiet lunch or a garden every other Saturday around Ikoyi and VI, nothing loud, we can afford it", dims: { budget: "comfortable", age: "retirees", size: "medium", interests: ["quiet"], constraints: [], sensitive: null, language: "plain" }, hard: { noNightlife: true } },
  { id: "lag-retirees-festac-pidgin", label: "Retired school friends (Pidgin)", city: "Lagos", areas: ["Festac", "Surulere"], sentence: "Old school friends, we don retire, 65 plus, we dey Festac and Surulere, every other Saturday afternoon, nothing wey get noise", dims: { budget: "mid", age: "retirees", size: "medium", interests: ["quiet"], constraints: [], sensitive: null, language: "pidgin" }, hard: { noNightlife: true } },
  { id: "lag-lagoon-ikorodu-lekki", label: "Across the lagoon: Ikorodu and Lekki", city: "Lagos", areas: ["Ikorodu", "Lekki"], sentence: "Mainland and island people, 6 of us, early 30s, half in Ikorodu and half in Lekki, every other Saturday, somewhere fair for everybody", dims: { budget: "mid", age: "30s", size: "medium", interests: ["hangout"], constraints: [], sensitive: null, language: "plain" }, hard: { maxTripMin: 90 } },
  { id: "lag-lagoon-three-areas", label: "Workmates in Ajah, Ikeja, Yaba", city: "Lagos", areas: ["Ajah", "Ikeja", "Yaba"], sentence: "Workmates, 5 of us, two in Ajah, two in Ikeja and one in Yaba, every other Saturday, a chill hangout", dims: { budget: "mid", age: "30s", size: "small", interests: ["hangout"], constraints: [], sensitive: null, language: "plain" }, hard: { maxTripMin: 90 } },
  { id: "lag-bankers-vi", label: "Banking colleagues, VI", city: "Lagos", areas: ["VI", "Ikoyi"], sentence: "Banking colleagues, 30s, every other Saturday after a long week, around VI and Ikoyi, nice places, money is fine", dims: { budget: "comfortable", age: "30s", size: "medium", interests: ["foodies"], constraints: [], sensitive: null, language: "plain" } },
  { id: "lag-diaspora-from-london", label: "Planned from London for Lagos cousins", city: "Lagos", areas: ["Surulere", "Yaba"], hintTz: "Europe/London", sentence: "I'm in London but I'm planning for my cousins in Lagos, 6 of them, around Surulere and Yaba, every other Saturday", dims: { budget: "mid", age: "20s", size: "medium", interests: ["hangout"], constraints: [], sensitive: null, language: "plain" } },
  { id: "lag-gameboys-yaba-pidgin", label: "Game boys, Yaba (Pidgin)", city: "Lagos", areas: ["Yaba"], sentence: "Na we be the game boys for Yaba, PS5 and board games, 6 of us, we no get plenty money, every Saturday", dims: { budget: "broke", age: "20s", size: "medium", interests: ["gamers"], constraints: [], sensitive: null, language: "pidgin" }, hard: { maxPrice: 5000, budgetRead: ["cheap", "free"] } },
  { id: "lag-concert-babes-lekki", label: "Uni girls who love concerts", city: "Lagos", areas: ["Lekki", "Ajah"], sentence: "Uni babes who love Afrobeats concerts, early 20s, 6 of us, every other Saturday around Lekki and Ajah, cheap abeg", dims: { budget: "cheap", age: "students", size: "medium", interests: ["afrobeats nightlife"], constraints: ["women-only"], sensitive: null, language: "mixed" }, hard: { maxPrice: 5000, needsInclude: ["women-friendly"] } },
  { id: "lag-chop-ikeja-pidgin", label: "Foodies, Ikeja (Pidgin)", city: "Lagos", areas: ["Ikeja", "Ogba"], sentence: "Make we go chop! Foodies wey like suya, amala and new spots, 7 of us for Ikeja and Ogba, every Saturday, mid budget", dims: { budget: "mid", age: "30s", size: "medium", interests: ["foodies"], constraints: [], sensitive: null, language: "pidgin" } },
  { id: "lag-church-youth-festac", label: "Church youth fellowship", city: "Lagos", areas: ["Festac", "Satellite Town"], sentence: "Our church youth fellowship, teens and early 20s, 15 of us, every other Saturday around Festac and Satellite Town, no alcohol and nothing late", dims: { budget: "cheap", age: "teens", size: "large", interests: ["gospel"], constraints: ["no alcohol: church"], sensitive: null, language: "plain" }, hard: { noAlcohol: true, noNightlife: true, needsInclude: ["no alcohol"] } },
  { id: "lag-draughts-surulere-pidgin", label: "Chess and draughts, 40s (Pidgin)", city: "Lagos", areas: ["Surulere"], sentence: "Chess and draughts guys for Surulere, 40s, we dey play every Saturday afternoon, quiet place abeg", dims: { budget: "mid", age: "40s+", size: "small", interests: ["chess"], constraints: [], sensitive: null, language: "pidgin" }, hard: { noNightlife: true } },
  { id: "lag-art-students-yabatech", label: "Art students, Yaba Tech", city: "Lagos", areas: ["Yaba", "Surulere"], sentence: "Art students from Yaba Tech, 19 to 23, sketching and exhibitions, every other Saturday around Yaba and Surulere, very cheap", dims: { budget: "broke", age: "students", size: "medium", interests: ["art"], constraints: [], sensitive: null, language: "plain" }, hard: { maxPrice: 5000, budgetRead: ["cheap", "free"] } },
  // ---- Abuja
  { id: "abj-tech-wuse", label: "Tech crowd, Abuja", city: "Abuja", areas: ["Wuse 2", "Jabi"], sentence: "Tech bros in Abuja, 20s and 30s, meetups and co-working, every other Saturday around Wuse 2 and Jabi", dims: { budget: "mid", age: "30s", size: "medium", interests: ["tech meetups"], constraints: [], sensitive: null, language: "mixed" } },
  { id: "abj-sisters-garki", label: "Muslim sisters, Abuja", city: "Abuja", areas: ["Garki", "Wuse"], sentence: "Muslim sisters in Abuja, 8 of us, 20s and 30s, women only, no alcohol, every other Saturday afternoon around Garki and Wuse", dims: { budget: "mid", age: "20s", size: "medium", interests: ["quiet"], constraints: ["no alcohol: mosque", "women-only"], sensitive: null, language: "plain" }, hard: { noAlcohol: true, needsInclude: ["no alcohol", "women-friendly"] } },
  { id: "abj-families-gwarinpa", label: "Families with young kids, Abuja", city: "Abuja", areas: ["Gwarinpa", "Kubwa"], sentence: "Families from Gwarinpa and Kubwa with young kids, every other Saturday, kid-friendly and cheap", dims: { budget: "cheap", age: "30s", size: "large", interests: ["family"], constraints: ["kids"], sensitive: null, language: "plain" }, hard: { kidFriendly: true, needsInclude: ["kid-friendly"], budgetRead: ["cheap", "free"] } },
  // ---- Accra
  { id: "acc-nightout-osu", label: "Accra nights out", city: "Accra", areas: ["Osu", "Labone"], sentence: "Accra crew, Afrobeats and highlife, 20s, nights out in Osu and Labone every other Saturday", dims: { budget: "mid", age: "20s", size: "medium", interests: ["afrobeats nightlife"], constraints: [], sensitive: null, language: "plain" } },
  { id: "acc-queer-lowkey", label: "Queer crew, Accra", city: "Accra", areas: ["East Legon", "Cantonments"], sentence: "Small queer crew in Accra, 4 of us, late 20s, we keep it low-key, every other Saturday around East Legon and Cantonments", dims: { budget: "mid", age: "20s", size: "small", interests: ["quiet"], constraints: [], sensitive: "lgbtq", language: "plain" }, hard: { needsInclude: ["safe", "discreet"], discreetNoLabel: LGBTQ } },
  { id: "acc-church-women-madina", label: "Church women, Madina", city: "Accra", areas: ["Madina", "Adenta"], sentence: "Church women's group from Madina and Adenta, 40s and 50s, every other Saturday afternoon, no alcohol", dims: { budget: "mid", age: "40s+", size: "large", interests: ["gospel"], constraints: ["no alcohol: church", "women-only"], sensitive: null, language: "plain" }, hard: { noAlcohol: true, needsInclude: ["no alcohol", "women-friendly"] } },
  // ---- Nairobi
  { id: "nbo-runclub", label: "Nairobi run club, 7am", city: "Nairobi", areas: ["Westlands", "Kilimani"], sentence: "Nairobi run club, Saturday 7am runs, 20 of us, around Westlands and Kilimani", dims: { budget: "mid", age: "30s", size: "large", interests: ["fitness"], constraints: [], sensitive: null, language: "plain" }, hard: { withinHours: ["06:00", "10:00"] } },
  { id: "nbo-gamers-southb", label: "Broke gamers, South B", city: "Nairobi", areas: ["South B", "South C"], sentence: "Gamers from South B and South C, FIFA nights and arcades, early 20s, broke kabisa, every Saturday", dims: { budget: "broke", age: "20s", size: "medium", interests: ["gamers"], constraints: [], sensitive: null, language: "mixed" }, hard: { budgetRead: ["cheap", "free"] } },
  { id: "nbo-bookclub-wheelchair", label: "Book club with a wheelchair user, Nairobi", city: "Nairobi", areas: ["Kilimani", "Kileleshwa"], sentence: "Book club in Kilimani and Kileleshwa, one member uses a wheelchair, 30s, every other Saturday afternoon", dims: { budget: "mid", age: "30s", size: "small", interests: ["book club"], constraints: ["step-free"], sensitive: null, language: "plain" }, hard: { stepFree: true, needsInclude: ["step-free"] } },
  // ---- London
  { id: "ldn-naija-peckham", label: "Naija crew in London", city: "London", areas: ["Peckham", "Brixton"], sentence: "Naija crew in London, 30s, around Peckham and Brixton, jollof and Afrobeats, every other Saturday", dims: { budget: "mid", age: "30s", size: "medium", interests: ["foodies", "afrobeats nightlife"], constraints: [], sensitive: null, language: "mixed" } },
  { id: "ldn-sober-hackney", label: "Sober curious, Hackney", city: "London", areas: ["Hackney", "Stratford"], sentence: "Sober curious friends in Hackney and Stratford, 30s, no pubs please, every other Saturday", dims: { budget: "mid", age: "30s", size: "small", interests: ["hangout"], constraints: ["no alcohol: sober"], sensitive: null, language: "plain" }, hard: { noAlcohol: true, needsInclude: ["no alcohol"] } },
  { id: "ldn-retired-croydon", label: "Retired teachers, Croydon", city: "London", areas: ["Croydon"], sentence: "Retired teachers in Croydon, 70s, a gentle walk and a cuppa every other Saturday, step-free if possible", dims: { budget: "mid", age: "retirees", size: "small", interests: ["quiet"], constraints: [], sensitive: null, language: "plain" }, hard: { noNightlife: true } },
  // ---- Berlin
  { id: "ber-kunst-kreuzberg", label: "Gallery people, Kreuzberg", city: "Berlin", areas: ["Kreuzberg", "Neukölln"], sentence: "Kunst people in Kreuzberg and Neukölln, galleries and openings, 30s, every other Saturday", dims: { budget: "mid", age: "30s", size: "small", interests: ["art"], constraints: [], sensitive: null, language: "mixed" } },
  { id: "ber-hijabi-wedding", label: "Hijabi sisters, Berlin", city: "Berlin", areas: ["Wedding", "Moabit"], sentence: "Hijabi sisters in Berlin, Wedding and Moabit, 20s, women only, no alcohol, every other Saturday afternoon", dims: { budget: "cheap", age: "20s", size: "medium", interests: ["quiet"], constraints: ["no alcohol: faith", "women-only"], sensitive: "religious-minority", language: "plain" }, hard: { noAlcohol: true, needsInclude: ["no alcohol", "women-friendly"], discreetNoLabel: "hijabi|hijabis|hijab|muslim|muslims|islam|islamic|mosque|masjid" } },
  { id: "ber-chess-prenzlauer", label: "Chess nerds, 40s, Berlin", city: "Berlin", areas: ["Prenzlauer Berg", "Friedrichshain"], sentence: "Chess nerds in Prenzlauer Berg and Friedrichshain, 40s, every Saturday afternoon, quiet cafés", dims: { budget: "mid", age: "40s+", size: "small", interests: ["chess"], constraints: [], sensitive: null, language: "plain" }, hard: { noNightlife: true } },
  // ---- Bengaluru
  { id: "blr-startup-koramangala", label: "Startup folks, Bengaluru", city: "Bengaluru", areas: ["Koramangala", "HSR Layout"], sentence: "Startup folks in Koramangala and HSR Layout, 20s, meetups and filter coffee, every other Saturday", dims: { budget: "mid", age: "20s", size: "medium", interests: ["tech meetups"], constraints: [], sensitive: null, language: "plain" } },
  { id: "blr-football-indiranagar", label: "Premier League watch party, Bengaluru", city: "Bengaluru", areas: ["Indiranagar", "Whitefield"], sentence: "Football watch party crew in Indiranagar and Whitefield, Premier League Saturdays, 10 of us, late 20s", dims: { budget: "mid", age: "20s", size: "large", interests: ["football watch parties"], constraints: [], sensitive: null, language: "plain" } },
  { id: "blr-teens-jayanagar", label: "Parents with teens, Bengaluru", city: "Bengaluru", areas: ["Jayanagar", "Malleshwaram"], sentence: "Parents taking our teens, 13 to 15, out every other Saturday around Jayanagar and Malleshwaram, nothing late and no parties", dims: { budget: "mid", age: "teens", size: "medium", interests: ["hangout"], constraints: ["kids"], sensitive: null, language: "plain" }, hard: { noAlcohol: true, noNightlife: true } },
  // ---- São Paulo
  { id: "sp-foodies-pinheiros", label: "Foodies, São Paulo (mixed Portuguese)", city: "São Paulo", areas: ["Pinheiros", "Vila Madalena"], sentence: "Galera foodie de Pinheiros e Vila Madalena, 30s, every other Saturday, feiras e comida de rua", dims: { budget: "mid", age: "30s", size: "medium", interests: ["foodies"], constraints: [], sensitive: null, language: "mixed" } },
  { id: "sp-gospel-youth-mooca", label: "Evangelical youth, São Paulo", city: "São Paulo", areas: ["Mooca", "Liberdade"], sentence: "Evangelical youth group from Mooca and Liberdade, gospel music, late teens, no alcohol, every other Saturday", dims: { budget: "cheap", age: "teens", size: "large", interests: ["gospel"], constraints: ["no alcohol: church"], sensitive: null, language: "plain" }, hard: { noAlcohol: true, noNightlife: true, needsInclude: ["no alcohol"] } },
  { id: "sp-usp-broke", label: "Broke students, São Paulo", city: "São Paulo", areas: ["Butantã", "Pinheiros"], sentence: "Broke USP students around Butantã and Pinheiros, every Saturday, free stuff only", dims: { budget: "broke", age: "students", size: "medium", interests: ["hangout"], constraints: [], sensitive: null, language: "plain" }, hard: { maxPrice: 0, budgetRead: ["free"] } },
  // ---- a small town
  { id: "tot-walkers", label: "Walking group, Totnes (small town)", city: "Totnes", areas: ["Totnes", "Dartington"], sentence: "Walking group in Totnes and Dartington, 60s, every other Saturday, a countryside walk and tea after", dims: { budget: "mid", age: "retirees", size: "medium", interests: ["fitness", "quiet"], constraints: [], sensitive: null, language: "plain" }, hard: { noNightlife: true } },
];

// ---------------------------------------------------------------- assemble

function persona(/** @type {Def} */ d) {
  const city = CITIES[d.city];
  if (!city) throw new Error(`no city ${d.city}`);
  const areas = d.areas.map((label) => {
    const a = AREAS[label];
    if (!a) throw new Error(`no area ${label}`);
    return { label, lat: a[0], lon: a[1], tolKm: a[2] };
  });
  const kinds = [...new Set(d.dims.interests.flatMap((i) => INTERESTS[i].kinds))];
  const keywords = [...new Set(d.dims.interests.flatMap((i) => INTERESTS[i].keywords))];
  /** @type {Record<string, any>} */
  const hard = {
    areasOnMap: true,
    cityCorrect: city.bbox ? { bbox: city.bbox } : { center: city.center, km: city.km },
    timezoneCorrect: city.tz,
    ...(d.hard || {}),
  };
  if (typeof hard.maxPrice === "number") hard.maxPrice = { amount: hard.maxPrice, currency: city.currency };
  if (typeof hard.discreetNoLabel === "string") hard.discreetNoLabel = { labels: hard.discreetNoLabel };
  const geo = d.city === "Lagos" ? lagosGeo(d.areas) : d.city === "Totnes" ? "small town" : d.city;
  return {
    id: d.id,
    label: d.label,
    sentence: d.sentence,
    city: d.city,
    hintTz: d.hintTz ?? city.tz,
    areas,
    dims: { ...d.dims, geo, region: d.city === "Lagos" ? "Lagos" : "elsewhere" },
    taste: { kinds, keywords },
    hard,
  };
}

/** A Lagos crew's geography dimension: its first area, or "across the lagoon" when it spans mainland and island. */
function lagosGeo(/** @type {string[]} */ areas) {
  const island = new Set(["VI", "Lekki", "Lekki Phase 1", "Ikoyi", "Ajah", "Obalende"]);
  const sides = new Set(areas.map((a) => (island.has(a) ? "island" : "mainland")));
  return sides.size > 1 ? "across the lagoon" : areas[0];
}

/** mulberry32: a small seeded generator, so the split is the same on every machine. */
function rng(/** @type {number} */ seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The values a persona has on each stratification dimension. */
function strata(/** @type {any} */ p) {
  const d = p.dims;
  return [
    `budget:${d.budget}`, `age:${d.age}`, `size:${d.size}`, `language:${d.language}`, `region:${d.region}`, `geo:${d.geo}`,
    `sensitive:${d.sensitive ?? "none"}`, ...d.interests.map((/** @type {string} */ i) => `interest:${i}`),
    ...(d.constraints.length ? d.constraints.map((/** @type {string} */ c) => `constraint:${c.split(":")[0]}`) : ["constraint:none"]),
  ];
}

/**
 * Stratified split over many dimensions at once: shuffle with the seed, then put each persona
 * (rarest strata first) in the half where its strata are least represented so far, keeping
 * the halves at 30 each.
 */
function split(/** @type {any[]} */ personas) {
  const r = rng(SEED);
  const order = personas.map((p) => ({ p, k: r() }));
  const freq = new Map();
  for (const { p } of order) for (const s of strata(p)) freq.set(s, (freq.get(s) || 0) + 1);
  // rarest first, ties broken by the seeded key
  order.sort((a, b) => Math.min(...strata(a.p).map((s) => freq.get(s))) - Math.min(...strata(b.p).map((s) => freq.get(s))) || a.k - b.k);
  const half = personas.length / 2;
  /** @type {{ dev: Map<string, number>, test: Map<string, number>, n: { dev: number, test: number } }} */
  const count = { dev: new Map(), test: new Map(), n: { dev: 0, test: 0 } };
  /** @type {Record<string, "dev"|"test">} */
  const out = {};
  for (const { p, k } of order) {
    const cost = (/** @type {"dev"|"test"} */ side) => strata(p).reduce((sum, s) => sum + (count[side].get(s) || 0) / freq.get(s), 0);
    let side = /** @type {"dev"|"test"} */ (cost("dev") < cost("test") ? "dev" : cost("test") < cost("dev") ? "test" : k < 0.5 ? "dev" : "test");
    if (count.n[side] >= half) side = side === "dev" ? "test" : "dev";
    out[p.id] = side;
    count.n[side]++;
    for (const s of strata(p)) count[side].set(s, (count[side].get(s) || 0) + 1);
  }
  return out;
}

const personas = DEFS.map(persona);
const ids = new Set();
for (const p of personas) {
  if (ids.has(p.id)) throw new Error(`duplicate id ${p.id}`);
  ids.add(p.id);
  if (/[—–]/.test(p.sentence)) throw new Error(`dash in ${p.id}`);
}
if (personas.length !== 60) throw new Error(`expected 60 personas, have ${personas.length}`);
const sides = split(personas);
const file = {
  version: "v2",
  about: "Persona eval v2 for Come Through: 60 crews from explicit dimensions, frozen before any run. See eval/personas/FROZEN.md for the rules and the hash, and eval/checks.mjs for what each hard constraint means.",
  seed: SEED,
  target: { date: "2026-10-24", weekday: "Saturday", now: "2026-10-22T11:00:00Z" },
  dimensions: {
    budget: ["broke", "cheap", "mid", "comfortable"],
    age: ["teens", "students", "20s", "30s", "40s+", "retirees"],
    size: ["small (4 to 5)", "medium (6 to 9)", "large (10 or more)"],
    interests: Object.keys(INTERESTS),
    constraints: ["no alcohol: church", "no alcohol: mosque", "no alcohol: faith", "no alcohol: sober", "kids", "step-free", "night-shift", "women-only"],
    sensitive: ["lgbtq", "religious-minority"],
    language: ["pidgin", "mixed", "plain"],
  },
  interests: INTERESTS,
  personas: personas.map((p) => ({ ...p, split: sides[p.id] })),
};
const json = `${JSON.stringify(file, null, 1)}\n`;
const sha = crypto.createHash("sha256").update(json).digest("hex");
if (process.argv.includes("--check")) {
  const now = fs.readFileSync(OUT, "utf8");
  if (now !== json) {
    console.error("v2.json differs from what build-v2.mjs makes");
    process.exit(1);
  }
  console.log(`v2.json matches (sha256 ${sha})`);
} else {
  fs.writeFileSync(OUT, json);
  const n = (/** @type {string} */ s) => file.personas.filter((p) => p.split === s).length;
  console.log(`wrote ${OUT}: ${personas.length} personas, dev ${n("dev")}, test ${n("test")}; sha256 ${sha}`);
}
