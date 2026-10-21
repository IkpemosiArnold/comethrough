// @ts-check
// Serves the built web app (web/dist) from the API server, so production is one origin:
// no CORS, and links like /c/uni-guys?t=... load the app (history routing falls back to
// index.html). Hashed assets are cached for a year; index.html and the service worker are
// always revalidated so a deploy reaches phones at once.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { BASE_HEADERS } from "./http.mjs";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8", ".ics": "text/calendar; charset=utf-8", ".map": "application/json",
};

/**
 * @param {string} dir
 * @returns {null | ((req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, pathname: string) => Promise<boolean>)}
 *   null when the folder does not exist; the handler resolves false when it did not answer
 */
export function staticHandler(dir) {
  if (!fs.existsSync(path.join(dir, "index.html"))) return null;
  const root = path.resolve(dir);
  return async (req, res, pathname) => {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    let rel;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return false;
    }
    if (rel.includes("\0")) return false;
    let file = path.resolve(root, `.${path.posix.normalize(`/${rel}`)}`);
    if (file !== root && !file.startsWith(root + path.sep)) return false; // no escaping the folder
    let st = await fsp.stat(file).catch(() => null);
    if (st?.isDirectory()) {
      file = path.join(file, "index.html");
      st = await fsp.stat(file).catch(() => null);
    }
    // an app route (no file extension) gets the app; a missing asset is a real 404
    if (!st) {
      if (path.extname(rel)) return false;
      file = path.join(root, "index.html");
      st = await fsp.stat(file).catch(() => null);
      if (!st) return false;
    }
    const ext = path.extname(file).toLowerCase();
    const name = path.basename(file);
    const immutable = /[.-][A-Za-z0-9_-]{8,}\.(js|css|woff2|png|svg|jpg|webp)$/.test(name) && file.includes(`${path.sep}assets${path.sep}`);
    res.writeHead(200, {
      ...BASE_HEADERS,
      "content-type": TYPES[/** @type {keyof typeof TYPES} */ (ext)] || "application/octet-stream",
      "content-length": String(st.size),
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      ...(name === "sw.js" ? { "service-worker-allowed": "/" } : {}),
    });
    if (req.method === "HEAD") {
      res.end();
      return true;
    }
    fs.createReadStream(file).pipe(res);
    return true;
  };
}
