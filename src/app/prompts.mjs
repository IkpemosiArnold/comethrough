// @ts-check
// Loads the Gemma prompts from src/core/prompts/*.md (the core never touches files).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IDEA_PROMPT_NAMES } from "../core/ideas.mjs";
import { PROMPT_NAMES, splitPrompt } from "../core/tasks.mjs";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../core/prompts");

/** @returns {Record<string, import("../core/tasks.mjs").Prompt>} */
export function loadPrompts() {
  return Object.fromEntries([...PROMPT_NAMES, ...IDEA_PROMPT_NAMES].map((n) => [n, splitPrompt(fs.readFileSync(path.join(dir, `${n}.md`), "utf8"), n)]));
}
