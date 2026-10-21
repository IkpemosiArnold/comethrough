// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, daysBetween, isAmbiguousTime, isDate, localParts, parseInstant, resolveDateWords, resolveTimeWords, toIsoLocal, weekdayOf, zonedToMs, zoneOffsetMinutes } from "../src/core/time.mjs";
import { crossesLagoon, haversineKm, islandSide, trafficBand, travelEstimate } from "../src/core/geo.mjs";
import { AREAS } from "./fixtures/lagos.mjs";

test("Lagos is UTC+01:00 all year and round-trips", () => {
  const ms = zonedToMs("2026-10-23", "19:00", "Africa/Lagos");
  assert.equal(new Date(ms).toISOString(), "2026-10-23T18:00:00.000Z");
  assert.equal(zoneOffsetMinutes(ms, "Africa/Lagos"), 60);
  assert.equal(toIsoLocal(ms, "Africa/Lagos"), "2026-10-23T19:00:00+01:00");
  assert.equal(localParts(ms, "Africa/Lagos").weekday, 5);
  assert.equal(zoneOffsetMinutes(Date.parse("2026-07-01T00:00:00Z"), "Africa/Lagos"), 60);
});

test("zone arithmetic works across a daylight-saving change", () => {
  // London moves to UTC on 25 Oct 2026 at 02:00 local
  assert.equal(new Date(zonedToMs("2026-10-24", "12:00", "Europe/London")).toISOString(), "2026-10-24T11:00:00.000Z");
  assert.equal(new Date(zonedToMs("2026-10-26", "12:00", "Europe/London")).toISOString(), "2026-10-26T12:00:00.000Z");
});

test("calendar date helpers", () => {
  assert.equal(addDays("2026-10-30", 3), "2026-11-02");
  assert.equal(daysBetween("2026-10-21", "2026-10-24"), 3);
  assert.equal(weekdayOf("2026-10-21"), 3);
  assert.ok(isDate("2028-02-29"));
  assert.ok(!isDate("2026-02-29"));
  assert.ok(Number.isNaN(parseInstant("2026-10-23T19:00")), "an instant needs an offset");
  assert.equal(parseInstant("2026-10-23T19:00:00+01:00"), Date.parse("2026-10-23T18:00:00Z"));
});

test("date words resolve with code, not the model (today is Wednesday 21 Oct 2026)", () => {
  const today = "2026-10-21";
  assert.equal(resolveDateWords("friday", today), "2026-10-23");
  assert.equal(resolveDateWords("Fri", today), "2026-10-23");
  assert.equal(resolveDateWords("this friday", today), "2026-10-23");
  assert.equal(resolveDateWords("next friday", today), "2026-10-30");
  assert.equal(resolveDateWords("wednesday", today), "2026-10-21");
  assert.equal(resolveDateWords("next monday", today), "2026-10-26");
  assert.equal(resolveDateWords("tonight", today), today);
  assert.equal(resolveDateWords("tomorrow", today), "2026-10-22");
  assert.equal(resolveDateWords("23 Oct", today), "2026-10-23");
  assert.equal(resolveDateWords("Saturday 24th October", today), "2026-10-24");
  assert.equal(resolveDateWords("Oct 31st", today), "2026-10-31");
  assert.equal(resolveDateWords("31/10", today), "2026-10-31");
  assert.equal(resolveDateWords("3 Jan", "2026-12-20"), "2027-01-03");
  assert.equal(resolveDateWords("sometime soon", today), null);
  assert.equal(resolveDateWords("monopoly", today), null, "a word that starts like a weekday is not one");
  assert.equal(resolveDateWords("saturated", today), null);
  assert.equal(resolveDateWords("thurs", today), "2026-10-22");
  assert.equal(resolveDateWords("SUN 25 OCT", today), "2026-10-25");
  assert.equal(resolveDateWords("31/02", today), null);
});

test("time words: a bare hour is the evening, and that guess is flagged", () => {
  assert.equal(resolveTimeWords("7"), "19:00");
  assert.equal(resolveTimeWords("7pm"), "19:00");
  assert.equal(resolveTimeWords("7:30"), "19:30");
  assert.equal(resolveTimeWords("10am"), "10:00");
  assert.equal(resolveTimeWords("12am"), "00:00");
  assert.equal(resolveTimeWords("19:00"), "19:00");
  assert.equal(resolveTimeWords("noon"), "12:00");
  assert.equal(resolveTimeWords("8ish"), "20:00");
  assert.equal(resolveTimeWords("whenever"), null);
  assert.ok(isAmbiguousTime("7"));
  assert.ok(!isAmbiguousTime("7pm"));
  assert.ok(!isAmbiguousTime("19:00"));
});

