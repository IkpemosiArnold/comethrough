// @ts-check
// The Lagos pack's curated weekly guides, for "The sloth has 3 ideas". Both are Substack
// newsletters; only their RSS feeds are ever fetched (at most once a day, with an honest
// User-Agent, and only while robots.txt allows the feed path). Only short facts are kept
// (name, date and time, venue or area, price as stated, ticket link), each idea credits
// and links the guide's post, and the posts' prose is never stored or shown.
//
// Checked 21 Oct 2026 (docs/LOCAL-FACTS.md, "Curated weekly guides";
// road-to-50k research EVENTS-RESEARCH.md, section 4): both feeds return 200 with the full
// posts; robots.txt for `*` disallows /feed/private but not /feed; Substack's terms forbid
// crawling pages and copying a significant portion of content, which is why only the feed
// is read and only facts are kept. The curators have not been asked yet: email both for
// permission (a "featured in Come Through" credit is a fair trade).

/** @type {readonly import("../../core/feeds.mjs").FeedSource[]} */
export const LAGOS_FEEDS = Object.freeze([
  { id: "awe-lagos", name: "Awe Lagos", feed: "https://awelagos.substack.com/feed", home: "https://awelagos.substack.com" },
  { id: "ntdil", name: "Nothing To Do In Lagos", feed: "https://nothingtodoinlagos.substack.com/feed", home: "https://nothingtodoinlagos.substack.com" },
]);
