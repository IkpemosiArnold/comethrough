// @ts-check
// Which fields are empty for real crews and plans, without reading anyone's words.
//
//   MONGODB_URI=... node scripts/live-report.mjs        the live store (read only)
//   DATA_DIR=.data node scripts/live-report.mjs         a local file store
//   ... --json                                          the same as JSON
//
// It only ever reads (find and countDocuments; no index is created, nothing is written),
// and it prints field names, counts, kinds, statuses and dates. Never a name, a sentence,
// a vibe, a place, a token or an id: crews and plans are numbered in the order they were made.
// We do not keep what people type (docs/SPEC.md), so this and the `gemma_fields` and
// `gemma_read` log lines are how we see what the sloth leaves empty for real users.

import fs from "node:fs";
import path from "node:path";
import { memberInvite } from "../src/core/plans.mjs";
import { plainTaste } from "../src/core/taste.mjs";

const asJson = process.argv.includes("--json");
const empty = (/** @type {any} */ v) => v == null || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);
const day = (/** @type {any} */ s) => (typeof s === "string" ? s.slice(0, 10) : "?");

/** Read every crew, member and plan, read only. */
async function load() {
  const uri = process.env.MONGODB_URI;
  if (uri) {
    const { MongoClient } = await import("mongodb");
    const client = new MongoClient(uri, { appName: "comethrough-live-report", serverSelectionTimeoutMS: 15000, readPreference: "secondaryPreferred" });
    await client.connect();
    try {
      const db = client.db(process.env.MONGODB_DB || "comethrough");
      const all = (/** @type {string} */ c) => db.collection(c).find({}, { projection: { _id: 0 } }).toArray();
      return { crews: await all("crews"), members: await all("members"), plans: await all("plans"), source: "mongo" };
    } finally {
      await client.close();
    }
  }
  const dir = path.resolve(process.env.DATA_DIR || ".data");
  const read = (/** @type {string} */ c) => {
    const f = path.join(dir, `${c}.json`);
    if (!fs.existsSync(f)) return [];
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    return Array.isArray(j) ? j : Object.values(j);
  };
  return { crews: read("crews"), members: read("members"), plans: read("plans"), source: "files" };
}

/** The empty fields of a crew, by name. */
function crewGaps(/** @type {any} */ c) {
  const t = c.taste || {};
  const gaps = [];
  if (empty(c.vibe)) gaps.push("vibe");
  if (empty(c.vibeTags)) gaps.push("vibeTags");
  if (!c.budget || c.budget === "any") gaps.push("budget(any)");
  if (!c.rhythm) gaps.push("rhythm");
  if (empty(c.areas)) gaps.push("areas");
  else if (c.areas.some((/** @type {any} */ a) => a.lat == null)) gaps.push("areas.unpinned");
  if (!c.region?.center) gaps.push("region.center");
  for (const k of ["scenes", "likes", "placeKinds", "eventKeywords", "avoid", "needs", "ageBand", "energy"]) if (empty(t[k])) gaps.push(`taste.${k}`);
  if (!c.firstPick) gaps.push("firstPick");
  // the vibe names taste words the taste has none of (the 22 Oct 2026 bug), as a flag only
  if (c.vibe && empty(t.likes) && plainTaste(c.vibe).likes.length) gaps.push("taste.likes(vibe says more)");
  return gaps;
}

/** The empty fields of a plan, by name. */
function planGaps(/** @type {any} */ p) {
  const gaps = [];
  if (empty(p.title)) gaps.push("title");
  if (empty(p.place?.name)) gaps.push("place.name");
  if (empty(p.place?.address)) gaps.push("place.address");
  if (p.place?.lat == null && !p.place?.near) gaps.push("place.pin");
  if (!p.price) gaps.push("price");
  if (empty(p.bring)) gaps.push("bring");
  if (empty(p.note)) gaps.push("note");
  if (empty(p.why)) gaps.push("why");
  if (empty(p.invite)) gaps.push(memberInvite(p) ? "invite(stored; shown from bring and note)" : "invite");
  if (empty(p.confidence)) gaps.push("confidence");
  if (!p.weather) gaps.push("weather");
  // a start at exactly noon from text with no time was the silent default before 22 Oct 2026
  if (typeof p.start === "string" && p.start.slice(11, 16) === "12:00" && p.kind !== "ritual") gaps.push("start(noon, check)");
  return gaps;
}

const { crews, members, plans, source } = await load();
crews.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
/** @type {Record<string, number>} */
const crewCount = {};
/** @type {Record<string, number>} */
const planCount = {};
const rows = crews.map((c, i) => {
  const gaps = crewGaps(c);
  gaps.forEach((g) => (crewCount[g] = (crewCount[g] || 0) + 1));
  const own = plans.filter((p) => p.crewId === c.id).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return {
    crew: i + 1,
    made: day(c.createdAt),
    members: members.filter((m) => m.crewId === c.id).length,
    rhythm: !!c.rhythm,
    firstPick: c.firstPick?.status ?? null,
    empty: gaps,
    plans: own.map((p, j) => {
      const g = planGaps(p);
      g.forEach((x) => (planCount[`${p.kind}: ${x}`] = (planCount[`${p.kind}: ${x}`] || 0) + 1));
      return { plan: j + 1, kind: p.kind, status: p.status, made: day(p.createdAt), from: p.source?.image ? "flyer" : p.source?.url ? "link" : p.source?.text ? "text" : p.kind === "ritual" ? "sloth" : "?", empty: g };
    }),
  };
});
const kinds = plans.reduce((/** @type {Record<string, number>} */ a, p) => ((a[p.kind] = (a[p.kind] || 0) + 1), a), {});
const sorted = (/** @type {Record<string, number>} */ o) => Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

if (asJson) {
  console.log(JSON.stringify({ source, crews: crews.length, members: members.length, plans: plans.length, planKinds: kinds, crewEmpty: Object.fromEntries(sorted(crewCount)), planEmpty: Object.fromEntries(sorted(planCount)), rows }, null, 1));
} else {
  console.log(`Store: ${source}. ${crews.length} crews, ${members.length} members, ${plans.length} plans (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(", ") || "none"}).`);
  console.log("\nEmpty crew fields (crews with it empty, of " + crews.length + "):");
  for (const [k, n] of sorted(crewCount)) console.log(`  ${String(n).padStart(3)}  ${k}`);
  console.log("\nEmpty plan fields, by kind (plans with it empty):");
  for (const [k, n] of sorted(planCount)) console.log(`  ${String(n).padStart(3)}  ${k}`);
  console.log("\nPer crew:");
  for (const r of rows) {
    console.log(`  crew ${r.crew} (made ${r.made}, ${r.members} members, ${r.rhythm ? "regular day" : "no regular day"}, first pick ${r.firstPick ?? "none"}): ${r.empty.join(", ") || "nothing empty"}`);
    for (const p of r.plans) console.log(`    plan ${p.plan} ${p.kind} from ${p.from}, ${p.status}, made ${p.made}: ${p.empty.join(", ") || "nothing empty"}`);
  }
}
