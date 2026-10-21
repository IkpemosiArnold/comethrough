// @ts-check
// A live run of "The sloth has 3 ideas" for a made-up Lagos crew (Yaba, Lekki Phase 1,
// Surulere; "outside and music", cheap), with the real places pipeline (Overpass, the
// curated spots), the real forecast (Open-Meteo) and Gemma through the LLM port. Nothing is
// saved: the store and the cache are in memory.
//
// Run:  node scripts/ideas-check.mjs [tonight|weekend]
//       FEEDS_DIR=/some/dir ...   reads <id>.xml copies of the guides saved earlier today
//       LLM=ollama ...            ranks with your own model

import fs from "node:fs";
import path from "node:path";
import { config, loadDotEnv } from "../src/config.mjs";
import { createIdeas } from "../src/app/ideas.mjs";
import { createService } from "../src/app/service.mjs";
import { makeIds } from "../src/app/ids.mjs";
import { createFeeds } from "../src/adapters/feeds.mjs";
import { fakePageMeta, fakePush } from "../src/adapters/fakes.mjs";
import { createGeocoder } from "../src/adapters/geocode.mjs";
import { memoryCache } from "../src/adapters/http.mjs";
import { createLlm, describeLlm } from "../src/adapters/llm.mjs";
import { createOpenMeteo } from "../src/adapters/openmeteo.mjs";
import { createOverpass } from "../src/adapters/overpass.mjs";
import { memoryStore } from "../src/adapters/store.mjs";
import { loadPrompts } from "../src/app/prompts.mjs";
import { parseRss } from "../src/core/feeds.mjs";
import { withEntries } from "../src/core/places.mjs";
import { LAGOS, LAGOS_REGION } from "../src/packs/index.mjs";

loadDotEnv();
const cfg = config();
const when = process.argv[2] === "tonight" ? "tonight" : "weekend";
const cache = memoryCache();
const store = memoryStore();
const ai = createLlm(cfg);
const geocoder = createGeocoder({ ...cfg.geocoder, contact: cfg.contact, cache });
const weather = createOpenMeteo({ url: cfg.openMeteoUrl, cache });
const places = createOverpass({ urls: cfg.overpassUrls, contact: cfg.contact, cache });
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const fees = JSON.parse(fs.readFileSync(path.join(root, "data/spot-entry-fees.json"), "utf8")).fees;
const spots = withEntries(JSON.parse(fs.readFileSync(path.join(root, "data/lagos-spots.json"), "utf8")).spots, fees);
const prompts = loadPrompts();
const now = Date.now;
const service = createService({ store, ai, geocoder, places, weather, pages: fakePageMeta(), push: fakePush({ enabled: false }), spots, prompts, ids: makeIds(), now, cfg });
const dir = process.env.FEEDS_DIR;
/** @type {any} */
const feeds = dir
  ? { async pull(/** @type {any} */ s) { return { items: parseRss(fs.readFileSync(path.join(dir, `${s.id}.xml`), "utf8")), reason: "fetched", checkedAt: new Date().toISOString() }; } }
  : createFeeds({ cache, contact: cfg.contact });
/** @type {string[]} */
const logs = [];
const ideas = createIdeas({ store, cache, ai, feeds, weather, geocoder, candidatesNear: service._internal.candidatesNear, spots, prompts, now, log: (e, f) => logs.push(JSON.stringify({ e, ...f })) });

const crew = {
  id: "c_check", slug: "check-crew", name: "Check crew", vibe: "outside and music", vibeTags: ["outside", "music"], budget: "cheap", rhythm: null,
  areas: [{ label: "Yaba", lat: 6.5095, lon: 3.3711 }, { label: "Lekki Phase 1", lat: 6.4474, lon: 3.4723 }, { label: "Surulere", lat: 6.5, lon: 3.35 }],
  tz: "Africa/Lagos", createdAt: new Date().toISOString(), inviteToken: "inv_check",
  region: { center: { lat: 6.4856, lon: 3.3978 }, countryCode: "NG", city: "Lagos", timezone: "Africa/Lagos", tzSource: "open-meteo" },
};
await store.put("crews", crew);
// as after the heartbeat: the guides read first (at most once a day each)
const r0 = performance.now();
await ideas.refreshAll([{ pack: LAGOS, region: LAGOS_REGION }]);
const refreshSec = +((performance.now() - r0) / 1000).toFixed(1);
const t0 = performance.now();
const card = await ideas.getIdeas({ slug: crew.slug, token: crew.inviteToken, when });
const sec = +((performance.now() - t0) / 1000).toFixed(1);
console.log(JSON.stringify({
  llm: describeLlm(cfg), when, refreshSec, sec, by: card.by, notes: card.notes, slot: card.slot,
  ideas: card.ideas.map((i) => ({ kind: i.kind, title: i.title, when: i.when, place: i.place.name, price: i.price?.text ?? null, why: i.why, by: i.by, source: i.source ?? null, longest: i.travel?.longestMinutes ?? null, weather: i.weather?.text ?? null })),
  log: logs.filter((l) => /gemma|feed_read|ideas|error/.test(l)),
}, null, 2));
