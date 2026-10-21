// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetFit, isGreen, placeKey, scorePlaces, vibeFit } from "../src/core/places.mjs";
import { zonedToMs, DAY } from "../src/core/time.mjs";
import { AREAS, PLACES } from "./fixtures/lagos.mjs";

const saturday4pm = zonedToMs("2026-10-24", "16:00");
const crew = [
  { id: "m1", name: "Tolu", area: AREAS.yaba },
  { id: "m2", name: "Ada", area: AREAS.yaba },
  { id: "m3", name: "Kene", area: AREAS.lekki },
  { id: "m4", name: "Bayo", area: AREAS.lekki },
];
const all = Object.values(PLACES);

test("a Yaba plus Lekki crew does not get a place on the mainland edge", () => {
  const { ranked, pick } = scorePlaces({ members: crew, candidates: all, at: saturday4pm });
  assert.notEqual(pick?.candidate.name, PLACES.jakande.name);
  const leastFair = [...ranked].sort((a, b) => b.cost - a.cost)[0];
  assert.equal(leastFair.candidate.name, PLACES.jakande.name, "Ikeja is the least fair for this crew");
  // the pick sits between the two groups: neither side travels much longer than the other
  assert.ok(pick && pick.spreadMin <= 20, `spread ${pick?.spreadMin}`);
  const jakande = ranked.find((r) => r.candidate.name === PLACES.jakande.name);
  assert.ok(jakande && pick && jakande.maxMin > pick.maxMin + 30);
});

test("the pick minimises the longest trip, not the average", () => {
  // three in Lekki and one in Yaba: a Lekki beach has the best average but strands Yaba
  const lopsided = [crew[0], crew[2], crew[3], { id: "m5", name: "Ife", area: AREAS.lekki }];
  const { pick } = scorePlaces({ members: lopsided, candidates: [PLACES.elegushi, PLACES.freedom], at: saturday4pm });
  assert.equal(pick?.candidate.name, PLACES.freedom.name);
});

test("an outdoor crew prefers green; a drinks crew prefers the bar when trips are equal", () => {
  const yabaOnly = [crew[0], crew[1]];
  const outdoors = scorePlaces({ members: yabaOnly, candidates: [PLACES.yabaBar, { ...PLACES.ikoyiGarden, lat: 6.5099, lon: 3.3775 }], outdoor: true, vibeTags: ["outside"] });
  assert.equal(outdoors.pick?.candidate.name, PLACES.ikoyiGarden.name);
  const drinks = scorePlaces({ members: yabaOnly, candidates: [PLACES.yabaBar, { ...PLACES.ikoyiGarden, lat: 6.5101, lon: 3.3779 }], vibeTags: ["drinks"] });
  assert.equal(drinks.pick?.candidate.name, PLACES.yabaBar.name);
});

test("variety: a place the crew used last week drops behind a near-equal one", () => {
  const twins = [PLACES.freedom, { ...PLACES.muri, lat: PLACES.freedom.lat + 0.001, lon: PLACES.freedom.lon + 0.001 }];
  const fresh = scorePlaces({ members: crew, candidates: twins, at: saturday4pm });
  const usedKey = placeKey(fresh.pick?.candidate);
  const again = scorePlaces({ members: crew, candidates: twins, at: saturday4pm, now: saturday4pm, recent: [{ key: usedKey, at: saturday4pm - 7 * DAY }] });
  assert.notEqual(placeKey(again.pick?.candidate), usedKey);
  assert.match(again.explanation?.notChosen[0].why || "", /used 7 days ago/);
  const longAgo = scorePlaces({ members: crew, candidates: twins, at: saturday4pm, now: saturday4pm, recent: [{ key: usedKey, at: saturday4pm - 90 * DAY }] });
  assert.equal(placeKey(longAgo.pick?.candidate), usedKey, "the penalty fades after eight weeks");
});

test("the explanation carries the facts Gemma may use, and nothing else", () => {
  const { explanation } = scorePlaces({ members: [...crew, { id: "m9", name: "Zee", area: null }], candidates: all, at: saturday4pm, outdoor: true, vibeTags: ["outside", "cheap"], budget: "cheap" });
  assert.ok(explanation);
  assert.equal(explanation.members.length, 4);
  assert.deepEqual(explanation.unlocated, ["Zee"]);
  assert.ok(explanation.reasons.includes("fair"));
  assert.ok(explanation.reasons.includes("green"));
  assert.ok(explanation.maxMinutes >= explanation.meanMinutes);
  assert.equal(explanation.notChosen.length, 2);
  assert.ok(explanation.members.every((m) => typeof m.minutes === "number" && m.from));
});

