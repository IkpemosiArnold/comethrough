// @ts-check
// The generic link preview card, drawn once and served as a file by the static site
// (web/public/og-card.png). The static site cannot draw a card per crew or plan, so every
// link it serves shows this one: the sloth on the branch, the name and one line. Drawn with
// the same code as the server's per-link cards (src/server/og.mjs).
//
// Run: node scripts/og-card.mjs   (writes web/public/og-card.png)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOg } from "../src/server/og.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "../web/public/og-card.png");

const og = createOg({ growth: /** @type {any} */ ({}), publicUrl: "https://comethrough.ikpemosi.work" });
const { png } = await og.render({ title: "Come through", when: "The lazy way to link up.", place: "You send one sentence. Your crew taps once.", going: [], count: null, discreet: false });
fs.writeFileSync(out, png);
console.log(JSON.stringify({ file: path.relative(process.cwd(), out), bytes: png.length }));
