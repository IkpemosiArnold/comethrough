// @ts-check
// Before and after on the same frozen world: two runs of a set (their v2-<set>.json files),
// side by side, every rate with its 95% Wilson interval.
//
//   node eval/compare.mjs eval/results/v2-dev-before.json eval/results/v2-dev.json > table.md

import fs from "node:fs";
import { ci, copyQuality, distinctness, median, pct } from "./metrics.mjs";

const [beforeFile, afterFile] = process.argv.slice(2);
if (!beforeFile || !afterFile) {
  console.error("node eval/compare.mjs <before.json> <after.json>");
  process.exit(2);
}
const personas = JSON.parse(fs.readFileSync(new URL("./personas/v2.json", import.meta.url), "utf8")).personas;

/** The measures of one run, from its JSON. */
export function measures(/** @type {any} */ run) {
  const crews = run.crews;
  const rows = crews.map((/** @type {any} */ c) => ({
    p: personas.find((/** @type {any} */ p) => p.id === c.id),
    r: { ...c, crew: c.read, exemptNames: [c.ritual?.place?.name, ...(c.ideas || []).flatMap((/** @type {any} */ i) => [i.title, i.place?.name])].filter(Boolean) },
  }));
  const ok = rows.filter((/** @type {any} */ x) => !x.r.error);
  const fail = crews.filter((/** @type {any} */ c) => (c.hard || []).some((/** @type {any} */ h) => !h.pass)).length;
  const sens = crews.filter((/** @type {any} */ c) => (c.hard || []).some((/** @type {any} */ h) => h.check === "discreetNoLabel"));
  const sensFail = sens.filter((/** @type {any} */ c) => c.error || c.hard.some((/** @type {any} */ h) => h.check === "discreetNoLabel" && !h.pass)).length;
  const safety = crews.filter((/** @type {any} */ c) => (c.safety || []).some((/** @type {any} */ s) => !s.pass)).length;
  const t = crews.filter((/** @type {any} */ c) => c.taste);
  const sugg = t.reduce((/** @type {number} */ s, /** @type {any} */ c) => s + c.taste.n, 0);
  const fit = t.reduce((/** @type {number} */ s, /** @type {any} */ c) => s + c.taste.aligned, 0);
  const rit = t.filter((/** @type {any} */ c) => c.taste.ritual != null);
  const dist = distinctness(ok);
  const copy = copyQuality(ok);
  const ritTrips = ok.map((/** @type {any} */ x) => (x.r.ritual?.status !== "cancelled" ? x.r.ritual?.trips?.maxMin : null)).filter((/** @type {any} */ x) => Number.isFinite(x));
  const ideaTrips = ok.flatMap((/** @type {any} */ x) => (x.r.ideas || []).map((/** @type {any} */ i) => i.longest)).filter((/** @type {any} */ x) => Number.isFinite(x));
  const byCheck = new Map();
  for (const c of crews) for (const h of c.hard || []) {
    const k = h.check.replace(/ \(.*\)$/, "");
    const e = byCheck.get(k) || { n: 0, fail: 0 };
    e.n++;
    if (!h.pass) e.fail++;
    byCheck.set(k, e);
  }
  const made = ok.filter((/** @type {any} */ x) => x.r.ritual && x.r.ritual.status !== "cancelled").length;
  const three = ok.filter((/** @type {any} */ x) => (x.r.ideas || []).length >= 3).length;
  return {
    n: crews.length, fail, sens: sens.length, sensFail, safety, sugg, fit, rit: rit.length, ritFit: rit.filter((/** @type {any} */ c) => c.taste.ritual).length,
    anyFit: t.filter((/** @type {any} */ c) => c.taste.any).length, t: t.length, dist, copy, ritTrips, ideaTrips, byCheck, made, three, ok: ok.length,
  };
}

const B = measures(JSON.parse(fs.readFileSync(beforeFile, "utf8")));
const A = measures(JSON.parse(fs.readFileSync(afterFile, "utf8")));
const L = [];
L.push("| Measure | Before | After |", "|---|---|---|");
L.push(`| **Crews with any hard-constraint violation** | ${ci(B.fail, B.n)} | **${ci(A.fail, A.n)}** |`);
L.push(`| Sensitive crews with an identity word or need where it should not be | ${ci(B.sensFail, B.sens)} | ${ci(A.sensFail, A.sens)} |`);
L.push(`| Crews failing an app-wide safety claim | ${ci(B.safety, B.n)} | ${ci(A.safety, A.n)} |`);
L.push(`| Suggestions that fit the crew's interests | ${ci(B.fit, B.sugg)} | ${ci(A.fit, A.sugg)} |`);
L.push(`| Ritual picks that fit | ${ci(B.ritFit, B.rit)} | ${ci(A.ritFit, A.rit)} |`);
L.push(`| Crews with at least one fitting suggestion | ${ci(B.anyFit, B.t)} | ${ci(A.anyFit, A.t)} |`);
L.push(`| Mean overlap between two crews' suggestions (all pairs; same city) | ${pct(B.dist.meanAll, 1)}; ${pct(B.dist.meanSameCity, 1)} | ${pct(A.dist.meanAll, 1)}; ${pct(A.dist.meanSameCity, 1)} |`);
L.push(`| Near-duplicate pairs | ${B.dist.nearDups.length} of ${B.dist.pairs} | ${A.dist.nearDups.length} of ${A.dist.pairs} |`);
L.push(`| Ritual made (not skipped) | ${ci(B.made, B.ok)} | ${ci(A.made, A.ok)} |`);
L.push(`| Crews given 3 ideas | ${ci(B.three, B.ok)} | ${ci(A.three, A.ok)} |`);
L.push(`| Ritual longest trip: median, max (min) | ${Math.round(median(B.ritTrips) ?? NaN)}, ${Math.round(Math.max(...B.ritTrips))} | ${Math.round(median(A.ritTrips) ?? NaN)}, ${Math.round(Math.max(...A.ritTrips))} |`);
L.push(`| Ideas longest trip: median, max (min) | ${Math.round(median(B.ideaTrips) ?? NaN)}, ${Math.round(Math.max(...B.ideaTrips))} | ${Math.round(median(A.ideaTrips) ?? NaN)}, ${Math.round(Math.max(...A.ideaTrips))} |`);
L.push(`| Copy: stock phrases; dashes; reading grade (median) | ${B.copy.banned.length}; ${B.copy.dashes.length}; ${B.copy.gradeMedian?.toFixed(1)} | ${A.copy.banned.length}; ${A.copy.dashes.length}; ${A.copy.gradeMedian?.toFixed(1)} |`);
L.push(`| Copy: texts in a template shared by 3 or more crews | ${ci(B.copy.inRepeated, B.copy.n)} | ${ci(A.copy.inRepeated, A.copy.n)} |`);
L.push(`| Idea reasons written by code | ${ci(B.copy.byCode, B.copy.byKnown)} | ${ci(A.copy.byCode, A.copy.byKnown)} |`);
L.push("", "| Check | Before (violations of crews) | After |", "|---|---|---|");
for (const k of [...new Set([...B.byCheck.keys(), ...A.byCheck.keys()])].sort()) {
  const b = B.byCheck.get(k) || { n: 0, fail: 0 };
  const a = A.byCheck.get(k) || { n: 0, fail: 0 };
  L.push(`| ${k} | ${b.fail} of ${b.n} | ${a.fail} of ${a.n} |`);
}
console.log(L.join("\n"));
