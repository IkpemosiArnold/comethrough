// @ts-check
// The LLM port: one shape for every Gemma task, the Gemini API by default or your own
// Ollama ("Run your own sloth"). Ollama is faked here; scripts/llm-check.mjs runs it live.
import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../src/config.mjs";
import { createLlm, describeLlm } from "../src/adapters/llm.mjs";
import { contextFor, createOllama, ollamaBody } from "../src/adapters/ollama.mjs";
import { EXPLAIN_SCHEMA } from "../src/core/tasks.mjs";

const msgs = [{ role: /** @type {const} */ ("system"), content: "You explain." }, { role: /** @type {const} */ ("user"), content: "Facts: {}" }];

/** A fake Ollama: /api/show with the given capabilities, /api/chat answering `answer`. */
function fakeOllama({ capabilities = ["completion"], answer = '{"why":"Freedom Park is fair."}', refuseSchema = false } = {}) {
  /** @type {{ url: string, body: any }[]} */
  const calls = [];
  /** @type {typeof fetch} */
  const f = async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(url), body });
    if (String(url).endsWith("/api/show")) return Response.json({ capabilities });
    if (refuseSchema && body?.format && typeof body.format === "object") return Response.json({ error: "invalid format: schema not supported" }, { status: 400 });
    return Response.json({ model: body.model, message: { role: "assistant", content: answer }, done: true, done_reason: "stop", prompt_eval_count: 40, eval_count: 12, total_duration: 3_500_000_000, load_duration: 200_000_000 });
  };
  return { f, calls };
}

test("config: LLM picks the adapter; Ollama has its own URL, model, vision setting and a long timeout", () => {
  const d = config({});
  assert.equal(d.llm, "gemini");
  assert.equal(describeLlm(d), "gemini:gemma-4-26b-a4b-it");
  const o = config({ LLM: "ollama", OLLAMA_URL: "http://gpu-box:11434/", OLLAMA_MODEL: "gemma3:12b", OLLAMA_VISION: "yes" });
  assert.equal(o.llm, "ollama");
  assert.deepEqual(o.ollama, { url: "http://gpu-box:11434", model: "gemma3:12b", vision: "yes", timeoutMs: 180000 });
  assert.equal(describeLlm(o), "ollama:gemma3:12b@http://gpu-box:11434");
  assert.equal(config({ LLM: "something" }).llm, "gemini");
});

test("ollama: chat with the task's schema as the JSON format, no streaming, and a context sized to the prompt", async () => {
  const { f, calls } = fakeOllama();
  const llm = createLlm({ ...config({ LLM: "ollama", OLLAMA_MODEL: "gemma3:4b" }) }, { fetchImpl: f });
  assert.equal(llm.provider, "ollama");
  const r = await llm.generate({ task: "explain-pick", messages: msgs, schema: EXPLAIN_SCHEMA, maxTokens: 200 });
  assert.deepEqual(r.data, { why: "Freedom Park is fair." });
  assert.equal(r.model, "gemma3:4b");
  assert.deepEqual(r.usage, { promptTokens: 40, outTokens: 12, loadSec: 0.2, totalSec: 3.5 });
  const body = calls[0].body;
  assert.equal(calls[0].url, "http://localhost:11434/api/chat");
  assert.equal(body.stream, false);
  assert.deepEqual(body.format, EXPLAIN_SCHEMA);
  assert.deepEqual(body.messages.map((/** @type {any} */ m) => m.role), ["system", "user"]);
  assert.equal(body.options.num_predict, 200);
  assert.equal(body.options.num_ctx, 4096);
  assert.equal(contextFor([{ role: "user", content: "x".repeat(30000) }], 3000), 16384, "a long weekly guide gets a bigger window");
});

test("ollama: a server that refuses the schema gets plain JSON mode, with the shape described in the prompt", async () => {
  const { f, calls } = fakeOllama({ refuseSchema: true });
  const llm = createOllama({ model: "gemma3:4b", fetchImpl: f });
  const r = await llm.generate({ messages: msgs, schema: EXPLAIN_SCHEMA });
  assert.deepEqual(r.data, { why: "Freedom Park is fair." });
  assert.equal(calls[1].body.format, "json");
  assert.match(calls[1].body.messages[1].content, /Answer with only this JSON/);
  await llm.generate({ messages: msgs, schema: EXPLAIN_SCHEMA });
  assert.equal(calls[2].body.format, "json", "remembered: no second refusal");
  assert.equal(ollamaBody({ model: "m", messages: msgs }).format, undefined, "no schema, no format");
});

test("ollama: a flyer needs a vision model; without one it is refused in plain words and nothing is sent", async () => {
  const image = { mimeType: "image/png", data: "iVBORw0KGgo=" };
  const withImage = [msgs[0], { ...msgs[1], images: [image] }];
  const text = fakeOllama({ capabilities: ["completion"] });
  const llm = createOllama({ model: "gemma3-4b-hf:latest", fetchImpl: text.f });
  assert.equal(await llm.vision(), false);
  await assert.rejects(llm.generate({ messages: withImage }), (e) => {
    const err = /** @type {any} */ (e);
    assert.equal(err.code, "no_vision");
    assert.match(err.hint, /^Reading a flyer needs a vision model, and this server runs gemma3-4b-hf:latest, which reads text only\./);
    return true;
  });
  assert.ok(!text.calls.some((c) => c.url.endsWith("/api/chat")), "no chat call");
  const vision = fakeOllama({ capabilities: ["completion", "vision"] });
  const v = createOllama({ model: "gemma3:4b", fetchImpl: vision.f });
  await v.generate({ messages: withImage });
  assert.deepEqual(vision.calls.at(-1)?.body.messages[1].images, ["iVBORw0KGgo="]);
  // OLLAMA_VISION overrides the check either way
  assert.equal(await createOllama({ model: "x", vision: "no", fetchImpl: vision.f }).vision(), false);
});

test("ollama: not running, or the model not pulled, gives plain hints the app can show", async () => {
  const down = createOllama({ model: "gemma3:4b", fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
  await assert.rejects(down.generate({ messages: msgs }), (e) => /Start Ollama/.test(/** @type {any} */ (e).hint));
  const missing = createOllama({ model: "gemma3:4b", fetchImpl: async () => Response.json({ error: "model 'gemma3:4b' not found" }, { status: 404 }) });
  await assert.rejects(missing.generate({ messages: msgs }), (e) => /ollama pull gemma3:4b/.test(/** @type {any} */ (e).hint));
});

test("gemini stays the default port, and says it reads images", async () => {
  const llm = createLlm(config({ GEMINI_API_KEY: "" }));
  assert.equal(llm.provider, "gemini");
  assert.equal(llm.available, false);
  assert.equal(await llm.vision(), true);
});
