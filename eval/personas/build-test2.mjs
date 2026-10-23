// @ts-check
// Builds eval/personas/test2.json: a fresh held-out set of 30 crews, made by a written
// procedure from the same spec as the original test set, after that set had been scored twice
// (so it is spent for claims about fixes). Frozen before the fixes it will measure exist.
//
//   node eval/personas/build-test2.mjs --draw    print the drawn tuples (for writing sentences)
//   node eval/personas/build-test2.mjs           write test2.json and print its SHA-256
//   node eval/personas/build-test2.mjs --check   exit 1 if test2.json differs from what this builds
//
// The procedure, in full:
//   1. The frame. Each of the 30 slots keeps one original test crew's city, language, group
//      size, sensitive need and constraint types, so the mix of cities, languages, sizes, the
//      sensitive share and the constraint types are exactly the original test set's.
//   2. The draw (seed 20261023), per slot: an interest from the v2 interest list, never the
//      slot's original one, and none that the slot's constraints rule out (no nightlife
//      interest with kids, no alcohol, teens or retirees); a budget and an age band with the
//      v2 set's frequencies (kids: parents in their 30s, or teens with a parent); one to
//      three areas from the city's neighbourhoods, never the slot's original set; whether the
//      sentence states a time (one in five, and always for night-shift crews); whether a
//      broke crew says free only (three in ten); and, for Lagos, whether the organiser plans
//      from a browser abroad (one in thirty, as in v2).
//   3. The sentence. Written by hand for the drawn tuple, as people type it, in the slot's
//      language, saying the areas, the day (Saturday) and whatever the tuple says (a stated
//      time, free only, the constraint). Never copied: every sentence must share under 45%
//      of its words with each of the 60 v2 sentences, checked below.
//   4. The checks. Derived mechanically from the tuple, as in v2: areasOnMap, cityCorrect,
//      timezoneCorrect for all; noAlcohol and needsInclude "no alcohol" for no-alcohol crews;
//      kidFriendly and needsInclude "kid-friendly" for kids (teens: noAlcohol and noNightlife);
//      stepFree and needsInclude "step-free"; needsInclude "women-friendly" for women only;
//      needsInclude "safe" and "discreet" plus discreetNoLabel for LGBTQ+ crews; noAlcohol,
//      needsInclude "no alcohol" and discreetNoLabel for a religious-minority crew;
//      noNightlife for retirees; maxPrice (5,000 in the local currency for Lagos; 0 for free
//      only) and budgetRead for broke and cheap crews; withinHours for a stated time.
//
// What was known when this set was frozen is written in eval/personas/FROZEN.md.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SEED = 20261023;
const here = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(here, "test2.json");
const v2 = JSON.parse(fs.readFileSync(path.join(here, "v2.json"), "utf8"));

/** @type {Record<string, { tz: string, center: [number, number], km?: number, bbox?: any, currency: string }>} */
const CITIES = {
  Lagos: { tz: "Africa/Lagos", center: [6.52, 3.38], bbox: { south: 6.35, north: 6.75, west: 2.7, east: 4.4 }, currency: "NGN" },
  Abuja: { tz: "Africa/Lagos", center: [9.06, 7.47], km: 40, currency: "NGN" },
  Accra: { tz: "Africa/Accra", center: [5.6, -0.19], km: 35, currency: "GHS" },
  Nairobi: { tz: "Africa/Nairobi", center: [-1.29, 36.82], km: 35, currency: "KES" },
  London: { tz: "Europe/London", center: [51.507, -0.128], km: 35, currency: "GBP" },
  Berlin: { tz: "Europe/Berlin", center: [52.52, 13.405], km: 30, currency: "EUR" },
  Bengaluru: { tz: "Asia/Kolkata", center: [12.97, 77.59], km: 35, currency: "INR" },
  "São Paulo": { tz: "America/Sao_Paulo", center: [-23.55, -46.633], km: 35, currency: "BRL" },
};

