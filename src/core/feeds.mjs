// @ts-check
// Curators' weekly guides, read from their RSS feeds: the pure part. The adapter
// (src/adapters/feeds.mjs) fetches a feed at most once a day; this module parses the XML,
// turns one post into plain text with numbered links, builds the Gemma task that lists the
// post's events, and checks every event the model returns against the post's own words.
//
// The rules (docs/SPEC.md, "Ideas"):
//   - facts only: an event keeps its name, dates and time, venue or area, price as stated,
//     and ticket link. The post's prose is never stored or shown, and the text given to
//     Gemma is dropped as soon as the events are read.
//   - every event carries its source (the curator's name and the post's link), and the UI
//     credits and links it.
//   - nothing is silently invented: a name that is not in the post is dropped; a date the
//     post does not state (or that falls outside the post's own weekend), or a date with
//     low confidence, drops the event; a time, venue or price that the event's own lines do
//     not contain is left out; a ticket link is only ever one of the post's own links.
//
// Pure: no I/O, no clock (the caller passes today), no city named.

import { decodeEntities } from "./htmlmeta.mjs";
import { daysBetween, isDate, resolveTimeWords, weekdayOf } from "./time.mjs";
import { fill, groundedShare, noDashes } from "./tasks.mjs";

/** @typedef {import("./tasks.mjs").Message} Message */
/** @typedef {import("./tasks.mjs").Prompt} Prompt */

/**
 * @typedef {object} FeedSource
 * @property {string} id      "awe-lagos"
 * @property {string} name    "Awe Lagos", as the UI credits it
 * @property {string} feed    the RSS URL (the only URL ever fetched)
 * @property {string} home    the publication's page, for "go look here"
 * @property {string} [credit] "From Awe Lagos' weekly guide"
 */
/**
 * @typedef {object} FeedItem
 * @property {string} title
 * @property {string} link
 * @property {string|null} published   ISO date-time
 * @property {string} html             the post body (content:encoded, else description)
 */
/**
 * @typedef {object} FeedEvent
 * @property {string} title
 * @property {string[]} dates          "YYYY-MM-DD", every date the post says it runs
 * @property {string|null} start       "HH:MM", local
 * @property {string|null} end         "HH:MM", local
 * @property {string|null} venue
 * @property {string|null} area
 * @property {{ text: string, free: boolean }|null} price
 * @property {string|null} ticketUrl
 * @property {boolean|null} outdoor
 * @property {string|null} category    the guide's own label ("Concert"), as a hint for ranking
 * @property {{ date: number, time: number }} confidence
 * @property {{ lat: number, lon: number }|null} [at]  where the venue is, when it was found on the map
 * @property {{ id: string, name: string, url: string, title: string, published: string|null }} source
 */

// ---------------------------------------------------------------- RSS

/** The text of the first <tag> in a chunk of XML, CDATA unwrapped and entities decoded. */
function tagText(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  if (!m) return null;
  const raw = m[1].trim();
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return cdata ? cdata[1] : decodeEntities(raw);
}

/**
 * The items of an RSS 2.0 feed, newest first as the feed lists them.
 * @param {string} xml
 * @returns {FeedItem[]}
 */
export function parseRss(xml) {
  /** @type {FeedItem[]} */
  const out = [];
  for (const m of String(xml || "").matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const it = m[1];
    const title = (tagText(it, "title") || "").replace(/\s+/g, " ").trim();
    const link = (tagText(it, "link") || "").trim();
    const date = tagText(it, "pubDate");
    const ms = date ? Date.parse(date) : NaN;
    const html = tagText(it, "content:encoded") ?? tagText(it, "description") ?? "";
    if (!title || !/^https?:\/\//.test(link)) continue;
    out.push({ title: decodeEntities(title), link, published: Number.isFinite(ms) ? new Date(ms).toISOString() : null, html });
  }
  return out;
}

// ---------------------------------------------------------------- one post as text

/** Hosts whose links are the platform's own (subscribe buttons, images), never a ticket. */
const PLATFORM_LINK = /(^|\.)(substack\.com|substackcdn\.com)$/i;

/** A link without tracking parameters (utm_*, fbclid and the like). */
export function cleanLink(raw) {
  try {
    const u = new URL(decodeEntities(raw));
    if (!/^https?:$/.test(u.protocol)) return null;
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_|exln|ref_?src)/i.test(k)) u.searchParams.delete(k);
    return u.href;
  } catch {
    return null;
  }
}

