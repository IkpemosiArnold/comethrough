// @ts-check
// The crew's taste: what the crew is into and what makes a place feel right for it, so that
// describing the crew changes what the sloth suggests. Pure and city-free.
//
//   taste = { scenes: ["alte"], likes: ["art", "live music"], placeKinds: ["gallery", "cafe"],
//             eventKeywords: ["art", "exhibition", "indie"], avoid: ["clubs"],
//             needs: ["discreet", "women-friendly"], budget: "cheap"|"free"|"any"|null,
//             ageBand: "late 20s"|null, energy: "chill"|"lively"|"mixed"|null }
//
// Gemma reads the setup sentence (and the optional "what you're into" line) into a taste,
// with cultural knowledge applied ("alte" is Lagos's alternative scene: docs/LOCAL-FACTS.md).
// This module checks the answer: list values come from closed vocabularies where they drive
// code (placeKinds, needs, energy), free words are short and few, and a taste must rest on
// words the sentence actually says, so nothing is invented for a crew that said nothing.
//
// Sensitive attributes (a safety requirement, docs/LOCAL-FACTS.md, "Sensitive attributes"):
// same-sex relationships are criminalised in Nigeria, so who a crew is never gets stored.
// Sexual orientation, gender identity, religion, health and ethnicity are turned into NEEDS
// (safe, discreet, women-friendly, no alcohol, step-free...) and the words themselves are
// dropped from every stored field. The raw sentence is read once and never kept.
//
// placeKinds map to OpenStreetMap tags here, deterministically (PLACE_KINDS), so the places
// pipeline can ask Overpass for them and the scorer can tell a gallery from a bar.

import { SENSITIVE, HIGH_RISK, sensitiveIn, hasSensitive, scrubSensitive, scrubDeep } from "./sensitive.mjs";

// ---------------------------------------------------------------- vocabularies

/** What a crew may need from a place. Closed: code acts on each one. */
export const NEEDS = Object.freeze(["safe", "discreet", "women-friendly", "inclusive", "no alcohol", "kid-friendly", "step-free", "quiet", "daytime"]);
export const ENERGY = Object.freeze(["chill", "lively", "mixed"]);

/** How each need reads on the organiser's own setup screen (never shown to anyone else). */
export const NEED_LABELS = Object.freeze({
  safe: "Feels safe",
  discreet: "Low-key places",
  "women-friendly": "Women-friendly",
  inclusive: "Welcoming",
  "no alcohol": "No alcohol",
  "kid-friendly": "Kid-friendly",
  "step-free": "Step-free",
  quiet: "Quiet",
  daytime: "Daytime",
});

/**
 * @typedef {object} PlaceKind
 * @property {[string, string][]} tags   OpenStreetMap key=value pairs that make a place this kind
 * @property {string} label              how an explanation names it ("an art gallery")
 * @property {boolean} [outdoor]         open-air
 * @property {boolean} [indoor]          under a roof by its nature (a gallery, a cinema)
 * @property {boolean} [alcohol]         its main trade is drink
 * @property {boolean} [nightlife]       mostly a late-night place
 * @property {boolean} [lowKey]          quiet, seated, unhurried: suits a crew that wants discreet
 * @property {boolean} [kids]            made for children
 */

/**
 * The place kinds a taste may name, and their OpenStreetMap tags (wiki.openstreetmap.org,
 * "Map features"). Deterministic: Gemma picks names from this list, code does the rest.
 * @type {Readonly<Record<string, PlaceKind>>}
 */
export const PLACE_KINDS = Object.freeze({
  park: { tags: [["leisure", "park"]], label: "a park", outdoor: true, lowKey: true },
  garden: { tags: [["leisure", "garden"]], label: "a garden", outdoor: true, lowKey: true },
  beach: { tags: [["natural", "beach"]], label: "a beach", outdoor: true },
  playground: { tags: [["leisure", "playground"]], label: "a playground", outdoor: true, kids: true },
  gallery: { tags: [["tourism", "gallery"]], label: "an art gallery", indoor: true, lowKey: true },
  museum: { tags: [["tourism", "museum"]], label: "a museum", indoor: true, lowKey: true },
  "arts centre": { tags: [["amenity", "arts_centre"]], label: "an art space", indoor: true, lowKey: true },
  cafe: { tags: [["amenity", "cafe"]], label: "a café", indoor: true, lowKey: true },
  restaurant: { tags: [["amenity", "restaurant"]], label: "a restaurant", indoor: true },
  "street food": { tags: [["amenity", "fast_food"]], label: "a food spot", indoor: true },
  "ice cream": { tags: [["amenity", "ice_cream"]], label: "an ice cream spot", indoor: true, kids: true },
  mall: { tags: [["shop", "mall"]], label: "a mall", indoor: true, kids: true },
  bar: { tags: [["amenity", "bar"]], label: "a bar", alcohol: true, nightlife: true },
  pub: { tags: [["amenity", "pub"], ["amenity", "biergarten"]], label: "a pub", alcohol: true },
  nightclub: { tags: [["amenity", "nightclub"]], label: "a club", alcohol: true, nightlife: true },
  "live music": { tags: [["amenity", "music_venue"]], label: "a live music venue", nightlife: true },
  cinema: { tags: [["amenity", "cinema"]], label: "a cinema", indoor: true },
  theatre: { tags: [["amenity", "theatre"]], label: "a theatre", indoor: true },
  bookshop: { tags: [["shop", "books"]], label: "a bookshop", indoor: true, lowKey: true },
  thrift: { tags: [["shop", "second_hand"], ["shop", "charity"]], label: "a thrift shop", indoor: true },
  market: { tags: [["amenity", "marketplace"]], label: "a market" },
  library: { tags: [["amenity", "library"]], label: "a library", indoor: true, lowKey: true },
  "community centre": { tags: [["amenity", "community_centre"]], label: "a community centre", indoor: true },
  sports: { tags: [["leisure", "sports_centre"], ["leisure", "pitch"]], label: "a sports ground" },
  bowling: { tags: [["leisure", "bowling_alley"]], label: "a bowling alley", indoor: true },
  arcade: { tags: [["leisure", "amusement_arcade"]], label: "an arcade", indoor: true },
  "theme park": { tags: [["tourism", "theme_park"]], label: "a theme park", outdoor: true, kids: true },
  zoo: { tags: [["tourism", "zoo"]], label: "a zoo", outdoor: true, kids: true },
});
export const PLACE_KIND_NAMES = Object.freeze(Object.keys(PLACE_KINDS));

