// @ts-check
// The store port and its three implementations:
//   memory  tests
//   file    development: one JSON file per collection under DATA_DIR (.data/), written
//           atomically (temp file, then rename), one write at a time per collection
//   mongo   production: MongoDB Atlas through the official driver, chosen when MONGODB_URI
//           is set; indexes for every lookup, and TTL indexes so expired plans and cache
//           entries delete themselves
//
// The port is deliberately small: documents with a string `id`, filters on fields (equality,
// plus $in, $ne, $lt, $lte, $gt, $gte, $exists and $or), put (insert or replace), insert
// (only when new), update (targeted) and delete. The app's repository functions in src/app
// build on it, so swapping databases never touches the core or the app logic.
//
// Concurrency (docs/SPEC.md, "Concurrent writes"): `put` replaces a whole document, so it is
// for creating one. A change to a document that already exists goes through `update`: a
// targeted $set / $unset / $inc of the fields that changed, atomic in every store (Mongo's
// findOneAndUpdate; in memory and in the file store the read and the write happen in one
// synchronous step of the single process, which is the per-document lock), and every update
// bumps the document's `version`. A whole-document edit passes `ifMatch: { version }` and
// retries when someone else wrote first (optimistic concurrency).

import fs from "node:fs/promises";
import path from "node:path";

/**
 * @typedef {object} Store
 * @property {string} kind
 * @property {(coll: string, id: string) => Promise<any|null>} get
 * @property {(coll: string, filter: Record<string, any>) => Promise<any|null>} findOne
 * @property {(coll: string, filter?: Record<string, any>, opts?: { limit?: number }) => Promise<any[]>} find
 * @property {(coll: string, doc: { id: string, [key: string]: any }) => Promise<void>} put
 * @property {(coll: string, doc: { id: string, [key: string]: any }) => Promise<boolean>} insert  only when no document has this id; false when one does
 * @property {(coll: string, id: string, change: Change, opts?: { ifMatch?: Record<string, any> }) => Promise<any|null>} update
 *   atomic; the document after the change, or null when there is none or ifMatch does not match. Bumps `version`.
 * @property {(coll: string, id: string) => Promise<boolean>} delete
 * @property {() => Promise<boolean>} ping
 * @property {() => Promise<void>} close
 */

/**
 * A targeted change: fields by dotted path ("rsvps.m_1").
 * @typedef {{ set?: Record<string, any>, unset?: string[], inc?: Record<string, number> }} Change
 */

// meta: small server state, such as the awake window's month of warm hours (src/app/warm.mjs)
export const COLLECTIONS = ["crews", "members", "plans", "push", "cache", "sent", "deliveries", "podcache", "flyers", "faces", "meta"];

/** A path segment may not start with $ or hold a dot inside it (ids are [A-Za-z0-9_-]). */
const SAFE_PATH = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;
export const safePath = (/** @type {string} */ p) => SAFE_PATH.test(p);

