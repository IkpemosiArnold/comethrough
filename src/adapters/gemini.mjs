// @ts-check
// Gemma through Google's Gemini API, with the project's server-held key. Only what a user
// deliberately submitted (a sentence, a page's text, a flyer image) is sent.
//
// Adapted from Selects (github.com/IkpemosiArnold/selects, MIT), src/core/gemini.mjs: the
// request body, the timeout and one retry for transient failures, retrying once without a
// feature the model refuses (JSON mode, system instructions, thinking settings), and
// skipping "thought" parts in the answer. Added here: image input (inlineData parts; the
// Gemma 4 models on the API read images, per Google's docs checked 21 Oct 2026), nullable
// fields in the schema, a fallback model when one is not served, and per-model memory of
// refused features so the next call does not pay for the same refusal.
//
// Whether Gemma honours responseSchema on the API was unconfirmed on 21 Oct 2026, so every
// answer is parsed with parseModelJson (fences, chatter and cut-off answers survive), and
// when JSON mode is refused the schema is described in the prompt instead.

import { parseModelJson, schemaHint } from "../core/json.mjs";

export const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const RETRY_BACKOFF_MS = 2000;

/** @typedef {import("../core/tasks.mjs").Message} Message */
/** @typedef {{ json?: boolean, system?: boolean, thinking?: boolean }} Features */

/**
 * The request body.
 * @param {Message[]} messages
 * @param {{ schema?: any, maxTokens?: number, temperature?: number, features?: Features }} [opts]
 */
export function geminiBody(messages, { schema, maxTokens = 512, temperature = 0.2, features = {} } = {}) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const users = messages.filter((m) => m.role !== "system");
  let user = users.map((m) => m.content).join("\n\n");
  const images = users.flatMap((m) => m.images || []);
  // without JSON mode the model only knows the shape from the prompt
  if (features.json === false && schema) user += `\n\n${schemaHint(schema)}`;
  const useSystem = features.system !== false && !!system;
  const text = useSystem || !system ? user : `${system}\n\n${user}`;
  /** @type {any} */
  const body = {
    // images first, then the words about them (Google's recommended order)
    contents: [{ role: "user", parts: [...images.map((i) => ({ inlineData: { mimeType: i.mimeType, data: i.data } })), { text }] }],
    generationConfig: { temperature, maxOutputTokens: maxTokens },
  };
  if (useSystem) body.systemInstruction = { parts: [{ text: system }] };
  if (features.json !== false && schema) {
    body.generationConfig.responseMimeType = "application/json";
    body.generationConfig.responseSchema = toGeminiSchema(schema);
  }
  if (features.thinking !== false) body.generationConfig.thinkingConfig = { thinkingLevel: "minimal" };
  return body;
}

/**
 * JSON Schema to the OpenAPI subset the Gemini API takes: upper-case types, `nullable`
 * for ["x", "null"], enums as strings without null, no numeric bounds.
 * @param {any} s
 * @returns {any}
 */
export function toGeminiSchema(s) {
  if (!s || typeof s !== "object") return s;
  /** @type {any} */
  const out = {};
  const types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
  const main = types.find((/** @type {string} */ t) => t !== "null");
  if (main) out.type = String(main).toUpperCase();
  if (types.includes("null")) out.nullable = true;
  if (s.enum) out.enum = s.enum.filter((/** @type {any} */ e) => e !== null).map(String);
  if (s.description) out.description = s.description;
  if (s.properties) {
    out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
    out.propertyOrdering = Object.keys(s.properties);
  }
  if (s.required) out.required = s.required;
  if (s.items) out.items = toGeminiSchema(s.items);
  return out;
}

/** The answer's text (thought parts left out) and token counts. */
export function readGemini(json) {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((/** @type {any} */ p) => !p.thought && typeof p.text === "string").map((/** @type {any} */ p) => p.text).join("");
  const u = json?.usageMetadata || {};
  return { text, finish: json?.candidates?.[0]?.finishReason ?? null, promptTokens: u.promptTokenCount ?? null, outTokens: u.candidatesTokenCount ?? null };
}

/** Which feature a 400 error message complains about, or null. */
export function refusedFeature(message) {
  const m = String(message || "").toLowerCase();
  if (/json mode|response_?mime|response_?schema|responseschema|responsemimetype|structured output/.test(m)) return "json";
  if (/system.?instruction|developer instruction/.test(m)) return "system";
  if (/thinking/.test(m)) return "thinking";
  return null;
}

const transient = (/** @type {number} */ status, /** @type {string} */ body) => status >= 500 || status === 408 || (status === 404 && !String(body || "").trim());

/**
 * One generateContent call with a timeout, one retry for transient failures, and a retry
 * without any refused feature. Throws an Error with .status (0 for a timeout or a network
 * failure), .transient and .hint (plain words for the UI).
 * @param {{ key: string, model: string, messages: Message[], schema?: any, maxTokens?: number, temperature?: number,
 *           features?: Features, fetchImpl?: typeof fetch, base?: string, timeoutMs?: number, retries?: number, backoffMs?: number }} opts
 */
