// @ts-check
// Tests for the persona eval's own judging (run: node --test eval/test/).

import assert from "node:assert/strict";
import { test } from "node:test";
import { aligned, fkGrade, hardChecks, jaccard, skeleton, wilson } from "../metrics.mjs";
import { requestKey, serviceOf } from "../world.mjs";

test("Wilson interval: known values, and none for no trials", () => {
  const w = wilson(0, 10);
  assert.equal(w.p, 0);
  assert.equal(w.lo, 0);
  assert.ok(Math.abs(/** @type {number} */ (w.hi) - 0.2775) < 0.001);
  const h = wilson(5, 10);
  assert.ok(Math.abs(/** @type {number} */ (h.lo) - 0.2366) < 0.001 && Math.abs(/** @type {number} */ (h.hi) - 0.7634) < 0.001);
  assert.equal(wilson(0, 0).p, null);
});

test("Jaccard overlap", () => {
  assert.equal(jaccard(new Set(["a", "b"]), new Set(["b", "c"])), 1 / 3);
  assert.equal(jaccard(new Set(), new Set()), null);
});

test("world keys: Overpass by its query alone, whichever mirror; others by method and URL", () => {
  const a = requestKey("https://overpass-api.de/api/interpreter", { method: "POST", body: "data=x" });
  const b = requestKey("https://maps.mail.ru/osm/tools/overpass/api/interpreter", { method: "POST", body: "data=x" });
  assert.equal(a.key, b.key);
  assert.notEqual(requestKey("https://nominatim.openstreetmap.org/search?q=a").key, requestKey("https://nominatim.openstreetmap.org/search?q=b").key);
  assert.equal(serviceOf("https://api.open-meteo.com/v1/forecast?x=1"), "openmeteo");
  assert.equal(serviceOf("https://awelagos.substack.com/robots.txt"), "rss");
});

const base = { id: "x", city: "Lagos", areas: [{ label: "Yaba", lat: 6.509, lon: 3.378, tolKm: 4 }], taste: { kinds: ["park"], keywords: ["art"] } };
const crew = { areas: [{ label: "Yaba", lat: 6.51, lon: 3.38 }], tz: "Africa/Lagos", region: { center: { lat: 6.51, lon: 3.38 } }, taste: { needs: [] }, budget: "any" };

test("hard checks: a bar for a crew with no alcohol fails; a park passes", () => {
  const p = { ...base, hard: { noAlcohol: true } };
  const bar = { crew, ritual: { place: { name: "Bar X", lat: 6.5, lon: 3.38 }, kind: "bar", status: "ready", start: "2026-10-24T15:00:00+01:00", end: "2026-10-24T18:00:00+01:00" }, ideas: [] };
  assert.equal(hardChecks(p, bar).find((c) => c.check === "noAlcohol")?.pass, false);
  const park = { ...bar, ritual: { ...bar.ritual, place: { name: "Park Y", lat: 6.5, lon: 3.38 }, kind: "park" } };
  assert.equal(hardChecks(p, park).find((c) => c.check === "noAlcohol")?.pass, true);
});

test("hard checks: a place called 'Lagos Polo Club' is not drink, an event called 'Wine & Paint' is", () => {
  const p = { ...base, hard: { noAlcohol: true } };
  const r = { crew, ideas: [{ kind: "place", title: "Lagos Polo Club", place: { name: "Lagos Polo Club", lat: 6.5, lon: 3.38 }, placeKind: "sports", why: "A sports ground." }] };
  assert.equal(hardChecks(p, r).find((c) => c.check === "noAlcohol")?.pass, true);
  const e = { crew, ideas: [{ kind: "event", title: "Wine & Paint", place: { name: "Studio", lat: 6.5, lon: 3.38 }, why: "Paint together." }] };
  assert.equal(hardChecks(p, e).find((c) => c.check === "noAlcohol")?.pass, false);
});

test("hard checks: areas pinned far away fail; the times a crew said are kept", () => {
  const p = { ...base, hard: { areasOnMap: true, withinHours: ["06:00", "11:00"] } };
  const far = { crew: { ...crew, areas: [{ label: "Yaba", lat: 6.7, lon: 3.38 }] }, ritual: { place: { name: "P", lat: 6.5, lon: 3.38 }, kind: "park", status: "ready", start: "2026-10-24T15:00:00+01:00", end: "2026-10-24T18:00:00+01:00" }, ideas: [] };
  const out = hardChecks(p, far);
  assert.equal(out.find((c) => c.check === "areasOnMap")?.pass, false);
  assert.equal(out.find((c) => c.check.startsWith("withinHours"))?.pass, false);
});

test("hard checks: an identity word in the invite fails discreetNoLabel, a place name does not", () => {
  const p = { ...base, hard: { discreetNoLabel: { labels: "queer|\\bgay\\b" } } };
  const clean = { crew, ideas: [], artifacts: { invite: "Catch us at Queer Street Garden this Saturday." }, exemptNames: ["Queer Street Garden"] };
  assert.equal(hardChecks(p, clean).find((c) => c.check === "discreetNoLabel")?.pass, true);
  const dirty = { crew, ideas: [], artifacts: { invite: "A queer night out this Saturday." }, exemptNames: [] };
  assert.equal(hardChecks(p, dirty).find((c) => c.check === "discreetNoLabel")?.pass, false);
  const need = { crew, ideas: [], artifacts: { ics: "DESCRIPTION:somewhere discreet" }, exemptNames: [] };
  assert.equal(hardChecks(p, need).find((c) => c.check === "discreetNoLabel")?.pass, false);
});

test("taste proxy: kinds for places, keywords for events, the night in for a discreet crew", () => {
  const t = { kinds: ["gallery"], keywords: ["art"] };
  /** @type {any} */
  const s = { what: "idea", name: "G", text: "G", kind: "gallery", ideaKind: "place" };
  assert.equal(aligned(s, t), true);
  assert.equal(aligned({ ...s, kind: "event", ideaKind: "event", text: "Art Fair at Freedom Park" }, t), true);
  assert.equal(aligned({ ...s, kind: "event", ideaKind: "event", text: "Comedy night" }, t), false);
  assert.equal(aligned({ ...s, kind: "home" }, t, ["discreet"]), true);
});

test("copy: reading grade and templates", () => {
  assert.ok(/** @type {number} */ (fkGrade("Come through. We meet at the park.")) < 5);
  assert.equal(skeleton("Freedom Park is 12 minutes from Yaba on Saturday.", ["Freedom Park"]), skeleton("Muri Park is 30 minutes from Yaba on Sunday.", ["Muri Park"]));
});
