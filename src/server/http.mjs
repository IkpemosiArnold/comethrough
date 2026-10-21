// @ts-check
// HTTP plumbing: the client address behind proxies, rate limits, body readers (JSON and
// multipart with an image), image type sniffing, and JSON responses.
//
// makeLimiter and clientIp are adapted from Selects (github.com/IkpemosiArnold/selects,
// MIT), server-proxy/server.mjs, including its measured finding that on Render behind
// Cloudflare the real client is the 3rd X-Forwarded-For entry from the right.

/** @typedef {import("node:http").IncomingMessage} Req */
/** @typedef {import("node:http").ServerResponse} Res */

export class HttpFail extends Error {
  /** @param {number} status @param {string} code @param {string} message */
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** A fixed-window counter: allow(key, limit, windowMs) -> { ok, retrySec }. */
export function makeLimiter(now = () => Date.now()) {
  /** @type {Map<string, { start: number, n: number }>} */
  const buckets = new Map();
  return {
    /** @param {string} key @param {number} limit @param {number} windowMs */
    allow(key, limit, windowMs) {
      const t = now();
      let b = buckets.get(key);
      if (!b || t - b.start >= windowMs) {
        b = { start: t, n: 0 };
        buckets.set(key, b);
      }
      if (b.n >= limit) return { ok: false, retrySec: Math.ceil((b.start + windowMs - t) / 1000) };
      b.n++;
      return { ok: true, retrySec: 0 };
    },
    sweep() {
      const t = now();
      for (const [k, b] of buckets) if (t - b.start > 86400000) buckets.delete(k);
    },
  };
}

/**
 * The rate-limit key. X-Forwarded-For is a list the client starts: anyone can send
 * "X-Forwarded-For: 1.2.3.4", and each proxy appends the address it saw. The left-most
 * entry is the client's choice and must never be trusted. With `hops` trusted proxies the
 * real client is the hops-th entry from the right (Render behind Cloudflare: 3, measured on
 * 21 Oct 2026 for Selects: "client, cloudflare-edge, render-internal"). With no proxy
 * (hops 0, local runs and tests) the socket address is the only truth.
 * Check after a deploy: `curl -H 'X-Forwarded-For: 1.2.3.4' <api>/healthz` must report your
 * own address in "you".
 * @param {Req} req
 * @param {number} hops
 */
export function clientIp(req, hops = 0) {
  if (hops > 0) {
    const xs = String(req.headers["x-forwarded-for"] || "").split(",").map((x) => x.trim()).filter(Boolean);
    if (xs.length >= hops) return xs[xs.length - hops];
  }
  return req.socket.remoteAddress || "unknown";
}

/**
 * Read the body up to maxBytes (413 beyond it).
 * @param {Req} req
 * @param {number} maxBytes
 * @returns {Promise<Buffer>}
 */
export function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes) {
      req.resume();
      reject(new HttpFail(413, "too_large", tooLargeMessage(maxBytes)));
      return;
    }
    /** @type {Buffer[]} */
    const chunks = [];
    let n = 0;
    let done = false;
    req.on("data", (c) => {
      if (done) return;
      n += c.length;
      if (n > maxBytes) {
        done = true;
        req.resume();
        reject(new HttpFail(413, "too_large", tooLargeMessage(maxBytes)));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!done) resolve(Buffer.concat(chunks));
    });
    req.on("error", (e) => {
      if (!done) reject(e);
    });
  });
}

const tooLargeMessage = (/** @type {number} */ max) => `That is too large (the limit is ${max >= 1048576 ? `${Math.round(max / 1048576)} MB` : `${Math.round(max / 1024)} KB`}).`;

/** Parse a JSON body (an empty body is {}). */
export async function readJson(req, maxBytes = 32 * 1024) {
  const buf = await readBody(req, maxBytes);
  if (!buf.length) return {};
  try {
    const v = JSON.parse(buf.toString("utf8"));
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  } catch {}
  throw new HttpFail(400, "bad_json", "The request body must be a JSON object.");
}

