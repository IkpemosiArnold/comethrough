// @ts-check
// Flyer uploads on mobile data (web/src/lib/image.js): the size steps and the HEIC path.
// The canvas work itself was checked in headless Chrome (docs/LOCAL-FACTS.md, "Data cost").
import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-ignore: a browser module, imported for its plain functions
import { FlyerError, MAX_EDGE, STEPS, TARGET_BYTES, fitSize, formatBytes, isHeic, prepareFlyer, shrinkWith } from "../web/src/lib/image.js";

test("flyers are drawn at most 1600 px on the long edge, never enlarged", () => {
  assert.equal(MAX_EDGE, 1600);
  assert.deepEqual(fitSize(4032, 3024), { width: 1600, height: 1200 });
  assert.deepEqual(fitSize(1080, 1920), { width: 900, height: 1600 });
  assert.deepEqual(fitSize(800, 600), { width: 800, height: 600 });
});

test("quality then size step down until the file is under 400 KB; the smallest wins if none is", async () => {
  assert.equal(TARGET_BYTES, 400 * 1024);
  assert.deepEqual(STEPS[0], { edge: 1600, quality: 0.8 });
  /** @type {string[]} */
  const tried = [];
  // a busy flyer: 0.8 at 1600 px is 520 KB, 0.7 is 380 KB
  const sizes = { "1600x1200@0.8": 520e3, "1600x1200@0.7": 380e3 };
  const out = await shrinkWith({ width: 4032, height: 3024 }, async (w, h, q) => {
    const k = `${w}x${h}@${q}`;
    tried.push(k);
    return /** @type {any} */ ({ size: /** @type {any} */ (sizes)[k] ?? 100e3 });
  });
  assert.deepEqual(tried, ["1600x1200@0.8", "1600x1200@0.7"]);
  assert.deepEqual(out?.step, { edge: 1600, quality: 0.7 });
  const stubborn = await shrinkWith({ width: 4000, height: 3000 }, async (w) => /** @type {any} */ ({ size: 500e3 + w }));
  assert.equal(stubborn?.step.edge, 1024, "every step tried; the smallest kept");
});

test("sizes read in KB and MB for the upload line", () => {
  assert.equal(formatBytes(312000), "305 KB");
  assert.equal(formatBytes(4.2e6), "4.0 MB");
  assert.equal(formatBytes(900), "900 bytes");
});

test("an iPhone HEIC photo the browser cannot open asks for a screenshot", async () => {
  const g = /** @type {any} */ (globalThis);
  const before = g.createImageBitmap;
  g.createImageBitmap = async () => { throw new Error("unsupported"); };
  try {
    const heic = new File([new Uint8Array(3000)], "IMG_2041.HEIC", { type: "" });
    assert.ok(isHeic(heic));
    await assert.rejects(prepareFlyer(heic), (e) => e instanceof FlyerError && e.code === "heic" && /Take a screenshot of the flyer/.test(e.message));
    // a small JPEG the browser cannot decode still goes as it is
    const jpeg = new File([new Uint8Array(2000)], "flyer.jpg", { type: "image/jpeg" });
    assert.equal((await prepareFlyer(jpeg)).file, jpeg);
    const big = new File([new Uint8Array(900_000)], "x.jpg", { type: "image/jpeg" });
    await assert.rejects(prepareFlyer(big), (e) => e instanceof FlyerError && e.code === "unreadable");
  } finally {
    g.createImageBitmap = before;
  }
});
