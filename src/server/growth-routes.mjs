// @ts-check
// The HTTP routes for the growth features (docs/SPEC.md, "Growth"), added to the API's
// route table in server.mjs: renaming a crew, the sloth's name ideas, a member's photo,
// one-time cards seen, and the preview images.

import { AppError } from "../app/errors.mjs";
import { FACE_MAX_BYTES } from "../app/growth.mjs";
import { HttpFail, readBody, readJson, sniffImage } from "./http.mjs";

/**
 * @param {{ growth: ReturnType<typeof import("../app/growth.mjs").createGrowth>, og: ReturnType<typeof import("./og.mjs").createOg>|null, limit: (bucket: string, key: string) => void, aiLimits: (ip: string) => void }} p
 * @returns {[string, RegExp, (ctx: any) => Promise<any>][]}
 */
export function growthRoutes({ growth, og, limit, aiLimits }) {
  return [
    // rename the crew (any member); the new name is in every message from now on
    ["PATCH", /^\/api\/crews\/([a-z0-9-]{1,64})$/, async ({ m, token, req }) => growth.renameCrew({ slug: m[1], token, body: await readJson(req, 4 * 1024) })],
    // "Let the sloth name you": three grounded names (one Gemma call)
    ["POST", /^\/api\/crews\/([a-z0-9-]{1,64})\/names$/, async ({ m, token, ip }) => {
      aiLimits(ip);
      return growth.suggestNames({ slug: m[1], token });
    }],
    // your photo: PUT the picture itself (WebP, JPEG or PNG, made small on the phone)
    ["PUT", /^\/api\/members\/([A-Za-z0-9_-]{1,64})\/face$/, async ({ m, token, req, ip }) => {
      limit("create", ip);
      const data = await readBody(req, FACE_MAX_BYTES);
      const mimeType = sniffImage(data);
      if (!mimeType) throw new HttpFail(415, "not_an_image", "That file is not a photo this app can use. Try another.");
      return growth.setFace({ memberId: m[1], token, image: { mimeType, data } });
    }],
    ["DELETE", /^\/api\/members\/([A-Za-z0-9_-]{1,64})\/face$/, async ({ m, token }) => ({ status: 204, body: await growth.removeFace({ memberId: m[1], token }) })],
    // a member's photo, for the crew only: the crew's link key or a member's (?t= for <img>)
    ["GET", /^\/api\/members\/([A-Za-z0-9_-]{1,64})\/face$/, async ({ m, token }) => {
      const f = await growth.getFace({ memberId: m[1], token });
      return { raw: f.data, headers: { "content-type": f.mimeType, "cache-control": "private, max-age=604800", "content-security-policy": "default-src 'none'", etag: `"${f.v}"` } };
    }],
    // a one-time card, seen: "another-crew", "status:<plan id>"
    ["POST", /^\/api\/members\/([A-Za-z0-9_-]{1,64})\/seen$/, async ({ m, token, req }) => growth.markSeen({ memberId: m[1], token, body: await readJson(req, 1024) })],
    // the preview images: /api/og/p/<plan id>.png?v=&k=, /api/og/c/<slug>.png?v=&k=, the discreet and generic ones
    ["GET", /^\/api\/og\/((?:p|c)\/[A-Za-z0-9_-]{1,64}|discreet-plan|discreet-crew|default)\.png$/, async ({ m, url }) => {
      if (!og) throw new AppError(404, "not_found", "There is nothing at that address.");
      const out = await og.imageFor({ name: m[1], key: url.searchParams.get("k") });
      if (!out) throw new AppError(404, "not_found", "There is nothing at that address.");
      // a change makes a new link (?v=), so a drawn card can be kept a day
      return { raw: out.png, headers: { "content-type": "image/png", "cache-control": "public, max-age=86400", etag: `"${out.v}"`, "content-security-policy": "default-src 'none'" } };
    }],
  ];
}