const getPath = (/** @type {any} */ doc, /** @type {string} */ p) => p.split(".").reduce((o, k) => (o == null ? undefined : o[k]), doc);
function setPath(/** @type {any} */ doc, /** @type {string} */ p, /** @type {any} */ v) {
  const ks = p.split(".");
  let o = doc;
  for (const k of ks.slice(0, -1)) {
    if (o[k] == null || typeof o[k] !== "object") o[k] = {};
    o = o[k];
  }
  o[/** @type {string} */ (ks.at(-1))] = v;
}
function unsetPath(/** @type {any} */ doc, /** @type {string} */ p) {
  const ks = p.split(".");
  const o = getPath(doc, ks.slice(0, -1).join("."));
  if (ks.length === 1) delete doc[ks[0]];
  else if (o && typeof o === "object") delete o[/** @type {string} */ (ks.at(-1))];
}
const isOps = (/** @type {any} */ v) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0 && Object.keys(v).every((k) => k.startsWith("$"));
const same = (/** @type {any} */ a, /** @type {any} */ b) => (b === null ? a == null : a === b);
/** One field's condition, as Mongo reads it (the subset this app uses). */
function test1(/** @type {any} */ a, /** @type {any} */ cond) {
  if (!isOps(cond)) return same(a, cond);
  return Object.entries(cond).every(([op, v]) => {
    switch (op) {
      case "$in": return v.some((/** @type {any} */ x) => same(a, x));
      case "$ne": return !same(a, v);
      case "$lt": return a != null && a < v;
      case "$lte": return a != null && a <= v;
      case "$gt": return a != null && a > v;
      case "$gte": return a != null && a >= v;
      case "$exists": return (a !== undefined) === !!v;
      default: throw new TypeError(`unsupported filter operator ${op}`);
    }
  });
}
/** True when a document matches a filter. Exported for tests. */
export function matches(/** @type {any} */ doc, /** @type {Record<string, any>} */ filter) {
  return Object.entries(filter).every(([k, v]) => (k === "$or" ? v.some((/** @type {any} */ f) => matches(doc, f)) : test1(getPath(doc, k), v)));
}
/** Apply a change to a document in place (and bump its version). */
function applyChange(/** @type {any} */ doc, /** @type {Change} */ change) {
  for (const [p, v] of Object.entries(change.set || {})) setPath(doc, p, clone(v));
  for (const p of change.unset || []) unsetPath(doc, p);
  for (const [p, n] of Object.entries({ ...(change.inc || {}), version: (change.inc?.version ?? 0) + 1 })) setPath(doc, p, (Number(getPath(doc, p)) || 0) + n);
}
function checkChange(/** @type {Change} */ change) {
  const paths = [...Object.keys(change?.set || {}), ...(change?.unset || []), ...Object.keys(change?.inc || {})];
  for (const p of paths) if (!safePath(p) || p === "id" || p.startsWith("id.")) throw new TypeError(`bad field path ${p}`);
}
const clone = (/** @type {any} */ x) => (x == null ? x : structuredClone(x));

/** @returns {Store} */
export function memoryStore() {
  /** @type {Map<string, Map<string, any>>} */
  const data = new Map();
  const coll = (/** @type {string} */ c) => {
    let m = data.get(c);
    if (!m) data.set(c, (m = new Map()));
    return m;
  };
  return {
    kind: "memory",
    async get(c, id) {
      return clone(coll(c).get(id) ?? null);
    },
    async findOne(c, filter) {
      for (const d of coll(c).values()) if (matches(d, filter)) return clone(d);
      return null;
    },
    async find(c, filter = {}, { limit = Infinity } = {}) {
      const out = [];
      for (const d of coll(c).values()) {
        if (out.length >= limit) break;
        if (matches(d, filter)) out.push(clone(d));
      }
      return out;
    },
    async put(c, doc) {
      if (typeof doc?.id !== "string" || !doc.id) throw new TypeError("a document needs a string id");
      coll(c).set(doc.id, clone(doc));
    },
    async insert(c, doc) {
      if (typeof doc?.id !== "string" || !doc.id) throw new TypeError("a document needs a string id");
      if (coll(c).has(doc.id)) return false;
      coll(c).set(doc.id, clone(doc));
      return true;
    },
    async update(c, id, change, { ifMatch = {} } = {}) {
      checkChange(change);
      // read, check and write with no await in between: nothing else runs meanwhile
      const d = coll(c).get(id);
      if (!d || !matches(d, ifMatch)) return null;
      const next = clone(d);
      applyChange(next, change);
      coll(c).set(id, next);
      return clone(next);
    },
    async delete(c, id) {
      return coll(c).delete(id);
    },
    async ping() {
      return true;
    },
    async close() {},
  };
}

/**
 * JSON files under dir, for development. Loads each collection on first use.
 * @param {string} dir
 * @returns {Promise<Store>}
 */
