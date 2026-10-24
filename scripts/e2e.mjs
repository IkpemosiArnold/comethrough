// @ts-check
// The whole app end to end over HTTP, against a running server (local or deployed):
//   create a crew from a sentence, four members join (Yaba, Lekki Phase 1, Surulere, Ikeja),
//   plans arrive by a sentence, a flyer image, a public event link and an Instagram link,
//   RSVPs, ride pods, the calendar feed and one event file (checked against RFC 5545),
//   and the heartbeat twice (it must be idempotent).
//
// Run: node scripts/e2e.mjs [base URL] [event page URL]
//   defaults: http://localhost:3000 and no event link. TICK_SECRET comes from the
//   environment or .env. Prints a JSON report; exits 1 when a check fails.
//   Tokens are never printed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "../src/config.mjs";
import { checkIcs } from "./ics-check.mjs";

loadDotEnv();
const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/+$/, "");
const EVENT_URL = process.argv[3] || "";
const FLYER = path.join(here, "../test/fixtures/flyer-mango-yard.png");
const FLYER_THUMB = path.join(here, "../test/fixtures/flyer-mango-yard-thumb.jpg");

/** @type {{ step: string, ok: boolean, ms: number, info?: any }[]} */
const steps = [];
let failed = 0;

/** @param {string} step @param {() => Promise<any>} fn */
async function check(step, fn) {
  const t0 = performance.now();
  try {
    const info = await fn();
    steps.push({ step, ok: true, ms: Math.round(performance.now() - t0), info });
    return info;
  } catch (e) {
    failed++;
    steps.push({ step, ok: false, ms: Math.round(performance.now() - t0), info: String(/** @type {any} */ (e)?.message || e).slice(0, 400) });
    return null;
  }
}

/** @param {any} cond @param {string} msg */
function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

/**
 * @param {string} method @param {string} p
 * @param {{ token?: string, json?: any, form?: FormData, raw?: boolean, headers?: Record<string, string> }} [o]
 */
async function call(method, p, o = {}) {
  /** @type {Record<string, string>} */
  const headers = { ...(o.headers || {}) };
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  let body;
  if (o.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(o.json);
  } else if (o.form) body = o.form;
  const res = await fetch(BASE + p, { method, headers, body });
  const text = await res.text();
  if (o.raw) return { status: res.status, headers: res.headers, text };
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, headers: res.headers, data };
}

const short = (/** @type {any} */ plan) => plan && { id: plan.id, kind: plan.kind, title: plan.title, start: plan.start, end: plan.end, place: plan.place && { name: plan.place.name, address: plan.place.address, pinned: plan.place.lat != null, outdoor: plan.place.outdoor, private: plan.place.private }, price: plan.price, bring: plan.bring, hostName: plan.hostName, weather: plan.weather, imageUrl: plan.source?.imageUrl ? "yes" : "no" };

const health = await check("healthz", async () => {
  const r = await call("GET", "/healthz");
  must(r.status === 200 && r.data.ok, `healthz ${r.status}`);
  return r.data;
});

// ---------------------------------------------------------------- crew
const SENTENCE = "the uni guys, every other Saturday, somewhere outside and cheap, around Yaba, Lekki and Surulere";
const draft = await check("crew draft from a sentence", async () => {
  const r = await call("POST", "/api/crews", { json: { sentence: SENTENCE } });
  must(r.status === 200, `status ${r.status} ${JSON.stringify(r.data)}`);
  must(r.data.draft?.name, "no crew name");
  return r.data;
});
const created = await check("create the crew, organiser joins from Yaba", async () => {
  must(draft, "no draft");
  const r = await call("POST", "/api/crews", { json: { confirm: draft.draft, organiser: { name: "Tolu", area: "Yaba" } } });
  must(r.status === 201, `status ${r.status} ${JSON.stringify(r.data)}`);
  must(r.data.inviteUrl && r.data.memberToken && r.data.calendarUrl, "missing links");
  return r.data;
});
const slug = created?.crew.slug;
const invite = created?.inviteToken;
/** @type {Record<string, { id: string, token: string, calendarUrl: string, notes: string[] }>} */
const who = {};
if (created) who.Tolu = { id: created.member.id, token: created.memberToken, calendarUrl: created.calendarUrl, notes: created.notes || [] };

