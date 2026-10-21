// @ts-check
// The curated spots file must stay honest: every coordinate traced to an OSM lookup.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { inLagos } from "../src/core/geo.mjs";

const data = JSON.parse(fs.readFileSync(new URL("../data/lagos-spots.json", import.meta.url), "utf8"));

test("every curated spot is in Lagos, named, and has a recorded OSM source", () => {
  assert.ok(data.spots.length >= 20);
  const keys = new Set();
  for (const s of data.spots) {
    assert.ok(s.name && s.kind, JSON.stringify(s));
    assert.ok(inLagos(s), `${s.name} is in Lagos`);
    assert.ok(["photon", "nominatim", "overpass"].includes(s.source?.service), `${s.name} has a source`);
    assert.match(s.source.url, /^https:\/\//);
    assert.match(s.source.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(s.osm && ["node", "way", "relation"].includes(s.osm.type) && Number.isFinite(s.osm.id), `${s.name} has an OSM id`);
    const key = `${s.osm.type}/${s.osm.id}`;
    assert.ok(!keys.has(key), `${s.name} is listed once`);
    keys.add(key);
  }
});
