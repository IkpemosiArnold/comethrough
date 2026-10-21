// @ts-check
// Extra idea sources a city pack brings, kept beside the packs rather than inside them so a
// pack's core shape stays as it is. Today: the Lagos pack's curated weekly guides (RSS).
// Every other city gets the global sources only (open-data places and the crew's own
// history). To add a city's guides, add its list here, with its terms checked and written
// down in docs/LOCAL-FACTS.md.

import { LAGOS_FEEDS } from "./lagos/feeds.mjs";

/** @type {Record<string, readonly import("../core/feeds.mjs").FeedSource[]>} */
const FEEDS = { lagos: LAGOS_FEEDS };

/** The curated weekly guides for a pack (by id), or none. */
export function feedsFor(/** @type {{ id: string }} */ pack) {
  return FEEDS[pack.id] ?? [];
}

/** Every feed any pack reads, for the heartbeat's daily refresh. */
export function allFeeds() {
  return Object.values(FEEDS).flat();
}
