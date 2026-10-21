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
