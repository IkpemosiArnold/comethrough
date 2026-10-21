// @ts-check
// Reading JSON out of a model's answer, and describing a schema in words.
//
// Adapted from Selects (github.com/IkpemosiArnold/selects, MIT), src/core/tasks.mjs:
// extractJson and schemaHint. Added here: repair of a cut-off answer (closing open strings,
// arrays and objects), and schema hints for nullable, number and boolean fields.
//
// Gemma on the Gemini API may or may not honour JSON mode (unconfirmed on 21 Oct 2026),
// so every answer goes through parseModelJson whether or not a schema was enforced.

/**
 * The first complete JSON object in a model's text: small models without constrained
 * decoding often wrap it in ```json fences or add a sentence around it. Returns the parsed
 * object, or null.
 * @param {string} text
 */
export function extractJson(text) {
  const t = String(text ?? "").replace(/```(?:json)?/gi, "");
  const start = t.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(t.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Repair an answer cut off by the token limit: close an open string, drop a dangling key
 * or comma, and close every open array and object. Returns the parsed object or null.
 * @param {string} text
 */
export function repairJson(text) {
  const t = String(text ?? "").replace(/```(?:json)?/gi, "");
  const start = t.indexOf("{");
  if (start < 0) return null;
  let body = t.slice(start);
  for (let attempt = 0; attempt < 8 && body.length > 1; attempt++) {
    /** @type {string[]} */
    const stack = [];
    let inStr = false;
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (inStr) {
        if (ch === "\\") i++;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
      else if (ch === "}" || ch === "]") stack.pop();
    }
    let fixed = body + (inStr ? '"' : "");
    // a trailing comma, colon or bare key cannot be closed meaningfully: drop it
    fixed = fixed.replace(/,\s*$/, "").replace(/,?\s*"[^"]*"\s*:\s*$/, "").replace(/,\s*"[^"]*"\s*$/, (m) => (stack.at(-1) === "}" ? "" : m));
    try {
      return JSON.parse(fixed + stack.reverse().join(""));
    } catch {
      // cut back to the last complete value and try again
      const cut = Math.max(body.lastIndexOf(",", body.length - 2), body.lastIndexOf("{", body.length - 2), body.lastIndexOf("[", body.length - 2));
      if (cut <= 0) return null;
      body = body.slice(0, body[cut] === "," ? cut : cut + 1);
    }
  }
  return null;
}

/** Parse a model's answer: the object itself, a wrapped object, or a repaired cut-off one. */
export function parseModelJson(text) {
  return extractJson(text) ?? repairJson(text);
}

/**
 * A one-line description of the answer's JSON shape, for a model that cannot be forced
 * into JSON mode. Example: {"title": "text" or null, "bring": ["text", ...]}.
 * @param {any} schema  a JSON Schema subset: type (string or [type, "null"]), enum, properties, items
 */
export function schemaHint(schema) {
  /** @param {any} s @returns {string} */
  const show = (s) => {
    if (!s) return '"text"';
    const types = Array.isArray(s.type) ? s.type : [s.type];
    const nullable = types.includes("null");
    const t = types.find((/** @type {string} */ x) => x !== "null");
    let out;
    if (s.enum) out = s.enum.filter((/** @type {any} */ e) => e !== null).map((/** @type {any} */ e) => JSON.stringify(e)).join(" or ");
    else if (t === "string") out = s.description ? `"${s.description}"` : '"text"';
    else if (t === "number" || t === "integer") out = s.minimum != null && s.maximum != null ? `${s.minimum}-${s.maximum}` : "0";
    else if (t === "boolean") out = "true or false";
    else if (t === "array") out = `[${show(s.items)}, ...]`;
    else if (t === "object") out = `{${Object.entries(s.properties || {}).map(([k, v]) => `"${k}": ${show(v)}`).join(", ")}}`;
    else out = "null";
    return nullable ? `${out} or null` : out;
  };
  return `Answer with only this JSON, nothing before or after it: ${show(schema)}`;
}