/** Neighbourhood centres and tolerances (km): v2's, plus more per city (OpenStreetMap, Oct 2026). */
/** @type {Record<string, Record<string, [number, number, number]>>} */
const AREAS = {
  Lagos: {
    Yaba: [6.509, 3.378, 4], Surulere: [6.497, 3.354, 5], Ikeja: [6.601, 3.351, 6], Maryland: [6.571, 3.367, 4], Ikorodu: [6.619, 3.511, 10], Ajah: [6.468, 3.577, 8],
    Festac: [6.466, 3.284, 5], VI: [6.428, 3.422, 4], Lekki: [6.447, 3.472, 8], Ikoyi: [6.452, 3.435, 4], Gbagada: [6.555, 3.389, 4], Ogba: [6.627, 3.339, 4],
    Isolo: [6.53, 3.322, 5], Ilupeju: [6.553, 3.357, 3], Magodo: [6.62, 3.385, 4], Agege: [6.62, 3.322, 5], Oshodi: [6.555, 3.343, 4], Ogudu: [6.575, 3.392, 3],
    Apapa: [6.45, 3.36, 5], Sangotedo: [6.47, 3.62, 8], Ojodu: [6.64, 3.37, 4], Ketu: [6.598, 3.39, 4],
  },
  Abuja: { "Wuse 2": [9.08, 7.475, 5], Jabi: [9.068, 7.425, 5], Garki: [9.035, 7.49, 6], Maitama: [9.09, 7.5, 5], Asokoro: [9.04, 7.53, 5], Lugbe: [8.98, 7.37, 7], Gwarinpa: [9.105, 7.405, 6] },
  Accra: { Osu: [5.556, -0.182, 4], Labone: [5.566, -0.171, 4], "East Legon": [5.636, -0.161, 6], Dzorwulu: [5.61, -0.2, 4], Spintex: [5.63, -0.1, 6], Teshie: [5.58, -0.1, 5], Madina: [5.683, -0.165, 6] },
  Nairobi: { Westlands: [-1.268, 36.811, 5], Kilimani: [-1.29, 36.785, 4], Lavington: [-1.28, 36.77, 4], Kasarani: [-1.22, 36.9, 6], Parklands: [-1.26, 36.82, 4], "South B": [-1.31, 36.838, 4] },
  London: { Peckham: [51.474, -0.069, 4], Brixton: [51.461, -0.116, 4], Lewisham: [51.46, -0.01, 5], Camden: [51.54, -0.14, 4], Walthamstow: [51.585, -0.02, 5], Croydon: [51.372, -0.1, 6] },
  Berlin: { Kreuzberg: [52.497, 13.403, 4], "Neukölln": [52.481, 13.435, 5], "Schöneberg": [52.48, 13.35, 4], Mitte: [52.52, 13.4, 4], Charlottenburg: [52.51, 13.3, 5], Wedding: [52.55, 13.36, 4] },
  Bengaluru: { Koramangala: [12.935, 77.624, 4], Indiranagar: [12.978, 77.64, 4], "BTM Layout": [12.915, 77.61, 4], Marathahalli: [12.956, 77.7, 5], Basavanagudi: [12.94, 77.575, 4], Jayanagar: [12.925, 77.593, 4] },
  "São Paulo": { Pinheiros: [-23.567, -46.69, 4], Moema: [-23.6, -46.665, 4], Santana: [-23.5, -46.625, 5], Perdizes: [-23.535, -46.68, 4], Mooca: [-23.55, -46.6, 5], Liberdade: [-23.559, -46.635, 3] },
};

const INTERESTS = v2.interests;
const NIGHT_OUT = new Set(["afrobeats nightlife"]);
const BUDGETS = /** @type {const} */ (["broke", "cheap", "mid", "comfortable"]);
const AGES = /** @type {const} */ (["students", "20s", "30s", "40s+", "retirees"]);
const WINDOWS = [["07:00", "11:00", "morning"], ["13:00", "17:00", "afternoon"], ["16:00", "20:00", "early evening"]];