/**
 * A minimal multipart/form-data parser for one request already in memory: text fields
 * and files. At most `maxParts` parts.
 * @param {Buffer} body
 * @param {string} contentType
 * @param {{ maxParts?: number }} [opts]
 * @returns {{ fields: Record<string, string>, files: Record<string, { filename: string, contentType: string, data: Buffer }> }}
 */
export function parseMultipart(body, contentType, { maxParts = 8 } = {}) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!m) throw new HttpFail(400, "bad_form", "The form is missing its boundary.");
  const boundary = Buffer.from(`--${(m[1] || m[2]).trim()}`);
  /** @type {Record<string, string>} */
  const fields = {};
  /** @type {Record<string, { filename: string, contentType: string, data: Buffer }>} */
  const files = {};
  let pos = body.indexOf(boundary);
  if (pos < 0) throw new HttpFail(400, "bad_form", "The form could not be read.");
  let parts = 0;
  for (;;) {
    pos += boundary.length;
    if (body.subarray(pos, pos + 2).toString() === "--") break; // the closing boundary
    if (body.subarray(pos, pos + 2).toString() === "\r\n") pos += 2;
    const headEnd = body.indexOf("\r\n\r\n", pos);
    if (headEnd < 0) throw new HttpFail(400, "bad_form", "The form could not be read.");
    const head = body.subarray(pos, headEnd).toString("utf8");
    const next = body.indexOf(boundary, headEnd + 4);
    if (next < 0) throw new HttpFail(400, "bad_form", "The form ended early.");
    const data = body.subarray(headEnd + 4, next - 2); // minus the CRLF before the boundary
    if (++parts > maxParts) throw new HttpFail(400, "bad_form", "The form has too many parts.");
    const disp = /content-disposition:[^\r\n]*/i.exec(head)?.[0] || "";
    const name = /\bname="([^"]*)"/i.exec(disp)?.[1];
    const filename = /\bfilename="([^"]*)"/i.exec(disp)?.[1];
    const type = /content-type:\s*([^\r\n;]+)/i.exec(head)?.[1]?.trim().toLowerCase() || "application/octet-stream";
    if (name) {
      if (filename != null) files[name] = { filename, contentType: type, data: Buffer.from(data) };
      else fields[name] = data.toString("utf8");
    }
    pos = next;
  }
  return { fields, files };
}

/**
 * The real type of an image from its first bytes (the client's Content-Type is not
 * trusted). JPEG, PNG, WebP and HEIC/HEIF, the types Gemma reads; null for anything else.
 * @param {Buffer} b
 */
export function sniffImage(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (b.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = b.subarray(8, 12).toString("latin1");
    if (["heic", "heix", "hevc", "hevx", "heim", "heis"].includes(brand)) return "image/heic";
    if (["mif1", "msf1"].includes(brand)) return "image/heif";
  }
  return null;
}

/** Headers on every response. Referrer-Policy matters: links carry tokens in ?t=. */
export const BASE_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};

/**
 * @param {Res} res
 * @param {number} status
 * @param {any} body
 * @param {Record<string, string>} [headers]
 */
export function sendJson(res, status, body, headers = {}) {
  if (status === 204 || body == null) {
    res.writeHead(status === 200 ? 204 : status, { ...BASE_HEADERS, "cache-control": "no-store", ...headers });
    res.end();
    return;
  }
  const text = JSON.stringify(body);
  res.writeHead(status, { ...BASE_HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": String(Buffer.byteLength(text)), ...headers });
  res.end(text);
}

/** The token from Authorization: Bearer, or ?t=. */
export function tokenOf(req, url) {
  const auth = String(req.headers.authorization || "");
  const m = /^Bearer\s+(\S+)$/i.exec(auth);
  return m?.[1] || url.searchParams.get("t") || null;
}
