// @ts-check
// Writes the v2 persona eval's results: eval/results/v2-<set>.md (the numbers, with 95%
// Wilson intervals, the failures and every crew side by side), v2-<set>.json (the same
// without the raw artifacts), and the blind human sheet (markdown, plus JSON for
// `node eval/score.mjs`).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { whenWords } from "../src/server/basic.mjs";
import { ci, copyQuality, distinctness, hardChecks, median, pct, quantile, safetyChecks, suggestionsOf, tasteAlignment, wilson } from "./metrics.mjs";

const esc = (/** @type {any} */ s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const r0 = (/** @type {number|null} */ x) => (x == null ? "n/a" : String(Math.round(x)));
const sec = (/** @type {number|null} */ x) => (x == null ? "n/a" : `${(x / 1000).toFixed(1)} s`);

/** A seeded shuffle (mulberry32), for the human sheet's sample. */
function shuffled(/** @type {any[]} */ xs, /** @type {number} */ seed) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * @param {{ set: string, rows: { p: any, r: any }[], meta: any, resultsDir: string, file: any, suffix?: string }} input
 *   suffix: "-after-fix" for a labelled second scored test run (its own files, the baseline's untouched)
 * @returns {string[]} the files written
 */
export function writeReports({ set, rows, meta, resultsDir, file, suffix = "" }) {
  fs.mkdirSync(resultsDir, { recursive: true });
  const ok = rows.filter((x) => !x.r.error);
  const judged = rows.map(({ p, r }) => ({ p, r, hard: hardChecks(p, r), safety: safetyChecks(p, r) }));

  // ---- hard constraints
  const failing = judged.filter((j) => j.hard.some((c) => !c.pass));
  /** @type {Map<string, { n: number, fail: number, who: string[] }>} */
  const byCheck = new Map();
  for (const j of judged) {
    for (const c of j.hard) {
      const k = c.check.replace(/ \(.*\)$/, "");
      const e = byCheck.get(k) || { n: 0, fail: 0, who: [] };
      e.n++;
      if (!c.pass) {
        e.fail++;
        e.who.push(`${j.p.id}: ${c.detail}`);
      }
      byCheck.set(k, e);
    }
  }
  // ---- safety
  const sensitive = judged.filter((j) => j.p.hard?.discreetNoLabel);
  const sensFail = sensitive.filter((j) => j.hard.some((c) => c.check === "discreetNoLabel" && !c.pass) || j.r.error);
  const safetyFail = judged.filter((j) => j.safety.some((c) => !c.pass));
  // ---- taste
  const ta = ok.map(({ p, r }) => ({ p, ...tasteAlignment(p, r) }));
  const sugg = ta.reduce((s, x) => s + x.n, 0);
  const alignedN = ta.reduce((s, x) => s + x.aligned, 0);
  const rituals = ta.filter((x) => x.ritual != null);
  // chance level: the same suggestions judged against every other crew's interests
  let baseK = 0;
  let baseN = 0;
  for (const { p, r } of ok) {
    for (const o of ok) {
      if (o.p.id === p.id) continue;
      const t = tasteAlignment(p, r, o.p.taste);
      baseK += t.aligned;
      baseN += t.n;
    }
  }
  // ---- distinctness, travel, copy, latency, coverage
  const dist = distinctness(ok);
  const copy = copyQuality(ok);
  const ritualTrips = ok.map(({ r }) => r.ritual?.status !== "cancelled" ? r.ritual?.trips?.maxMin : null).filter((x) => Number.isFinite(x));
  const ideaTrips = ok.flatMap(({ r }) => (r.ideas || []).map((/** @type {any} */ i) => i.longest)).filter((x) => Number.isFinite(x));
  const lat = (/** @type {string} */ k) => ok.map(({ r }) => r.timings?.[k]).filter((x) => Number.isFinite(x));
  const made = ok.filter(({ r }) => r.ritual && r.ritual.status !== "cancelled");
  const skipped = ok.filter(({ r }) => r.ritual?.status === "cancelled");
  const noPlan = ok.filter(({ r }) => !r.ritual);
  const three = ok.filter(({ r }) => (r.ideas || []).length >= 3);
  const ideasMean = ok.length ? ok.reduce((s, { r }) => s + (r.ideas || []).length, 0) / ok.length : 0;
  const aiRead = ok.filter(({ r }) => r.draft?.ai);
  const satRead = ok.filter(({ r }) => r.rhythmRead?.day === 6);
  const nameRefused = ok.filter(({ r }) => r.nameRefused);
  const subgroup = (/** @type {(p: any) => string} */ f) => {
    /** @type {Map<string, { n: number, fail: number }>} */
    const m = new Map();
    for (const j of judged) {
      const k = f(j.p);
      const e = m.get(k) || { n: 0, fail: 0 };
      e.n++;
      if (j.hard.some((c) => !c.pass)) e.fail++;
      m.set(k, e);
    }
    return [...m.entries()].sort();
  };

  // ---- the markdown
  const L = [];
  const title = set === "test" ? `Persona eval v2: test set, ${meta.label === "after-fix" ? "after the crew-parsing fixes (second scored run)" : "baseline (first scored run)"}` : "Persona eval v2: dev set";
  L.push(`# ${title}`, "");
  if (meta.note) L.push(`_${esc(meta.note)}_`, "");
  if (meta.rerunReason) L.push(`**This is a second scored run of the test set. Reason given: ${esc(meta.rerunReason)}**`, "");
  L.push(`Run ${meta.at.slice(0, 16).replace("T", " ")} UTC, ${rows.length} crews (${set}), ${meta.llm}, app at git ${String(meta.git?.head).slice(0, 7)}${meta.git?.head ? "" : ""} (working tree as it stood, other builders' uncommitted changes included). Personas: \`eval/personas/v2.json\` (sha256 ${meta.sha.slice(0, 12)}, frozen). The app's clock: ${meta.clock}; the target is Saturday 24 October 2026 for every crew.`, "");
  L.push(`The world (eval/world/2026-10-24): ${meta.world.hits} answers replayed${meta.fast ? "" : " with their recorded latencies"}, ${meta.world.misses} misses${meta.world.misses ? ` (**the run is not clean**: ${[...new Set(meta.worldMisses.map((/** @type {any} */ m) => m.service))].join(", ")})` : ""}. Gemma: ${meta.llmStats.hits} answers from the eval's LLM cache (keyed by prompt hash), ${meta.llmStats.misses} misses; live calls so far across both sets: ${meta.ledger.liveCalls} of ${meta.ledger.cap}. Reproduce: \`node eval/run.mjs --set ${set} --replay${set === "test" ? " --scored" : ""}\`.`, "");
  if (meta.world.hitsExtended) {
    const ext = (meta.appends || []).filter((/** @type {any} */ a) => a.at >= meta.extendedSince);
    const by = /** @type {Record<string, number>} */ ({});
    for (const a of ext) for (const [k, v] of Object.entries(a.added.byService)) by[k] = (by[k] || 0) + /** @type {number} */ (v);
    const llmBy = /** @type {Record<string, number>} */ ({});
    for (const a of ext) for (const [k, v] of Object.entries(a.llm.liveByTask || {})) llmBy[k] = (llmBy[k] || 0) + /** @type {number} */ (v);
    L.push(`**The world was extended after the fixes of 22 Oct.** The fixed app asks different questions (geocoding without ", Lagos", other picks), so the requests it made that were not yet recorded were appended on ${[...new Set(ext.map((/** @type {any} */ a) => a.at.slice(0, 10)))].join(", ") || "a later day"}, for the same target date; nothing recorded earlier was overwritten, so the weather and places answered for earlier queries are unchanged. Appended in total: ${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}; Gemma ${Object.entries(llmBy).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}. In this run, ${meta.world.hitsExtended} of ${meta.world.hits} world answers came from the extension.`, "");
  }
  if (meta.llmStats.misses) L.push(`**${meta.llmStats.misses} Gemma answers were not in the cache** (${Object.entries(meta.llmStats.missByTask || {}).map(([k, v]) => `${k} ${v}`).join(", ")}): the eval's Gemma budget (250 live calls across both sets) was spent, so for these the app did what it does when Gemma is away, and used its own code.`, "");
  L.push("## Headline", "");
  L.push("| Measure | Result |", "|---|---|");
  L.push(`| Crews that ran end to end | ${ok.length} of ${rows.length} |`);
  L.push(`| **Crews with any hard-constraint violation** | **${ci(failing.length, judged.length)}** |`);
  L.push(`| Sensitive crews with an identity word or a need anywhere it should not be | ${ci(sensFail.length, sensitive.length)} |`);
  L.push(`| Crews failing an app-wide safety claim (identity word in the stored taste, vibe or name; the sentence kept) | ${ci(safetyFail.length, judged.length)} |`);
  L.push(`| Suggestions that fit the crew's interests (taste proxy) | ${ci(alignedN, sugg)}; chance level (the same suggestions against other crews' interests) ${pct(baseN ? baseK / baseN : null)} |`);
  L.push(`| Ritual picks that fit the crew's interests | ${ci(rituals.filter((x) => x.ritual).length, rituals.length)} |`);
  L.push(`| Crews with at least one suggestion that fits | ${ci(ta.filter((x) => x.any).length, ta.length)} |`);
  L.push(`| Distinctness: mean overlap (Jaccard) of two crews' suggestions | all pairs ${pct(dist.meanAll, 1)}; same-city pairs ${pct(dist.meanSameCity, 1)}; near-duplicate pairs (half or more shared) ${dist.nearDups.length} of ${dist.pairs} |`);
  L.push(`| Ritual made (not skipped for rain) | ${ci(made.length, ok.length)}; skipped for rain ${skipped.length}; no plan ${noPlan.length} |`);
  L.push(`| Crews given 3 ideas | ${ci(three.length, ok.length)}; mean ideas per crew ${ideasMean.toFixed(1)} |`);
  L.push(`| Travel, ritual: longest trip per crew (pack estimate) | median ${r0(median(ritualTrips))} min, max ${r0(ritualTrips.length ? Math.max(...ritualTrips) : null)} min |`);
  L.push(`| Travel, ideas: longest trip per idea | median ${r0(median(ideaTrips))} min, max ${r0(ideaTrips.length ? Math.max(...ideaTrips) : null)} min |`);
  L.push(`| Copy: reasons and invites checked | ${copy.n}; stock AI phrases ${copy.banned.length}; dashes ${copy.dashes.length}; reading grade median ${copy.gradeMedian?.toFixed(1) ?? "n/a"} (90th percentile ${copy.gradeP90?.toFixed(1) ?? "n/a"}) |`);
  L.push(`| Copy: length | reasons median ${r0(copy.reasonLen.median)} chars (max ${copy.reasonLen.max}); invites median ${r0(copy.inviteLen.median)} (max ${copy.inviteLen.max}) |`);
  L.push(`| Copy: the same sentence template in 3 or more crews | ${ci(copy.inRepeated, copy.n)} of texts; ideas' reasons written by code (Gemma's failed the checks or was away) ${ci(copy.byCode, copy.byKnown)} |`);
  L.push(`| Gemma read the setup sentence | ${ci(aiRead.length, ok.length)}; the day read as Saturday ${ci(satRead.length, ok.length)}; crew names refused for an identity word ${nameRefused.length} |`);
  L.push(`| Latency per crew${meta.fast ? " (replayed without latencies: compute and the app's own pacing only)" : " (replayed with the recorded latencies)"} | setup ${sec(median(lat("draft")))} median (p90 ${sec(quantile(lat("draft"), 0.9))}); first pick ${sec(median(lat("pick")))} (p90 ${sec(quantile(lat("pick"), 0.9))}); ideas ${sec(median(lat("ideas")))} (p90 ${sec(quantile(lat("ideas"), 0.9))}); whole crew ${sec(median(lat("total")))} (max ${sec(lat("total").length ? Math.max(...lat("total")) : null)}) |`);
  L.push("");
  L.push("## Hard constraints, by check", "");
  L.push("| Check | Crews it applies to | Violations | Rate (95% CI) |", "|---|---|---|---|");
  for (const [k, e] of [...byCheck.entries()].sort((a, b) => b[1].fail - a[1].fail || a[0].localeCompare(b[0]))) {
    const w = wilson(e.fail, e.n);
    L.push(`| ${k} | ${e.n} | ${e.fail} | ${pct(w.p)} (${pct(w.lo)} to ${pct(w.hi)}) |`);
  }
  L.push("", "### Every violation", "");
  for (const [k, e] of [...byCheck.entries()].filter(([, e]) => e.fail)) {
    L.push(`**${k}**`, "");
    for (const w of e.who) L.push(`- ${esc(w)}`);
    L.push("");
  }
  L.push("## Subgroups (crews with any violation)", "");
  L.push("| Dimension | Value | Crews | With a violation |", "|---|---|---|---|");
  for (const [dim, f] of /** @type {[string, (p: any) => string][]} */ ([["language", (p) => p.dims.language], ["region", (p) => p.dims.region], ["sensitive", (p) => p.dims.sensitive ?? "none"], ["budget", (p) => p.dims.budget], ["age", (p) => p.dims.age]])) {
    for (const [v, e] of subgroup(f)) L.push(`| ${dim} | ${v} | ${e.n} | ${e.fail} (${pct(e.n ? e.fail / e.n : null)}) |`);
  }
  L.push("", "## Safety", "");
  for (const j of sensitive) {
    const c = j.hard.find((x) => x.check === "discreetNoLabel");
    L.push(`- **${esc(j.p.label)}** (${j.p.id}): ${c ? (c.pass ? "clean everywhere checked" : `**${esc(c.detail)}**`) : `did not run: ${esc(j.r.error)}`}. Stored needs: ${esc((j.r.crew?.taste?.needs || []).join(", ") || "none")}.`);
  }
  L.push("", "Checked for each sensitive crew: the setup draft, the stored crew, members and plans, the first pick, the ideas card, the invite, the calendar feed, push payloads, the plain plan page and the one-tap page (what a WhatsApp link preview reads), the crew page, the WhatsApp share text, the app's logs and every app cache entry written while the crew was served. Place and event names are taken out first. Outbound (invite, calendar, push, plain pages, share text) must also carry none of the needs (discreet, low-key, women-friendly, inclusive, safe).", "");
  const sf = Object.entries(meta.llmStats.sensitiveFieldsSeen || {});
  L.push(`Gemma's crew readings that put a word for who the crew is into a field (dropped by the app's code, and scrubbed in the eval's cache): ${sf.length ? sf.map(([k, v]) => `${k} ${v}`).join("; ") : "none"}.`, "");
  if (safetyFail.length) {
    L.push("App-wide claims that failed:", "");
    for (const j of safetyFail) for (const c of j.safety.filter((x) => !x.pass)) L.push(`- ${j.p.id}: ${c.check}: ${esc(c.detail)}`);
    L.push("");
  }
  L.push("## Distinctness", "");
  L.push(`Most common ritual picks: ${dist.topRitual.map(([n, c]) => `${esc(n)} (${c})`).join(", ") || "none"}. Most common suggestions overall: ${dist.topAny.map(([n, c]) => `${esc(n)} (${c})`).join(", ")}.`, "");
  if (dist.nearDups.length) {
    L.push("Near-duplicate pairs:", "");
    for (const d of dist.nearDups.slice(0, 15)) L.push(`- ${d.a} and ${d.b}: ${pct(d.j)} overlap (${d.shared.map(esc).join(", ")})`);
    L.push("");
  }
  L.push("## Copy", "");
  if (copy.repeated.length) {
    L.push("Templates repeated across 3 or more crews (names, numbers and days taken out):", "");
    for (const x of copy.repeated) L.push(`- ${x.crews} crews: "${esc(x.skeleton)}"`);
    L.push("");
  }
  if (copy.banned.length) {
    L.push("Stock phrases:", "");
    for (const b of copy.banned.slice(0, 15)) L.push(`- ${b.persona}: "${esc(b.phrase)}" in "${esc(b.text)}"`);
    L.push("");
  }
  if (copy.dashes.length) {
    L.push("Dashes:", "");
    for (const d of copy.dashes.slice(0, 10)) L.push(`- ${d.persona}: "${esc(d.text)}"`);
    L.push("");
  }
  L.push("## Every crew", "");
  L.push("| Crew | Sentence | Read as | Ritual | Ideas | Violations |", "|---|---|---|---|---|---|");
  for (const j of judged) {
    const { p, r } = j;
    if (r.error) {
      L.push(`| ${p.id} | ${esc(p.sentence)} | | **error**: ${esc(r.error)} | | |`);
      continue;
    }
    const t = r.crew?.taste || {};
    const read = [`budget ${r.crew?.budget}`, t.placeKinds?.length ? `kinds: ${t.placeKinds.join(", ")}` : "no kinds", t.needs?.length ? `needs: ${t.needs.join(", ")}` : null, `areas: ${(r.crew?.areas || []).map((/** @type {any} */ a) => a.label).join(", ")}`, `zone ${r.crew?.tz}`].filter(Boolean).join("; ");
    const rit = r.ritual ? `**${esc(r.ritual.place?.name)}** (${esc(r.ritual.kind ?? "place")}${r.ritual.rain ? `, rain: ${r.ritual.rain}` : ""}${r.ritual.status === "cancelled" ? ", skipped" : ""}), ${esc(r.ritual.start?.slice(0, 16))} to ${esc(r.ritual.end?.slice(11, 16))}${r.ritual.trips ? `, longest trip ${Math.round(r.ritual.trips.maxMin)} min` : ""}. ${esc(r.ritual.why ?? "")}` : `none (${esc(r.pick?.reason)})`;
    const ids = (r.ideas || []).map((/** @type {any} */ i, /** @type {number} */ k) => `${k + 1}. **${esc(i.title)}** (${esc(i.kind === "place" ? i.placeKind ?? "place" : i.kind)}${i.price ? `, ${esc(i.price.text)}` : ""}${i.start ? `, ${esc(i.start.slice(5, 16))}` : ""}): ${esc(i.why)} _[${i.by}]_`).join("<br>") || "none";
    const v = j.hard.filter((c) => !c.pass).map((c) => `${c.check}: ${esc(c.detail)}`).join("<br>") || "none";
    L.push(`| ${p.id} | ${esc(p.sentence)} | ${esc(read)} | ${rit} | ${ids} | ${v} |`);
  }
  L.push("", "## Invites", "");
  for (const { p, r } of ok) L.push(`- **${p.id}:** ${esc(r.ritual?.invite ?? "none")}`);
  L.push("", "## How each measure works", "");
  L.push("- **Hard constraints** (eval/metrics.mjs, `hardChecks`): every crew has areasOnMap (each area it names is read and pinned within its tolerance of the real neighbourhood), cityCorrect (the crew's centre, areas and every suggestion are in its city; no Lagos guide events elsewhere) and timezoneCorrect. Then its own: noAlcohol (no bar, pub or club by OpenStreetMap kind; no event, reason or invite about drink), noNightlife (no nightlife kind, no party night, nothing from 9 pm), kidFriendly (both, and nothing from 8 pm), maxPrice (no stated price or entry fee over the ceiling; free only means none), budgetRead, stepFree (nothing tagged wheelchair=no, no beach), needsInclude (the stored needs), withinHours (the times the crew said), maxTripMin, discreetNoLabel (see Safety). A crew fails if any one check fails.", "- **Taste alignment** is a deterministic proxy: a suggestion fits when its OpenStreetMap kind is one the crew's interests point to, or an event's title or venue has one of their keywords (eval/personas/v2.json, `taste`), or it is the night in offered to a crew that needs discretion. Chance level judges the same suggestions against every other crew's interests.", "- **Distinctness** is the Jaccard overlap of two crews' suggestion names (the ritual and the ideas).", "- **Travel** uses the city pack's own travel estimate from each named area, at the plan's time.", "- **Copy** checks every ritual reason, invite and idea reason: stock AI phrases (a fixed list), dashes, the Flesch-Kincaid grade, length, and templates that repeat once names, numbers and days are taken out.", "- **Intervals** are 95% Wilson score intervals.", "");
  L.push("<!-- analysis -->", "");
  const md = path.join(resultsDir, `v2-${set}${suffix}.md`);
  fs.writeFileSync(md, L.join("\n"));

  // ---- the JSON (no raw artifacts: the stores and pages stay in the run folder)
  const json = path.join(resultsDir, `v2-${set}${suffix}.json`);
  fs.writeFileSync(json, `${JSON.stringify({ meta: { ...meta, worldNew: meta.worldNew?.length ?? 0 }, crews: judged.map(({ p, r, hard, safety }) => ({ id: p.id, sentence: p.sentence, error: r.error, timings: r.timings, read: r.crew ? { budget: r.crew.budget, taste: r.crew.taste, areas: r.crew.areas, tz: r.crew.tz, rhythmRead: r.rhythmRead } : null, ritual: r.ritual ? { ...r.ritual } : null, ideas: r.ideas, notes: r.cardNotes, hard, safety, taste: r.error ? null : tasteAlignment(p, r) })) }, null, 1)}\n`);

  // ---- the blind human sheet
  const pool = shuffled(ok.filter(({ r }) => r.ritual || (r.ideas || []).length), 20261024).slice(0, 20);
  const crews = pool.map(({ p, r }, k) => ({
    n: k + 1,
    key: crypto.createHash("sha256").update(`v2:${p.id}`).digest("hex").slice(0, 10),
    sentence: p.sentence,
    ritual: r.ritual ? { place: r.ritual.place?.name, when: whenWords(r.ritual.start, r.ritual.end, r.crew?.tz || "UTC"), skipped: r.ritual.status === "cancelled", note: r.ritual.status === "cancelled" ? r.ritual.rainNote : null, why: r.ritual.why } : null,
    invite: r.ritual?.invite ?? null,
    ideas: (r.ideas || []).map((/** @type {any} */ i) => ({ title: i.title, when: i.when, why: i.why, price: i.price?.text ?? null })),
  }));
  const sheetBase = set === "test" ? `v2-human-sheet${suffix}` : "v2-dev-human-sheet";
  const H = [`# Persona eval v2${set === "test" ? "" : " (dev)"}: human scores`, "", `${crews.length} crews from the ${set} set, in random order (seed 20261024), with nothing but what the crew typed and what the sloth answered. For each: **fit** from 1 (wrong for this crew) to 5 (exactly what they would pick), and a flag for anything off (unsafe, wrong city, wrong time, a bad sentence, a place that is not what it says). On a phone: \`node eval/score.mjs${set === "test" ? (suffix ? ` --sheet ${suffix.slice(1)}` : "") : " --sheet dev"}\` and open the address it prints.`, ""];
  for (const c of crews) {
    H.push(`## Crew ${c.n}`, "", `> ${c.sentence}`, "");
    if (c.ritual) H.push(`**The sloth's pick:** ${c.ritual.skipped ? `skipped (${c.ritual.note ?? "rain"})` : `${c.ritual.place}, ${c.ritual.when}`}${c.ritual.why ? `. ${c.ritual.why}` : ""}`, "");
    if (c.invite) H.push(`**Invite:** ${c.invite}`, "");
    H.push("**3 ideas:**", "");
    c.ideas.forEach((i, k) => H.push(`${k + 1}. ${i.title} (${i.when}${i.price ? `, ${i.price}` : ""}): ${i.why}`));
    if (!c.ideas.length) H.push("(none)");
    H.push("", "Fit (1 to 5): ___   Flag: ___________", "");
  }
  const sheetMd = path.join(resultsDir, `${sheetBase}.md`);
  const sheetJson = path.join(resultsDir, `${sheetBase}.json`);
  fs.writeFileSync(sheetMd, H.join("\n"));
  fs.writeFileSync(sheetJson, `${JSON.stringify({ set, at: meta.at, crews }, null, 1)}\n`);
  return [md, json, sheetMd, sheetJson];
}

export { suggestionsOf };
