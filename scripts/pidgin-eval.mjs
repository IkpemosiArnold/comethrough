// Runs the Pidgin and mixed English fixtures (test/fixtures/pidgin.mjs) live against the
// Gemini API with the app's own prompts and readers, prints per-field accuracy, and records
// Gemma's answers to test/fixtures/pidgin-answers.json so test/pidgin.test.mjs can check the
// readers offline. One call per case (16), spaced a few seconds apart.
//   node scripts/pidgin-eval.mjs            needs GEMINI_API_KEY in .env (never printed)
import fs from "node:fs/promises";
import { config, loadDotEnv } from "../src/config.mjs";
import { createGemini } from "../src/adapters/gemini.mjs";
import { loadPrompts } from "../src/app/prompts.mjs";
import { MAX_TOKENS } from "../src/core/tasks.mjs";
import { CASES, request, score } from "../test/fixtures/pidgin.mjs";

loadDotEnv();
const cfg = config();
if (!cfg.gemini.key) throw new Error("GEMINI_API_KEY is not set");
const ai = createGemini({ key: cfg.gemini.key, model: cfg.gemini.model, fallbacks: [], timeoutMs: 40000 });
const prompts = loadPrompts();
const only = process.argv[2] ? new Set(process.argv[2].split(",")) : null;
const answersFile = new URL("../test/fixtures/pidgin-answers.json", import.meta.url);
let saved = { answers: {} };
try { saved = JSON.parse(await fs.readFile(answersFile, "utf8")); } catch {}
/** @type {Record<string, { ok: number, n: number }>} */
const fields = {};
let calls = 0;
for (const c of CASES) {
  if (only && !only.has(c.id)) continue;
  const { messages, schema } = request(c, prompts);
  let data = null;
  let model = null;
  try {
    calls++;
    const r = await ai.generate({ task: c.task, messages, schema, maxTokens: MAX_TOKENS[c.task] });
    data = r.data;
    model = r.model;
  } catch (e) {
    console.log(`${c.id}: Gemma error ${/** @type {any} */ (e).status ?? ""} ${String(/** @type {any} */ (e).message).slice(0, 80)}`);
  }
  saved.answers[c.id] = { model, data };
  await fs.writeFile(answersFile, `${JSON.stringify(saved, null, 1)}\n`);
  const rows = score(c, data);
  for (const r of rows) {
    fields[`${c.task}.${r.field}`] ??= { ok: 0, n: 0 };
    fields[`${c.task}.${r.field}`].n++;
    if (r.ok) fields[`${c.task}.${r.field}`].ok++;
  }
  const bad = rows.filter((r) => !r.ok);
  console.log(`${bad.length ? "x" : "ok"} ${c.id}${bad.length ? `: ${bad.map((r) => `${r.field} got ${JSON.stringify(r.got)} want ${JSON.stringify(r.want)}`).join("; ")}` : ""}`);
  await new Promise((r) => setTimeout(r, 3500));
}
saved.recordedAt = new Date().toISOString().slice(0, 10);
saved.model = cfg.gemini.model;
await fs.writeFile(answersFile, `${JSON.stringify(saved, null, 1)}\n`);
let ok = 0, n = 0;
console.log("\nfield accuracy:");
for (const [k, v] of Object.entries(fields).sort()) {
  ok += v.ok; n += v.n;
  console.log(`  ${k}: ${v.ok}/${v.n}`);
}
console.log(`overall ${ok}/${n} (${Math.round((100 * ok) / n)}%), ${calls} Gemma calls`);