/** mulberry32 */
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
const r = rng(SEED);
const pick = (/** @type {any[]} */ xs) => xs[Math.floor(r() * xs.length)];
/** A weighted draw: weights from v2's own frequencies. */
function weighted(/** @type {string[]} */ values, /** @type {(v: string) => number} */ w) {
  const ws = values.map((v) => Math.max(0.5, w(v)));
  let x = r() * ws.reduce((s, v) => s + v, 0);
  for (let i = 0; i < values.length; i++) if ((x -= ws[i]) < 0) return values[i];
  return values[values.length - 1];
}
const v2count = (/** @type {(p: any) => boolean} */ f) => v2.personas.filter(f).length;

/** The frame (step 1) and the draw (step 2). */
export function draw() {
  const frame = v2.personas.filter((/** @type {any} */ p) => p.split === "test");
  return frame.map((/** @type {any} */ s, /** @type {number} */ i) => {
    const cons = s.dims.constraints.map((/** @type {string} */ c) => c.split(":")[0]);
    const kids = cons.includes("kids");
    const sober = cons.includes("no alcohol");
    const age = kids ? pick(["30s", "30s", "teens"]) : weighted([...AGES], (a) => v2count((p) => p.dims.age === a));
    const interests = Object.keys(INTERESTS).filter((k) => !s.dims.interests.includes(k) && !(NIGHT_OUT.has(k) && (kids || sober || age === "teens" || age === "retirees")) && !(k === "family" && !kids));
    const interest = kids && r() < 0.5 ? "family" : pick(interests);
    const budget = weighted([...BUDGETS], (b) => v2count((p) => p.dims.budget === b));
    const pool = Object.keys(AREAS[s.city]);
    const n = s.city === "Lagos" && r() < 0.1 ? 3 : r() < 0.7 ? 2 : 1;
    let areas;
    for (let tries = 0; tries < 20; tries++) {
      const shuffled = [...pool].sort(() => r() - 0.5);
      areas = shuffled.slice(0, n);
      if (areas.sort().join("/") !== [...s.areas.map((/** @type {any} */ a) => a.label)].sort().join("/")) break;
    }
    const statesTime = cons.includes("night-shift") ? WINDOWS[1] : r() < 0.2 ? pick(WINDOWS) : null;
    const freeOnly = budget === "broke" && r() < 0.3;
    const abroad = s.city === "Lagos" && r() < 1 / 30;
    return { slot: i + 1, from: s.id, city: s.city, language: s.dims.language, size: s.dims.size, sensitive: s.dims.sensitive, constraints: s.dims.constraints, interest, budget, age, areas, statesTime, freeOnly, abroad };
  });
}

if (process.argv.includes("--draw")) {
  for (const d of draw()) console.log(JSON.stringify(d));
  process.exit(0);
}

// ---------------------------------------------------------------- step 3: the sentences (by hand, per slot)

