// @ts-check
// Web Push (VAPID). It reaches Android Chrome without an install, and iPhones once the web
// app is added to the Home Screen. Keys come from the environment; generate a pair once
// with `npx web-push generate-vapid-keys`. Without keys, push is off and the API says so.

/** @typedef {{ endpoint: string, keys: { p256dh: string, auth: string } }} PushSubscription */
/** @typedef {{ title: string, body: string, url: string, tag: string }} PushMessage */
/**
 * @typedef {object} PushPort
 * @property {boolean} enabled
 * @property {string|null} publicKey
 * @property {(sub: PushSubscription, msg: PushMessage) => Promise<{ ok: boolean, gone: boolean, permanent?: boolean, status?: number }>} send
 *   ok: the push service accepted it (2xx). gone: the browser unsubscribed (404 or 410), so
 *   the subscription should be deleted. permanent: trying again will not help (400, 403,
 *   404, 410, 413). Anything else (429, 5xx, no answer) is worth another try later.
 */

/** Push service answers that another try will not change. */
const PERMANENT = [400, 403, 404, 410, 413];

/** True for a subscription object a browser could have produced. */
export function isSubscription(s) {
  return !!s && typeof s.endpoint === "string" && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 1000 &&
    typeof s.keys?.p256dh === "string" && typeof s.keys?.auth === "string" && s.keys.p256dh.length < 200 && s.keys.auth.length < 100;
}

/**
 * @param {{ publicKey?: string, privateKey?: string, subject?: string }} cfg
 * @returns {Promise<PushPort>}
 */
export async function createWebPush({ publicKey, privateKey, subject }) {
  if (!publicKey || !privateKey) return { enabled: false, publicKey: null, send: async () => ({ ok: false, gone: false, permanent: true, status: 0 }) };
  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(subject || "mailto:hello@comethrough.tech", publicKey, privateKey);
  return {
    enabled: true,
    publicKey,
    async send(sub, msg) {
      try {
        // TTL: a nudge older than 12 hours is stale; urgency high so phones show it now
        await webpush.sendNotification(sub, JSON.stringify(msg), { TTL: 12 * 3600, urgency: "high", topic: msg.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined });
        return { ok: true, gone: false, status: 201 };
      } catch (e) {
        const status = Number(/** @type {any} */ (e).statusCode) || 0;
        return { ok: false, gone: status === 404 || status === 410, permanent: PERMANENT.includes(status), status };
      }
    },
  };
}