/**
 * A post's body as plain text, each outside link written as "label [n]" and listed in
 * `links` (n is 1-based), so the model can name a ticket link by number and never has to
 * copy a URL. Images, buttons and the platform's own links are left out.
 * @param {string} html
 * @param {{ maxChars?: number, ownHost?: string }} [opts]  ownHost: the publication's own host, whose links are never tickets
 * @returns {{ text: string, links: string[] }}
 */
export function postText(html, { maxChars = 14000, ownHost = "" } = {}) {
  /** @type {string[]} */
  const links = [];
  let s = String(html || "")
    .replace(/<(script|style|svg|figure|picture|form|button|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_, a, inner) => {
    const href = /href\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'/i.exec(a);
    const label = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const url = href ? cleanLink(href[1] ?? href[2]) : null;
    if (!url || !label) return label;
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {}
    if (PLATFORM_LINK.test(host) || (ownHost && host === ownHost) || /^(subscribe|share|leave a comment)/i.test(label)) return label;
    let n = links.indexOf(url) + 1;
    if (!n) n = links.push(url);
    return `${label} [${n}]`;
  });
  const text = decodeEntities(
    s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d|tr|blockquote|ul|ol)>/gi, "\n").replace(/<li\b[^>]*>/gi, "\n- ").replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return { text: text.slice(0, maxChars), links };
}

// ---------------------------------------------------------------- the Gemma task

const S = (/** @type {string} */ description) => ({ type: ["string", "null"], description });

export const EVENTS_SCHEMA = {
  type: "object",
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: S("the event's name, copied"),
          dates: { type: "array", items: { type: "string", description: "YYYY-MM-DD" } },
          startTime: S("start time as written"),
          endTime: S("end time as written"),
          venue: S("venue, copied"),
          area: S("neighbourhood, copied"),
          priceText: S("price as written"),
          free: { type: ["boolean", "null"] },
          ticketLink: { type: ["integer", "null"], description: "the [n] after the ticket words" },
          outdoor: { type: ["boolean", "null"] },
          category: S("the guide's label"),
          confidence: { type: "object", properties: { date: { type: "number" }, time: { type: "number" } }, required: ["date", "time"] },
        },
        required: ["title", "dates", "startTime", "endTime", "venue", "area", "priceText", "free", "ticketLink", "outdoor", "category", "confidence"],
      },
    },
  },
  required: ["events"],
};

export const EVENTS_MAX_TOKENS = 3000;

/**
 * @param {Prompt} prompt  extract-events, localised
 * @param {{ source: FeedSource, item: FeedItem, text: string, today: string }} input
 * @returns {Message[]}
 */
