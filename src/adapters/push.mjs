// @ts-check
// Web Push (VAPID). It reaches Android Chrome without an install, and iPhones once the web
// app is added to the Home Screen. Keys come from the environment; generate a pair once
// with `npx web-push generate-vapid-keys`. Without keys, push is off and the API says so.
//
// A subscription's endpoint comes from a member's browser, and the server POSTs to it, so it
// is guarded against server-side request forgery (the review of d01a23b):
//   - when it is saved and again before every send, the endpoint must be https on port 443
//     at a known push service (PUSH_HOSTS in src/core/netguard.mjs);
//   - before each send the host is resolved here and every address must be public, and the
//     connection is pinned to the vetted address (DNS rebinding cannot move it inside);
//   - redirects are never followed, the request is cut off after SEND_LIMITS.timeoutMs, and
//     at most SEND_LIMITS.maxBytes of the answer are read.
// web-push builds the encrypted body and the VAPID headers; this file sends them.

import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import { checkPushEndpoint, isPublicIp } from "../core/netguard.mjs";

/** @typedef {{ endpoint: string, keys: { p256dh: string, auth: string } }} PushSubscription */
/** @typedef {{ title: string, body: string, url: string, tag: string }} PushMessage */
/** @typedef {{ ok: boolean, gone: boolean, permanent?: boolean, status?: number, blocked?: string }} SendResult */
/**
 * @typedef {object} PushPort
 * @property {boolean} enabled
 * @property {string|null} publicKey
 * @property {(sub: PushSubscription, msg: PushMessage) => Promise<SendResult>} send
 *   ok: the push service accepted it (2xx). gone: the browser unsubscribed (404 or 410), or
 *   the endpoint is not a known push service, so the subscription should be deleted.
 *   permanent: trying again will not help (400, 403, 404, 410, 413, a redirect, a refused
 *   address). Anything else (429, 5xx, no answer) is worth another try later.
 */

/** Push service answers that another try will not change. */
const PERMANENT = [400, 403, 404, 410, 413];

/** Limits on one send: a push service answers 201 with an empty body within a second or two. */
export const SEND_LIMITS = Object.freeze({ timeoutMs: 10_000, maxBytes: 16 * 1024 });

/** True for a subscription object a browser could have produced, at a known push service. */
export function isSubscription(s) {
  return !!s && typeof s.endpoint === "string" && s.endpoint.length < 1000 && checkPushEndpoint(s.endpoint).ok &&
    typeof s.keys?.p256dh === "string" && typeof s.keys?.auth === "string" && s.keys.p256dh.length < 200 && s.keys.auth.length < 100;
}

/** @typedef {(host: string) => Promise<{ address: string, family: number }[]>} Resolve */

const defaultResolve = /** @type {Resolve} */ ((host) => dns.lookup(host, { all: true, verbatim: true }).catch(() => []));

/**
 * The address to connect to for a push endpoint, or why not: the endpoint must pass
 * checkPushEndpoint, the host must resolve, and every address it resolves to must be public.
 * @param {string} endpoint
 * @param {{ resolve?: Resolve, allowIp?: (ip: string) => boolean }} [opts]
 * @returns {Promise<{ ok: boolean, reason?: string, url?: URL, addr?: { address: string, family: number } }>}  ok: url and addr are set; else reason
 */
export async function vetPushEndpoint(endpoint, { resolve = defaultResolve, allowIp = isPublicIp } = {}) {
  const c = checkPushEndpoint(endpoint);
  if (!c.ok || !c.url) return { ok: false, reason: c.reason || "not a push endpoint" };
  const host = c.url.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await resolve(host);
  if (!addrs.length) return { ok: false, reason: "no address" };
  if (addrs.some((a) => !allowIp(a.address))) return { ok: false, reason: "private address" };
  return { ok: true, url: c.url, addr: addrs[0] };
}

/**
 * One POST to a vetted address: no redirects followed, a deadline, a cap on the answer.
 * Resolves the status (0 when there was no answer).
 * @param {URL} url
 * @param {{ address: string, family: number }} addr
 * @param {{ method: string, headers: Record<string, any>, body: Buffer|null }} req
 * @param {{ timeoutMs?: number, maxBytes?: number, port?: number, request?: typeof https.request }} [opts]  port and request are for tests (plain http to a local server)
 * @returns {Promise<number>}
 */
export function postPinned(url, addr, req, { timeoutMs = SEND_LIMITS.timeoutMs, maxBytes = SEND_LIMITS.maxBytes, port = 443, request = https.request } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (/** @type {number} */ status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(status);
    };
    const r = request({
      hostname: url.hostname,
      port,
      path: `${url.pathname}${url.search}`,
      method: req.method,
      headers: req.headers,
      agent: false,
      // every connection goes to the address we checked, whatever DNS says now
      lookup: (_h, o, cb) => (/** @type {any} */ (o)?.all ? /** @type {any} */ (cb)(null, [addr]) : cb(null, addr.address, addr.family)),
      timeout: timeoutMs,
    });
    const timer = setTimeout(() => r.destroy(new Error("push send timed out")), timeoutMs);
    r.on("timeout", () => r.destroy(new Error("push send timed out")));
    r.on("error", () => done(0));
    r.on("response", (res) => {
      const status = res.statusCode || 0;
      let n = 0;
      // the answer is read only to free the socket, and only so far
      res.on("data", (c) => {
        n += c.length;
        if (n > maxBytes) {
          res.destroy();
          done(status);
        }
      });
      res.on("end", () => done(status));
      res.on("error", () => done(status));
      res.on("close", () => done(status));
    });
    if (req.body) r.write(req.body);
    r.end();
  });
}

/**
 * @param {{ publicKey?: string, privateKey?: string, subject?: string, resolve?: Resolve, allowIp?: (ip: string) => boolean, limits?: { timeoutMs?: number, maxBytes?: number, port?: number, request?: typeof https.request } }} cfg
 *   resolve, allowIp and limits are for tests (a local server on a private address)
 * @returns {Promise<PushPort>}
 */
export async function createWebPush({ publicKey, privateKey, subject, resolve, allowIp, limits = {} }) {
  if (!publicKey || !privateKey) return { enabled: false, publicKey: null, send: async () => ({ ok: false, gone: false, permanent: true, status: 0 }) };
  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(subject || "https://comethrough.ikpemosi.work", publicKey, privateKey);
  return {
    enabled: true,
    publicKey,
    async send(sub, msg) {
      const v = await vetPushEndpoint(sub.endpoint, { resolve, allowIp });
      // not a push service at all (saved before the check existed): drop the subscription;
      // a push service host that resolves inside a private network: refuse, keep nothing
      if (!v.ok || !v.url || !v.addr) return { ok: false, gone: v.reason === "not a known push service", permanent: true, status: 0, blocked: v.reason };
      let details;
      try {
        // TTL: a nudge older than 12 hours is stale; urgency high so phones show it now
        details = webpush.generateRequestDetails(sub, JSON.stringify(msg), { TTL: 12 * 3600, urgency: "high", topic: msg.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined });
      } catch {
        return { ok: false, gone: false, permanent: true, status: 0, blocked: "bad subscription keys" };
      }
      const status = await postPinned(v.url, v.addr, { method: details.method, headers: details.headers, body: details.body ?? null }, limits);
      if (status >= 200 && status < 300) return { ok: true, gone: false, status };
      // a redirect is not followed: the push service is not where the subscription says
      if (status >= 300 && status < 400) return { ok: false, gone: false, permanent: true, status };
      return { ok: false, gone: status === 404 || status === 410, permanent: PERMANENT.includes(status), status };
    },
  };
}