const typeahead = await check("area type-ahead: Lekki Ph", async () => {
  const r = await call("GET", "/api/areas?q=Lekki%20Ph");
  must(r.status === 200 && r.data.results.length, "no results");
  return r.data.results.slice(0, 3).map((/** @type {any} */ x) => `${x.label} (${x.lat.toFixed(4)}, ${x.lon.toFixed(4)})`);
});
for (const [name, area] of /** @type {[string, any][]} */ ([["Amaka", "Lekki Phase 1"], ["Seyi", "Surulere"], ["Bayo", "Ikeja"]])) {
  await check(`${name} joins from ${area}`, async () => {
    const r = await call("POST", `/api/crews/${slug}/members`, { token: invite, json: { name, area } });
    must(r.status === 201, `status ${r.status} ${JSON.stringify(r.data)}`);
    must(r.data.memberUrl?.includes(`/c/${slug}?t=`), "memberUrl shape");
    who[name] = { id: r.data.member.id, token: r.data.memberToken, calendarUrl: r.data.calendarUrl, notes: r.data.notes };
    return { area: r.data.member.area.label, notes: r.data.notes };
  });
}
await check("crew read: members and their areas (labels only)", async () => {
  const r = await call("GET", `/api/crews/${slug}`, { token: who.Tolu.token });
  must(r.status === 200 && r.data.members.length === 4, `members ${r.data?.members?.length}`);
  must(!JSON.stringify(r.data.members).includes("lat"), "member coordinates leak");
  return r.data.members.map((/** @type {any} */ m) => `${m.name}: ${m.area.label}`);
});

// ---------------------------------------------------------------- plans
/**
 * Parse, then confirm like a person would: when Gemma left the start empty (or Gemma is
 * off), fill it in by hand with `fill`.
 * @param {string} label @param {string} memberName @param {() => Promise<any>} parse @param {Record<string, any>} [fill]
 */
async function addPlan(label, memberName, parse, fill = {}) {
  const parsed = await check(`parse: ${label}`, async () => {
    const r = await parse();
    must(r.status === 200, `status ${r.status} ${JSON.stringify(r.data)}`);
    return { ai: r.data.ai, model: r.data.model, low: r.data.low, notes: r.data.notes, draft: short(r.data.draft), _draft: r.data.draft };
  });
  if (!parsed) return null;
  const draftPlan = parsed._draft;
  delete parsed._draft;
  /** @type {string[]} */
  const filled = [];
  for (const [k, v] of Object.entries(fill)) {
    if (draftPlan[k] == null || (k === "place" && !draftPlan.place?.name)) {
      draftPlan[k] = v;
      filled.push(k);
    }
  }
  if (filled.length) parsed.filledByHand = filled;
  return check(`create: ${label}`, async () => {
    const r = await call("POST", `/api/crews/${slug}/plans`, { token: who[memberName].token, json: { plan: draftPlan } });
    must(r.status === 201, `status ${r.status} ${JSON.stringify(r.data)}`);
    return { plan: short(r.data.plan), id: r.data.plan.id, eventIcsUrl: !!r.data.plan.eventIcsUrl };
  });
}

const wine = await addPlan("a sentence (hosted)", "Tolu", () => call("POST", `/api/crews/${slug}/plans/parse`, { token: who.Tolu.token, json: { text: "wine and monopoly at mine friday 7, bring a bottle" } }));

const flyer = await addPlan("a flyer image", "Seyi", async () => {
  const form = new FormData();
  form.append("image", new Blob([fs.readFileSync(FLYER)], { type: "image/png" }), "flyer.png");
  if (fs.existsSync(FLYER_THUMB)) form.append("thumb", new Blob([fs.readFileSync(FLYER_THUMB)], { type: "image/jpeg" }), "thumb.jpg");
  return call("POST", `/api/crews/${slug}/plans/parse`, { token: who.Seyi.token, form });
}, { title: "Highlife Under Mangoes", start: "2026-10-31T17:00:00+01:00", place: { name: "The Mango Yard", address: "14 Adeyemo Close, off Bode Thomas, Surulere", outdoor: true, private: false } });

const link = EVENT_URL ? await addPlan(`a public event link (${new URL(EVENT_URL).hostname})`, "Amaka", () => call("POST", `/api/crews/${slug}/plans/parse`, { token: who.Amaka.token, json: { url: EVENT_URL } }), { start: "2026-11-07T18:00:00+01:00" }) : null;

