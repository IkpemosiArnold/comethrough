// @ts-check
// The HTTP API end to end over real HTTP, with every outside service faked and the clock
// fixed at Wednesday 21 Oct 2026, 10:00 in Lagos.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { config } from "../src/config.mjs";
import { createService } from "../src/app/service.mjs";
import { makeIds } from "../src/app/ids.mjs";
import { loadPrompts } from "../src/app/prompts.mjs";
import { fakeAi, fakeGeocoder, fakeOverpass, fakePageMeta, fakePush, fakeWeather, OFFLINE_ANSWERS } from "../src/adapters/fakes.mjs";
import { memoryStore } from "../src/adapters/store.mjs";
import { clientIp } from "../src/server/http.mjs";
import { createApi } from "../src/server/server.mjs";
import { PLACES } from "./fixtures/lagos.mjs";

let clock = Date.parse("2026-10-21T09:00:00Z");
const now = () => clock;
const WINE = "wine and monopoly at mine friday 7, bring a bottle";
const answers = {
  ...OFFLINE_ANSWERS,
  "parse-crew": { name: "the uni guys", vibe: "outside and cheap", vibeTags: ["outside", "chill"], budget: "cheap", every: "2w", day: "Saturday", from: "3pm", to: "7pm", areas: ["Yaba", "Lekki"], confidence: { name: 0.9, vibe: 0.9, rhythm: 0.9, areas: 0.9 } },
  "parse-plan": (/** @type {string} */ user) =>
    user.includes("wine")
      ? { kind: "hosted", title: "Wine and monopoly", dateWords: "friday", date: "2026-10-23", startTime: "7", endTime: null, atHost: true, venueName: null, address: null, outdoor: false, priceText: null, free: null, hostName: null, bring: ["a bottle"], confidence: { title: 0.9, date: 0.9, time: 0.8, place: 0.8, price: 0, host: 0.9 } }
      : { kind: "found", title: "Beach day", dateWords: "saturday", date: null, startTime: "2pm", endTime: "6pm", atHost: false, venueName: "Tarkwa Bay", address: null, outdoor: true, priceText: null, free: null, hostName: null, bring: [], confidence: { title: 0.8, date: 0.8, time: 0.9, place: 0.8, price: 0, host: 0 } },
  "explain-pick": { why: "Freedom Park sits in the middle, so nobody crosses the whole city." },
  "write-invite": { invite: "Saturday at Freedom Park, 16:00 to 19:00. Come through if you can, no need to reply." },
};
const ai = fakeAi({ answers });
const push = fakePush();
const store = memoryStore();
let rainy = false;
const weather = fakeWeather({ rain: (_d, h) => (rainy ? 90 : h >= 12 && h <= 14 ? 60 : 10) });
let base = "";
/** @type {import("node:http").Server} */
let server;
let webDir = "";

before(async () => {
  webDir = await fs.mkdtemp(path.join(os.tmpdir(), "ct-web-"));
  await fs.writeFile(path.join(webDir, "index.html"), '<!doctype html><title>Come Through</title><noscript><a href="?basic=1">Open the basic version</a></noscript>');
  await fs.mkdir(path.join(webDir, "assets"), { recursive: true });
  await fs.writeFile(path.join(webDir, "assets", "index-AbCdEf12.js"), `export const app = ${JSON.stringify("come through ".repeat(400))};\n`);
  const cfg = { ...config({ PUBLIC_URL: "https://api.comethrough.test", WEB_URL: "https://comethrough.test", WEB_ORIGIN: "https://comethrough.test", TICK_SECRET: "s3cret-tick", STATIC_DIR: webDir }), imageMaxBytes: 4096 };
  const service = createService({
    store, ai, push, weather, now,
    geocoder: fakeGeocoder(),
    places: fakeOverpass([PLACES.freedom, PLACES.jakande, PLACES.muri]),
    pages: fakePageMeta(),
    spots: [{ name: "Tarkwa Bay", kind: "beach", lat: 6.3999, lon: 3.3956, osm: { type: "node", id: 1, tags: { name: "Tarkwa Bay", natural: "bay" } } }],
    prompts: loadPrompts(),
    ids: makeIds(),
    cfg,
  });
  server = createApi({ service, cfg, now });
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(null)));
  base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
});
after(async () => {
  server.close();
  await fs.rm(webDir, { recursive: true });
});