export function eventsMessages(prompt, { source, item, text, today }) {
  const published = item.published ? item.published.slice(0, 10) : "unknown";
  return [
    { role: "system", content: prompt.system },
    { role: "user", content: fill(prompt.user, { guide: source.name, title: item.title, published, today, text }) },
  ];
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const norm = (/** @type {string} */ s) => String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const str = (/** @type {any} */ v, max = 120) => (typeof v === "string" && v.trim() && !/^(null|none|n\/a|unknown|tba|tbc)$/i.test(v.trim()) ? v.replace(/\s+/g, " ").trim().slice(0, max) : null);
const clamp01 = (/** @type {any} */ x) => (Number.isFinite(Number(x)) ? Math.max(0, Math.min(1, Number(x))) : 0);

/** Below this the model is not sure of the date, and the event is dropped. */
export const DATE_CONFIDENCE = 0.6;

/**
 * Where an event's own lines are in the post: from its name to the next 1,400 characters
 * (`own`), plus the 2,500 before it (`before`: the day heading sits above a block), both
 * normalised for word checks, and `raw`, the own lines as written (for the [n] link marks).
 * Null when the name is not in the post at all.
 * @param {string} title
 * @param {string} text
 */
export function eventBlock(title, text) {
  const words = norm(title).split(" ").filter(Boolean);
  if (!words.length) return null;
  const lower = text.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  // the whole name, else its first three words (a title the model tidied: "DAVE: The Boy" as "Dave, The Boy")
  const pattern = (/** @type {string[]} */ ws) => ws.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^a-z0-9]+");
  // the name on a line of its own (the event's heading) beats a mention in the highlights
  const find = (/** @type {string[]} */ ws, whole = false) => {
    if (!whole) return lower.search(new RegExp(pattern(ws)));
    const m = new RegExp(`(^|\\n)[^a-z0-9\\n]*${pattern(ws)}[^a-z0-9\\n]*(?=\\n|$)`).exec(lower);
    return m ? m.index + m[1].length : -1;
  };
  let i = find(words, true);
  if (i < 0) i = find(words);
  if (i < 0 && words.length > 3 && words.slice(0, 3).join(" ").length >= 6) i = find(words.slice(0, 3));
  if (i < 0) return null;
  const raw = text.slice(i, i + 1400);
  return { own: norm(raw), before: norm(text.slice(Math.max(0, i - 2500), i)), raw };
}

/** True when a date's day number and month are written near the event, or in the post's title. */
function dateStated(date, block, postTitle) {
  const [, m, d] = date.split("-").map(Number);
  const month = MONTHS[m - 1];
  const where = `${block.before} ${block.own}`;
  const title = norm(postTitle);
  const day = new RegExp(`(^|\\D)${d}(st|nd|rd|th)?(\\D|$)`);
  const monthNear = where.includes(month) || where.includes(month.slice(0, 3)) || title.includes(month) || title.includes(month.slice(0, 3));
  return monthNear && (day.test(where) || day.test(title));
}

/**
 * The events in the model's answer that the post itself supports.
 * @param {any} data  the parsed answer
 * @param {{ source: FeedSource, item: FeedItem, text: string, links: string[] }} input
 * @returns {{ events: FeedEvent[], dropped: { title: string|null, why: string }[] }}
 */
