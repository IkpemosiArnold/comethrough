// @ts-check
// Privacy-safe diagnostics: which fields came back empty, never what was in them. People's
// sentences, plans and names are never logged or stored (docs/SPEC.md), so this is how we
// see what the sloth misses for real users: field names and counts only.
//
//   emptyFields({ name: "The Gurls", vibe: null, taste: { likes: [], needs: ["safe"] } })
//     gives ["vibe", "taste.likes"]
//   droppedFields(gemma, read) gives the fields Gemma filled that code then emptied
//     (a check that was too strict, like the taste anchoring on 22 Oct 2026)

/** Fields that never count: bookkeeping, and Gemma's own working. */
const SKIP = new Set(["confidence", "basis", "source", "tz", "region"]);

const isEmpty = (/** @type {any} */ v) => v == null || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);
const isPlain = (/** @type {any} */ v) => v != null && typeof v === "object" && !Array.isArray(v);

/**
 * The names of the empty fields in a value, one level into nested objects ("taste.likes").
 * @param {any} value
 * @param {{ skip?: string[] }} [opts]
 * @returns {string[]}
 */
export function emptyFields(value, { skip = [] } = {}) {
  if (!isPlain(value)) return value == null ? ["(all)"] : [];
  /** @type {string[]} */
  const out = [];
  for (const [k, v] of Object.entries(value)) {
    if (SKIP.has(k) || skip.includes(k)) continue;
    if (isPlain(v) && Object.keys(v).length) {
      for (const [k2, v2] of Object.entries(v)) if (!SKIP.has(k2) && isEmpty(v2)) out.push(`${k}.${k2}`);
    } else if (isEmpty(v)) out.push(k);
  }
  return out.sort();
}

/**
 * The fields the model filled that ended up empty after code read them.
 * @param {any} raw   the model's answer
 * @param {any} read  what the app kept, with the same field names
 * @returns {string[]}
 */
export function droppedFields(raw, read) {
  if (!isPlain(raw) || !isPlain(read)) return [];
  const before = new Set(Object.keys(flat(raw)).filter((k) => !isEmpty(flat(raw)[k])));
  const after = flat(read);
  return [...before].filter((k) => k in after && isEmpty(after[k])).sort();
}

/** One level of nesting, flattened ("taste.likes"). */
function flat(/** @type {Record<string, any>} */ o) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (SKIP.has(k)) continue;
    if (isPlain(v) && Object.keys(v).length) for (const [k2, v2] of Object.entries(v)) { if (!SKIP.has(k2)) out[`${k}.${k2}`] = v2; }
    else out[k] = v;
  }
  return out;
}
