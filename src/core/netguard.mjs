// @ts-check
// The server-side request forgery (SSRF) rules for fetching a link a user pasted. Pure, so
// they are tested without a network: the adapter resolves DNS, then asks isPublicIp about
// every address and connects only to a vetted one.
//
// Blocked: loopback, private networks (RFC 1918), carrier-grade NAT, link-local (which
// includes cloud metadata at 169.254.169.254), multicast, reserved and documentation
// ranges, the unspecified address, IPv6 unique-local and link-local, and IPv4 addresses
// hidden inside IPv6 (::ffff:10.0.0.1, 64:ff9b::/96 NAT64, 6to4).

/** IPv4 ranges that are not the public internet: [network, prefix length]. */
const V4_BLOCKED = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

/** "10.1.2.3" -> 32-bit number, or null when it is not a dotted quad. */
export function v4ToInt(ip) {
  const m = String(ip).match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function v4Public(ip) {
  const n = v4ToInt(ip);
  if (n == null) return false;
  return !V4_BLOCKED.some(([net, len]) => {
    const base = /** @type {number} */ (v4ToInt(net));
    const mask = len === 0 ? 0 : (0xffffffff << (32 - Number(len))) >>> 0;
    return ((n & mask) >>> 0) === ((base & mask) >>> 0);
  });
}

/** An IPv6 address as 8 groups of 16 bits, or null. Handles :: and a trailing dotted quad. */
export function v6Groups(ip) {
  let s = String(ip).toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const quad = s.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (quad) {
    const n = v4ToInt(quad[1]);
    if (n == null) return null;
    s = s.slice(0, -quad[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const all = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => parseInt(g, 16));
}

function v6Public(ip) {
  const g = v6Groups(ip);
  if (!g) return false;
  const embedded = (/** @type {number} */ hi, /** @type {number} */ lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (g.every((x) => x === 0)) return false; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // ::1
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return v4Public(embedded(g[6], g[7])); // ::ffff:a.b.c.d
  if (g.slice(0, 6).every((x) => x === 0)) return false; // ::a.b.c.d (deprecated compatible form)
  if (g[0] === 0x64 && g[1] === 0xff9b) return v4Public(embedded(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return v4Public(embedded(g[1], g[2])); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return false; // fe80::/10 link local
  if ((g[0] & 0xff00) === 0xff00) return false; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return false; // discard
  return true;
}

/** True only for a public unicast IPv4 or IPv6 address. Anything unparseable is not public. */
export function isPublicIp(ip) {
  return String(ip).includes(":") ? v6Public(ip) : v4Public(ip);
}

/**
 * Check a pasted URL before any DNS lookup: http or https, the default port, no
 * credentials, and a host name (not a bare IP that is private).
 * @param {string} raw
 * @returns {{ ok: boolean, url?: URL, reason?: string }}
 */
export function checkUrl(raw) {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    return { ok: false, reason: "That is not a link." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "Only http and https links can be read." };
  if (url.username || url.password) return { ok: false, reason: "Links with a login in them are not read." };
  if (url.port && url.port !== "80" && url.port !== "443") return { ok: false, reason: "Only links on the standard ports are read." };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return { ok: false, reason: "That link points inside a private network." };
  const literal = v4ToInt(host) != null || host.includes(":");
  if (literal && !isPublicIp(host)) return { ok: false, reason: "That link points inside a private network." };
  return { ok: true, url };
}

/**
 * Sites that hand servers an empty page instead of the post (Instagram, Facebook and
 * Threads, checked 21 Oct 2026). Their links are never fetched: the person is asked for
 * the flyer picture instead.
 */
export const LOCKED_HOSTS = /(^|\.)(instagram\.com|instagr\.am|facebook\.com|fb\.com|fb\.me|threads\.net|tix\.africa)$/i;

/**
 * Which locked site a link is on, in the words a person uses, or null.
 * Instagram, Facebook and Threads return an empty page to servers (checked 21 Oct 2026).
 * Tix.africa answers every server request with a Cloudflare 403, whatever the user agent,
 * and its pages carry no event data until JavaScript runs (checked 21 Oct 2026; see
 * docs/LOCAL-FACTS.md, "Event sources").
 * @param {string} raw
 */
export function lockedSite(raw) {
  let host;
  try {
    host = new URL(String(raw)).hostname;
  } catch {
    return null;
  }
  if (!LOCKED_HOSTS.test(host)) return null;
  if (/(^|\.)tix\.africa$/i.test(host)) return "Tix.africa";
  if (/(^|\.)threads\.net$/i.test(host)) return "Threads";
  if (/(^|\.)(facebook\.com|fb\.com|fb\.me)$/i.test(host)) return "Facebook";
  return "Instagram";
}

/** True for a link on one of the LOCKED_HOSTS. */
export function isLockedLink(raw) {
  return lockedSite(raw) != null;
}

/** What to tell the person about a locked link. No dashes. */
export function lockedMessage(site) {
  if (site === "Tix.africa") return "Tix.africa does not let other apps read its event pages. Share a screenshot of the event page or the flyer instead.";
  return `${site || "Instagram"} keeps that one locked. Share the flyer picture instead: a screenshot works.`;
}
