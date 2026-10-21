// @ts-check
// Fetch a pasted link's meta tags safely.
//
// The guard against server-side request forgery: the URL must be http(s) on a standard
// port; the host name is resolved here and EVERY address it returns must be public
// (src/core/netguard.mjs); the connection is then pinned to that vetted address (the
// socket's lookup returns it), so a DNS answer that changes between the check and the
// connect (DNS rebinding) cannot redirect the request inside. Redirects are followed by
// hand, at most 3, each checked the same way. Limits: 6 s in all, 512 KB of HTML, and
// HTML only (an image link comes back as the image, for Gemma to read as a flyer).
//
// Instagram and Facebook are not fetched: they return an empty shell to servers (checked
// 21 Oct 2026), so the UI asks for a screenshot of the flyer instead.

import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { parseHtmlMeta } from "../core/htmlmeta.mjs";
import { checkUrl, isPublicIp } from "../core/netguard.mjs";

/** @typedef {import("../core/tasks.mjs").PageMeta} PageMeta */
/** @typedef {{ meta: PageMeta|null, image: { mimeType: string, data: string }|null, note: string|null }} PageResult */

export const SKIP_HOSTS = /(^|\.)(instagram\.com|instagr\.am|facebook\.com|fb\.com|fb\.me|threads\.net)$/i;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export class LinkError extends Error {
  /** @param {string} message plain words for the UI */
  constructor(message) {
    super(message);
    this.name = "LinkError";
  }
}

/**
 * Resolve a host and insist that every address is public.
 * @param {string} host
 * @param {(host: string) => Promise<{ address: string, family: number }[]>} resolve
 * @param {(ip: string) => boolean} [allow]  tests pass a looser rule to reach a local server
 */
export async function vetHost(host, resolve, allow = isPublicIp) {
  const bare = host.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(bare) ? [{ address: bare, family: net.isIP(bare) }] : await resolve(bare);
  if (!addrs.length) throw new LinkError("That link's site could not be found.");
  for (const a of addrs) if (!allow(a.address)) throw new LinkError("That link points inside a private network.");
  return addrs[0];
}

const defaultResolve = (/** @type {string} */ host) => dns.lookup(host, { all: true, verbatim: true }).catch(() => []);

/**
 * One GET pinned to a vetted address. Resolves { status, headers, body (Buffer), location }.
 * @param {URL} url
 * @param {{ address: string, family: number }} addr
 * @param {{ deadline: number, capFor: (contentType: string) => number, userAgent: string }} opts  capFor: the byte limit for the response's type
 */
function getPinned(url, addr, { deadline, capFor, userAgent }) {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(url, {
      method: "GET",
      headers: { "user-agent": userAgent, accept: "text/html,application/xhtml+xml,image/*;q=0.8", "accept-language": "en" },
      // every connection goes to the address we checked, whatever DNS says now
      lookup: (_h, opts, cb) => (/** @type {any} */ (opts)?.all ? /** @type {any} */ (cb)(null, [addr]) : cb(null, addr.address, addr.family)),
      timeout: Math.max(1, deadline - Date.now()),
    });
    const timer = setTimeout(() => req.destroy(new LinkError("That link took too long to answer.")), Math.max(1, deadline - Date.now()));
    req.on("timeout", () => req.destroy(new LinkError("That link took too long to answer.")));
    req.on("error", (e) => {
      clearTimeout(timer);
      reject(e instanceof LinkError ? e : new LinkError("That link could not be opened."));
    });
    req.on("response", (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        clearTimeout(timer);
        resolve({ status, headers: res.headers, body: Buffer.alloc(0), location: res.headers.location });
        return;
      }
      const maxBytes = capFor(String(res.headers["content-type"] || "").split(";")[0].trim().toLowerCase());
      /** @type {Buffer[]} */
      const chunks = [];
      let n = 0;
      let truncated = false;
      res.on("data", (c) => {
        if (truncated) return;
        n += c.length;
        if (n > maxBytes) {
          truncated = true;
          chunks.push(c.subarray(0, c.length - (n - maxBytes)));
          res.destroy();
          clearTimeout(timer);
          resolve({ status, headers: res.headers, body: Buffer.concat(chunks), location: null, truncated: true });
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => {
        clearTimeout(timer);
        if (!truncated) resolve({ status, headers: res.headers, body: Buffer.concat(chunks), location: null });
      });
      res.on("error", () => {
        clearTimeout(timer);
        if (!truncated) reject(new LinkError("That link could not be read."));
      });
    });
    req.end();
  });
}

/**
 * @param {{ contact: string, timeoutMs?: number, maxBytes?: number, imageMaxBytes?: number, resolve?: (host: string) => Promise<{ address: string, family: number }[]>,
 *           allowAddress?: (ip: string) => boolean, checkUrlImpl?: typeof checkUrl }} cfg
 * @returns {{ fetchPage(raw: string): Promise<PageResult> }}
 */
export function createPageMeta({ contact, timeoutMs = 6000, maxBytes = 512 * 1024, imageMaxBytes = 5 * 1024 * 1024, resolve = defaultResolve, allowAddress = isPublicIp, checkUrlImpl = checkUrl }) {
  const userAgent = `Mozilla/5.0 (compatible; ComeThroughBot/0.1; +${contact})`;
  return {
    async fetchPage(raw) {
      const first = checkUrlImpl(raw);
      if (!first.ok || !first.url) throw new LinkError(first.reason || "That is not a link.");
      if (SKIP_HOSTS.test(first.url.hostname)) {
        return { meta: null, image: null, note: "Instagram and Facebook do not share posts with other apps. Add a screenshot of the flyer instead." };
      }
      const deadline = Date.now() + timeoutMs;
      let url = first.url;
      for (let hop = 0; hop <= 3; hop++) {
        const addr = await vetHost(url.hostname, resolve, allowAddress);
        const capFor = (/** @type {string} */ type) => (IMAGE_TYPES.includes(type) ? imageMaxBytes + 1 : maxBytes);
        const r = /** @type {any} */ (await getPinned(url, addr, { deadline, capFor, userAgent }));
        if (r.location) {
          if (hop === 3) throw new LinkError("That link redirects too many times.");
          const next = checkUrlImpl(new URL(r.location, url).href);
          if (!next.ok || !next.url) throw new LinkError(next.reason || "That link redirects somewhere odd.");
          if (SKIP_HOSTS.test(next.url.hostname)) return { meta: null, image: null, note: "That link leads to Instagram or Facebook, which do not share posts with other apps. Add a screenshot of the flyer instead." };
          url = next.url;
          continue;
        }
        if (r.status < 200 || r.status >= 300) throw new LinkError(`That link answered with an error (${r.status}).`);
        const type = String(r.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
        if (IMAGE_TYPES.includes(type)) {
          if (r.truncated) throw new LinkError("That image is too large.");
          return { meta: { url: url.href }, image: { mimeType: type, data: r.body.toString("base64") }, note: null };
        }
        if (type !== "text/html" && type !== "application/xhtml+xml") throw new LinkError("That link is not a web page or an image.");
        const charset = /charset=([\w-]+)/i.exec(String(r.headers["content-type"]))?.[1]?.toLowerCase();
        const html = new TextDecoder(charset === "iso-8859-1" || charset === "windows-1252" ? "windows-1252" : "utf-8").decode(r.body);
        return { meta: parseHtmlMeta(html, url.href), image: null, note: null };
      }
      throw new LinkError("That link redirects too many times.");
    },
  };
}
