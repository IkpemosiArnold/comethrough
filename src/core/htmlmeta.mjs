// @ts-check
// What a shared link says about itself: Open Graph and Twitter tags, the title and
// description, schema.org Event data (JSON-LD), and the start of the visible text for Gemma.
// Pure string work on HTML the adapter fetched; no DOM, so it runs anywhere.

/** @typedef {import("./tasks.mjs").PageMeta} PageMeta */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', naira: "N" };

/** Decode the HTML entities that show up in titles and descriptions. */
export function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[/** @type {keyof typeof ENTITIES} */ (n.toLowerCase())] ?? m);
}
const safeChar = (/** @type {number} */ n) => (n > 0 && n < 0x110000 && !(n >= 0xd800 && n < 0xe000) ? String.fromCodePoint(n) : "");

/** The attributes of one tag's source ("<meta property='og:title' content=...>"). */
export function attrs(tag) {
  /** @type {Record<string,string>} */
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

const clean = (/** @type {any} */ s, max = 300) => (typeof s === "string" && s.trim() ? s.replace(/\s+/g, " ").trim().slice(0, max) : null);

/**
 * @param {string} html
 * @param {string} [baseUrl]  to resolve a relative og:image
 * @returns {PageMeta}
 */
export function parseHtmlMeta(html, baseUrl) {
  const head = html.slice(0, 400_000);
  /** @type {Record<string,string>} */
  const meta = {};
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const key = (a.property || a.name || a.itemprop || "").toLowerCase();
    if (key && a.content != null && !(key in meta)) meta[key] = a.content;
  }
  const titleTag = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  let image = meta["og:image"] || meta["og:image:url"] || meta["twitter:image"] || null;
  if (image && baseUrl) {
    try {
      image = new URL(image, baseUrl).href;
    } catch {
      image = null;
    }
  }
  return {
    url: meta["og:url"] || baseUrl,
    title: clean(meta["og:title"] || meta["twitter:title"] || (titleTag && decodeEntities(titleTag)), 200),
    description: clean(meta["og:description"] || meta["twitter:description"] || meta.description, 600),
    siteName: clean(meta["og:site_name"], 80),
    image,
    text: visibleText(head),
    event: findEvent(head),
  };
}

/** The page's readable text, without scripts, styles or markup (first 3000 characters). */
export function visibleText(html) {
  const body = html.match(/<body[^>]*>([\s\S]*)/i)?.[1] ?? html;
  const t = body
    .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return clean(decodeEntities(t).replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n"), 3000);
}

/** The first schema.org Event in the page's JSON-LD, flattened, or null. */
export function findEvent(html) {
  for (const m of html.matchAll(/<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const ev = walk(data);
    if (ev) return flattenEvent(ev);
  }
  return null;
}

function walk(x, depth = 0) {
  if (!x || typeof x !== "object" || depth > 5) return null;
  if (Array.isArray(x)) {
    for (const y of x) {
      const f = walk(y, depth + 1);
      if (f) return f;
    }
    return null;
  }
  const types = [].concat(x["@type"] || []).map(String);
  if (types.some((t) => /Event$/.test(t))) return x;
  return walk(x["@graph"], depth + 1);
}

function flattenEvent(ev) {
  const loc = [].concat(ev.location || [])[0] || {};
  const addr = typeof loc.address === "string" ? loc.address : loc.address ? [loc.address.streetAddress, loc.address.addressLocality, loc.address.addressRegion].filter(Boolean).join(", ") : null;
  const offer = [].concat(ev.offers || [])[0] || {};
  const priceNum = offer.price ?? offer.lowPrice;
  const free = ev.isAccessibleForFree === true || ev.isAccessibleForFree === "True" || Number(priceNum) === 0;
  const price = free ? "Free" : priceNum != null ? `${offer.priceCurrency || ""} ${priceNum}`.trim() : null;
  const org = [].concat(ev.organizer || [])[0];
  return {
    name: clean(ev.name, 120),
    startDate: clean(ev.startDate, 40),
    endDate: clean(ev.endDate, 40),
    venue: clean(typeof loc === "string" ? loc : loc.name, 120),
    address: clean(addr, 200),
    price: clean(price, 60),
    free,
    organizer: clean(typeof org === "string" ? org : org?.name, 60),
  };
}
