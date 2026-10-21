// @ts-check
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createGemini, geminiBody, geminiGenerate, toGeminiSchema } from "../src/adapters/gemini.mjs";
import { createGeocoder, readNominatim, readPhoton } from "../src/adapters/geocode.mjs";
import { cached, fetchText, layeredCache, memoryCache, storeCache, throttle } from "../src/adapters/http.mjs";
import { forecastUrl } from "../src/adapters/openmeteo.mjs";
import { createOverpass, greenQuery, readOverpass } from "../src/adapters/overpass.mjs";
import { createPageMeta, vetHost } from "../src/adapters/pagemeta.mjs";
import { fileStore, memoryStore } from "../src/adapters/store.mjs";
import { isSubscription } from "../src/adapters/push.mjs";
import { PLAN_SCHEMA } from "../src/core/tasks.mjs";
import { checkUrl, isPublicIp } from "../src/core/netguard.mjs";
import { parseHtmlMeta } from "../src/core/htmlmeta.mjs";

/** A fetch that answers from a list of [status, body] in order and records requests. */
function scripted(/** @type {[number, any][]} */ answers) {
  /** @type {{ url: string, init: any }[]} */
  const calls = [];
  const f = async (/** @type {any} */ url, /** @type {any} */ init) => {
    calls.push({ url: String(url), init });
    const [status, body] = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (status === 0) throw new Error("ECONNRESET");
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return Object.assign(f, { calls });
}
const noSleep = async () => {};
const ok = (/** @type {string} */ text) => ({ candidates: [{ content: { parts: [{ text: "thinking...", thought: true }, { text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } });

test("gemini: body with images, system, JSON mode and nullable schema", () => {
  const body = geminiBody([{ role: "system", content: "sys" }, { role: "user", content: "read this", images: [{ mimeType: "image/png", data: "AAA" }] }], { schema: PLAN_SCHEMA });
  assert.deepEqual(body.contents[0].parts, [{ inlineData: { mimeType: "image/png", data: "AAA" } }, { text: "read this" }]);
  assert.equal(body.systemInstruction.parts[0].text, "sys");
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  const s = toGeminiSchema(PLAN_SCHEMA);
  assert.deepEqual(s.properties.date, { type: "STRING", nullable: true, description: "YYYY-MM-DD" });
  assert.deepEqual(s.properties.kind.enum, ["found", "hosted", "quick"]);
  assert.equal(s.properties.confidence.properties.title.minimum, undefined, "no numeric bounds on the API");
  const plain = geminiBody([{ role: "system", content: "sys" }, { role: "user", content: "u" }], { schema: PLAN_SCHEMA, features: { json: false, system: false } });
  assert.match(plain.contents[0].parts[0].text, /^sys\n\nu\n\nAnswer with only this JSON/);
  assert.equal(plain.generationConfig.responseSchema, undefined);
});

test("gemini: a refused JSON mode is retried without it, and thoughts are skipped", async () => {
  const f = scripted([[400, { error: { message: "JSON mode is not enabled for models/gemma-4-26b-a4b-it" } }], [200, ok('```json\n{"title": "Wine"}\n```')]]);
  const r = await geminiGenerate({ key: "k", model: "gemma-4-26b-a4b-it", messages: [{ role: "user", content: "x" }], schema: { type: "object" }, fetchImpl: f, backoffMs: 0 });
  assert.equal(r.text, '```json\n{"title": "Wine"}\n```');
  assert.equal(r.features.json, false);
  assert.equal(f.calls.length, 2);
  assert.equal(JSON.parse(f.calls[1].init.body).generationConfig.responseMimeType, undefined);
  assert.equal(f.calls[0].init.headers["x-goog-api-key"], "k");
});

test("gemini port: falls back to the next model, remembers refusals, parses salvaged JSON", async () => {
  const f = scripted([[404, { error: { message: "models/a is not found" } }], [200, ok('{"title": "Wine", "bring": ["a bot')]]);
  const ai = createGemini({ key: "k", model: "a", fallbacks: ["b"], fetchImpl: f });
  const r = await ai.generate({ messages: [{ role: "user", content: "x" }], schema: { type: "object" } });
  assert.equal(r.model, "b");
  assert.deepEqual(r.data, { title: "Wine", bring: ["a bot"] });
  assert.ok(f.calls[0].url.includes("/models/a:generateContent"));
  assert.ok(f.calls[1].url.includes("/models/b:generateContent"));
  const bad = createGemini({ key: "k", model: "a", fallbacks: ["b"], fetchImpl: scripted([[400, { error: { message: "API key not valid" } }]]) });
  await assert.rejects(bad.generate({ messages: [{ role: "user", content: "x" }] }), (e) => /** @type {any} */ (e).hint.includes("key"));
  await assert.rejects(createGemini({ key: "", model: "a" }).generate({ messages: [] }), /GEMINI_API_KEY/);
});

test("gemini: a 429 is not retried on every model blindly but surfaces a plain hint", async () => {
  const f = scripted([[429, { error: { message: "quota" } }]]);
  await assert.rejects(geminiGenerate({ key: "k", model: "a", messages: [{ role: "user", content: "x" }], fetchImpl: f, backoffMs: 0 }), (e) => /quota/.test(/** @type {any} */ (e).hint));
});

test("http: retries a busy service with backoff, then succeeds; refuses oversize bodies", async () => {
  const f = scripted([[502, "at capacity"], [503, "busy"], [200, '{"ok":1}']]);
  /** @type {number[]} */
  const waits = [];
  const r = await fetchText("https://x.test/a", { retries: 2, backoffMs: 100, fetchImpl: f, sleep: async (ms) => waits.push(ms) });
  assert.equal(r.text, '{"ok":1}');
  assert.deepEqual(waits, [100, 200]);
  await assert.rejects(fetchText("https://x.test/a", { fetchImpl: scripted([[404, "no"]]), retries: 3 }), (e) => /** @type {any} */ (e).status === 404);
  await assert.rejects(fetchText("https://x.test/a", { fetchImpl: scripted([[200, "x".repeat(100)]]), maxBytes: 10 }), /larger than 10 bytes/);
});

test("http: throttle spaces calls; caches expire; concurrent misses share one computation", async () => {
  let t = 0;
  /** @type {number[]} */
  const starts = [];
  const gate = throttle(1000, { now: () => t, sleep: async (ms) => (t += ms) });
  await Promise.all([1, 2, 3].map(() => gate(async () => starts.push(t))));
  assert.deepEqual(starts, [0, 1000, 2000]);
  let now = 0;
  const c = memoryCache({ now: () => now, max: 2 });
  await c.set("a", 1, 100);
  assert.equal(await c.get("a"), 1);
  now = 101;
  assert.equal(await c.get("a"), undefined);
  let n = 0;
  const slow = memoryCache();
  const [x, y] = await Promise.all([cached(slow, "k", 1000, async () => ++n), cached(slow, "k", 1000, async () => ++n)]);
  assert.deepEqual([x, y, n], [1, 1, 1]);
  const store = memoryStore();
  const layered = layeredCache(memoryCache(), storeCache(store));
  await layered.set("geo:x", { lat: 1 }, 60_000);
  assert.deepEqual(await layeredCache(memoryCache(), storeCache(store)).get("geo:x"), { lat: 1 }, "survives a restart through the store");
});

test("geocoding: Photon and Nominatim answers, Lagos bias, caching", async () => {
  const photon = { features: [
    { geometry: { coordinates: [3.3711, 6.5095] }, properties: { name: "Yaba", countrycode: "NG", city: "Lagos", state: "Lagos State", osm_type: "R", osm_id: 3720729 } },
    { geometry: { coordinates: [-0.1, 51.5] }, properties: { name: "Yaba", countrycode: "GB" } },
  ] };
  assert.deepEqual(readPhoton(photon), [{ label: "Yaba", detail: "Lagos, Lagos State", lat: 6.5095, lon: 3.3711, osm: { type: "relation", id: 3720729 } }]);
  assert.deepEqual(readNominatim([{ display_name: "Yaba, Lagos Mainland, Lagos, Nigeria", name: "Yaba", lat: "6.5095", lon: "3.3711", osm_type: "relation", osm_id: 1 }])[0].detail, "Lagos Mainland, Lagos, Nigeria");
  const f = scripted([[200, photon]]);
  const geo = createGeocoder({ provider: "photon", photonUrl: "https://photon.test", nominatimUrl: "", countryCodes: "ng", contact: "test", cache: memoryCache(), fetchImpl: f });
  const r = await geo.lookup("Yaba");
  assert.equal(r?.label, "Yaba");
  await geo.lookup("yaba");
  assert.equal(f.calls.length, 1, "cached");
  const u = new URL(f.calls[0].url);
  assert.equal(u.searchParams.get("q"), "yaba, lagos");
  assert.equal(u.searchParams.get("lat"), "6.52");
  assert.match(f.calls[0].init.headers["user-agent"], /^ComeThrough\/0\.1 \(\+test\)$/);
  assert.deepEqual(await geo.search("y"), [], "too short to search");
});

test("overpass: a bounded named-green query, failover between endpoints, unnamed and private skipped", async () => {
  const q = greenQuery({ lat: 6.4785, lon: 3.4217 }, 5000);
  assert.match(q, /^\[out:json\]\[timeout:25\];/);
  assert.match(q, /nwr\(around:5000,6\.47850,3\.42170\)\["leisure"~"\^\(park\|garden\|recreation_ground\)\$"\]\["name"\];/);
  assert.match(q, /\["natural"~"\^\(beach\)\$"\]/);
  assert.match(q, /out center tags 150;$/);
  const json = { elements: [
    { type: "way", id: 1, center: { lat: 6.45, lon: 3.4 }, tags: { name: "Freedom Park", leisure: "park", fee: "yes", junk: "x" } },
    { type: "way", id: 2, center: { lat: 6.45, lon: 3.4 }, tags: { landuse: "grass" } },
    { type: "node", id: 3, lat: 6.44, lon: 3.45, tags: { name: "Oniru Private Beach", natural: "beach", access: "private" } },
  ] };
  assert.deepEqual(readOverpass(json), [{ name: "Freedom Park", lat: 6.45, lon: 3.4, osm: { type: "way", id: 1, tags: { name: "Freedom Park", leisure: "park", fee: "yes" } } }]);
  const f = scripted([[502, "at capacity"], [0, "hung"], [200, json]]);
  const op = createOverpass({ urls: ["https://a.test/api", "https://b.test/api", "https://c.test/api"], contact: "t", cache: memoryCache(), fetchImpl: f, sleep: noSleep });
  const r = await op.greenNear({ lat: 6.4785, lon: 3.4217 }, 5000);
  assert.equal(r.length, 1);
  assert.deepEqual(f.calls.map((c) => new URL(c.url).host), ["a.test", "b.test", "c.test"], "one attempt each, then the next endpoint");
  await op.greenNear({ lat: 6.4785, lon: 3.4217 }, 5000);
  assert.equal(f.calls.length, 3, "cached");
  const all = createOverpass({ urls: ["https://a.test/api"], contact: "t", cache: memoryCache(), fetchImpl: scripted([[504, "busy"]]) });
  await assert.rejects(all.greenNear({ lat: 6.4, lon: 3.4 }, 5000), /answered 504/);
  assert.match(decodeURIComponent(f.calls[0].init.body), /^data=\[out:json\]/);
});

test("open-meteo: the forecast URL asks for the hours we read, in Lagos time", () => {
  const u = new URL(forecastUrl("https://api.open-meteo.com/v1/forecast", { lat: 6.4785, lon: 3.4217 }));
  assert.equal(u.searchParams.get("hourly"), "precipitation_probability,apparent_temperature,uv_index,precipitation,temperature_2m");
  assert.equal(u.searchParams.get("timezone"), "Africa/Lagos");
  assert.equal(u.searchParams.get("latitude"), "6.479");
});

test("SSRF guard: private, loopback, metadata and disguised addresses are refused", async () => {
  for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.3.4", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1", "2002:a00:1::1", "256.1.1.1", "nonsense"]) {
    assert.equal(isPublicIp(ip), false, ip);
  }
  for (const ip of ["8.8.8.8", "102.89.32.1", "2a00:1450:4001:80b::200e", "::ffff:8.8.8.8"]) assert.equal(isPublicIp(ip), true, ip);
  for (const u of ["http://localhost/", "http://127.0.0.1/", "http://[::1]/", "file:///etc/passwd", "http://user:pw@example.com/", "http://example.com:8080/", "http://printer.local/", "gopher://x"]) {
    assert.equal(checkUrl(u).ok, false, u);
  }
  assert.equal(checkUrl("https://tix.africa/events/x").ok, true);
  // DNS answers are all checked: one private address among public ones is refused (rebinding)
  await assert.rejects(vetHost("evil.test", async () => [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }]), /private network/);
  const pm = createPageMeta({ contact: "t", resolve: async () => [{ address: "127.0.0.1", family: 4 }] });
  await assert.rejects(pm.fetchPage("https://looks-public.test/x"), /private network/);
  const ig = await pm.fetchPage("https://www.instagram.com/p/abc/");
  assert.equal(ig.meta, null);
  assert.match(/** @type {string} */ (ig.note), /screenshot/);
});

test("page meta: a real fetch pinned to the vetted address, with redirects, size and type limits", async () => {
  const html = `<!doctype html><html><head><title>Fallback</title>
    <meta property="og:title" content="Afrobeats Night &amp; Friends">
    <meta property="og:image" content="/flyer.jpg">
    <meta name="description" content="Live band, Saturday 31 Oct">
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"MusicEvent","name":"Afrobeats Night","startDate":"2026-10-31T20:00:00+01:00","location":{"@type":"Place","name":"Hard Rock Cafe","address":{"streetAddress":"Landmark Village","addressLocality":"Lagos"}},"offers":{"price":"10000","priceCurrency":"NGN"}}]}</script>
    </head><body><script>var x=1</script><h1>Afrobeats Night</h1><p>Doors 8pm</p></body></html>`;
  const server = http.createServer((req, res) => {
    if (req.url === "/go") return res.writeHead(302, { location: "/page" }).end();
    if (req.url === "/loop") return res.writeHead(302, { location: "/loop" }).end();
    if (req.url === "/page") return res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
    if (req.url === "/img.png") return res.writeHead(200, { "content-type": "image/png" }).end(Buffer.from([137, 80, 78, 71]));
    if (req.url === "/big") return res.writeHead(200, { "content-type": "text/html" }).end(`<title>Big</title>${"x".repeat(2_000_000)}`);
    res.writeHead(200, { "content-type": "application/pdf" }).end("%PDF");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(null)));
  const port = /** @type {any} */ (server.address()).port;
  try {
    // the host name resolves to the local server; the test loosens only the address rule
    const pm = createPageMeta({ contact: "t", resolve: async () => [{ address: "127.0.0.1", family: 4 }], allowAddress: () => true, checkUrlImpl: (u) => ({ ok: true, url: new URL(u) }) });
    const base = `http://events.test:${port}`;
    const r = await pm.fetchPage(`${base}/go`);
    assert.equal(r.meta?.title, "Afrobeats Night & Friends");
    assert.equal(r.meta?.image, `${base}/flyer.jpg`);
    assert.equal(r.meta?.event?.startDate, "2026-10-31T20:00:00+01:00");
    assert.equal(r.meta?.event?.venue, "Hard Rock Cafe");
    assert.equal(r.meta?.event?.address, "Landmark Village, Lagos");
    assert.equal(r.meta?.event?.price, "\u20a610,000");
    assert.ok(!r.meta?.text?.includes("var x"), "scripts are not text");
    const img = await pm.fetchPage(`${base}/img.png`);
    assert.equal(img.image?.mimeType, "image/png");
    await assert.rejects(pm.fetchPage(`${base}/loop`), /redirects too many times/);
    await assert.rejects(pm.fetchPage(`${base}/doc.pdf`), /not a web page or an image/);
    const big = await pm.fetchPage(`${base}/big`);
    assert.equal(big.meta?.title, "Big", "a huge page is cut, not loaded whole");
  } finally {
    server.close();
  }
});

test("html meta fallbacks", () => {
  const m = parseHtmlMeta("<title>Suya &#8211; night</title><meta name='description' content='Free'>", "https://x.test/");
  assert.equal(m.title, "Suya – night");
  assert.equal(m.description, "Free");
  assert.equal(m.event, null);
});

test("stores: memory and file behave the same, and files survive a reopen", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "comethrough-"));
  for (const open of [async () => memoryStore(), () => fileStore(dir)]) {
    const s = await open();
    await s.put("crews", { id: "c1", slug: "uni", n: 1 });
    await s.put("crews", { id: "c2", slug: "work", n: 2 });
    assert.deepEqual(await s.get("crews", "c1"), { id: "c1", slug: "uni", n: 1 });
    assert.deepEqual((await s.findOne("crews", { slug: "work" }))?.id, "c2");
    assert.equal((await s.find("crews")).length, 2);
    assert.equal((await s.find("crews", {}, { limit: 1 })).length, 1);
    const got = await s.get("crews", "c1");
    got.n = 99;
    assert.equal((await s.get("crews", "c1")).n, 1, "reads are copies");
    assert.equal(await s.delete("crews", "c2"), true);
    assert.equal(await s.get("crews", "nope"), null);
    await assert.rejects(s.put("crews", /** @type {any} */ ({ slug: "x" })), /string id/);
    await s.close();
  }
  const again = await fileStore(dir);
  assert.deepEqual(await again.get("crews", "c1"), { id: "c1", slug: "uni", n: 1 });
  assert.equal(await again.get("crews", "c2"), null);
  await fs.rm(dir, { recursive: true });
});

test("push subscriptions are checked before they are stored", () => {
  assert.ok(isSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "BN...", auth: "xyz" } }));
  assert.ok(!isSubscription({ endpoint: "http://evil.test", keys: { p256dh: "a", auth: "b" } }));
  assert.ok(!isSubscription({ endpoint: "https://x.test" }));
});