export async function fileStore(dir) {
  await fs.mkdir(dir, { recursive: true });
  const mem = memoryStore();
  /** @type {Map<string, Promise<void>>} */
  const loaded = new Map();
  /** @type {Map<string, Promise<void>>} */
  const writing = new Map();
  const file = (/** @type {string} */ c) => {
    if (!/^[a-z]+$/.test(c)) throw new TypeError(`bad collection name ${c}`);
    return path.join(dir, `${c}.json`);
  };
  const load = (/** @type {string} */ c) => {
    let p = loaded.get(c);
    if (!p) {
      p = (async () => {
        let docs = [];
        try {
          docs = JSON.parse(await fs.readFile(file(c), "utf8"));
        } catch (e) {
          if (/** @type {any} */ (e).code !== "ENOENT") throw e;
        }
        for (const d of docs) await mem.put(c, d);
      })();
      loaded.set(c, p);
    }
    return p;
  };
  const save = (/** @type {string} */ c) => {
    const prev = writing.get(c) || Promise.resolve();
    const next = prev.then(async () => {
      const docs = await mem.find(c);
      const tmp = `${file(c)}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(docs, null, 1));
      await fs.rename(tmp, file(c));
    });
    writing.set(c, next.catch(() => {}));
    return next;
  };
  return {
    kind: "file",
    async get(c, id) {
      await load(c);
      return mem.get(c, id);
    },
    async findOne(c, filter) {
      await load(c);
      return mem.findOne(c, filter);
    },
    async find(c, filter, opts) {
      await load(c);
      return mem.find(c, filter, opts);
    },
    async put(c, doc) {
      await load(c);
      await mem.put(c, doc);
      await save(c);
    },
    async insert(c, doc) {
      await load(c);
      const fresh = await mem.insert(c, doc);
      if (fresh) await save(c);
      return fresh;
    },
    async update(c, id, change, opts) {
      await load(c);
      // the in-memory copy is the source of truth for this process; the change is applied
      // there atomically (see memoryStore), then the collection is written in order
      const after = await mem.update(c, id, change, opts);
      if (after) await save(c);
      return after;
    },
    async delete(c, id) {
      await load(c);
      const had = await mem.delete(c, id);
      if (had) await save(c);
      return had;
    },
    async ping() {
      return true;
    },
    async close() {
      await Promise.all([...writing.values()]);
    },
  };
}

/** Indexes per collection: [keys, options]. TTL indexes use the hidden _expireAt Date. */
export const MONGO_INDEXES = {
  crews: [[{ slug: 1 }, { unique: true }], [{ inviteToken: 1 }, { unique: true }]],
  members: [[{ token: 1 }, { unique: true }], [{ calToken: 1 }, { unique: true }], [{ crewId: 1 }, {}]],
  plans: [[{ crewId: 1 }, {}], [{ _expireAt: 1 }, { expireAfterSeconds: 0 }]],
  push: [[{ memberId: 1 }, {}], [{ crewId: 1 }, {}]],
  cache: [[{ _expireAt: 1 }, { expireAfterSeconds: 0 }]],
  sent: [[{ _expireAt: 1 }, { expireAfterSeconds: 0 }]],
  // push deliveries: the heartbeat looks for the ones due again (src/app/service.mjs, notify)
  deliveries: [[{ state: 1, nextAt: 1 }, {}], [{ _expireAt: 1 }, { expireAfterSeconds: 0 }]],
  // a plan's pods as last worked out with road routes (calendar reads use them, never OSRM)
  podcache: [[{ _expireAt: 1 }, { expireAfterSeconds: 0 }]],
  flyers: [[{ _expireAt: 1 }, { expireAfterSeconds: 0 }]],
  // a member's photo, by member id (about 27 KB as base64; Mongo's limit is 16 MB)
  faces: [[{ crewId: 1 }, {}]],
};

/**
 * MongoDB (Atlas). Documents keep their own `id` as `_id`. A document with an `expiresAt`
 * also gets `_expireAt` as a real Date, which MongoDB's TTL monitor needs.
 * @param {{ uri: string, db: string, appName?: string }} opts
 * @returns {Promise<Store>}
 */
export async function mongoStore({ uri, db: dbName, appName = "comethrough" }) {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(uri, { appName, maxPoolSize: 10, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(dbName);
  for (const [c, specs] of Object.entries(MONGO_INDEXES)) {
    for (const [keys, options] of specs) await db.collection(c).createIndex(/** @type {any} */ (keys), /** @type {any} */ (options));
  }
  const toDoc = (/** @type {any} */ d) => {
    if (!d) return null;
    const { _id, _expireAt, ...rest } = d;
    return rest;
  };
  return {
    kind: "mongo",
    async get(c, id) {
      return toDoc(await db.collection(c).findOne({ _id: /** @type {any} */ (id) }));
    },
    async findOne(c, filter) {
      return toDoc(await db.collection(c).findOne(filter));
    },
    async find(c, filter = {}, { limit = 0 } = {}) {
      const cur = db.collection(c).find(filter);
      if (limit && Number.isFinite(limit)) cur.limit(limit);
      return (await cur.toArray()).map(toDoc);
    },
    async put(c, doc) {
      if (typeof doc?.id !== "string" || !doc.id) throw new TypeError("a document needs a string id");
      /** @type {any} */
      const stored = { ...doc, _id: doc.id };
      const exp = Date.parse(/** @type {any} */ (doc).expiresAt);
      if (Number.isFinite(exp)) stored._expireAt = new Date(exp);
      await db.collection(c).replaceOne({ _id: stored._id }, stored, { upsert: true });
    },
    async insert(c, doc) {
      if (typeof doc?.id !== "string" || !doc.id) throw new TypeError("a document needs a string id");
      /** @type {any} */
      const stored = { ...doc, _id: doc.id };
      const exp = Date.parse(/** @type {any} */ (doc).expiresAt);
      if (Number.isFinite(exp)) stored._expireAt = new Date(exp);
      try {
        await db.collection(c).insertOne(stored);
        return true;
      } catch (e) {
        if (/** @type {any} */ (e).code === 11000 && /_id_/.test(String(/** @type {any} */ (e).message))) return false;
        throw e;
      }
    },
    async update(c, id, change, { ifMatch = {} } = {}) {
      checkChange(change);
      /** @type {any} */
      const u = {};
      if (change.set && Object.keys(change.set).length) u.$set = { ...change.set };
      if (change.unset?.length) u.$unset = Object.fromEntries(change.unset.map((p) => [p, ""]));
      u.$inc = { ...(change.inc || {}), version: (change.inc?.version ?? 0) + 1 };
      // the TTL date follows expiresAt
      const exp = Date.parse(change.set?.expiresAt);
      if (Number.isFinite(exp)) u.$set._expireAt = new Date(exp);
      const r = await db.collection(c).findOneAndUpdate(/** @type {any} */ ({ ...ifMatch, _id: id }), u, { returnDocument: "after" });
      return toDoc(r);
    },
    async delete(c, id) {
      return (await db.collection(c).deleteOne({ _id: /** @type {any} */ (id) })).deletedCount > 0;
    },
    async ping() {
      try {
        await db.command({ ping: 1 });
        return true;
      } catch {
        return false;
      }
    },
    async close() {
      await client.close();
    },
  };
}

/**
 * The store the config asks for: MongoDB when a URI is set, else files.
 * @param {{ mongoUri: string, mongoDb: string, dataDir: string }} cfg
 */
export async function openStore(cfg) {
  return cfg.mongoUri ? mongoStore({ uri: cfg.mongoUri, db: cfg.mongoDb }) : fileStore(cfg.dataDir);
}
