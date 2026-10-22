// @ts-check
// Writing to a document that already exists, without losing anyone else's change
// (docs/SPEC.md, "Concurrent writes"). Two tools:
//   - a targeted update (store.update with $set / $unset / $inc) when the change does not
//     depend on what else is in the document (an RSVP, a new name, the forecast);
//   - editDoc: read, work out the change from what was read, and write it only if nobody
//     wrote in between (the document's `version`), else read again and retry.

import { AppError } from "./errors.mjs";

/** How many times a guarded edit is tried before giving up with a 409. */
export const EDIT_TRIES = 6;

/**
 * Read a document, ask `fn` for the change, and write it under a version guard, retrying
 * on a conflict. `fn` may return null (nothing to change) and may be called more than
 * once, so it must not have side effects beyond what it returns.
 * @param {import("../adapters/store.mjs").Store} store
 * @param {string} coll
 * @param {string} id
 * @param {(doc: any) => Promise<import("../adapters/store.mjs").Change|null>|import("../adapters/store.mjs").Change|null} fn
 * @returns {Promise<{ before: any, after: any, changed: boolean }|null>}  null when there is no such document
 */
export async function editDoc(store, coll, id, fn) {
  for (let i = 0; i < EDIT_TRIES; i++) {
    const doc = await store.get(coll, id);
    if (!doc) return null;
    const change = await fn(doc);
    if (!change) return { before: doc, after: doc, changed: false };
    const after = await store.update(coll, id, change, { ifMatch: { version: doc.version ?? null } });
    if (after) return { before: doc, after, changed: true };
  }
  throw new AppError(409, "conflict", "Someone else changed this at the same moment. Try again.");
}

/**
 * The targeted change that turns `before` into `after`, field by top-level field, leaving
 * out the fields named in `skip` (ones written by their own targeted updates, like rsvps).
 * @param {Record<string, any>} before
 * @param {Record<string, any>} after
 * @param {string[]} [skip]
 * @returns {import("../adapters/store.mjs").Change|null}
 */
export function diffChange(before, after, skip = []) {
  const ignore = new Set(["id", "version", ...skip]);
  /** @type {Record<string, any>} */
  const set = {};
  /** @type {string[]} */
  const unset = [];
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (ignore.has(k)) continue;
    if (!(k in after) || after[k] === undefined) {
      if (k in before && before[k] !== undefined) unset.push(k);
    } else if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) set[k] = after[k];
  }
  return Object.keys(set).length || unset.length ? { set, unset } : null;
}