/** The place kind a set of OpenStreetMap tags is, or null. */
export function kindOfTags(/** @type {Record<string,string>} */ tags = {}) {
  for (const [name, k] of Object.entries(PLACE_KINDS)) if (k.tags.some(([key, v]) => tags[key] === v)) return name;
  return null;
}

/** The OpenStreetMap tags to ask for, by key, for a list of place kinds: { amenity: ["cafe", "bar"], tourism: ["gallery"] }. */
export function osmTagsFor(/** @type {string[]} */ kinds = []) {
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const n of kinds) for (const [k, v] of PLACE_KINDS[n]?.tags || []) (out[k] ||= []).includes(v) || out[k].push(v);
  return out;
}

// ---------------------------------------------------------------- sensitive attributes (src/core/sensitive.mjs)

export { SENSITIVE, HIGH_RISK, sensitiveIn, hasSensitive, scrubSensitive, scrubDeep };

const WOMEN = /\b(women|woman|female|females|girls|ladies|sisters|babes|sapphics?|lesbians?|wlw)\b/i;
const KIDS = /\b(kids|children|child|toddlers?|babies|baby|little ones|young ones|family|families|parents|mums|moms|dads)\b/i;
const YOUNG_KIDS = /\b(toddlers?|babies|baby|little ones|young (?:kids|children)|small (?:kids|children|pikin))\b/i;
const ABSTAIN = /\b(muslims?|islam|islamic|mosque|masjid|jumu?['’]?ah|jummah|pentecostals?|rccg|deeper life|mfm|sober|recovering|in recovery|alcoholics?|no (?:alcohol|drinks?|booze))\b/i;
const YOUTH = /\b(youth|youths|teens?|teenagers?|fellowship|choir|students?)\b/i;

/**
 * The needs a sentence implies on its own, whatever Gemma says: code's floor, so a safety
 * need never depends on the model. Who the crew is becomes what it needs; the words go.
 * @param {string} sentence
 * @returns {string[]}
 */
export function impliedNeeds(sentence) {
  const s = String(sentence ?? "");
  const cats = sensitiveIn(s);
  /** @type {Set<string>} */
  const out = new Set();
  if (cats.includes("orientation") || cats.includes("genderIdentity")) ["safe", "discreet", "inclusive"].forEach((n) => out.add(n));
  if (WOMEN.test(s)) out.add("women-friendly");
  if (KIDS.test(s)) out.add("kid-friendly");
  if (YOUNG_KIDS.test(s)) out.add("daytime");
  if (ABSTAIN.test(s) || (cats.includes("religion") && YOUTH.test(s))) out.add("no alcohol");
  if (/\b(wheelchairs?|step[- ]free|mobility)\b/i.test(s)) out.add("step-free");
  return NEEDS.filter((n) => out.has(n));
}

// ---------------------------------------------------------------- reading a taste

/** @typedef {{ scenes: string[], likes: string[], placeKinds: string[], eventKeywords: string[], avoid: string[], needs: string[], budget: "free"|"cheap"|"any"|null, ageBand: string|null, energy: "chill"|"lively"|"mixed"|null }} Taste */

/** A taste with nothing in it. */
export const EMPTY_TASTE = Object.freeze({ scenes: [], likes: [], placeKinds: [], eventKeywords: [], avoid: [], needs: [], budget: null, ageBand: null, energy: null });

const norm = (/** @type {string} */ s) => String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9+]+/g, " ").trim();
const STOP = new Set(["the", "and", "for", "with", "our", "we", "are", "who", "into", "like", "likes", "love", "mostly", "some", "lot", "lots", "crew", "group", "guys", "people", "friends", "gang"]);

/**
 * A word's stem, so close variants match: "raves" and "rave", "parties" and "party",
 * "clubbing" and "club", "galleries" and "gallery". Rough on purpose; it only ever compares
 * a word with the organiser's own words.
 */
export function stem(/** @type {string} */ w) {
  let t = String(w).toLowerCase();
  if (t.length > 5 && t.endsWith("ing")) t = t.slice(0, -3).replace(/(.)\1$/, "$1");
  else if (t.length > 4 && t.endsWith("ies")) t = `${t.slice(0, -3)}y`;
  else if (t.length > 4 && /(ches|shes|sses|xes)$/.test(t)) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
  if (t.length > 4 && t.endsWith("e")) t = t.slice(0, -1);
  return t;
}

/** True when a word or phrase is said in the source: one of its distinctive words, as a whole word or a close variant ("rave" for "raves"). */
function said(/** @type {string} */ v, /** @type {string} */ source) {
  const srcToks = new Set(norm(source).split(" ").filter(Boolean).map(stem));
  const toks = norm(v).split(" ").filter((t) => (t.length >= 3 || /\d/.test(t)) && !STOP.has(t));
  return toks.length > 0 && toks.some((t) => srcToks.has(stem(t)));
}

/**
 * Close relatives of taste words, so a reading of the organiser's words in other words is
 * kept item by item: "raves" grounds nightlife, dancing, a club and music; "art galleries"
 * grounds a museum and an exhibition, and not cocktails or a bar (the review of d01a23b:
 * one grounded word had let every other preference Gemma added through). Small and explicit
 * on purpose, and city-free: a word not here keeps only what says it, or what TASTE_WORDS
 * reads from it. Matched by stem, both ways round.
 * @type {readonly { words: string[], related: string[] }[]}
 */
