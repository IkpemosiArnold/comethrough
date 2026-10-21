// @ts-check
// Ids, link tokens and slugs. Tokens carry 192 random bits (base64url), so a link cannot
// be guessed; ids are shorter because they are not secrets.

import crypto from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"; // Crockford base32, lower case

/** n random base32 characters. */
export function randomBase32(n) {
  const bytes = crypto.randomBytes(n);
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHABET[bytes[i] & 31];
  return s;
}

/** @typedef {{ id(prefix: string): string, token(): string, suffix(): string }} Ids */

/** @returns {Ids} */
export function makeIds() {
  return {
    id: (prefix) => `${prefix}_${randomBase32(12)}`,
    token: () => crypto.randomBytes(24).toString("base64url"),
    suffix: () => randomBase32(4),
  };
}

/** "The Uni Guys!" -> "the-uni-guys" (ASCII letters and digits, at most 32 characters). */
export function slugify(name) {
  const s = String(name || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "");
  return s || "crew";
}

/** Compare two secrets in constant time. */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ""));
  const y = Buffer.from(String(b ?? ""));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

/** A short stable id for a push endpoint (so subscribing twice does not duplicate). */
export const endpointId = (/** @type {string} */ endpoint) => `ps_${crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 32)}`;
