// @ts-check
// The curated spots file must stay honest: every coordinate traced to an OpenStreetMap lookup
// or a Wikidata item, with the date it was checked.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { inLagos } from "../src/core/geo.mjs";

const data = JSON.parse(fs.readFileSync(new URL("../data/lagos-spots.json", import.meta.url), "utf8"));

test("every curated spot is in Lagos, named, and has a recorded open source and a check date", () => {
  assert.ok(data.spots.length >= 30);
  const keys = new Set();
  for (const s of data.spots) {
    assert.ok(s.name && s.kind, JSON.stringify(s));
    assert.ok(inLagos(s), `${s.name} is in Lagos`);
    assert.ok(["photon", "nominatim", "overpass", "wikidata"].includes(s.source?.service), `${s.name} has a source`);
    assert.match(s.source.url, /^https:\/\//);
    assert.match(s.source.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(s.verifiedAt, /^\d{4}-\d{2}-\d{2}$/, `${s.name} has verifiedAt`);
    let key;
    if (s.source.service === "wikidata") {
      assert.match(s.source.qid, /^Q\d+$/);
      assert.equal(s.source.licence, "CC0");
      assert.equal(s.source.url, `https://www.wikidata.org/wiki/${s.source.qid}`);
      key = s.source.qid;
    } else {
      assert.ok(s.osm && ["node", "way", "relation"].includes(s.osm.type) && Number.isFinite(s.osm.id), `${s.name} has an OSM id`);
      key = `${s.osm.type}/${s.osm.id}`;
    }
    assert.ok(!keys.has(key), `${s.name} is listed once`);
    keys.add(key);
  }
});

test("the places Lagosians go that OpenStreetMap lacks are in, from Wikidata; the rest are listed as missing", () => {
  const byName = Object.fromEntries(data.spots.map((/** @type {any} */ s) => [s.name, s]));
  for (const name of ["Elegushi Beach", "Landmark Beach", "JJT Park", "Ndubuisi Kanu Park", "Jhalobia Recreation Park", "Lagos Yacht Club", "Dreamworld Africana"]) {
    assert.equal(byName[name]?.source.service, "wikidata", name);
  }
  // the coordinates sit where the places are: Elegushi on the Lekki coast, JJT at Alausa
  assert.ok(Math.abs(byName["Elegushi Beach"].lat - 6.42) < 0.01 && Math.abs(byName["Elegushi Beach"].lon - 3.49) < 0.01);
  assert.ok(Math.abs(byName["JJT Park"].lat - 6.615) < 0.01 && Math.abs(byName["JJT Park"].lon - 3.364) < 0.01);
  assert.deepEqual(byName["JJT Park"].aliases, ["Johnson Jakande Tinubu Park"]);
  assert.deepEqual(data.missing, ["Alpha Beach, Lekki", "Lekki Leisure Lake"], "no open coordinates, so not added");
  assert.equal(byName["Nike Art Gallery"].covered, true, "a gallery has a roof: the rain alternative");
});