test("the lagoon heuristic puts each neighbourhood on the right side", () => {
  for (const k of ["lekki", "ikoyi", "vi", "ajah", "lagosIsland"]) assert.ok(islandSide(AREAS[k]), `${k} is on the island side`);
  for (const k of ["yaba", "ikeja", "surulere", "apapa", "ikorodu"]) assert.ok(!islandSide(AREAS[k]), `${k} is on the mainland`);
  assert.ok(crossesLagoon(AREAS.yaba, AREAS.lekki));
  assert.ok(!crossesLagoon(AREAS.yaba, AREAS.ikeja));
});

test("travel estimates: distance, rush hour and the bridge", () => {
  const km = haversineKm(AREAS.yaba, AREAS.lekki);
  assert.ok(km > 12 && km < 14, `Yaba to Lekki Phase 1 is about 13 km in a straight line, got ${km}`);
  const friday6pm = zonedToMs("2026-10-23", "18:00");
  const sunday3pm = zonedToMs("2026-10-25", "15:00");
  assert.equal(trafficBand(friday6pm), "peak");
  assert.equal(trafficBand(sunday3pm), "weekend");
  assert.equal(trafficBand(zonedToMs("2026-10-23", "23:00")), "night");
  const rush = travelEstimate(AREAS.yaba, AREAS.lekki, { at: friday6pm });
  const calm = travelEstimate(AREAS.yaba, AREAS.lekki, { at: sunday3pm });
  assert.ok(rush.crossesLagoon);
  assert.ok(rush.minutes > calm.minutes, "rush hour is slower");
  assert.ok(rush.minutes >= 90 && rush.minutes <= 130, `Friday rush Yaba to Lekki is long, got ${rush.minutes}`);
  assert.equal(travelEstimate(AREAS.yaba, AREAS.yaba).minutes, 5, "never below the minimum");
  assert.equal(rush.source, "straight");
  assert.equal(rush.bridge, null, "no route, so no bridge is named");
});

test("travel estimates on a road route: real distance, and a bridge only when the route takes one", () => {
  const friday6pm = zonedToMs("2026-10-23", "18:00");
  // OSRM's answer on 21 Oct 2026 for Yaba to Lekki Phase 1: 17.3 km, 15.6 min free flow, over Third Mainland Bridge
  const viaBridge = { km: 17.3, min: 15.6, bridges: ["Third Mainland Bridge", "Lekki - Ikoyi Bridge"] };
  const r = travelEstimate(AREAS.yaba, AREAS.lekki, { at: friday6pm, route: viaBridge });
  assert.equal(r.source, "road");
  assert.equal(r.roadKm, 17.3);
  assert.equal(r.bridge, "Third Mainland Bridge");
  assert.ok(r.crossesLagoon);
  assert.equal(r.minutes, Math.round((17.3 / 13) * 60 + 20));
  // Ikeja to Yaba: all mainland; OSRM names no bridge, so no penalty and no bridge claim
  const ikeja = travelEstimate(AREAS.ikeja, AREAS.yaba, { at: friday6pm, route: { km: 14.2, min: 12.6, bridges: [] } });
  assert.equal(ikeja.crossesLagoon, false);
  assert.equal(ikeja.bridge, null);
  // a route whose ends look like they are on two sides, but which uses no lagoon bridge, is believed
  const noCross = travelEstimate(AREAS.yaba, AREAS.lekki, { at: friday6pm, route: { km: 30, min: 40, bridges: ["Lekki - Ikoyi Bridge"] } });
  assert.equal(noCross.crossesLagoon, false);
  // OSRM's free-flow time is a floor: a fast road never beats it
  assert.equal(travelEstimate(AREAS.yaba, AREAS.lekki, { at: zonedToMs("2026-10-23", "23:30"), route: { km: 1, min: 30, bridges: [] } }).minutes, 30);
  // a table lookup has no bridge names: the sides of the lagoon decide, with no bridge named
  const table = travelEstimate(AREAS.yaba, AREAS.lekki, { at: friday6pm, route: { km: 17.3, min: 15.6 } });
  assert.ok(table.crossesLagoon);
  assert.equal(table.bridge, null);
  // Saturday afternoon is its own band
  assert.equal(trafficBand(zonedToMs("2026-10-24", "15:00")), "saturday");
  assert.equal(trafficBand(zonedToMs("2026-10-24", "10:00")), "weekend");
  assert.equal(trafficBand(zonedToMs("2026-10-25", "15:00")), "weekend");
});
