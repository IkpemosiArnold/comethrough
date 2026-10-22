// @ts-check
// The one LLM port every Gemma task goes through, and the choice of adapter behind it:
//   LLM=gemini  (the default) Gemma 4 through Google's Gemini API, with the server's key
//   LLM=ollama  Gemma on your own machine or server through Ollama (OLLAMA_URL, OLLAMA_MODEL)
// The service and the core only ever see the AiPort shape (./gemini.mjs): `available`,
// `model` and `generate({ task, messages, schema, maxTokens, temperature })`. This file adds
// `provider` and `vision()` so the app can say plainly what the running model can do.

import { createGemini } from "./gemini.mjs";
import { createOllama } from "./ollama.mjs";
import { emptyFields } from "../core/diagnose.mjs";

/** @typedef {import("./gemini.mjs").AiPort} AiPort */
/** @typedef {AiPort & { provider: "gemini"|"ollama", vision: () => Promise<boolean> }} LlmPort */

/**
 * The LLM port for a config.
 * @param {{ llm: "gemini"|"ollama", gemini: { key: string, model: string, fallbacks: string[], visionModel: string, timeoutMs: number }, ollama: { url: string, model: string, vision: "auto"|"yes"|"no", timeoutMs: number } }} cfg
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 * @returns {LlmPort}
 */
export function createLlm(cfg, { fetchImpl } = {}) {
  if (cfg.llm === "ollama") return createOllama({ ...cfg.ollama, ...(fetchImpl ? { fetchImpl } : {}) });
  const g = createGemini({ ...cfg.gemini, ...(fetchImpl ? { fetchImpl } : {}) });
  // Gemma 4 on the Gemini API reads images (checked live on 21 Oct 2026, docs/NOTES.md)
  return { ...g, provider: "gemini", vision: async () => true };
}

/** A line for logs and /healthz: which model answers, and where. */
export function describeLlm(/** @type {{ llm: string, gemini: { model: string }, ollama: { url: string, model: string } }} */ cfg) {
  return cfg.llm === "ollama" ? `ollama:${cfg.ollama.model}@${cfg.ollama.url}` : `gemini:${cfg.gemini.model}`;
}

/**
 * The port with one log line per Gemma call: the task, which output fields came back empty,
 * how many calls it took and whether another model answered. Field names only, never what
 * anyone wrote or what the model said (src/core/diagnose.mjs).
 * @template {AiPort} T
 * @param {T} ai
 * @param {(event: string, fields?: Record<string, any>) => void} log
 * @returns {T}
 */
export function diagnosedAi(ai, log) {
  return {
    ...ai,
    async generate(/** @type {any} */ req) {
      try {
        const r = await ai.generate(req);
        log("gemma_fields", { task: req.task ?? null, model: r.model, parsed: r.data != null, empty: r.data != null ? emptyFields(r.data) : ["(all)"], attempts: r.attempts ?? 1, retried: (r.attempts ?? 1) > 1, modelFallback: !!r.modelFallback });
        return r;
      } catch (e) {
        const err = /** @type {any} */ (e);
        log("gemma_fields", { task: req.task ?? null, model: null, parsed: false, empty: ["(all)"], attempts: err.attempts ?? 1, retried: (err.attempts ?? 1) > 1, status: err.status ?? null });
        throw e;
      }
    },
  };
}
