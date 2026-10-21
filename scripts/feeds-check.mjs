// @ts-check
// A live check of the curated guides for "The sloth has 3 ideas": fetch each Lagos guide's
// RSS feed once (robots.txt first, the honest User-Agent), read the newest post's events
// with Gemma through the LLM port, and print what the checks kept and dropped, and how many
// are still to come today. Nothing is saved: the cache is in memory, and only the facts
// (names, dates, times, venues, prices, links) are printed, never the posts' prose.
//
// Run:  node scripts/feeds-check.mjs            (LLM=ollama to use your own model)
//       FEEDS_DIR=/some/dir node scripts/feeds-check.mjs   reads <id>.xml copies saved earlier
//       today instead of fetching again (the feeds are fetched at most once a day)

import fs from "node:fs";
import path from "node:path";
import { config, loadDotEnv } from "../src/config.mjs";
import { createFeeds } from "../src/adapters/feeds.mjs";
import { memoryCache } from "../src/adapters/http.mjs";
import { createLlm, describeLlm } from "../src/adapters/llm.mjs";
import { loadPrompts } from "../src/app/prompts.mjs";
import { EVENTS_MAX_TOKENS, EVENTS_SCHEMA, eventsMessages, parseRss, postText, readEvents, upcomingDates } from "../src/core/feeds.mjs";
import { localisePrompt } from "../src/core/tasks.mjs";
import { localParts } from "../src/core/time.mjs";
import { LAGOS, LAGOS_REGION } from "../src/packs/index.mjs";
import { feedsFor } from "../src/packs/sources.mjs";

loadDotEnv();
const cfg = config();
const llm = createLlm(cfg);
const feeds = createFeeds({ cache: memoryCache(), contact: cfg.contact });
const prompt = localisePrompt(loadPrompts()["extract-events"], LAGOS.local(LAGOS_REGION));
const now = localParts(Date.now(), "Africa/Lagos");
/** @type {any} */
const report = { at: new Date().toISOString(), llm: describeLlm(cfg), today: now.date, guides: [] };

for (const source of feedsFor(LAGOS)) {
  const t0 = performance.now();
  const saved = process.env.FEEDS_DIR ? path.join(process.env.FEEDS_DIR, `${source.id}.xml`) : null;
  const got = saved ? { items: parseRss(fs.readFileSync(saved, "utf8")), reason: `read ${path.basename(saved)}` } : await feeds.pull(source);
  const g = /** @type {any} */ ({ name: source.name, feed: source.feed, fetch: got.reason, fetchMs: Math.round(performance.now() - t0) });
  report.guides.push(g);
  if (!got.items?.length) continue;
  g.items = got.items.length;
  const item = got.items[0];
  g.post = { title: item.title, link: item.link, published: item.published };
  const { text, links } = postText(item.html, { ownHost: new URL(item.link).host });
  g.textChars = text.length;
  g.links = links.length;
  // read as of the post's own day, to measure the reading; then count what is still to come today
  const asOf = item.published ? item.published.slice(0, 10) : now.date;
  const t1 = performance.now();
  try {
    const r = await llm.generate({ task: "extract-events", messages: eventsMessages(prompt, { source, item, text, today: asOf }), schema: EVENTS_SCHEMA, maxTokens: EVENTS_MAX_TOKENS, temperature: 0.1, timeoutMs: 120_000 });
    g.gemmaSec = +((performance.now() - t1) / 1000).toFixed(1);
    g.model = r.model;
    const { events, dropped } = readEvents(r.data, { source, item, text, links });
    g.modelListed = Array.isArray(r.data?.events) ? r.data.events.length : 0;
    g.kept = events.map((e) => ({ title: e.title, dates: e.dates, start: e.start, venue: e.venue, price: e.price?.text ?? null, ticket: e.ticketUrl ? new URL(e.ticketUrl).host : null }));
    g.dropped = dropped;
    g.stillToComeToday = events.filter((e) => upcomingDates(e, now.date, now.time).length).length;
  } catch (e) {
    g.gemmaSec = +((performance.now() - t1) / 1000).toFixed(1);
    g.error = String(/** @type {any} */ (e).message).slice(0, 200);
  }
}
console.log(JSON.stringify(report, null, 2));