export const RELATED = Object.freeze([
  { words: ["rave", "raver", "techno", "edm"], related: ["nightlife", "dancing", "club", "nightclub", "music", "party", "dj", "techno", "house music"] },
  { words: ["party", "club", "clubbing", "dancing", "dance"], related: ["nightlife", "dancing", "club", "nightclub", "music", "party", "dj", "rave"] },
  { words: ["nightlife", "night out"], related: ["club", "nightclub", "bar", "party", "dancing", "music", "dj", "rave"] },
  { words: ["music", "concert", "gig", "jazz", "afrobeats", "amapiano", "band"], related: ["live music", "music", "concert", "gig", "band", "jazz", "dj", "open mic", "festival"] },
  { words: ["art", "arts", "gallery", "exhibition", "artsy"], related: ["art", "gallery", "arts centre", "museum", "exhibition", "painting", "sculpture", "photography", "design", "craft"] },
  { words: ["museum", "history", "heritage"], related: ["museum", "history", "heritage", "gallery", "exhibition", "art", "culture"] },
  { words: ["drinks", "cocktail", "wine", "beer", "bar", "pub"], related: ["drinks", "bar", "pub", "cocktail", "wine", "beer", "rooftop", "lounge"] },
  { words: ["food", "foodie", "eat", "eating", "restaurant", "dinner", "lunch"], related: ["food", "restaurant", "cafe", "brunch", "street food", "dining", "dessert", "ice cream"] },
  { words: ["brunch", "breakfast", "coffee", "cafe"], related: ["brunch", "cafe", "coffee", "breakfast", "bakery", "restaurant", "food"] },
  { words: ["chill", "relaxed", "relax", "cosy", "cozy", "low key"], related: ["chill", "cafe", "garden", "park", "lounge", "quiet"] },
  { words: ["outdoors", "outside", "park", "picnic", "nature", "green"], related: ["outdoors", "park", "garden", "beach", "picnic", "nature", "hiking", "walk"] },
  { words: ["beach", "seaside"], related: ["beach", "seaside", "swimming", "picnic", "outdoors", "sunset"] },
  { words: ["hiking", "hike", "walk", "walking", "trail"], related: ["hiking", "nature", "park", "trail", "outdoors", "walk"] },
  { words: ["games", "gaming", "arcade", "bowling", "quiz", "trivia"], related: ["games", "arcade", "bowling", "board games", "gaming", "quiz", "trivia"] },
  { words: ["movie", "film", "cinema"], related: ["cinema", "movies", "film", "screening"] },
  { words: ["comedy", "stand up"], related: ["comedy", "theatre", "open mic", "improv"] },
  { words: ["theatre", "theater", "plays", "drama"], related: ["theatre", "plays", "drama", "comedy", "musical", "performance"] },
  { words: ["book", "reading", "bookshop", "poetry"], related: ["books", "bookshop", "library", "reading", "poetry", "spoken word", "open mic"] },
  { words: ["thrift", "vintage"], related: ["thrift", "vintage", "market", "flea market", "fashion"] },
  { words: ["sport", "football", "basketball", "tennis", "gym", "running", "fitness"], related: ["sports", "sport", "football", "fitness", "running", "gym", "basketball", "tennis", "match"] },
  { words: ["shopping", "mall"], related: ["shopping", "mall", "market"] },
  { words: ["karaoke", "singing"], related: ["karaoke", "singing", "music", "bar"] },
  { words: ["meetup", "hackathon", "tech", "coding", "startup", "networking", "talks", "workshop"], related: ["meetups", "hackathons", "tech", "talks", "workshops", "networking", "coding", "community centre", "cafe", "library"] },
  { words: ["craft", "crafts", "diy", "pottery", "sewing"], related: ["crafts", "workshops", "arts centre", "community centre", "market"] },
]);

/** Words too general to ground anything by themselves ("live" in live music, "centre" in arts centre). */
const GENERIC = new Set(["live", "centre", "center", "street", "theme", "community", "open", "night", "place", "spot", "venue", "thing", "event", "vibe", "good", "fun", "time", "out", "house", "word", "board"].map(stem));

/** Two-letter taste words that still mean something. */
const SHORT = new Set(["dj", "mc"]);

/** The distinctive word stems of a word or phrase. */
const distinct = (/** @type {string} */ t) => (t.length >= 3 || /\d/.test(t) || SHORT.has(t)) && !STOP.has(t) && !GENERIC.has(t);
const stems = (/** @type {string} */ v) => norm(v).split(" ").filter((t) => t && !STOP.has(t)).map(stem).filter(distinct);

/** RELATED with its words as stems, built once. */
const RELATED_STEMS = RELATED.map((g) => ({ words: g.words.map((w) => norm(w).split(" ").map(stem).join(" ")), related: g.related.flatMap(stems), phrases: g.related.map((r) => `=${norm(r)}`) }));

/**
 * What a sentence grounds, as word stems: its own words, their RELATED words, and what
 * TASTE_WORDS reads from it. An item rests on the sentence when one of its distinctive
 * words is in this set. Whole related phrases are in it too, marked "=", so a kind whose
 * words are all general ("community centre") can still be grounded by name.
 * @param {string} src
 */
function groundOf(src) {
  const toks = norm(src).split(" ").filter(Boolean).map(stem);
  const text = ` ${toks.join(" ")} `;
  const out = new Set(toks.filter(distinct));
  for (const g of RELATED_STEMS) if (g.words.some((w) => text.includes(` ${w} `))) [...g.related, ...g.phrases].forEach((r) => out.add(r));
  for (const e of plainEntries(src)) [...(e.likes || []), ...(e.kinds || []), ...(e.keys || [])].flatMap(stems).forEach((r) => out.add(r));
  return out;
}

/**
 * Kinds of place a kind of group points to, by the group words the sentence says. City-free
 * and explicit, like RELATED; used to ground the model's kinds for who the crew is, and as a
 * fallback so no crew is left with no kind of place at all.
 * @type {readonly { re: RegExp, kinds: string[] }[]}
 */
export const GROUP_KINDS = Object.freeze([
  { re: /\b(students?|uni|university|campus|undergrads?)\b/i, kinds: ["cafe", "street food", "park"] },
  { re: /\b(parents|mums|moms|dads|famil(?:y|ies)|kids|toddlers?|children)\b/i, kinds: ["playground", "park", "zoo", "ice cream", "community centre"] },
  { re: /\b(colleagues|work friends|workmates|office|corporate|bankers|lawyers)\b/i, kinds: ["restaurant", "cafe"] },
  { re: /\b(techies|tech bros|developers?|devs?|engineers|startup folks)\b/i, kinds: ["cafe", "community centre", "library"] },
  { re: /\b(creatives|artists|musicians)\b/i, kinds: ["gallery", "arts centre", "live music", "cafe"] },
  { re: /\b(gym|runners|footballers?|ballers)\b/i, kinds: ["sports", "park"] },
  { re: /\b(gamers)\b/i, kinds: ["arcade", "bowling"] },
  { re: /\b(youth|choir|fellowship)\b/i, kinds: ["community centre", "park", "cafe"] },
  { re: /\b(retirees?|retired)\b/i, kinds: ["garden", "restaurant", "cafe"] },
  { re: /\b(alumni|old (?:boys|girls)|class of)\b/i, kinds: ["restaurant", "cafe"] },
]);