test("tag helpers", () => {
  assert.ok(isGreen({ leisure: "park" }));
  assert.ok(isGreen({ natural: "beach" }));
  assert.ok(isGreen({ landuse: "grass" }));
  assert.ok(!isGreen({ amenity: "bar" }));
  assert.deepEqual(vibeFit({ leisure: "park" }, ["outside", "cheap", "unknownword"]).matched, ["outside"]);
  assert.equal(vibeFit({}, []).score, 0.5);
  assert.equal(budgetFit({ fee: "no" }, "cheap").score, 1);
  assert.equal(budgetFit({ fee: "yes" }, "free").score, 0);
  assert.equal(placeKey(PLACES.freedom), "osm:way/1002");
  assert.equal(placeKey({ name: "Mama's Place", lat: 6.5, lon: 3.35 }), "name:mama s place@6.500,3.350");
});

test("empty inputs", () => {
  assert.equal(scorePlaces({ members: crew, candidates: [] }).pick, null);
  const { pick } = scorePlaces({ members: [], candidates: [PLACES.freedom] });
  assert.equal(pick?.candidate.name, PLACES.freedom.name);
});

test("entry fees: free only when a source says so; unknown means check at the gate", async () => {
  const fs = await import("node:fs");
  const { withEntries, entryFor, UNKNOWN_ENTRY } = await import("../src/core/places.mjs");
  const spotsData = JSON.parse(fs.readFileSync(new URL("../data/lagos-spots.json", import.meta.url), "utf8")).spots;
  const feesData = JSON.parse(fs.readFileSync(new URL("../data/spot-entry-fees.json", import.meta.url), "utf8")).fees;
  // every fee in the file is sourced, dated, and names a spot that exists
  for (const f of feesData) {
    assert.ok(spotsData.some((/** @type {any} */ s) => s.name === f.spot), `${f.spot} is a spot`);
    assert.match(f.source.url, /^https:\/\//);
    assert.match(f.source.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(f.source.says.length > 20, "the words the source uses");
    if (f.free === true) assert.match(f.source.says, /\bfree\b/i, "free only when the source says free");
    assert.ok(!/[—–]/.test(f.note || ""), "no dashes");
  }
  const spots = withEntries(spotsData, feesData);
  const by = (/** @type {string} */ n) => spots.find((s) => s.name === n);
  assert.equal(by("JJT Park").entry.free, false);
  assert.match(by("JJT Park").entry.note, /₦1,000/);
  assert.equal(by("Elegushi Beach").entry.free, false);
  assert.deepEqual(by("Freedom Park").entry, UNKNOWN_ENTRY, "no source, no claim");
  // a fee with no source never reaches a person
  const sneaky = withEntries([{ name: "Some Park", lat: 6.5, lon: 3.4 }], [{ spot: "Some Park", free: true, note: "Free" }]);
  assert.deepEqual(sneaky[0].entry, UNKNOWN_ENTRY);

  const jjt = by("JJT Park");
  assert.equal(entryFor({ name: "Johnson Jakande Tinubu Park", lat: jjt.lat, lon: jjt.lon }, spots)?.free, false, "found by alias");
  assert.deepEqual(entryFor({ name: "Freedom Park", lat: by("Freedom Park").lat, lon: by("Freedom Park").lon }, spots), UNKNOWN_ENTRY);
  assert.deepEqual(entryFor({ name: "Some Green", lat: 6.5, lon: 3.4 }, spots, { ritual: true }), UNKNOWN_ENTRY, "the sloth's pick: check at the gate");
  assert.equal(entryFor({ name: "Some Green", lat: 6.5, lon: 3.4 }, spots), null, "a flyer's venue: nothing to say");
  assert.equal(entryFor({ name: "Tolu's place", private: true }, spots, { ritual: true }), null);
  const osmFree = entryFor({ name: "Quiet Garden", lat: 6.5, lon: 3.4, osm: { type: "way", id: 7, tags: { leisure: "garden", fee: "no" } } }, spots);
  assert.equal(osmFree?.free, true);
  assert.equal(osmFree?.source?.url, "https://www.openstreetmap.org/way/7", "OpenStreetMap's fee tag is the source");
});
