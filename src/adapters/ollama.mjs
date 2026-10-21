// @ts-check
// Gemma on your own machine (or your own server) through Ollama's HTTP API, as an AI port
// with the same shape as the Gemini one (./gemini.mjs). "Run your own sloth": open weights
// mean no lock-in, no bill, and the crew's sentences never leave the machine.
//
// What it does:
//   - POST /api/chat with stream off, the system and user messages, and JSON mode: the
//     task's JSON schema as `format` (Ollama 0.5 and later turn it into a grammar), or
//     plain `"json"` with the schema described in the prompt when a server refuses it.
//   - a context window sized to the prompt (Ollama's default is small, and a long weekly
//     guide would be cut off silently), and a long timeout: a 4B model on a laptop is slow.
//   - images only when the model has a vision projector. Ollama's /api/show lists a
//     model's capabilities ("vision"); OLLAMA_VISION=yes|no overrides the check. Without
//     vision, a flyer is refused with plain words, never sent and silently ignored.
//
// Every answer is parsed with parseModelJson (fences, chatter and cut-off answers survive).

import { parseModelJson, schemaHint } from "../core/json.mjs";

/** @typedef {import("../core/tasks.mjs").Message} Message */
/** @typedef {import("./gemini.mjs").AiPort} AiPort */

export const OLLAMA_DEFAULT_URL = "http://localhost:11434";

/** Rough tokens for a text (about 3.5 characters a token for English; rounded up). */
const tokensOf = (/** @type {string} */ s) => Math.ceil(s.length / 3.2);

/**
 * The context window for a request: the prompt plus the answer, with room to spare,
 * rounded up to a power of two between 4096 and 32768.
 * @param {Message[]} messages
 * @param {number} maxTokens
 */
export function contextFor(messages, maxTokens) {
  const need = messages.reduce((n, m) => n + tokensOf(m.content) + 8, 0) + maxTokens + 256;
  let ctx = 4096;
  while (ctx < need && ctx < 32768) ctx *= 2;
  return ctx;
}

/**
 * The /api/chat request body.
 * @param {{ model: string, messages: Message[], schema?: any, maxTokens?: number, temperature?: number, schemaFormat?: boolean, keepAlive?: string }} opts
 */
export function ollamaBody({ model, messages, schema, maxTokens = 512, temperature = 0.2, schemaFormat = true, keepAlive = "10m" }) {
  const msgs = messages.map((m, i) => {
    const last = i === messages.length - 1;
    // without the schema as a grammar the model only knows the shape from the prompt
    const content = last && schema && !schemaFormat ? `${m.content}\n\n${schemaHint(schema)}` : m.content;
    return { role: m.role, content, ...(m.images?.length ? { images: m.images.map((x) => x.data) } : {}) };
  });
  /** @type {any} */
  const body = {
    model,
    messages: msgs,
    stream: false,
    keep_alive: keepAlive,
    options: { temperature, num_predict: maxTokens, num_ctx: contextFor(messages, maxTokens) },
  };
  if (schema) body.format = schemaFormat ? schema : "json";
  return body;
}

/** The answer's text, and timings in seconds (Ollama reports nanoseconds). */
export function readOllama(json) {
  const ns = (/** @type {any} */ v) => (Number.isFinite(v) ? +(v / 1e9).toFixed(2) : null);
  return {
    text: typeof json?.message?.content === "string" ? json.message.content : typeof json?.response === "string" ? json.response : "",
    promptTokens: json?.prompt_eval_count ?? null,
    outTokens: json?.eval_count ?? null,
    loadSec: ns(json?.load_duration),
    totalSec: ns(json?.total_duration),
    finish: json?.done_reason ?? null,
  };
}

/**
 * The AI port backed by Ollama.
 * @param {{ url?: string, model: string, vision?: "auto"|"yes"|"no", timeoutMs?: number, fetchImpl?: typeof fetch }} cfg
 * @returns {AiPort & { provider: "ollama", vision: () => Promise<boolean> }}
 */
export function createOllama({ url = OLLAMA_DEFAULT_URL, model, vision = "auto", timeoutMs = 180_000, fetchImpl = globalThis.fetch }) {
  const base = url.replace(/\/+$/, "");
  /** @type {Promise<boolean>|null} */
  let visionCheck = null;
  /** whether this server took the schema as `format` (null until the first call with a schema) */
  /** @type {boolean|null} */
  let schemaOk = null;

  /** Whether the model reads images: OLLAMA_VISION, else what /api/show says. */
  const hasVision = () => {
    if (vision === "yes") return Promise.resolve(true);
    if (vision === "no") return Promise.resolve(false);
    if (!visionCheck) {
      visionCheck = (async () => {
        try {
          const r = await fetchImpl(`${base}/api/show`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model }) });
          if (!r.ok) return false;
          const j = await r.json();
          return Array.isArray(j?.capabilities) ? j.capabilities.includes("vision") : !!j?.projector_info;
        } catch {
          visionCheck = null; // the server may come up later; ask again next time
          return false;
        }
      })();
    }
    return visionCheck;
  };

  /** @param {any} body */
  async function post(body) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {}
      return { ok: res.ok, status: res.status, json, text };
    } catch (e) {
      throw Object.assign(
        new Error(ctl.signal.aborted ? `${model} did not answer within ${Math.round(timeoutMs / 1000)} s.` : `Could not reach Ollama at ${base}: ${/** @type {any} */ (e).message}`),
        { status: 0, transient: true, hint: ctl.signal.aborted ? "The local model is slow right now. Try again in a minute." : "The local model is not running. Start Ollama and try again." },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    provider: "ollama",
    available: !!model,
    model,
    vision: hasVision,
    async generate({ messages, schema, maxTokens = 512, temperature = 0.2 }) {
      const t0 = Date.now();
      if (messages.some((m) => m.images?.length) && !(await hasVision())) {
        throw Object.assign(new Error(`${model} has no vision projector`), {
          status: 0,
          transient: false,
          code: "no_vision",
          hint: `Reading a flyer needs a vision model, and this server runs ${model}, which reads text only. Type the plan or paste the link instead.`,
        });
      }
      let useSchema = schemaOk !== false;
      let r = await post(ollamaBody({ model, messages, schema, maxTokens, temperature, schemaFormat: useSchema }));
      // an older server, or a schema its grammar converter cannot take: plain JSON mode
      if (!r.ok && schema && useSchema && r.status >= 400 && r.status < 500 && /format|schema|grammar|json/i.test(r.text)) {
        schemaOk = false;
        useSchema = false;
        r = await post(ollamaBody({ model, messages, schema, maxTokens, temperature, schemaFormat: false }));
      }
      if (!r.ok) {
        const message = r.json?.error || r.text.slice(0, 200) || `HTTP ${r.status}`;
        throw Object.assign(new Error(`Ollama ${r.status}: ${message}`), {
          status: r.status,
          transient: r.status >= 500,
          hint: r.status === 404 ? `The model ${model} is not installed. Run: ollama pull ${model}` : "The local model is busy right now. Try again in a minute.",
        });
      }
      if (schema && useSchema) schemaOk = true;
      const out = readOllama(r.json);
      return { data: parseModelJson(out.text), text: out.text, model, wallSec: +((Date.now() - t0) / 1000).toFixed(2), jsonMode: !!schema, usage: { promptTokens: out.promptTokens, outTokens: out.outTokens, loadSec: out.loadSec, totalSec: out.totalSec } };
    },
  };
}