/** Kinds of place a budget points to: free and cheap places. */
const BUDGET_KINDS = Object.freeze({ free: ["park", "garden", "beach", "library", "community centre"], cheap: ["park", "street food", "market", "cafe"] });

/** The last resort, so no crew that said anything is left with no kind of place: green, and two roofs for a wet day. */
const DEFAULT_KINDS = Object.freeze(["park", "cafe", "museum"]);

/**
 * Taste words people use, read by code alone: the floor under Gemma's reading, and the whole
 * reading when Gemma is busy. Each says what the words are into, which kinds of place suit
 * them (PLACE_KINDS), words to look for in event guides, the vibe words (VIBE_MATCHERS) and
 * the energy. Only words the text says are matched; nothing is inferred about who anyone is.
 * @type {readonly { re: RegExp, likes?: string[], kinds?: string[], keys?: string[], tags?: string[], energy?: "chill"|"lively" }[]}
 */
export const TASTE_WORDS = Object.freeze([
  { re: /\b(raves?|raving|ravers?)\b/i, likes: ["raves"], kinds: ["nightclub", "live music"], keys: ["rave", "party", "dj"], tags: ["party", "music"], energy: "lively" },
  { re: /\b(part(?:y|ies)|turn ?up|owambe|clubbing|clubs?|nightlife|night ?out)\b/i, likes: ["parties"], kinds: ["nightclub", "bar"], keys: ["party"], tags: ["party"], energy: "lively" },
  { re: /\b(danc(?:e|es|ing))\b/i, likes: ["dancing"], kinds: ["nightclub"], keys: ["dance"], tags: ["party"], energy: "lively" },
  { re: /\b(live music|concerts?|gigs?|afrobeats?|amapiano|jazz|highlife|music)\b/i, likes: ["live music"], kinds: ["live music"], keys: ["music", "concert", "live"], tags: ["music"] },
  { re: /\b(karaoke)\b/i, likes: ["karaoke"], kinds: ["bar"], keys: ["karaoke"], tags: ["music"], energy: "lively" },
  { re: /\b(chill(?:ed|ing)?|low[- ]?key|laid[- ]back|relaxed|easy ?going|cosy|cozy)\b/i, kinds: ["cafe"], tags: ["chill"], energy: "chill" },
  { re: /\b(arts?|galler(?:y|ies)|exhibitions?|artsy)\b/i, likes: ["art"], kinds: ["gallery", "arts centre"], keys: ["art", "exhibition"], tags: ["art"] },
  { re: /\b(museums?|history)\b/i, likes: ["museums"], kinds: ["museum"], keys: ["museum"], tags: ["art"] },
  { re: /\b(beach(?:es)?|seaside|by the water)\b/i, likes: ["beach"], kinds: ["beach"], keys: ["beach"], tags: ["beach"] },
  { re: /\b(outside|outdoors?|parks?|picnics?|nature|green)\b/i, likes: ["outdoors"], kinds: ["park", "garden"], keys: ["picnic", "outdoor"], tags: ["outside"] },
  { re: /\b(food|foodies?|eat(?:ing)?|brunch|suya|restaurants?|amala|jollof)\b/i, likes: ["food"], kinds: ["restaurant", "street food"], keys: ["food", "brunch"], tags: ["food"] },
  { re: /\b(drinks?|cocktails?|wine|beers?|palm ?wine)\b/i, likes: ["drinks"], kinds: ["bar"], keys: ["drinks"], tags: ["drinks"] },
  { re: /\b(games?|game nights?|board ?games|gaming|arcades?|bowling|ps5)\b/i, likes: ["games"], kinds: ["arcade", "bowling"], keys: ["games"], tags: ["games"] },
  { re: /\b(movies?|cinema|films?)\b/i, likes: ["movies"], kinds: ["cinema"], keys: ["film", "movie"] },
  { re: /\b(comedy|stand[- ]?up)\b/i, likes: ["comedy"], kinds: ["theatre"], keys: ["comedy"] },
  { re: /\b(theatre|theater|plays|drama)\b/i, likes: ["theatre"], kinds: ["theatre"], keys: ["theatre", "play"] },
  { re: /\b(books?|bookshops?|reading)\b/i, likes: ["books"], kinds: ["bookshop", "library"], keys: ["book", "reading"] },
  { re: /\b(thrift(?:ing)?|vintage)\b/i, likes: ["thrift"], kinds: ["thrift", "market"], keys: ["thrift", "vintage"] },
  { re: /\b(sports?|football|basketball|tennis|gym|running|fitness)\b/i, likes: ["sport"], kinds: ["sports"], keys: ["sport"], tags: ["sport", "active"], energy: "lively" },
  { re: /\b(shopping|malls?)\b/i, likes: ["shopping"], kinds: ["mall"], keys: ["market"] },
]);

/**
 * The taste a text plainly says, from TASTE_WORDS: { likes, placeKinds, eventKeywords,
 * vibeTags, energy }. Empty lists when it says nothing.
 * @param {string|null|undefined} text
 */
export function plainTaste(text) {
  return tasteOf(plainEntries(text));
}

/** The TASTE_WORDS entries a text says. */
export function plainEntries(/** @type {string|null|undefined} */ text) {
  const t = String(text ?? "");
  return TASTE_WORDS.filter((w) => w.re.test(t));
}