await check("an Instagram link asks for the flyer picture instead", async () => {
  const r = await call("POST", `/api/crews/${slug}/plans/parse`, { token: who.Bayo.token, json: { url: "https://www.instagram.com/p/DAbCdEfGhIj/" } });
  must(r.status === 422 && r.data.error.code === "link_locked", `status ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.error;
});

// ---------------------------------------------------------------- RSVPs and pods
const rsvp = (/** @type {string} */ name, /** @type {string} */ planId, /** @type {any} */ v) => call("PATCH", `/api/plans/${planId}`, { token: who[name].token, json: { rsvp: v } });
let podsInfo = null;
if (wine) {
  await check("RSVPs on the hosted plan: going and maybe", async () => {
    for (const [n, v] of [["Amaka", "going"], ["Seyi", "going"], ["Bayo", "maybe"], ["Tolu", "going"]]) {
      const r = await rsvp(n, wine.id, v);
      must(r.status === 200, `${n}: ${r.status} ${JSON.stringify(r.data)}`);
    }
    const r = await call("GET", `/api/plans/${wine.id}`, { token: who.Bayo.token });
    must(r.data.plan.you === "maybe", "Bayo should be maybe");
    return { going: r.data.plan.going, maybe: r.data.plan.maybe };
  });
  podsInfo = await check("pods for the hosted plan (host not in a pod)", async () => {
    const r = await call("GET", `/api/plans/${wine.id}/pods`, { token: who.Amaka.token });
    must(r.status === 200, `status ${r.status}`);
    const all = r.data.pods.flatMap((/** @type {any} */ p) => p.memberIds);
    must(!all.includes(who.Tolu.id), "the host is in a pod");
    return r.data;
  });
}
if (flyer) {
  await check("pods for the flyer plan: drop-off text, ride apps and leave-by", async () => {
    for (const n of ["Tolu", "Amaka", "Seyi", "Bayo"]) await rsvp(n, flyer.id, n === "Bayo" ? "maybe" : "going");
    const r = await call("GET", `/api/plans/${flyer.id}/pods`, { token: who.Tolu.token });
    must(r.status === 200, `status ${r.status}`);
    for (const p of r.data.pods) {
      must(typeof p.destinationText === "string" && p.destinationText.length > 3, `drop-off ${p.destinationText}`);
      if (p.leaveBy) must(/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?\+01:00$/.test(p.leaveBy), `leaveBy ${p.leaveBy}`);
    }
    must(r.data.rides?.[0]?.name === "Bolt" && r.data.rides?.[1]?.name === "inDrive", `rides ${JSON.stringify(r.data.rides)}`);
    return r.data;
  });
}

// ---------------------------------------------------------------- calendars
await check("member calendar feed (RFC 5545)", async () => {
  const p = new URL(who.Amaka.calendarUrl).pathname;
  const r = await call("GET", p, { raw: true });
  must(r.status === 200, `status ${r.status}`);
  must(/^text\/calendar/.test(String(r.headers.get("content-type"))), "content type");
  const v = checkIcs(r.text);
  must(v.ok, v.errors.join("; "));
  const again = await call("GET", p, { raw: true, headers: { "if-none-match": String(r.headers.get("etag")) } });
  must(again.status === 304, `etag revalidation gave ${again.status}`);
  return { events: v.events, longestLine: v.longestLine, folded: v.folded, summaries: v.summaries };
});
if (wine) {
  await check("one event file (event.ics)", async () => {
    const r = await call("GET", `/api/plans/${wine.id}/event.ics?t=${encodeURIComponent(who.Seyi.token)}`, { raw: true });
    must(r.status === 200, `status ${r.status}`);
    must(/attachment/.test(String(r.headers.get("content-disposition"))), "disposition");
    const v = checkIcs(r.text);
    must(v.ok && v.events === 1, v.errors.join("; ") || `events ${v.events}`);
    return { summaries: v.summaries, folded: v.folded, alarms: v.alarms, disposition: r.headers.get("content-disposition") };
  });
}

// ---------------------------------------------------------------- the heartbeat
const secret = process.env.TICK_SECRET || "";
const tick1 = await check("tick 1", async () => {
  const r = await call("POST", "/api/tick", { headers: { authorization: `Bearer ${secret}` } });
  must(r.status === 200, `status ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
});
const tick2 = await check("tick 2 (idempotent: no second ritual)", async () => {
  const r = await call("POST", "/api/tick", { headers: { authorization: `Bearer ${secret}` } });
  must(r.status === 200 && r.data.rituals === 0, `second tick made ${r.data?.rituals} rituals`);
  return r.data;
});
await check("the ritual plan, with weather", async () => {
  const r = await call("GET", `/api/crews/${slug}`, { token: who.Bayo.token });
  const rituals = r.data.plans.filter((/** @type {any} */ p) => p.kind === "ritual");
  must(rituals.length === 1, `rituals: ${rituals.length}`);
  const p = rituals[0];
  // outdoor picks carry the forecast in `weather`; a covered pick made because of rain carries it in `rainPlan`.
  // Open-Meteo forecasts 7 days ahead, so a ritual further out (run on a Saturday afternoon,
  // an every-other-Saturday crew's next slot is 14 days away) has no forecast yet, honestly
  const daysOut = (Date.parse(p.start) - Date.now()) / 86_400_000;
  must(p.weather || p.rainPlan?.wanted?.rainProb != null || daysOut > 7, `no weather on the ritual (neither weather nor rainPlan), ${daysOut.toFixed(1)} days out`);
  return { ...short(p), why: p.why, invite: p.invite, rainPlan: p.rainPlan ?? null, aiNote: p.aiNote ?? null, ...(daysOut > 7 && !p.weather ? { beyondForecast: true } : {}) };
});

const report = { base: BASE, at: new Date().toISOString(), health, typeahead, failed, steps };
console.log(JSON.stringify(report, null, 1));
process.exit(failed ? 1 : 0);
