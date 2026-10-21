// @ts-check
// Curators' RSS feeds, fetched politely. Only a FeedSource's own `feed` URL is ever fetched
// (plus its host's robots.txt), never the publication's web pages, and:
//   - at most once a day per feed, whatever happens (a failure waits for tomorrow too);
//   - with an honest User-Agent and If-None-Match / If-Modified-Since;
//   - only while robots.txt allows the feed path for us (rechecked weekly; a robots.txt
//     that cannot be read means no fetch);
//   - the posts come back in memory only: the caller reads facts from them and drops them.
//     What is cached here is the feed's bookkeeping (when, ETag), never the text.

import { robotsAllows, parseRss } from "../core/feeds.mjs";
import { HttpError, fetchText, userAgent } from "./http.mjs";

/** @typedef {import("../core/feeds.mjs").FeedSource} FeedSource */
/** @typedef {import("../core/feeds.mjs").FeedItem} FeedItem */

export const FEED_MIN_GAP_MS = 24 * 3_600_000;
const ROBOTS_TTL_MS = 7 * 24 * 3_600_000;
const ROBOTS_RETRY_MS = 24 * 3_600_000;
/** The product token robots.txt groups are matched against. */
export const ROBOTS_AGENT = "ComeThrough";

/**
 * @param {{ cache: import("./http.mjs").Cache, contact: string, fetchImpl?: typeof fetch, now?: () => number, log?: (event: string, fields?: Record<string, any>) => void }} deps
 */
export function createFeeds({ cache, contact, fetchImpl = globalThis.fetch, now = Date.now, log = () => {} }) {
  const headers = { "user-agent": userAgent(contact), accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8" };

  /** Whether robots.txt lets us read this feed. Cached a week; unreadable means no. */
  async function robotsOk(/** @type {FeedSource} */ source) {
    const u = new URL(source.feed);
    const key = `robots:${u.host}`;
    let rec = await cache.get(key);
    if (!rec) {
      try {
        const r = await fetchText(`${u.origin}/robots.txt`, { headers, timeoutMs: 10000, maxBytes: 200_000, fetchImpl });
        rec = { text: r.text.slice(0, 50_000), ok: true };
        await cache.set(key, rec, ROBOTS_TTL_MS);
      } catch (e) {
        const status = /** @type {any} */ (e).status;
        // no robots.txt at all (a 404) allows everything; anything else is a "not now"
        rec = status === 404 || status === 410 ? { text: "", ok: true } : { text: "", ok: false };
        await cache.set(key, rec, rec.ok ? ROBOTS_TTL_MS : ROBOTS_RETRY_MS);
      }
    }
    return rec.ok && robotsAllows(rec.text, ROBOTS_AGENT, u.pathname + u.search);
  }

  /**
   * The feed's posts, if a day has passed since the last try. Otherwise (or on 304, a
   * robots refusal or an error) `items` is null and `reason` says why.
   * @param {FeedSource} source
   * @param {{ conditional?: boolean }} [opts]  false: ask for the whole feed even if it has not changed (a post's facts could not be read last time)
   * @returns {Promise<{ items: FeedItem[]|null, reason: "fetched"|"checked_today"|"not_modified"|"robots"|"error", checkedAt: string|null }>}
   */
  async function pull(source, { conditional = true } = {}) {
    const key = `feedstate:${source.id}`;
    /** @type {{ attemptAt?: string, okAt?: string, etag?: string, lastModified?: string }} */
    const state = (await cache.get(key)) || {};
    if (state.attemptAt && now() - Date.parse(state.attemptAt) < FEED_MIN_GAP_MS) return { items: null, reason: "checked_today", checkedAt: state.okAt ?? null };
    const next = { ...state, attemptAt: new Date(now()).toISOString() };
    await cache.set(key, next, 30 * 24 * 3_600_000);
    if (!(await robotsOk(source))) {
      log("feed_robots", { feed: source.id });
      return { items: null, reason: "robots", checkedAt: state.okAt ?? null };
    }
    /** @type {Record<string, string>} */
    const h = { ...headers };
    if (conditional && state.etag) h["if-none-match"] = state.etag;
    if (conditional && state.lastModified) h["if-modified-since"] = state.lastModified;
    try {
      const r = await fetchText(source.feed, { headers: h, timeoutMs: 20000, maxBytes: 3_000_000, fetchImpl });
      const items = parseRss(r.text);
      await cache.set(key, { ...next, okAt: next.attemptAt, etag: r.headers?.get?.("etag") || undefined, lastModified: r.headers?.get?.("last-modified") || undefined }, 30 * 24 * 3_600_000);
      log("feed_fetched", { feed: source.id, items: items.length, bytes: r.text.length });
      return { items, reason: "fetched", checkedAt: next.attemptAt };
    } catch (e) {
      if (e instanceof HttpError && e.status === 304) {
        await cache.set(key, { ...next, okAt: next.attemptAt }, 30 * 24 * 3_600_000);
        return { items: null, reason: "not_modified", checkedAt: next.attemptAt };
      }
      log("feed_error", { feed: source.id, message: String(/** @type {any} */ (e).message).slice(0, 160) });
      return { items: null, reason: "error", checkedAt: state.okAt ?? null };
    }
  }

  return { pull, robotsOk };
}

/** @typedef {ReturnType<typeof createFeeds>} FeedsPort */