/** The taste a few TASTE_WORDS entries add up to. */
function tasteOf(/** @type {typeof TASTE_WORDS[number][]} */ entries) {
  /** @type {Set<string>} */ const likes = new Set();
  /** @type {Set<string>} */ const kinds = new Set();
  /** @type {Set<string>} */ const keys = new Set();
  /** @type {Set<string>} */ const tags = new Set();
  /** @type {Set<string>} */ const energies = new Set();
  for (const w of entries) {
    (w.likes || []).forEach((x) => likes.add(x));
    (w.kinds || []).forEach((x) => kinds.add(x));
    (w.keys || []).forEach((x) => keys.add(x));
    (w.tags || []).forEach((x) => tags.add(x));
    if (w.energy) energies.add(w.energy);
  }
  /** @type {"chill"|"lively"|"mixed"|null} */
  const energy = energies.size === 2 ? "mixed" : energies.size === 1 ? /** @type {"chill"|"lively"} */ ([...energies][0]) : null;
  return { likes: [...likes], placeKinds: [...kinds], eventKeywords: [...keys], vibeTags: [...tags], energy };
}

/** Lists merged in order, without repeats, at most n. */
const merge = (/** @type {string[]} */ a, /** @type {string[]} */ b, /** @type {number} */ n) => [...new Set([...a, ...b])].slice(0, n);

/**
 * A taste from the organiser's edits, with the vibe they typed read in when the taste says
 * nothing about what they like (the sloth was busy and they filled the vibe in by hand: on
 * 22 Oct 2026 "Raves and chill vibes" was saved next to an empty taste). Needs stay as they
 * are and are added on top; the vibe never removes anything.
 * @param {Taste} taste  cleanTaste's output
 * @param {string|null|undefined} vibe
 * @returns {Taste}
 */
export function withVibe(taste, vibe) {
  if (!vibe || taste.likes.length || taste.scenes.length || taste.eventKeywords.length) return taste;
  const p = plainTaste(vibe);
  if (!p.likes.length && !p.placeKinds.length) return taste;
  const dry = taste.needs.includes("no alcohol") || taste.needs.includes("kid-friendly");
  // the kinds that came only from the needs (a quiet default) go after what the vibe says
  const kinds = merge(p.placeKinds, taste.placeKinds, 8).filter((k) => !dry || (!PLACE_KINDS[k].alcohol && !PLACE_KINDS[k].nightlife));
  return { ...taste, likes: p.likes.slice(0, 6), placeKinds: kinds, eventKeywords: p.eventKeywords.slice(0, 8), energy: taste.energy ?? p.energy };
}