/** @param {string} method @param {string} p @param {{ token?: string, body?: any, headers?: Record<string,string>, raw?: any }} [o] */
async function call(method, p, { token, body, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (body !== undefined) h["content-type"] = "application/json";
  const res = await fetch(base + p, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

/** state shared by the steps below, which run in order */
const S = /** @type {any} */ ({});

test("start a crew: Gemma's draft, then confirm with the organiser joining", async () => {
  const d = await call("POST", "/api/crews", { body: { sentence: "the uni guys, every other Saturday, somewhere outside and cheap, around Yaba and Lekki" } });
  assert.equal(d.status, 200);
  assert.deepEqual(d.json.draft.rhythm, { every: "2w", day: 6, window: { from: "15:00", to: "19:00" } });
  assert.deepEqual(d.json.draft.areas.map((/** @type {any} */ a) => a.label), ["Yaba", "Lekki"]);
  assert.ok(d.json.draft.areas.every((/** @type {any} */ a) => typeof a.lat === "number"));
  const c = await call("POST", "/api/crews", { body: { confirm: d.json.draft, organiser: { name: "Tolu", area: "Yaba" } } });
  assert.equal(c.status, 201);
  assert.match(c.json.crew.slug, /^the-uni-guys-[0-9a-z]{4}$/);
  assert.equal(c.json.inviteUrl, `https://comethrough.test/c/${c.json.crew.slug}?t=${encodeURIComponent(c.json.inviteToken)}`);
  assert.ok(c.json.memberToken.length >= 32);
  assert.match(c.json.webcalUrl, /^webcal:\/\/api\.comethrough\.test\/cal\/[A-Za-z0-9_-]+\.ics$/);
  Object.assign(S, { slug: c.json.crew.slug, invite: c.json.inviteToken, tolu: c.json.memberToken, toluId: c.json.member.id, cal: c.json.calendarUrl });
});

test("join with the invite link, using a picked area", async () => {
  const areas = await call("GET", "/api/areas?q=Lek");
  assert.equal(areas.json.results[0].label, "Lekki Phase 1");
  const j = await call("POST", `/api/crews/${S.slug}/members`, { token: S.invite, body: { name: "Kene", area: areas.json.results[0] } });
  assert.equal(j.status, 201);
  assert.deepEqual(j.json.member.area, { label: "Lekki Phase 1" }, "coordinates are not echoed to the crew");
  S.kene = j.json.memberToken;
  S.keneId = j.json.member.id;
  const ada = await call("POST", `/api/crews/${S.slug}/members`, { token: S.invite, body: { name: "Ada", area: "Yaba" } });
  S.ada = ada.json.memberToken;
  S.adaId = ada.json.member.id;
  assert.equal((await call("POST", `/api/crews/${S.slug}/members`, { token: S.invite, body: { name: "  " } })).status, 400);
});

test("auth: no token, a wrong token, another crew's token", async () => {
  assert.equal((await call("GET", `/api/crews/${S.slug}`)).status, 401);
  const wrong = await call("GET", `/api/crews/${S.slug}`, { token: "nope" });
  assert.equal(wrong.status, 403);
  assert.match(wrong.json.error.message, /stopped working/);
  assert.equal((await call("GET", "/api/crews/no-such-crew", { token: S.invite })).status, 404);
  assert.equal((await call("GET", "/api/nothing")).status, 404);
  assert.equal((await call("PUT", `/api/crews/${S.slug}`)).status, 405);
});

test("a hosted plan from one sentence: draft, confirm, and the private address", async () => {
  const p = await call("POST", `/api/crews/${S.slug}/plans/parse`, { token: S.tolu, body: { text: WINE } });
  assert.equal(p.status, 200);
  assert.equal(p.json.draft.start, "2026-10-23T19:00:00+01:00");
  assert.equal(p.json.draft.host, S.toluId);
  assert.ok(p.json.low.includes("start"), "a bare 7 is highlighted");
  assert.ok(p.json.notes.includes('Read "7" as 7pm.'));
  const guestParse = await call("POST", `/api/crews/${S.slug}/plans/parse`, { token: S.invite, body: { text: WINE } });
  assert.equal(guestParse.status, 403);
  const draft = { ...p.json.draft, place: { ...p.json.draft.place, address: "12 Herbert Macaulay Way, Yaba" } };
  const c = await call("POST", `/api/crews/${S.slug}/plans`, { token: S.tolu, body: { plan: draft } });
  assert.equal(c.status, 201);
  S.wine = c.json.plan.id;
  assert.equal(c.json.plan.you, "going", "the host is going");
  assert.match(c.json.plan.eventIcsUrl, /\/api\/plans\/p_[a-z0-9]+\/event\.ics\?t=/);
  const asGuest = await call("GET", `/api/crews/${S.slug}`, { token: S.invite });
  const gp = asGuest.json.plans.find((/** @type {any} */ x) => x.id === S.wine);
  assert.equal(gp.place.address, null);
  assert.equal(gp.place.hidden, true);
  assert.ok(!asGuest.text.includes("Herbert Macaulay"));
  assert.equal(asGuest.json.you, null);
  const asMember = await call("GET", `/api/crews/${S.slug}`, { token: S.kene });
  assert.equal(asMember.json.plans.find((/** @type {any} */ x) => x.id === S.wine).place.address, "12 Herbert Macaulay Way, Yaba");
  assert.equal(asMember.json.you.name, "Kene");
  assert.equal(asMember.json.members.length, 3);
  // a bad draft names its fields
  const bad = await call("POST", `/api/crews/${S.slug}/plans`, { token: S.tolu, body: { plan: { title: "", start: "friday" } } });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.json.error.fields.map((/** @type {any} */ f) => f.field).sort(), ["start", "title"]);
});

test("push: subscribe, then new plans and pods buzz the right people once", async () => {
  const sub = (/** @type {string} */ n) => ({ subscription: { endpoint: `https://push.example/${n}`, keys: { p256dh: "BKey", auth: "auth" } } });
  assert.equal((await call("POST", `/api/members/${S.keneId}/push-subscription`, { token: S.kene, body: sub("kene") })).status, 204);
  assert.equal((await call("POST", `/api/members/${S.adaId}/push-subscription`, { token: S.ada, body: sub("ada") })).status, 204);
  assert.equal((await call("POST", `/api/members/${S.adaId}/push-subscription`, { token: S.kene, body: sub("x") })).status, 403, "only for yourself");
  assert.equal((await call("GET", "/api/push/key")).json.publicKey, "BFakePublicKeyForTests");
  push.sent.length = 0;
  // a found plan with an image upload (multipart)
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  const form = new FormData();
  form.append("text", "beach day saturday");
  form.append("image", new Blob([png], { type: "image/png" }), "flyer.png");
  const parsed = await call("POST", `/api/crews/${S.slug}/plans/parse`, { token: S.tolu, raw: form });
  assert.equal(parsed.status, 200);
  // the small upload is kept as the flyer thumbnail, at an unguessable URL
  assert.match(parsed.json.draft.source.imageUrl, /^https:\/\/api\.comethrough\.test\/api\/flyers\/f_[A-Za-z0-9_-]{32}$/);
  const flyerPath = new URL(parsed.json.draft.source.imageUrl).pathname;
  const flyer = await fetch(base + flyerPath);
  assert.equal(flyer.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await flyer.arrayBuffer()), png);
  assert.deepEqual(ai.calls.at(-1).messages[1].images[0].mimeType, "image/png");
  assert.equal(parsed.json.draft.start, "2026-10-24T14:00:00+01:00");
  assert.equal(parsed.json.draft.place.outdoor, true);
  assert.deepEqual([parsed.json.draft.place.lat, parsed.json.draft.place.lon], [6.3999, 3.3956], "a known spot is pinned without a geocode");
  assert.ok(parsed.json.notes.includes("Pinned at Tarkwa Bay."));
  const created = await call("POST", `/api/crews/${S.slug}/plans`, { token: S.tolu, body: { plan: parsed.json.draft } });
  S.beach = created.json.plan.id;
  assert.equal(created.json.plan.source.imageUrl, parsed.json.draft.source.imageUrl, "the plan keeps its flyer");
  assert.equal(created.json.plan.source.flyerId, undefined, "the internal id stays inside");
  assert.deepEqual(push.sent.map((m) => m.endpoint).sort(), ["https://push.example/ada", "https://push.example/kene"]);
  assert.match(push.sent[0].title, /^New plan: Beach day$/);
  assert.equal(created.json.plan.weather.rainProb, 60, "an outdoor plan gets the forecast for its own hours");
  // not an image, and too big
  const fake = new FormData();
  fake.append("image", new Blob([Buffer.from("<svg></svg>xxxxxxxx")], { type: "image/png" }), "x.png");
  assert.equal((await call("POST", `/api/crews/${S.slug}/plans/parse`, { token: S.tolu, raw: fake })).status, 415);
  const big = new FormData();
  big.append("image", new Blob([Buffer.concat([png, Buffer.alloc(5000)])], { type: "image/png" }), "x.png");
  assert.equal((await call("POST", `/api/crews/${S.slug}/plans/parse`, { token: S.tolu, raw: big })).status, 413);
});

test("RSVP, ride pods, the one-event file and the feed", async () => {
  push.sent.length = 0;
  const r = await call("PATCH", `/api/plans/${S.wine}`, { token: S.ada, body: { rsvp: "going" } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.plan.going, ["Ada", "Tolu"]);
  assert.equal(r.json.plan.you, "going");
  assert.equal(r.json.plan.seq, 1);
  const pods = await call("GET", `/api/plans/${S.wine}/pods`, { token: S.kene });
  assert.equal(pods.status, 200);
  assert.deepEqual(pods.json.unplaced, []);
  // the host is already there, so only Ada rides; the home's address is the drop-off text
  assert.deepEqual(pods.json.pods.map((/** @type {any} */ p) => p.names), [["Ada"]]);
  assert.match(pods.json.pods[0].destinationText, /12 Herbert Macaulay Way, Yaba$/);
  assert.deepEqual(pods.json.rides.map((/** @type {any} */ r) => r.name), ["Bolt", "inDrive", "LagRide"]);
  assert.ok(!JSON.stringify(pods.json).toLowerCase().includes("uber"));
  assert.deepEqual(r.json.plan.rsvps, { [S.toluId]: "going", [S.adaId]: "going" }, "rsvps by member id, for faces");
  // one plan by id, for a member and for a guest
  const one = await call("GET", `/api/plans/${S.wine}`, { token: S.invite });
  assert.equal(one.status, 200);
  assert.equal(one.json.plan.place.address, null, "a guest still does not see the home address");
  assert.equal(one.json.you, null);
  assert.equal((await call("GET", `/api/plans/${S.wine}`, { token: S.kene })).json.plan.place.address, "12 Herbert Macaulay Way, Yaba");
  assert.equal((await call("GET", `/api/plans/${S.wine}`)).status, 401);
  // the beach plan has a pin: pods get a leave-by and the drop-off text
  await call("PATCH", `/api/plans/${S.beach}`, { token: S.ada, body: { rsvp: "going" } });
  await call("PATCH", `/api/plans/${S.beach}`, { token: S.kene, body: { rsvp: "going" } });
  const bp = await call("GET", `/api/plans/${S.beach}/pods`, { token: S.kene });
  assert.equal(bp.json.pods.length, 2, "Yaba and Lekki ride separately");
  const yaba = bp.json.pods.find((/** @type {any} */ p) => p.fromLabel === "Yaba");
  assert.ok(yaba.destinationText);
  assert.match(yaba.leaveBy, /^2026-10-24T1[23]:\d\d:00\+01:00$/);
  assert.ok(push.sent.some((m) => m.title === "Ride pod for Beach day"), "the pod that formed is told");
  const n = push.sent.length;
  await call("PATCH", `/api/plans/${S.beach}`, { token: S.ada, body: { rsvp: "going" } });
  assert.equal(push.sent.length, n, "no repeat buzz");
  const ics = await call("GET", `/api/plans/${S.beach}/event.ics?t=${encodeURIComponent(S.ada)}`);
  assert.equal(ics.status, 200);
  assert.match(ics.headers.get("content-type") || "", /^text\/calendar/);
  assert.match(ics.headers.get("content-disposition") || "", /attachment; filename="Beach day\.ics"/);
  assert.match(ics.text, /SUMMARY:Going: Beach day/);
  assert.match(ics.text, /TRIGGER;VALUE=DATE-TIME:/);
  const feed = await call("GET", new URL(S.cal).pathname);
  assert.equal(feed.status, 200);
  assert.match(feed.text, /X-WR-CALNAME:Come Through: the uni guys/);
  assert.equal((feed.text.match(/BEGIN:VEVENT/g) || []).length, 2);
  const again = await call("GET", new URL(S.cal).pathname, { headers: { "if-none-match": /** @type {string} */ (feed.headers.get("etag")) } });
  assert.equal(again.status, 304);
  assert.equal((await call("GET", "/cal/not-a-real-token-at-all.ics")).status, 404);
});

test("Opera Mini and phones without JavaScript: plain pages to see the plan, say going and join", async () => {
  const MINI = "Opera/9.80 (Android; Opera Mini/36.2.2254/119.132; U; en) Presto/2.12.423 Version/12.16";
  const get = async (/** @type {string} */ p, ua = MINI) => {
    const r = await fetch(base + p, { headers: { "user-agent": ua } });
    return { status: r.status, text: await r.text(), type: r.headers.get("content-type") };
  };
  const post = async (/** @type {string} */ p, /** @type {Record<string,string>} */ form) => {
    const r = await fetch(base + p, { method: "POST", redirect: "manual", headers: { "user-agent": MINI, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString() });
    return { status: r.status, location: r.headers.get("location") || "" };
  };
  // a member opens the plan link from the chat in Opera Mini: a plain page with a form, no scripts
  const plan = await get(`/c/${S.slug}/p/${S.beach}?t=${S.kene}`);
  assert.equal(plan.status, 200);
  assert.match(plan.type || "", /^text\/html/);
  assert.match(plan.text, /<h1>Beach day<\/h1>/);
  assert.match(plan.text, /<form method="post" action="\/basic\/rsvp\//);
  assert.ok(!/<script/i.test(plan.text), "no JavaScript at all");
  assert.match(plan.text, /https:\/\/wa\.me\/\?text=/);
  const said = await post(`/basic/rsvp/${S.beach}`, { t: S.kene, rsvp: "maybe" });
  assert.equal(said.status, 303);
  assert.match(said.location, new RegExp(`^/c/${S.slug}/p/${S.beach}\\?t=.*&basic=1$`));
  assert.equal((await call("GET", `/api/plans/${S.beach}`, { token: S.kene })).json.plan.you, "maybe");
  assert.match((await get(said.location)).text, /You said maybe/);
  // a guest with the invite link joins from the plain page and lands back on the plan
  const guest = await get(`/c/${S.slug}/p/${S.beach}?t=${S.invite}`);
  assert.match(guest.text, /Coming\? Add your name/);
  const joined = await post(`/basic/join/${S.slug}`, { t: S.invite, name: "Funmi", area: "Yaba", next: S.beach, rsvp: "going" });
  assert.equal(joined.status, 303);
  const after = await get(joined.location);
  assert.match(after.text, /You're going/, "joining from a plan answers it in the same tap");
  // the crew page lists plans; ?basic=1 works in any browser; Chrome gets the app
  assert.match((await get(`/c/${S.slug}?t=${S.kene}`)).text, /Coming up/);
  const chrome = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
  assert.match((await get(`/c/${S.slug}?t=${S.kene}&basic=1`, chrome)).text, /Coming up/);
  const app = await get(`/c/${S.slug}/p/${S.beach}?t=${S.kene}`, chrome);
  assert.match(app.text, /<title>Come Through<\/title>/);
  assert.ok(app.text.includes(`href="/c/${S.slug}/p/${S.beach}?t=${S.kene}&amp;basic=1"`), "the noscript link keeps the key and adds basic=1");
  // the join link works; starting a crew says it needs the full app
  assert.match((await get(`/c/${S.slug}/join?t=${S.invite}`)).text, /<h2>Join /);
  assert.match((await get("/")).text, /This part needs the full app/);
  assert.equal((await get("/assets/missing.js")).status, 404, "files are not app pages");
  // a link with no key explains itself; a bad key is a plain error page
  assert.equal((await get(`/c/${S.slug}/p/${S.beach}`)).status, 401);
  assert.equal((await get(`/c/${S.slug}/p/${S.beach}?t=nope`)).status, 403);
});

test("one tap from the chat: a link preview never answers; the plain page answers on a tap", async () => {
  const going = async () => Object.values((await call("GET", `/api/plans/${S.beach}`, { token: S.tolu })).json.plan.rsvps || {}).filter((v) => v === "going").length;
  const before = await going();
  // WhatsApp and Facebook fetch the link to draw a preview: they get a page, and nobody is marked going
  for (const ua of ["WhatsApp/2.24.20.80 A", "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36"]) {
    const r = await fetch(`${base}/c/${S.slug}/p/${S.beach}/in?t=${S.invite}`, { headers: { "user-agent": ua } });
    assert.equal(r.status, 200);
    assert.match(await r.text(), /<title>Come Through<\/title>/, "the app shell, whose script answers only on a real phone");
  }
  const MINI = "Opera/9.80 (Android; Opera Mini/36.2.2254/119.132; U; en) Presto/2.12.423 Version/12.16";
  const page = await (await fetch(`${base}/c/${S.slug}/p/${S.beach}/in?t=${S.invite}`, { headers: { "user-agent": MINI } })).text();
  assert.match(page, /What should the crew call you\?/);
  assert.match(page, /<input type="hidden" name="rsvp" value="going">/);
  assert.equal(await going(), before, "no GET has answered for anyone");
  // the one tap: a name and "I'm in"
  const r = await fetch(`${base}/basic/join/${S.slug}`, { method: "POST", redirect: "manual", headers: { "user-agent": MINI, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t: S.invite, name: "Ngozi", next: S.beach, rsvp: "going" }).toString() });
  assert.equal(r.status, 303);
  assert.equal(await going(), before + 1);
  // a member's phone gets one button, and opening it again changes nothing
  const mine = new URL(r.headers.get("location") || "", base).searchParams.get("t");
  const again = await (await fetch(`${base}/c/${S.slug}/p/${S.beach}/in?t=${mine}`, { headers: { "user-agent": MINI } })).text();
  assert.match(again, /You're in\./);
  assert.equal(await going(), before + 1);
});

test("edits: only the creator or host; a cancel tells who was coming", async () => {
  const no = await call("PATCH", `/api/plans/${S.wine}`, { token: S.kene, body: { title: "Mine now" } });
  assert.equal(no.status, 403);
  push.sent.length = 0;
  const moved = await call("PATCH", `/api/plans/${S.wine}`, { token: S.tolu, body: { start: "2026-10-23T20:00:00+01:00" } });
  assert.equal(moved.json.plan.status, "moved");
  assert.equal(moved.json.plan.end, "2026-10-24T00:00:00+01:00");
  assert.deepEqual(push.sent.map((m) => m.title), ["Changed: Wine and monopoly"]);
  push.sent.length = 0;
  const c = await call("PATCH", `/api/plans/${S.wine}`, { token: S.tolu, body: { status: "cancelled" } });
  assert.equal(c.json.plan.status, "cancelled");
  assert.deepEqual(push.sent.map((m) => m.title), ["Cancelled: Wine and monopoly"]);
});

test("the heartbeat: secret, a ritual once, the rain watch", async () => {
  assert.equal((await call("POST", "/api/tick")).status, 401);
  assert.equal((await call("POST", "/api/tick", { token: "wrong" })).status, 401);
  push.sent.length = 0;
  const t1 = await call("POST", "/api/tick", { token: "s3cret-tick" });
  assert.equal(t1.status, 200);
  // the beach plan on Saturday the 24th is within half a cycle, so the crew is "busy"
  assert.equal(t1.json.rituals, 0);
  assert.ok(t1.json.weatherChecked >= 1);
  // cancel the beach plan: the slot is quiet, so the ritual is made
  await call("PATCH", `/api/plans/${S.beach}`, { token: S.tolu, body: { status: "cancelled" } });
  const t2 = await call("POST", "/api/tick", { token: "s3cret-tick" });
  assert.equal(t2.json.rituals, 1);
  const t3 = await call("POST", "/api/tick", { token: "s3cret-tick" });
  assert.equal(t3.json.rituals, 0, "a retried heartbeat makes nothing twice");
  const crew = await call("GET", `/api/crews/${S.slug}`, { token: S.kene });
  const ritual = crew.json.plans.find((/** @type {any} */ p) => p.kind === "ritual");
  assert.equal(ritual.title, "Saturday at Freedom Park");
  assert.equal(ritual.ritualFor, "2026-10-24");
  assert.equal(ritual.createdBy, "sloth");
  assert.equal(ritual.start, "2026-10-24T15:00:00+01:00", "after the midday storm, and done by 6:30 pm before dark");
  assert.match(ritual.invite, /Come through/);
  assert.match(ritual.why, /Freedom Park/);
  assert.ok(push.sent.some((m) => m.title === "Saturday at Freedom Park"));
  // Thursday: rain moves in for Saturday. One alert, then quiet
  clock = Date.parse("2026-10-22T09:00:00Z");
  rainy = true;
  await call("PATCH", `/api/plans/${ritual.id}`, { token: S.kene, body: { rsvp: "going" } });
  push.sent.length = 0;
  const t4 = await call("POST", "/api/tick", { token: "s3cret-tick" });
  assert.equal(t4.json.rainAlerts, 1);
  assert.deepEqual(push.sent.map((m) => m.title), ["Rain watch: Saturday at Freedom Park"]);
  const wet = (await call("GET", `/api/crews/${S.slug}`, { token: S.kene })).json.plans.find((/** @type {any} */ p) => p.id === ritual.id);
  assert.match(wet.headsUp.whatsappUrl, /^https:\/\/wa\.me\/\?text=Heads%20up/);
  const t5 = await call("POST", "/api/tick", { token: "s3cret-tick" });
  assert.equal(t5.json.rainAlerts, 0);
  rainy = false;
  clock = Date.parse("2026-10-21T09:00:00Z");
});

test("expired plans are deleted by the heartbeat", async () => {
  const saved = clock;
  clock = Date.parse("2026-12-30T09:00:00Z");
  const t = await call("POST", "/api/tick", { token: "s3cret-tick" });
  assert.ok(t.json.expired >= 3, JSON.stringify(t.json));
  assert.equal((await store.find("plans", {})).filter((p) => Date.parse(p.expiresAt) <= clock).length, 0);
  clock = saved;
});

test("CORS for the web origin only, and security headers", async () => {
  const pre = await call("OPTIONS", `/api/crews/${S.slug}`, { headers: { origin: "https://comethrough.test", "access-control-request-method": "GET" } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "https://comethrough.test");
  const evil = await call("GET", "/healthz", { headers: { origin: "https://evil.test" } });
  assert.equal(evil.headers.get("access-control-allow-origin"), null);
  assert.equal(evil.headers.get("referrer-policy"), "no-referrer");
  assert.equal(evil.headers.get("cache-control"), "no-store");
});

test("the web app is served for app routes; a missing asset is a 404", async () => {
  const page = await call("GET", `/c/${S.slug}?t=abc`);
  assert.equal(page.status, 200);
  assert.match(page.text, /<title>Come Through<\/title>/);
  assert.equal((await call("GET", "/assets/missing.js")).status, 404);
  assert.equal((await call("GET", "/../../etc/passwd")).status, 200, "a traversal attempt gets the app, not the file");
});

test("on mobile data: the app's files and big API answers are compressed when the phone accepts it", async () => {
  const http = await import("node:http");
  const zlib = await import("node:zlib");
  const get = (/** @type {string} */ p, /** @type {string} */ enc, /** @type {Record<string,string>} */ extra = {}) => new Promise((resolve, reject) => {
    http.get(base + p, { headers: { "accept-encoding": enc, ...extra } }, (res) => {
      /** @type {Buffer[]} */
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
    }).on("error", reject);
  });
  const raw = /** @type {any} */ (await get("/assets/index-AbCdEf12.js", "identity"));
  const br = /** @type {any} */ (await get("/assets/index-AbCdEf12.js", "gzip, deflate, br"));
  assert.equal(br.headers["content-encoding"], "br");
  assert.equal(br.headers.vary, "Accept-Encoding");
  assert.ok(br.body.length < raw.body.length / 5, `${br.body.length} vs ${raw.body.length}`);
  assert.equal(zlib.brotliDecompressSync(br.body).toString(), raw.body.toString());
  const gz = /** @type {any} */ (await get("/assets/index-AbCdEf12.js", "gzip"));
  assert.equal(gz.headers["content-encoding"], "gzip");
  assert.equal(zlib.gunzipSync(gz.body).toString(), raw.body.toString());
  assert.equal(raw.headers["content-encoding"], undefined);
  const crew = /** @type {any} */ (await get(`/api/crews/${S.slug}`, "br", { authorization: `Bearer ${S.kene}` }));
  assert.equal(crew.headers["content-encoding"], "br");
  assert.ok(JSON.parse(zlib.brotliDecompressSync(crew.body).toString()).crew);
});

test("Gemma's limits: per IP per minute", async () => {
  let last = 0;
  for (let i = 0; i < 10; i++) last = (await call("POST", "/api/crews", { body: { sentence: "a crew" } })).status;
  assert.equal(last, 429);
});

test("the client address behind Render and Cloudflare (3 hops) ignores what the client prepends", () => {
  const req = (/** @type {string} */ xff) => /** @type {any} */ ({ headers: { "x-forwarded-for": xff }, socket: { remoteAddress: "10.1.1.1" } });
  assert.equal(clientIp(req("102.89.1.1, 172.70.1.1, 10.0.0.2"), 3), "102.89.1.1");
  assert.equal(clientIp(req("6.6.6.6, 102.89.1.1, 172.70.1.1, 10.0.0.2"), 3), "102.89.1.1", "a spoofed first entry is ignored");
  assert.equal(clientIp(req("6.6.6.6"), 0), "10.1.1.1");
});