/** @type {Record<number, { id: string, label: string, sentence: string, hintTz?: string }>} */
export const WRITTEN = {
  1: { id: "t2-lag-chess-festac", label: "Chess crew across Festac, Ketu and Yaba", sentence: "Chess crew, 7 of us in our 20s, spread across Festac, Ketu and Yaba, every other Saturday, somewhere nice to play for a few hours, budget is not a problem" },
  2: { id: "t2-lag-fellowship-chess", label: "Campus fellowship chess club", sentence: "Campus fellowship chess club, about 12 students, half in Ikorodu and half around VI, every other Saturday from 4pm to 8pm, no alcohol please" },
  3: { id: "t2-lag-ladies-football", label: "Women who watch the Premier League", sentence: "Ladies who never miss a Premier League game, 5 of us in our 30s, women only, around Ojodu and Yaba, Saturday matches every other week" },
  4: { id: "t2-lag-classmates-owambe", label: "Old classmates who love an owambe", sentence: "Old classmates, 14 of us now in our 30s, we love a good owambe with a live band and plenty of food, around Ikeja every other Saturday" },
  5: { id: "t2-lag-alte-ogba", label: "Alte kids in Ogba", sentence: "4 alte kids in Ogba, early 20s, vintage clothes, indie music and art, every other Saturday" },
  6: { id: "t2-lag-football-ogba-free", label: "Football guys in Ogba, free only", sentence: "Football guys in Ogba, 8 of us in our 30s, money is tight so only free spots to watch the Saturday games, every week" },
  7: { id: "t2-lag-brunch-early", label: "Early brunch crew, Ikorodu and Yaba", sentence: "Brunch crew in our 20s, 6 of us between Ikorodu and Yaba, we like to eat early, Saturdays from 7 to 11 in the morning, every other week" },
  8: { id: "t2-lag-sober-football", label: "Football fans in their 40s who quit drinking", sentence: "Five of us in our 40s who quit drinking, we still love watching football together, around Isolo, Oshodi and VI, every other Saturday, alcohol-free places only" },
  9: { id: "t2-lag-thrift-wheelchair", label: "Art and thrift lovers with a wheelchair user, free only", sentence: "Art and thrift lovers, 4 of us in our 20s, one friend is in a wheelchair so it has to be step-free, around Apapa and Yaba, every other Saturday, free things only" },
  10: { id: "t2-lag-nightnurses-gamers", label: "Hospital night workers who game (Pidgin)", sentence: "We dey work night for hospital, 7 of us wey like play game, na only Saturday afternoon 1 to 5 we dey free, around Ketu and Yaba, nothing wey cost too much" },
  11: { id: "t2-lag-lesbian-friends-yaba", label: "Lesbian friends, Yaba", sentence: "A few of us lesbian friends in our 30s, 5 people, around Yaba, every other Saturday, we just want to hang out somewhere calm without attention" },
  12: { id: "t2-lag-teen-parents-pidgin", label: "Parents taking teenagers out (Pidgin)", sentence: "Na we be the parents wey dey carry our teenage pikin go out, 12 of us, for Ikorodu and Maryland, every other Saturday, we like better food, money dey" },
  13: { id: "t2-lag-tech-apapa-pidgin", label: "Tech people across Apapa, Maryland and VI (Pidgin)", sentence: "Tech people wey dey Apapa, Maryland and VI, 8 of us for our 30s, we like meetup and hackathon, make we link every other Saturday" },
  14: { id: "t2-lag-quiet-agege-free", label: "A quiet bunch in Agege and Ketu, free only", sentence: "Quiet bunch from Agege and Ketu, 7 of us in our 30s, broke right now so free places only, somewhere peaceful every other Saturday" },
  15: { id: "t2-lag-devs-ilupeju", label: "Junior developers, Ilupeju", sentence: "Junior developers around Ilupeju, 6 of us in our 20s, we meet every other Saturday from 1pm to 5pm, cheap places please" },
  16: { id: "t2-lag-gospel-ojodu-pidgin", label: "Gospel music lovers (Pidgin)", sentence: "Gospel music lovers, 9 of us for Ikeja, Maryland and Ojodu, we dey find praise concert or anywhere wey get good worship, every other Saturday" },
  17: { id: "t2-lag-vi-girls-from-houston", label: "Planned from Houston for friends in VI", sentence: "I'm in Houston but my babes dem all dey VI, 6 of us in our 20s, women only, we want to try fancy restaurants every other Saturday, budget is fine", hintTz: "America/Chicago" },
  18: { id: "t2-lag-art-ikoyi-pidgin", label: "Young art lovers, Ikoyi (Pidgin)", sentence: "Art lovers for Ikoyi, 4 of us for our early 20s, we wan dey go gallery and exhibition every other Saturday" },
  19: { id: "t2-abj-creatives", label: "Abuja creatives", sentence: "Abuja creatives, 7 of us in our 20s, painting and exhibitions, Gwarinpa and Wuse 2, every other Saturday, abeg nothing expensive" },
  20: { id: "t2-acc-quiet-friends", label: "Quiet friends, Labone and Madina", sentence: "Accra friends in our 30s, 6 of us from Labone and Madina, we like quiet places to talk, every other Saturday" },
  21: { id: "t2-acc-church-young-women", label: "Young church women into fashion, Teshie", sentence: "Young women from our church in Teshie, 15 of us in our 20s, into fashion, art and indie music, every other Saturday, no alcohol and women only" },
  22: { id: "t2-nbo-retired-football", label: "Retired football fans, Nairobi", sentence: "Retired football fans in Nairobi, 11 of us, around Lavington and South B, we watch the Saturday matches together every week, nothing expensive" },
  23: { id: "t2-nbo-westlands-creatives", label: "Westlands creatives (Sheng)", sentence: "Westlands creatives, 6 of us in our 20s, thrift, art na indie music, every other Saturday, poa vibes" },
  24: { id: "t2-ldn-sober-bookclub", label: "Sober book club, Brixton and Croydon, mornings", sentence: "Book club of five, all in our 40s and all sober, Brixton and Croydon, Saturday mornings 7 to 11 every other week, no pubs, low cost" },
  25: { id: "t2-ldn-foodies", label: "Foodies, Croydon and Walthamstow", sentence: "Four foodies in our 20s, Croydon and Walthamstow, every other Saturday, happy to spend on a good meal" },
  26: { id: "t2-ber-sikh-women-football", label: "Sikh women who watch football, Berlin", sentence: "Sikh women from the gurdwara in Schöneberg, 8 of us in our 40s and 50s, we love watching football together, every other Saturday from 4pm to 8pm, women only and no alcohol" },
  27: { id: "t2-blr-ai-meetup", label: "AI meetup group, BTM Layout", sentence: "AI meetup group from BTM Layout, 12 of us in our 20s, every other Saturday from 4 to 8 pm, happy to pay for a good venue" },
  28: { id: "t2-blr-young-families", label: "Parents with young children, Basavanagudi", sentence: "Parents with young children in Basavanagudi, 4 families, every other Saturday, something the kids will love" },
  29: { id: "t2-sp-devs", label: "Developers, Liberdade and Pinheiros (mixed Portuguese)", sentence: "Devs de Liberdade e Pinheiros, 7 of us in our 20s, meetups e hackathons, every other Saturday" },
  30: { id: "t2-sp-retired-chess", label: "Retired chess players on a pension, São Paulo", sentence: "Retired chess players, 8 of us, around Moema and Pinheiros, every Saturday, on a pension so keep it cheap" },
};

