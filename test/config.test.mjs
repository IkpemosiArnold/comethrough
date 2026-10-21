// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../src/config.mjs";

test("config: ALLOWED_ORIGINS wins, WEB_ORIGIN still works, and junk is dropped", () => {
  assert.deepEqual(config({ ALLOWED_ORIGINS: "https://a.example/, http://localhost:5173 ,nope, ftp://x.example" }).webOrigins, ["https://a.example", "http://localhost:5173"]);
  assert.deepEqual(config({ WEB_ORIGIN: "https://b.example" }).webOrigins, ["https://b.example"]);
  assert.deepEqual(config({ WEB_URL: "https://c.example/app" }).webOrigins, ["https://c.example"]);
  assert.deepEqual(config({}).webOrigins, []);
  assert.equal(config({ RENDER: "true" }).trustProxyHops, 3, "behind Render and Cloudflare by default");
  assert.equal(config({ RENDER: "true", TRUST_PROXY_HOPS: "2" }).trustProxyHops, 2);
  assert.equal(config({}).trustProxyHops, 0);
});
