// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { boltText, clusterRiders, podsForPlan, uberLink } from "../src/core/pods.mjs";
import { parseInstant } from "../src/core/time.mjs";
import { AREAS, PLACES } from "./fixtures/lagos.mjs";

const near = (/** @type {{lat:number,lon:number,label:string}} */ a, dLat = 0, dLon = 0) => ({ ...a, lat: a.lat + dLat, lon: a.lon + dLon });
const plan = {
  start: "2026-10-24T16:00:00+01:00",
  tz: "Africa/Lagos",
  place: { name: PLACES.freedom.name, address: "Hospital Road, Lagos Island", lat: PLACES.freedom.lat, lon: PLACES.freedom.lon },
};

test("riders group by area, and nobody crosses the lagoon to pick someone up", () => {
  const riders = [
    { id: "a", name: "Tolu", area: AREAS.yaba },
    { id: "b", name: "Ada", area: near(AREAS.yaba, 0.005) },
    { id: "c", name: "Kene", area: AREAS.lekki },
    { id: "d", name: "Bayo", area: near(AREAS.lekki, -0.004, 0.006) },
    { id: "e", name: "Femi", area: AREAS.ikeja },
  ];
  const pods = clusterRiders(riders).map((g) => g.map((r) => r.id));
  assert.deepEqual(pods, [["a", "b"], ["c", "d"], ["e"]]);
  // Surulere is within 5 km of Yaba; Lagos Island is close too but across the water
  const mixed = clusterRiders([{ id: "a", name: "Tolu", area: AREAS.yaba }, { id: "s", name: "Sade", area: AREAS.surulere }, { id: "l", name: "Lola", area: AREAS.lagosIsland }]);
  assert.deepEqual(mixed.map((g) => g.map((r) => r.id)), [["a", "s"], ["l"]]);
});

test("a pod holds at most four, and five neighbours split 3 + 2, not 4 + 1", () => {
  const five = ["a", "b", "c", "d", "e"].map((id, i) => ({ id, name: id.toUpperCase(), area: near(AREAS.yaba, i * 0.001) }));
  const sizes = clusterRiders(five).map((g) => g.length);
  assert.deepEqual(sizes, [3, 2]);
  const nine = Array.from({ length: 9 }, (_, i) => ({ id: `m${i}`, name: `M${i}`, area: near(AREAS.lekki, i * 0.0005) }));
  assert.ok(clusterRiders(nine).every((g) => g.length <= 4 && g.length >= 2));
});

test("the result does not depend on input order", () => {
  const riders = [
    { id: "a", name: "Tolu", area: AREAS.yaba },
    { id: "b", name: "Ada", area: AREAS.surulere },
    { id: "c", name: "Kene", area: AREAS.lekki },
  ];
  const ids = (/** @type {any[]} */ rs) => clusterRiders(rs).map((g) => g.map((r) => r.id));
  assert.deepEqual(ids(riders), ids([...riders].reverse()));
});

test("leave-by is start minus the trip, pickups and a buffer, rounded down", () => {
  const { pods, unplaced } = podsForPlan(plan, [
    { id: "a", name: "Tolu", area: AREAS.yaba },
    { id: "b", name: "Ada", area: near(AREAS.yaba, 0.005) },
    { id: "z", name: "Zee", area: null },
  ]);
  assert.deepEqual(unplaced, [{ id: "z", name: "Zee" }]);
  assert.equal(pods.length, 1);
  const p = pods[0];
  assert.equal(p.fromLabel, "Yaba");
  assert.ok(p.crossesLagoon);
  assert.ok(p.travelMin && p.travelMin > 20 && p.travelMin < 60, `travel ${p.travelMin}`);
  const gap = (parseInstant(plan.start) - parseInstant(/** @type {string} */ (p.leaveBy))) / 60000;
  assert.ok(gap >= /** @type {number} */ (p.travelMin) + 15 && gap < /** @type {number} */ (p.travelMin) + 20, `gap ${gap}`);
  assert.match(/** @type {string} */ (p.leaveBy), /^2026-10-24T1[45]:[0-5][05]:00\+01:00$/);
  assert.match(p.shareText, /^Tolu and Ada: leave Yaba by 1\d:\d\d for Freedom Park \(about \d+ min\)\.$/);
});

test("the Uber link uses the documented m.uber.com/looking form with the dropoff filled", () => {
  const url = /** @type {string} */ (uberLink(plan.place));
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://m.uber.com/looking");
  assert.deepEqual(JSON.parse(/** @type {string} */ (u.searchParams.get("drop[0]"))), {
    latitude: 6.4497, longitude: 3.3972, addressLine1: "Freedom Park", addressLine2: "Hospital Road, Lagos Island",
  });
  assert.equal(u.searchParams.get("pickup"), null, "pickup is the rider's current location");
  const legacy = new URL(/** @type {string} */ (uberLink(plan.place, { style: "legacy" })));
  assert.equal(legacy.searchParams.get("dropoff[latitude]"), "6.4497");
  assert.equal(legacy.searchParams.get("dropoff[nickname]"), "Freedom Park");
  assert.equal(uberLink({ name: "Somewhere", address: null, lat: null, lon: null }), null);
});

test("Bolt gets copyable text, since it has no destination deep link", () => {
  assert.equal(boltText(plan.place), "Freedom Park, Hospital Road, Lagos Island (6.44970, 3.39720)");
  assert.equal(boltText({ name: "Tolu's place", address: null, lat: null, lon: null }), "Tolu's place");
  const { pods } = podsForPlan({ ...plan, place: { name: "Tolu's place", address: "12 Herbert Macaulay Way, Yaba", lat: null, lon: null } }, [{ id: "a", name: "Tolu", area: AREAS.yaba }]);
  assert.equal(pods[0].uberUrl, null);
  assert.equal(pods[0].leaveBy, null);
  assert.equal(pods[0].solo, true);
  assert.equal(pods[0].boltText, "Tolu's place, 12 Herbert Macaulay Way, Yaba");
});