export function readEvents(data, { source, item, text, links }) {
  const list = Array.isArray(data?.events) ? data.events : [];
  /** @type {FeedEvent[]} */
  const events = [];
  /** @type {{ title: string|null, why: string }[]} */
  const dropped = [];
  const published = item.published ? item.published.slice(0, 10) : null;
  const seen = new Set();
  for (const e of list.slice(0, 40)) {
    const title = str(e?.title, 120);
    if (!title) {
      dropped.push({ title: null, why: "no name" });
      continue;
    }
    const block = groundedShare(title, text) >= 0.6 ? eventBlock(title, text) : null;
    if (!block) {
      dropped.push({ title, why: "name not in the post" });
      continue;
    }
    const conf = { date: clamp01(e?.confidence?.date), time: clamp01(e?.confidence?.time) };
    // dates: stated near the event, and inside the post's own stretch (published two days
    // before to ten days after), so a misread year or month never lands on a real weekend
    const dates = [...new Set((Array.isArray(e?.dates) ? e.dates : []).filter((/** @type {any} */ d) => typeof d === "string" && isDate(d)))]
      .filter((d) => !published || (daysBetween(published, d) >= -2 && daysBetween(published, d) <= 10))
      .filter((d) => dateStated(d, block, item.title))
      .sort()
      .slice(0, 7);
    if (!dates.length) {
      dropped.push({ title, why: "no date the post states" });
      continue;
    }
    if (conf.date < DATE_CONFIDENCE) {
      dropped.push({ title, why: "unsure of the date" });
      continue;
    }
    // a time, venue or price counts only when the event's own lines contain it
    const timeIn = (/** @type {any} */ w) => {
      const words = str(w, 30);
      const hhmm = words ? resolveTimeWords(words.replace(/\s*(till|until|to|-).*$/i, "").replace(/^from\s+/i, "")) : null;
      if (!hhmm) return null;
      const h = Number(hhmm.slice(0, 2)) % 12 || 12;
      return new RegExp(`(^|\\D)(${h}|${hhmm.slice(0, 2)})(\\D|$)`).test(block.own) ? hhmm : null;
    };
    const start = timeIn(e?.startTime);
    const end = start ? timeIn(e?.endTime) : null;
    const own = (/** @type {any} */ v, max = 120) => {
      const s = str(v, max);
      return s && groundedShare(s, block.own) >= 0.6 ? s : null;
    };
    const priceText = own(e?.priceText, 60);
    const saysFree = /\b(free|open to all|no charge|free entry)\b/i.test(priceText || "");
    const n = Number(e?.ticketLink);
    const ticketUrl = Number.isInteger(n) && n >= 1 && n <= links.length && block.raw.includes(`[${n}]`) ? links[n - 1] : null;
    const key = `${norm(title)}|${dates[0]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({
      title: noDashes(title),
      dates,
      start,
      end,
      venue: own(e?.venue),
      area: own(e?.area, 60),
      price: priceText ? { text: priceText, free: saysFree } : null,
      ticketUrl,
      outdoor: typeof e?.outdoor === "boolean" ? e.outdoor : null,
      category: str(e?.category, 40),
      confidence: { date: conf.date, time: start ? conf.time : 0 },
      source: { id: source.id, name: source.name, url: item.link, title: item.title.slice(0, 160), published: item.published },
    });
  }
  return { events, dropped };
}

/**
 * The posts worth reading: published in the last `days` days (a weekly guide goes stale),
 * at most `max` of them.
 * @param {FeedItem[]} items
 * @param {string} today  "YYYY-MM-DD"
 */
export function freshItems(items, today, { days = 9, max = 2 } = {}) {
  return items
    .filter((i) => i.published && daysBetween(i.published.slice(0, 10), today) <= days && daysBetween(i.published.slice(0, 10), today) >= -1)
    .sort((a, b) => String(b.published).localeCompare(String(a.published)))
    .slice(0, max);
}

/** An event still to come: some date today or later, and when today, not started yet (an hour's grace). */
export function upcomingDates(/** @type {FeedEvent} */ e, /** @type {string} */ today, /** @type {string} */ nowTime) {
  return e.dates.filter((d) => d > today || (d === today && (!e.start || e.start >= addMinutes(nowTime, -60))));
}

const addMinutes = (/** @type {string} */ t, /** @type {number} */ n) => {
  const m = Math.max(0, Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) + n);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

// ---------------------------------------------------------------- robots.txt

/**
 * Whether robots.txt lets `agent` fetch `path`: the group for the agent's own name, else
 * the `*` group; the longest matching rule wins, Allow on a tie (RFC 9309). `*` and `$`
 * in rules are honoured.
 * @param {string} robots
 * @param {string} agent  the product token ("ComeThrough")
 * @param {string} path   "/feed"
 */
export function robotsAllows(robots, agent, path) {
  /** @type {{ agents: string[], rules: { allow: boolean, path: string }[] }[]} */
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of String(robots || "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && (key === "allow" || key === "disallow")) cur.rules.push({ allow: key === "allow", path: val });
    }
  }
  const me = agent.toLowerCase();
  const group = groups.find((g) => g.agents.some((a) => a !== "*" && me.startsWith(a))) ?? groups.find((g) => g.agents.includes("*"));
  if (!group) return true;
  let best = { len: -1, allow: true };
  for (const r of group.rules) {
    if (!r.path) continue; // "Disallow:" with nothing allows everything
    const re = new RegExp(`^${r.path.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$|\$$/, "$")}`);
    if (re.test(path) && (r.path.length > best.len || (r.path.length === best.len && r.allow))) best = { len: r.path.length, allow: r.allow };
  }
  return best.allow;
}

/** What a FeedEvent says, for a line in a test or a log: "Sat 24 Oct 18:00, Freedom Park". */
export function eventLine(/** @type {FeedEvent} */ e) {
  const d = e.dates[0];
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekdayOf(d)];
  return `${wd} ${d}${e.start ? ` ${e.start}` : ""}${e.venue ? `, ${e.venue}` : ""}`;
}

