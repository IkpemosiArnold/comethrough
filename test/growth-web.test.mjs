// @ts-check
// The phone's side of the growth features, tested from Node: the Status card's words and
// layout, cutting a face to a square, the crew name's 40 characters, and which one-time card
// shows (web/src/lib/statuscard.js, web/src/lib/face.js, web/src/ui).
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { cardLines, frames, wrap, W, H } from "../web/src/lib/statuscard.js";
import { faceCrop, FACE_PX } from "../web/src/lib/face.js";

test("the Status card's words: slow and steady, never guilt; a discreet crew's card has no name", () => {
  assert.deepEqual(cardLines({ crewName: "The Yaba Lot", linkups: 7 }), { head: "The Yaba Lot came through.", sub: "7 linkups, slow and steady" });
  assert.deepEqual(cardLines({ crewName: null, linkups: 1 }), { head: "We came through.", sub: "The first linkup, slow and steady" });
  const words = JSON.stringify([cardLines({ crewName: "x", linkups: 0 }), cardLines({ crewName: "x", linkups: 3 })]);
  assert.ok(!/streak|miss|lose|lost|don't break|again/i.test(words), "no streak-loss language");
  assert.equal(W, 1080);
  assert.equal(H, 1920);
});

test("the Status card's photos: 1 to 3 frames, inside the card, above the words", () => {
  for (const n of [1, 2, 3]) {
    const f = frames(n);
    assert.equal(f.length, n);
    for (const { cx, cy, size } of f) {
      assert.ok(cx - size / 2 >= 0 && cx + size / 2 <= W, "inside the width");
      assert.ok(cy + size / 2 + size * 0.09 <= 1420, "above the words");
    }
  }
  assert.deepEqual(frames(0), []);
  const measure = (/** @type {string} */ t) => t.length * 50;
  assert.deepEqual(wrap(measure, "The Yaba Saturday Sloths came through.", 1000), ["The Yaba Saturday", "Sloths came through."]);
  const long = wrap(measure, "a ".repeat(200), 300, 3);
  assert.equal(long.length, 3);
  assert.ok(long[2].endsWith("…"));
});

test("a face is cut square from the middle of a photo, a little above centre in a portrait", () => {
  assert.deepEqual(faceCrop(1200, 1600), { x: 0, y: 120, side: 1200 });
  assert.deepEqual(faceCrop(1600, 1200), { x: 200, y: 0, side: 1200 });
  assert.equal(FACE_PX, 128);
});

test("the web app never uploads the Status card's photos and shares the file alone", () => {
  const src = fs.readFileSync(new URL("../web/src/lib/statuscard.js", import.meta.url), "utf8");
  assert.ok(!/fetch\(|XMLHttpRequest|api\./.test(src), "nothing in the card maker talks to the server");
  assert.match(src, /navigator\.share\(data\)/);
  assert.match(src, /const data = \{ files: \[file\] \}/, "no text with the file (iPhones drop the file)");
});