export async function geminiGenerate({ key, model, messages, schema, maxTokens, temperature, features = {}, fetchImpl = globalThis.fetch, base = GEMINI_BASE, timeoutMs = 25000, retries = 1, backoffMs = RETRY_BACKOFF_MS }) {
  const feats = { ...features };
  const t0 = Date.now();
  let attempts = 0;
  /** @type {any} */
  let lastErr = null;
  for (let tries = 0; tries < 6; tries++) {
    attempts++;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let res = null;
    let body = "";
    try {
      res = await fetchImpl(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(geminiBody(messages, { schema, maxTokens, temperature, features: feats })),
        signal: ctl.signal,
      });
      body = await res.text();
    } catch (e) {
      res = null;
      lastErr = Object.assign(new Error(ctl.signal.aborted ? `Gemma did not answer within ${Math.round(timeoutMs / 1000)} s.` : `Could not reach the Gemini API: ${/** @type {any} */ (e).message}`), { status: 0, transient: true, hint: "Gemma is slow or busy right now. Try again in a minute." });
    } finally {
      clearTimeout(timer);
    }
    if (res) {
      let json = null;
      try {
        json = JSON.parse(body);
      } catch {}
      if (res.ok) return { ...readGemini(json), model, wallSec: +((Date.now() - t0) / 1000).toFixed(2), features: feats, attempts };
      const message = json?.error?.message || body.slice(0, 200) || `HTTP ${res.status}`;
      const feature = res.status === 400 ? refusedFeature(message) : null;
      if (feature && feats[feature] !== false) {
        feats[feature] = false;
        tries--; // a refused feature is not a failed attempt
        attempts--;
        continue;
      }
      lastErr = new Error(`Gemini API ${res.status}: ${message}`);
      lastErr.status = res.status;
      lastErr.transient = transient(res.status, body);
      lastErr.hint =
        res.status === 429
          ? "The free Gemma quota is used up for the moment. Wait a minute and try again."
          : res.status === 400 && /api key/i.test(message)
            ? "The server's Gemini API key was not accepted."
            : res.status === 404 && !lastErr.transient
              ? `The model ${model} is not served right now.`
              : "Gemma is slow or busy right now. Try again in a minute.";
    }
    if (!lastErr.transient || attempts > retries) break;
    await new Promise((r) => setTimeout(r, backoffMs * attempts));
  }
  throw Object.assign(lastErr, { attempts, wallSec: +((Date.now() - t0) / 1000).toFixed(2) });
}

/**
 * @typedef {object} AiResult
 * @property {any} data       the parsed JSON answer, or null
 * @property {string} text
 * @property {string} model
 * @property {number} wallSec
 * @property {boolean} jsonMode  whether the model accepted JSON mode for this call
 * @property {{ promptTokens: number|null, outTokens: number|null, loadSec?: number|null, totalSec?: number|null }} [usage]  token counts, when the adapter knows them
 */
/**
 * @typedef {object} AiPort
 * @property {boolean} available
 * @property {string} model
 * @property {(req: { task?: string, messages: Message[], schema?: any, maxTokens?: number, temperature?: number }) => Promise<AiResult>} generate
 *   task names the prompt (for logs, and for the offline stand-in in fakes.mjs)
 */

/**
 * The AI port backed by the Gemini API. Tries the main model, then each fallback when a
 * model is not served (404) or keeps failing; remembers what each model refused.
 * @param {{ key: string, model: string, fallbacks?: string[], visionModel?: string, timeoutMs?: number, fetchImpl?: typeof fetch, base?: string }} cfg
 * @returns {AiPort}
 */
export function createGemini({ key, model, fallbacks = [], visionModel = "", timeoutMs = 25000, fetchImpl, base }) {
  /** @type {Map<string, Features>} */
  const learned = new Map();
  return {
    available: !!key,
    model,
    async generate({ messages, schema, maxTokens, temperature }) {
      if (!key) throw Object.assign(new Error("No GEMINI_API_KEY is set."), { status: 0, transient: false, hint: "Gemma is not set up on this server." });
      const hasImage = messages.some((m) => m.images?.length);
      const order = [...new Set([hasImage && visionModel ? visionModel : model, model, ...fallbacks])];
      /** @type {any} */
      let last = null;
      for (const m of order) {
        try {
          const r = await geminiGenerate({ key, model: m, messages, schema, maxTokens, temperature, features: learned.get(m) || {}, fetchImpl, base, timeoutMs });
          learned.set(m, r.features);
          return { data: parseModelJson(r.text), text: r.text, model: m, wallSec: r.wallSec, jsonMode: !!schema && r.features.json !== false };
        } catch (e) {
          last = e;
          // a bad key or a refused request will fail on every model; a busy or missing model may not
          if (/** @type {any} */ (e).status === 400 || /** @type {any} */ (e).status === 403) break;
        }
      }
      throw last;
    },
  };
}