/** A clean list of short lower-case words: no sensitive words, no dashes, deduplicated. */
function words(/** @type {any} */ xs, max = 6, len = 30, /** @type {string|null} */ source = null) {
  if (!Array.isArray(xs)) return [];
  /** @type {string[]} */
  const out = [];
  for (const x of xs) {
    if (typeof x !== "string") continue;
    const w = x.toLowerCase().replace(/[—–]/g, " ").replace(/\s+/g, " ").trim().slice(0, len);
    if (!w || /^(null|none|n\/a|unknown|anything|everything)$/.test(w) || hasSensitive(w) || out.includes(w)) continue;
    // a word in another script than the source's is a model slip (Gemma answered "도락" for
    // parents with young kids on 22 Oct 2026), unless the source says it
    if (source != null && /[^\p{Script=Latin}\p{N}\p{P}\p{Zs}+&']/u.test(w) && !source.toLowerCase().includes(w)) continue;
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

/** Words that name a kind of group, enough for Gemma's cultural reading of what it likes. */
const GROUP_WORDS = /\b(students?|uni|university|campus|undergrads?|parents|mums|moms|dads|famil(?:y|ies)|kids|colleagues|work friends|workmates|office|corporate|bankers|lawyers|techies|tech bros|creatives|artists|musicians|gym|runners|footballers?|ballers|gamers|youth|choir|fellowship|alumni|old (?:boys|girls)|class of)\b/i;

/**
 * Indoor kinds to add for a wet day: kid-friendly crews get a cinema and a mall (indoor
 * play); a crew with no indoor kind at all gets a café and a restaurant (a quiet crew, a
 * café and a museum). Kinds a need rules out are never added.
 * @param {string[]} kinds
 * @param {string[]} needs
 */
export function rainKinds(kinds, needs) {
  /** @type {string[]} */
  const out = [];
  if (needs.includes("kid-friendly")) out.push("cinema", "mall");
  if (!kinds.some((k) => PLACE_KINDS[k]?.indoor)) out.push(...(needs.includes("discreet") || needs.includes("safe") ? ["cafe", "museum"] : ["cafe", "restaurant"]));
  return out.filter((k) => !kinds.includes(k));
}

/** Kinds of place a need points to, used only when Gemma named none. */
export const NEED_KINDS = Object.freeze({
  discreet: ["garden", "cafe", "gallery", "bookshop", "museum"],
  safe: ["garden", "cafe", "gallery", "museum"],
  "kid-friendly": ["playground", "park", "zoo", "ice cream"],
  quiet: ["garden", "library", "bookshop", "cafe"],
});

const AGE_WORDS = /\b(\d{2}s?|teens?|teenagers?|twenties|thirties|forties|fifties|students?|uni|university|undergrads?|youth|young|retired|retirees|parents|grown)\b/i;

/** An age band as people say it ("late 20s", "30s", "students"), or null. */
function ageBand(/** @type {any} */ v) {
  if (typeof v !== "string") return null;
  const t = v.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 24);
  if (!/(\d{2}|teen|twent|thirt|fort|fift|student|young|retire|kids)/.test(t) || hasSensitive(t)) return null;
  return t;
}

/**
 * Check a taste. From Gemma (with `sentence`): every list rests on words the sentence says
 * (`basis`, or the scenes and likes themselves), scenes must be said outright, and code's own
 * needs are added. From the organiser's edits (no sentence): only the vocabularies and limits.
 * Either way, nothing that names who people are survives.
 * @param {any} raw
 * @param {{ sentence?: string|null }} [opts]
 * @returns {Taste}
 */
export function cleanTaste(raw, { sentence = null } = {}) {
  const d = raw && typeof raw === "object" ? raw : {};
  const fromModel = typeof sentence === "string";
  const src = fromModel ? /** @type {string} */ (sentence) : "";
  const from = fromModel ? /** @type {string} */ (sentence) : null;
  let scenes = words(d.scenes, 4, 24, from);
  let likes = words(d.likes, 6, 30, from);
  let placeKinds = (Array.isArray(d.placeKinds) ? d.placeKinds : []).map((k) => String(k).toLowerCase().trim()).filter((k, i, a) => PLACE_KINDS[k] && a.indexOf(k) === i).slice(0, 6);
  let eventKeywords = words(d.eventKeywords, 8, 24, from);
  let avoid = words(d.avoid, 6, 30, from);
  let needs = (Array.isArray(d.needs) ? d.needs : []).map((n) => String(n).toLowerCase().trim()).filter((n) => NEEDS.includes(n));
  let energy = ENERGY.includes(d.energy) ? d.energy : null;
  let age = ageBand(d.ageBand);
  const budget = ["free", "cheap", "any"].includes(d.budget) ? d.budget : null;
  if (fromModel) {
    // a scene is a name people use for themselves ("alte"): it has to be in the sentence
    scenes = scenes.filter((s) => said(s, src));
    // the rest may be inferred (cultural knowledge), but only from something the sentence says
    const basis = (Array.isArray(d.basis) ? d.basis : []).filter((b) => typeof b === "string" && said(b, src));
    // what code reads from the sentence on its own: the floor under Gemma's reading
    const plain = plainTaste(src);
    // a kind of group the sentence names (students, parents, a church youth group, an age)
    // is a basis too, even when Gemma leaves basis empty (it did for "queer and mostly
    // female" on 21 Oct 2026: it was told not to repeat those words). So is any taste word
    // the sentence says, in any form: on 22 Oct 2026 "raves and chill vibes" came back with
    // likes ["nightlife", "dancing", "music"] and keyword "rave", none of them word for word
    // in the sentence, and the whole taste was thrown away.
    const anchored = basis.length > 0 || scenes.length > 0 || likes.some((l) => said(l, src)) || eventKeywords.some((k) => said(k, src)) || plain.likes.length > 0 || plain.placeKinds.length > 0
      || impliedNeeds(src).length > 0 || AGE_WORDS.test(src) || GROUP_WORDS.test(src);
    if (!anchored) {
      likes = likes.filter((l) => said(l, src));
      placeKinds = placeKinds.filter((k) => said(k, src));
      eventKeywords = eventKeywords.filter((k) => said(k, src));
      avoid = avoid.filter((a) => said(a, src));
      needs = [];
      energy = null;
    }
    // When the sentence says what the crew is into, each item of Gemma's reading must rest on
    // those words by itself: said in any form, a close relative (RELATED), what TASTE_WORDS
    // reads from them, or, for a kind of place, what a need the sentence implies points to.
    // One grounded word no longer lets the rest through (the review of d01a23b: "We want art
    // galleries" kept the cocktails and the bar Gemma added). A scene the sentence names
    // keeps Gemma's reading of it whole: what "alte" means is cultural knowledge that no list
    // in a city-free core holds. A sentence that says only who the crew is (students,
    // parents, an age, an identity turned into needs) keeps Gemma's reading of that, as before.
    // Needs, energy and things to avoid only narrow the choice, so they stay as read.
    const saysTaste = plain.likes.length > 0 || plain.placeKinds.length > 0 || likes.some((l) => said(l, src)) || eventKeywords.some((k) => said(k, src)) || placeKinds.some((k) => said(k, src));
    // a kind of group the sentence names grounds the kinds of place GROUP_KINDS lists for it
    // (a family crew keeps its community centre: the pinned run of d1770d0 lost it)
    const groupKinds = GROUP_KINDS.filter((g) => g.re.test(src)).flatMap((g) => g.kinds);
    let dropped = false;
    if (anchored && saysTaste && !scenes.length) {
      const ground = groundOf(src);
      const fits = (/** @type {string} */ v) => stems(v).some((t) => ground.has(t)) || ground.has(`=${norm(v)}`);
      const needKinds = new Set(impliedNeeds(src).flatMap((n) => NEED_KINDS[/** @type {keyof typeof NEED_KINDS} */ (n)] || []));
      likes = likes.filter(fits);
      eventKeywords = eventKeywords.filter(fits);
      const before = placeKinds.length;
      placeKinds = placeKinds.filter((k) => fits(k) || plain.placeKinds.includes(k) || needKinds.has(k) || groupKinds.includes(k));
      dropped = placeKinds.length < before;
    }
    if (age && !AGE_WORDS.test(src)) age = null;
    // Gemma's reading is trusted; what the sentence plainly says is never lost: each taste
    // word Gemma's lists do not cover adds its own like, kind of place and keyword
    const has = (/** @type {string[]} */ list, /** @type {string[]} */ xs) => xs.some((x) => list.some((l) => stem(l) === stem(x)));
    const entries = plainEntries(src);
    const covers = (/** @type {string[]} */ list, /** @type {string[]|undefined} */ xs, /** @type {number} */ n) => {
      if (!xs?.length) return list;
      if (!list.length) return merge(list, xs, n);
      return has(list, xs) ? list : merge(list.slice(0, n - 1), xs.slice(0, 1), n);
    };
    const hadKinds = placeKinds.length > 0;
    for (const w of entries) {
      likes = covers(likes, w.likes, 6);
      eventKeywords = covers(eventKeywords, w.keys, 8);
      if (!hadKinds) placeKinds = merge(placeKinds, w.kinds || [], 6);
      else if (w.kinds?.length && !w.kinds.some((k) => placeKinds.includes(k))) placeKinds = merge(placeKinds.slice(0, 5), w.kinds.slice(0, 1), 6);
    }
    energy = energy ?? plain.energy;
    // trusted unless it contradicts the sentence: a kind the crew said to avoid goes
    if (avoid.length) placeKinds = placeKinds.filter((k) => !avoid.some((a) => avoidHits(a, k)));
    // needs add constraints on top of the taste; they never replace it
    needs = [...new Set([...needs, ...impliedNeeds(src)])];
    const dry = needs.includes("no alcohol") || needs.includes("kid-friendly");
    if (dry) placeKinds = placeKinds.filter((k) => !PLACE_KINDS[k].alcohol && !PLACE_KINDS[k].nightlife);
    // When Gemma named no kind of place, or grounding left none (or one), the kinds the
    // crew's needs, group words and budget point to fill in: a discreet crew still gets
    // somewhere to go, and no crew that said anything is left with no kind of place at all
    // (the pinned run of d1770d0: a meetups crew and a free-things crew had none, so a wet
    // Saturday had nothing under a roof). Last of all, a park, a cafe and a museum.
    if (anchored && (!placeKinds.length || (dropped && placeKinds.length < 2))) {
      const implied = [...needs.flatMap((n) => NEED_KINDS[/** @type {keyof typeof NEED_KINDS} */ (n)] || []), ...groupKinds, ...(budget === "free" || budget === "cheap" ? BUDGET_KINDS[budget] : [])]
        .filter((k) => !dry || (!PLACE_KINDS[k].alcohol && !PLACE_KINDS[k].nightlife));
      placeKinds = merge(placeKinds, implied, 6);
      if (!placeKinds.length) placeKinds = [...DEFAULT_KINDS];
    } else if (!placeKinds.length) {
      placeKinds = [...new Set(needs.flatMap((n) => NEED_KINDS[/** @type {keyof typeof NEED_KINDS} */ (n)] || []))].slice(0, 6);
    }
    // and somewhere under a roof for a wet day, so rain does not send every crew to the same
    // covered spot (the 22 Oct eval: Nike Art Gallery for alte, parents and corporate alike)
    if (placeKinds.length) placeKinds = [...new Set([...placeKinds, ...rainKinds(placeKinds, needs)])].slice(0, 8);
  }
  // a need that rules out drink rules out the kinds that sell it
  if (needs.includes("no alcohol") || needs.includes("kid-friendly")) placeKinds = placeKinds.filter((k) => !PLACE_KINDS[k].alcohol && !PLACE_KINDS[k].nightlife);
  return { scenes, likes, placeKinds, eventKeywords, avoid, needs: NEEDS.filter((n) => needs.includes(n)), budget, ageBand: age, energy };
}

/** True when a taste says anything at all. */
export function hasTaste(/** @type {Taste|null|undefined} */ t) {
  return !!t && (t.scenes.length + t.likes.length + t.placeKinds.length + t.eventKeywords.length + t.avoid.length + t.needs.length > 0 || !!t.ageBand || !!t.energy);
}

/** A short stable key for a taste (for caches): the taste's own words, never the sentence. */
export function tasteKey(/** @type {Taste|null|undefined} */ t) {
  if (!hasTaste(t)) return "none";
  const s = JSON.stringify(t);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/**
 * The taste as editable chips for the setup screen, and one line that shows the sloth
 * understood: "Got it: alte, art and live music, late 20s, around Yaba and Lekki."
 * Needs are chips too, worded for the organiser; who the crew is never appears.
 * @param {Taste} t
 * @param {{ areas?: string[] }} [opts]
 */
export function tasteView(t, { areas = [] } = {}) {
  /** @type {{ field: string, value: string, label: string }[]} */
  const chips = [];
  for (const v of t.scenes) chips.push({ field: "scenes", value: v, label: v });
  for (const v of t.likes) chips.push({ field: "likes", value: v, label: v });
  for (const v of t.placeKinds) chips.push({ field: "placeKinds", value: v, label: v });
  for (const v of t.avoid) chips.push({ field: "avoid", value: v, label: `not ${v}` });
  for (const v of t.needs) chips.push({ field: "needs", value: v, label: NEED_LABELS[/** @type {keyof typeof NEED_LABELS} */ (v)] });
  if (t.ageBand) chips.push({ field: "ageBand", value: t.ageBand, label: t.ageBand });
  if (t.energy) chips.push({ field: "energy", value: t.energy, label: t.energy });
  const and = (/** @type {string[]} */ xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  const bits = [
    ...t.scenes.slice(0, 2),
    t.likes.length ? and(t.likes.slice(0, 2)) : t.placeKinds.length ? and(t.placeKinds.slice(0, 2)) : null,
    t.ageBand,
    areas.length ? `around ${and(areas.slice(0, 2))}` : null,
  ].filter(Boolean);
  return { chips, summary: bits.length ? `Got it: ${bits.join(", ")}.` : null };
}

// ---------------------------------------------------------------- judging places and events

/**
 * @typedef {object} TasteFit
 * @property {number} score        0 to 1; 0.5 when the crew has no taste
 * @property {string|null} kind    the place kind (PLACE_KINDS), or null
 * @property {string[]} matched    plain words for why it fits ("an art gallery")
 * @property {string|null} blocked why it is ruled out for this crew, or null
 * @property {boolean} lowKey      quiet and seated, said when the crew wants discreet or quiet
 * @property {number} green        how much it counts as outdoors: 1 green, 0.5 a café with outdoor seating, else 0
 */

/**
 * How a place fits a crew's taste and needs, from its OpenStreetMap tags.
 * @param {Record<string,string>} tags
 * @param {Taste|null|undefined} taste
 * @param {{ green?: boolean }} [opts]  green: the caller already knows it is outdoor green
 * @returns {TasteFit}
 */
export function tasteFit(tags = {}, taste, { green = false } = {}) {
  const kind = kindOfTags(tags);
  const k = kind ? PLACE_KINDS[kind] : null;
  const seating = tags.outdoor_seating === "yes" || /garden/i.test(tags.name || "");
  const greenness = green || k?.outdoor ? 1 : kind === "cafe" && seating ? 0.5 : 0;
  if (!hasTaste(taste)) return { score: 0.5, kind, matched: [], blocked: null, lowKey: false, green: greenness };
  const t = /** @type {Taste} */ (taste);
  const needs = new Set(t.needs);
  /** @type {string|null} */
  let blocked = null;
  const dry = needs.has("no alcohol") || needs.has("kid-friendly");
  if (k?.alcohol && needs.has("no alcohol")) blocked = "serves alcohol";
  // a club, bar or lounge by name or by tag (a members' social club's draw is its bar): out
  // for a crew that needs no alcohol or brings kids (the 22 Oct eval offered the church youth
  // group the Syrian Club)
  else if (dry && (DRINK_NAME.test(tags.name || "") || tags.amenity === "social_club" || tags.club != null || tags.leisure === "adult_gaming_centre")) blocked = "a club or bar";
  else if ((k?.alcohol || k?.nightlife) && needs.has("kid-friendly")) blocked = "not for kids";
  else if (k?.nightlife && needs.has("daytime")) blocked = "a night-time place";
  else if (needs.has("step-free") && tags.wheelchair === "no") blocked = "not step-free";
  else if (kind && t.avoid.some((a) => avoidHits(a, kind))) blocked = "the crew would rather not";
  const wantsOutdoor = t.placeKinds.some((n) => PLACE_KINDS[n].outdoor);
  let score = 0.3;
  /** @type {string[]} */
  const matched = [];
  if (kind && t.placeKinds.includes(kind)) {
    score = 1;
    matched.push(kind === "cafe" && seating ? "a garden café" : /** @type {PlaceKind} */ (k).label);
  } else if (greenness === 1 && (wantsOutdoor || !t.placeKinds.length)) score = 0.6;
  else if (greenness === 1) score = 0.4;
  const quietish = needs.has("discreet") || needs.has("safe") || needs.has("quiet");
  const lowKey = quietish && (!!k?.lowKey || (greenness === 1 && kind !== "beach"));
  if (quietish) score += lowKey ? 0.15 : k?.nightlife || kind === "beach" ? -0.2 : 0;
  if (needs.has("kid-friendly") && (k?.kids || kind === "park")) score += 0.2;
  if (needs.has("step-free") && tags.wheelchair === "yes") score += 0.15;
  if (t.energy === "chill" && (k?.lowKey || greenness)) score += 0.1;
  if (t.energy === "lively" && (k?.nightlife || kind === "beach" || kind === "live music")) score += 0.1;
  return { score: Math.max(0, Math.min(1, Math.round(score * 100) / 100)), kind, matched, blocked, lowKey, green: greenness };
}

/** Words people use for what to avoid, matched to place kinds ("clubs" is a nightclub). */
function avoidHits(/** @type {string} */ a, /** @type {string} */ kind) {
  const w = norm(a);
  if (w.includes(kind) || kind.includes(w)) return true;
  const map = /** @type {Record<string, RegExp>} */ ({
    nightclub: /\b(club|clubs|clubbing|nightlife|loud)\b/,
    bar: /\b(bar|bars|drinking|alcohol|booze|nightlife)\b/,
    pub: /\b(pub|pubs|drinking|alcohol|booze)\b/,
    beach: /\b(beach|beaches|sand)\b/,
    "live music": /\b(loud|concerts?)\b/,
  });
  return !!map[kind]?.test(w);
}

/** Place names that say drink: a club, a bar, a lounge. */
const DRINK_NAME = /\b(club|clubhouse|bar|pub|lounge|nightclub|tavern|brewery|beer|wine|cocktails?|spirits|shisha|hookah)\b/i;

/** Words in an event that mean drink or a late night: out for crews that need no alcohol, or bring kids. */
const DRINKY = /\b(wine|beer|cocktails?|bar|bars|bar crawl|bottomless|open bar|drinks?|rave|club|club night|nightclub|lounge|turn ?up|party|after ?party|18\+|21\+|hookah|shisha|tequila|brewery|whisky|whiskey|gin)\b/i;

/**
 * How an event from a curated guide fits the crew: keyword hits on its title, category and
 * venue, and whether a need rules it out.
 * @param {{ title: string, category?: string|null, venue?: string|null, start?: string|null }} e
 * @param {Taste|null|undefined} taste
 * @returns {{ score: number, matched: string[], blocked: string|null }}
 */
export function eventFit(e, taste) {
  if (!hasTaste(taste)) return { score: 0, matched: [], blocked: null };
  const t = /** @type {Taste} */ (taste);
  const text = ` ${norm(`${e.title} ${e.category || ""} ${e.venue || ""}`)} `;
  const needs = new Set(t.needs);
  /** @type {string|null} */
  let blocked = null;
  if ((needs.has("no alcohol") || needs.has("kid-friendly")) && DRINKY.test(text)) blocked = "drinks or a party";
  else if ((needs.has("kid-friendly") || needs.has("daytime")) && e.start && e.start >= "20:00") blocked = "too late";
  else if (t.avoid.some((a) => { const w = norm(a); return w.length >= 3 && (text.includes(` ${w} `) || text.includes(` ${w.replace(/s$/, "")} `)); })) blocked = "the crew would rather not";
  const keys = [...new Set([...t.eventKeywords, ...t.scenes, ...t.likes].map(norm).filter((w) => w.length >= 3))];
  const matched = keys.filter((w) => text.includes(` ${w} `) || (w.length >= 5 && text.includes(` ${w.replace(/s$/, "")}`)));
  return { score: keys.length ? Math.min(1, matched.length / Math.min(3, keys.length)) : 0, matched, blocked };
}

/**
 * The amount in a price as written ("₦5,000", "5k", "N3000 at the gate"), or null when it
 * has no number. Free is 0.
 * @param {{ text: string, free: boolean }|null|undefined} price
 */
export function priceAmount(price) {
  if (!price) return null;
  if (price.free) return 0;
  const m = String(price.text).replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(k)?\b/i);
  if (!m) return /\bfree\b/i.test(price.text) ? 0 : null;
  return Number(m[1]) * (m[2] ? 1000 : 1);
}

/**
 * True when a price is over what the crew's budget allows: anything paid for "free"; over
 * the pack's cheap ceiling for "cheap" (no ceiling known: nothing is over it).
 * @param {{ text: string, free: boolean }|null|undefined} price
 * @param {"free"|"cheap"|"any"|null|undefined} budget
 * @param {number|null} [cheapMax]
 */
export function overBudget(price, budget, cheapMax = null) {
  const a = priceAmount(price);
  if (a == null || budget == null || budget === "any") return false;
  if (budget === "free") return a > 0;
  return cheapMax != null && a > cheapMax;
}

/** Words in a reason that would make a claim about a venue nobody sourced ("queer-friendly", "a safe space"). */
export const UNSOURCED_CLAIM = /\b[\w]+-friendly\b|\bsafe (?:space|place|spot) for\b|\bsafe space\b|\binclusive (?:space|venue)\b/i;
