// @ts-check
// A live check of the LLM port: three text tasks through whichever adapter the config
// picks (LLM=gemini or LLM=ollama), with latencies, plus a flyer to see what the model says
// when it cannot read images. Nothing is saved.
//
// Run:  LLM=ollama OLLAMA_MODEL=gemma3-4b-hf:latest node scripts/llm-check.mjs
//       node scripts/llm-check.mjs            (the Gemini API; needs GEMINI_API_KEY)

import fs from "node:fs";
import { config, loadDotEnv } from "../src/config.mjs";
import { createLlm, describeLlm } from "../src/adapters/llm.mjs";
import { loadPrompts } from "../src/app/prompts.mjs";
import {
  CREW_SCHEMA, EXPLAIN_SCHEMA, MAX_TOKENS, PLAN_SCHEMA, crewSetupMessages, explainMessages, localisePrompt, planMessages, readCrewSetup, readExplain, readPlan,
} from "../src/core/tasks.mjs";
import { LAGOS, LAGOS_REGION } from "../src/packs/index.mjs";

loadDotEnv();
const cfg = config();
const llm = createLlm(cfg);
const prompts = loadPrompts();
const local = LAGOS.local(LAGOS_REGION);
const p = (/** @type {string} */ n) => localisePrompt(prompts[n], local);
const today = "2026-10-21";
const tz = "Africa/Lagos";

/** @type {Record<string, any>} */
const report = { at: new Date().toISOString(), llm: describeLlm(cfg), vision: await llm.vision() };

/** @param {string} task @param {any[]} messages @param {any} schema @param {(d: any) => any} read */
async function run(task, messages, schema, read) {
  const t0 = performance.now();
  try {
    const r = await llm.generate({ task, messages, schema, maxTokens: MAX_TOKENS[/** @type {keyof typeof MAX_TOKENS} */ (task)] });
    report[task] = { sec: +((performance.now() - t0) / 1000).toFixed(1), usage: r.usage ?? null, parsed: r.data != null, read: read(r.data) };
  } catch (e) {
    const err = /** @type {any} */ (e);
    report[task] = { sec: +((performance.now() - t0) / 1000).toFixed(1), error: String(err.message).slice(0, 200), hint: err.hint ?? null };
  }
}

const sentence = "the uni guys, every other Saturday, somewhere outside and cheap, around Yaba and Lekki";
await run("parse-crew", crewSetupMessages(p("parse-crew"), { sentence }), CREW_SCHEMA, (d) => {
  const r = readCrewSetup(d, { sentence }, local);
  return { name: r.draft.name, budget: r.draft.budget, rhythm: r.draft.rhythm, areas: r.draft.areas, low: r.low };
});

const text = "wine and monopoly at mine friday 7, bring a bottle";
await run("parse-plan", planMessages(p("parse-plan"), { text, url: null, pageMeta: null, image: null, today }), PLAN_SCHEMA, (d) => {
  const r = readPlan(d, { text, url: null, pageMeta: null, image: null, today, tz, member: { id: "m1", name: "Tolu" }, local });
  return { kind: r.draft.kind, title: r.draft.title, start: r.draft.start, bring: r.draft.bring, low: r.low };
});

const explanation = {
  pick: { name: "Freedom Park", key: "x", kind: "park", green: true, fee: null },
  members: [{ name: "Tolu", from: "Yaba", minutes: 28 }, { name: "Amaka", from: "Lekki Phase 1", minutes: 35 }, { name: "Seyi", from: "Surulere", minutes: 24 }],
  maxMinutes: 35, vibeMatched: ["outside"], lastUsedDaysAgo: null, reasons: ["fair", "green", "fresh"],
  notChosen: [{ name: "Muri Okunola Park", why: "about 52 minutes for Seyi" }],
};
await run("explain-pick", explainMessages(p("explain-pick"), explanation), EXPLAIN_SCHEMA, (d) => readExplain(d, explanation));

// a flyer: refused up front when the model has no vision projector (no model call)
const flyer = fs.readFileSync(new URL("../test/fixtures/flyer.png", import.meta.url));
await run("parse-plan (flyer)", planMessages(p("parse-plan"), { text: null, url: null, pageMeta: null, image: { mimeType: "image/png", data: flyer.toString("base64") }, today }), PLAN_SCHEMA, (d) => ({ title: d?.title ?? null }));

console.log(JSON.stringify(report, null, 2));
