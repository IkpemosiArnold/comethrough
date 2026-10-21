// @ts-check
// The architecture, enforced: src/core is a pure, browser-safe functional core (no Node
// builtins, no packages, no process, no clock or randomness read behind the caller's back),
// and every source file opts in to type checking.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const walk = (/** @type {string} */ dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

const core = walk(path.join(root, "src/core")).filter((f) => f.endsWith(".mjs"));
/** The code without comments (JSDoc type imports are not runtime imports). */
const code = (/** @type {string} */ f) => fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");

test("src/core imports nothing outside src/core", () => {
  for (const f of core) {
    const src = code(f);
    for (const m of src.matchAll(/^\s*(?:import|export)[^"'`]*?from\s+["']([^"']+)["']/gm)) {
      assert.ok(m[1].startsWith("./"), `${path.relative(root, f)} imports ${m[1]}`);
    }
    assert.ok(!/\bimport\(/.test(src), `${path.relative(root, f)} uses a dynamic import`);
  }
});

test("src/core reads no process, clock or randomness", () => {
  for (const f of core) {
    const src = code(f);
    for (const bad of [/\bprocess\./, /\bDate\.now\(/, /new Date\(\)/, /Math\.random\(/, /\bfetch\(/, /crypto\./]) {
      assert.ok(!bad.test(src), `${path.relative(root, f)} uses ${bad}`);
    }
  }
});

test("every source file is type checked", () => {
  for (const f of walk(path.join(root, "src")).filter((x) => x.endsWith(".mjs"))) {
    assert.match(fs.readFileSync(f, "utf8"), /^\/\/ @ts-check/, `${path.relative(root, f)} starts with // @ts-check`);
  }
});

test("no machine-specific paths in the source", () => {
  for (const f of walk(path.join(root, "src"))) {
    assert.ok(!/\/Users\/|C:\\\\Users|\/home\//.test(fs.readFileSync(f, "utf8")), `${path.relative(root, f)} has a machine path`);
  }
});

test("src/core names no city: Lagos lives in src/packs/lagos, and the core takes a pack as a parameter", () => {
  for (const f of core) {
    const src = code(f);
    assert.ok(!/lagos|nigeria|Africa\//i.test(src), `${path.relative(root, f)} mentions a city in its code (comments are fine)`);
  }
  for (const f of fs.readdirSync(path.join(root, "src/core/prompts"))) {
    const md = fs.readFileSync(path.join(root, "src/core/prompts", f), "utf8").split("<!-- system -->")[1] ?? "";
    assert.ok(!/lagos|nigeria|pidgin|naira/i.test(md), `${f}: the prompt text itself names no place; the pack fills it in`);
  }
  for (const f of walk(path.join(root, "src")).filter((x) => x.endsWith(".mjs") && !x.includes(`${path.sep}packs${path.sep}`))) {
    const src = code(f);
    assert.ok(!/from\s+["'][^"']*packs\/lagos/.test(src) || f.endsWith(path.join("server", "server.mjs")), `${path.relative(root, f)} imports the Lagos pack directly; go through src/packs/index.mjs`);
  }
});
