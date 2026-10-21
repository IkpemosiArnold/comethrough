// @ts-check
// The store port and its three implementations:
//   memory  tests
//   file    development: one JSON file per collection under DATA_DIR (.data/), written
//           atomically (temp file, then rename), one write at a time per collection
//   mongo   production: MongoDB Atlas through the official driver, chosen when MONGODB_URI
//           is set; indexes for every lookup, and TTL indexes so expired plans and cache
//           entries delete themselves
//
// The port is deliberately small: documents with a string `id`, equality filters on
// top-level fields, put (insert or replace) and delete. The app's repository functions in
// src/app build on it, so swapping databases never touches the core or the app logic.

import fs from "node:fs/promises";
import path from "node:path";

/**
 * @typedef {object} Store
 * @property {string} kind
 * @property {(coll: string, id: string) => Promise<any|null>} get
 * @property {(coll: string, filter: Record<string, any>) => Promise<any|null>} findOne
 * @property {(coll: string, filter?: Record<string, any>, opts?: { limit?: number }) => Promise<any[]>} find
 * @property {(coll: string, doc: { id: string, [key: string]: any }) => Promise<void>} put
 * @property {(coll: string, id: string) => Promise<boolean>} delete
 * @property {() => Promise<boolean>} ping
 * @property {() => Promise<void>} close
 */

export const COLLECTIONS = ["crews", "members", "plans", "push", "cache", "sent", "flyers"];

const matches = (/** @type {any} */ doc, /** @type {Record<string, any>} */ filter) => Object.entries(filter).every(([k, v]) => doc[k] === v);
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
  flyers: [[{ _expireAt: 1 }, { expireAfterSeconds: 0 }]],
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
