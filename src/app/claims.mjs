// @ts-check
// A claimed job: background work on a stored document that one worker at a time may run,
// and whose outcome only that worker may record. Used for push deliveries and the sloth's
// first pick (src/app/service.mjs).
//
// Why: a lease or a "started at" time can run out while its worker is still alive but stuck
// (a slow push service, a Render instance put to sleep, two instances during a deploy). A
// second worker then takes the job over and finishes it. Without a check, the first worker
// wakes up and overwrites the newer outcome: a success becomes a failure to retry, and the
// push goes out again (the external review of d01a23b reproduced both).
//
// How: claiming writes a fresh attempt token and bumps the job's attempt count, in one atomic
// store update guarded by the caller's condition (`when`: due, or a lease that ran out).
// Completing or failing is a compare-and-set on that token and attempt count, so it lands
// only while the claim is still the current one; a stale worker gets null and records
// nothing. The attempt count is the job's own version: the document's `version` would also
// change with an unrelated write beside the job (a crew renamed while its first pick runs),
// which must not void the claim.

/** @typedef {import("../adapters/store.mjs").Store} Store */
/** @typedef {{ id: string, token: string, attempts: number, doc: any }} Claim */

/**
 * @param {{ store: Store, coll: string, at?: string, newToken: () => string }} opts
 *   at: the job's path inside the document ("firstPick"), or "" when the document is the job
 *   newToken: a fresh, unguessable attempt token per claim
 */
export function claimedJobs({ store, coll, at = "", newToken }) {
  const p = (/** @type {string} */ k) => (at ? `${at}.${k}` : k);
  const under = (/** @type {Record<string, any>} */ set) => Object.fromEntries(Object.entries(set).map(([k, v]) => [p(k), v]));
  /** @param {Claim} c */
  const mine = (c) => ({ [p("claim")]: c.token, [p("attempts")]: c.attempts });
  const read = (/** @type {any} */ doc, /** @type {string} */ k) => (at ? doc?.[at]?.[k] : doc?.[k]);

  return {
    /**
     * Claim the job when `when` matches: sets `set` (fields of the job), a fresh token and
     * one more attempt. Null when another worker holds it or it is not due.
     * @param {string} id
     * @param {{ when: Record<string, any>, set?: Record<string, any> }} input
     * @returns {Promise<Claim|null>}
     */
    async claim(id, { when, set = {} }) {
      const token = newToken();
      const { claim: _c, attempts: _a, ...rest } = set;
      const doc = await store.update(coll, id, { set: { ...under(rest), [p("claim")]: token }, inc: { [p("attempts")]: 1 } }, { ifMatch: when });
      if (!doc || read(doc, "claim") !== token) return null;
      return { id, token, attempts: Number(read(doc, "attempts")), doc };
    },
    /**
     * Record the outcome of a claim that is still current. The document after, or null
     * when the claim is stale (another worker took over): nothing is written then.
     * @param {Claim} c
     * @param {Record<string, any>} set  fields of the job
     */
    async complete(c, set) {
      const { claim: _c, attempts: _a, ...rest } = set;
      return store.update(coll, c.id, { set: under(rest) }, { ifMatch: mine(c) });
    },
    /** The same compare-and-set as complete, for a failure. @param {Claim} c @param {Record<string, any>} set */
    async fail(c, set) {
      return this.complete(c, set);
    },
  };
}
