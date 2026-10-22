// @ts-check
// Event titles from web pages, without the page's search-engine tail. A page's <title> or
// og:title often carries the site's name or a keyword phrase after a separator:
//   "Selfie Sunday at Alali VI! : Things to do in Lagos Every Sunday"  ->  "Selfie Sunday at Alali VI"
//   "Afrobeats Brunch | Tix Africa"                                     ->  "Afrobeats Brunch"
//   "Eventbrite: Jazz on the Lawn"                                     ->  "Jazz on the Lawn"
// Only a part that reads like a site or a keyword phrase is dropped; a title that is all
// event ("Rock, Paper, Scissors: the party") stays as it is. Pure: no clock, no I/O.

/** Separators a site puts between the event and its own tail, longest first. */
const SEPARATORS = [" :: ", " | ", " – ", " — ", " - ", " : ", ": ", " · ", " • ", " » ", " ~ "];

/** A part that names a site or a ticket shop: dropped at either end of the title. */
const SITE = [
  /^tickets?\b/i, /\b(buy|get|book) (your )?tickets?\b/i, /\b(online )?ticketing\b/i, /\b(official )?(web)?site\b/i, /\bhome ?page\b/i, /^home$/i,
  /\b(eventbrite|tix\.?africa|tix|meetup|facebook|instagram|x\.com|twitter|linktree|luma|lu\.ma|partiful|ticketmaster|dice|resident advisor|allevents|eventful|songkick|bandsintown|nairabox|afrotix|ticketsafrica)\b/i,
  /\.(com|ng|africa|co|io|net|org|events?|tickets?)\b/i,
];
/** A keyword phrase for search engines: dropped only from the end. */
const PHRASE = [
  /\bthings to do\b/i, /\bwhat'?s on\b/i, /\bevents? (in|near|calendar|listings?|guide)\b/i, /\bregist(er|ration)\b/i, /\brsvp\b/i,
  /\btickets?( and| &) (info|events)\b/i, /^every (sunday|monday|tuesday|wednesday|thursday|friday|saturday|weekend|week)\b/i,
];

const isSite = (/** @type {string} */ part, /** @type {string|null} */ site) => {
  const p = part.trim().toLowerCase();
  if (!p) return true;
  if (site && (p === site.toLowerCase() || (site.length >= 3 && p.includes(site.toLowerCase())))) return true;
  return SITE.some((re) => re.test(p));
};
const isTail = (/** @type {string} */ part, /** @type {string|null} */ site) => isSite(part, site) || PHRASE.some((re) => re.test(part.trim()));

/** Trailing marks a cut leaves behind ("Alali VI! :" becomes "Alali VI"). */
const tidy = (/** @type {string} */ s) => s.replace(/\s+/g, " ").replace(/[\s!.:;,|·•»~–—-]+$/u, "").replace(/^[\s:;,|·•»~–—-]+/u, "").trim();

/**
 * The event's own title.
 * @param {string|null|undefined} title
 * @param {{ siteName?: string|null }} [opts]  the page's og:site_name, which is always a tail
 * @returns {string|null}
 */
export function cleanEventTitle(title, { siteName = null } = {}) {
  if (title == null) return null;
  const raw = String(title).replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const site = siteName ? String(siteName).trim() || null : null;
  let t = raw;
  let cut = false;
  for (let changed = true; changed;) {
    changed = false;
    for (const sep of SEPARATORS) {
      // the site's tail: "<event> | Tix Africa", "<event> : Things to do in ..."
      const at = t.lastIndexOf(sep);
      if (at > 0 && isTail(t.slice(at + sep.length), site) && tidy(t.slice(0, at)).length >= 3) {
        t = t.slice(0, at);
        changed = cut = true;
        break;
      }
      // the site's head: "Eventbrite: <event>"
      const first = t.indexOf(sep);
      if (first > 0 && isSite(t.slice(0, first), site) && tidy(t.slice(first + sep.length)).length >= 3) {
        t = t.slice(first + sep.length);
        changed = cut = true;
        break;
      }
    }
  }
  return cut ? tidy(t) || raw : raw;
}