const LGBTQ = "queer|lesbian|lesbians|\\bgay\\b|\\bgays\\b|lgbt\\w*|sapphic|bisexual|\\bbi\\b|homosexual|same[- ]sex";
const LABELS = { lgbtq: LGBTQ, "religious-minority": "sikh|sikhs|sikhism|gurdwara" };
const ISLAND = new Set(["VI", "Lekki", "Lekki Phase 1", "Ikoyi", "Ajah", "Obalende", "Sangotedo"]);
const words = (/** @type {string} */ t) => new Set(t.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2));
const overlap = (/** @type {Set<string>} */ a, /** @type {Set<string>} */ b) => [...a].filter((x) => b.has(x)).length / new Set([...a, ...b]).size;

/** Steps 3 and 4: the drawn tuples, their sentences and the checks derived from them. */
function build() {
  const out = [];
  for (const d of draw()) {
    const w = WRITTEN[d.slot];
    if (!w) throw new Error(`no sentence for slot ${d.slot}`);
    if (/[—–]/.test(w.sentence)) throw new Error(`dash in slot ${d.slot}`);
    for (const a of d.areas) if (!w.sentence.includes(a)) throw new Error(`slot ${d.slot}: the sentence does not name ${a}`);
    if (!/saturday|sábado/i.test(w.sentence)) throw new Error(`slot ${d.slot}: no Saturday`);
    // never a copy or a near-copy of a v2 crew
    for (const p of v2.personas) {
      const o = overlap(words(w.sentence), words(p.sentence));
      if (o >= 0.45) throw new Error(`slot ${d.slot} shares ${Math.round(o * 100)}% of its words with ${p.id}`);
    }
    const city = CITIES[d.city];
    const cons = d.constraints.map((/** @type {string} */ c) => c.split(":")[0]);
    /** @type {Record<string, any>} */
    const hard = { areasOnMap: true, cityCorrect: city.bbox ? { bbox: city.bbox } : { center: city.center, km: city.km }, timezoneCorrect: city.tz };
    const needs = new Set();
    if (cons.includes("no alcohol")) { hard.noAlcohol = true; needs.add("no alcohol"); }
    if (cons.includes("kids")) {
      if (d.age === "teens") { hard.noAlcohol = true; hard.noNightlife = true; }
      else { hard.kidFriendly = true; needs.add("kid-friendly"); }
    }
    if (cons.includes("step-free")) { hard.stepFree = true; needs.add("step-free"); }
    if (cons.includes("women-only")) needs.add("women-friendly");
    if (d.sensitive === "lgbtq") { needs.add("safe"); needs.add("discreet"); }
    if (d.sensitive) hard.discreetNoLabel = { labels: LABELS[d.sensitive] };
    if (d.age === "retirees") hard.noNightlife = true;
    if (d.freeOnly) { hard.maxPrice = { amount: 0, currency: city.currency }; hard.budgetRead = ["free"]; }
    else if (d.budget === "broke" || d.budget === "cheap") {
      if (d.city === "Lagos") hard.maxPrice = { amount: 5000, currency: city.currency };
      hard.budgetRead = ["cheap", "free"];
    }
    if (d.statesTime) hard.withinHours = [d.statesTime[0], d.statesTime[1]];
    if (needs.size) hard.needsInclude = [...needs];
    const t = INTERESTS[d.interest];
    const geo = d.city === "Lagos" ? (new Set(d.areas.map((/** @type {string} */ a) => (ISLAND.has(a) ? "island" : "mainland"))).size > 1 ? "across the lagoon" : d.areas[0]) : d.city;
    out.push({
      id: w.id, label: w.label, sentence: w.sentence, city: d.city, hintTz: w.hintTz ?? city.tz,
      areas: d.areas.map((/** @type {string} */ a) => ({ label: a, lat: AREAS[d.city][a][0], lon: AREAS[d.city][a][1], tolKm: AREAS[d.city][a][2] })),
      dims: { budget: d.budget, age: d.age, size: d.size, interests: [d.interest], constraints: d.constraints, sensitive: d.sensitive, language: d.language, geo, region: d.city === "Lagos" ? "Lagos" : "elsewhere", statesTime: d.statesTime ? d.statesTime[2] : null, freeOnly: d.freeOnly, plannedFromAbroad: !!w.hintTz },
      taste: { kinds: t.kinds, keywords: t.keywords }, hard, split: "test2", slot: d.slot, frameFrom: d.from,
    });
  }
  return out;
}

const personas = build();
const ids = new Set(personas.map((p) => p.id));
if (ids.size !== 30) throw new Error("ids must be unique, 30 of them");
for (const p of v2.personas) if (ids.has(p.id)) throw new Error(`id ${p.id} is a v2 id`);
const file = {
  version: "v2-test2",
  about: "Persona eval v2, a second held-out set (test-2): 30 new crews from the original test set's spec, by the procedure written in build-test2.mjs, frozen before the fixes it measures. See eval/personas/FROZEN.md.",
  seed: SEED,
  target: v2.target,
  frame: "the original test split of eval/personas/v2.json (city, language, size, sensitive need and constraint types per slot)",
  interests: INTERESTS,
  personas,
};
const json = `${JSON.stringify(file, null, 1)}\n`;
const sha = crypto.createHash("sha256").update(json).digest("hex");
if (process.argv.includes("--check")) {
  if (fs.readFileSync(OUT, "utf8") !== json) {
    console.error("test2.json differs from what build-test2.mjs makes");
    process.exit(1);
  }
  console.log(`test2.json matches (sha256 ${sha})`);
} else {
  fs.writeFileSync(OUT, json);
  console.log(`wrote ${OUT}: ${personas.length} crews; sha256 ${sha}`);
}
