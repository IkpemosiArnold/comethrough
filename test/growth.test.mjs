// @ts-check
// Growth: renaming a crew, the sloth's name ideas, sloth avatars, a member's photo (the crew
// only), one-time cards, "We came through", and WhatsApp preview cards. The rules first
// (src/core/growth.mjs), then the HTTP API end to end with every outside service faked.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { config } from "../src/config.mjs";
import { createService } from "../src/app/service.mjs";
import { makeIds } from "../src/app/ids.mjs";
import { loadPrompts } from "../src/app/prompts.mjs";
import { ACCESSORIES, avatarLook, avatarSvg } from "../src/core/avatar.mjs";
import { cardText, checkCrewName, crewCard, fallbackNames, groundedNames, linkupIds, mergeLinkups, nameVocab, planCard, recapPlan, cameThrough } from "../src/core/growth.mjs";
import { cleanTaste } from "../src/core/taste.mjs";
import { fakeAi, fakeGeocoder, fakeOverpass, fakePageMeta, fakePush, fakeWeather, OFFLINE_ANSWERS } from "../src/adapters/fakes.mjs";
import { memoryStore } from "../src/adapters/store.mjs";
import { createApi } from "../src/server/server.mjs";
import { tags, withHead } from "../src/server/og.mjs";

// ---------------------------------------------------------------- the rules

test("a crew name: 40 characters as people count them, emoji welcome, never who the crew is", () => {
  assert.deepEqual(checkCrewName("  The   Yaba Lot 🌴 "), { name: "The Yaba Lot 🌴", error: null });
  assert.equal(checkCrewName("👩🏾‍🤝‍👩🏽".repeat(40)).name, "👩🏾‍🤝‍👩🏽".repeat(40), "40 emoji are 40 characters");
  assert.match(String(checkCrewName("x".repeat(41)).error), /40 characters/);
  assert.equal(checkCrewName("").error, "Give the crew a name.");
  assert.equal(checkCrewName(42).error, "Give the crew a name.");
  assert.match(String(checkCrewName("the gay lot").error), /fine for anyone to see/);
  assert.equal(checkCrewName("Lagos\u0000 lot\u2028").name, "Lagos lot");
});

test("the sloth's name ideas are grounded: only the crew's own words and plain ones, never its needs", () => {
  const crew = { name: "the uni guys", areas: [{ label: "Yaba" }, { label: "Lekki Phase 1" }], rhythm: { every: "2w", day: 6 }, vibeTags: ["outside"], taste: cleanTaste({ likes: ["live music"], placeKinds: ["park"], needs: ["discreet", "safe"] }) };
  const vocab = nameVocab(crew, { city: "Lagos", flavour: ["jollof"] });
  assert.ok(vocab.has("yaba") && vocab.has("saturdays") && vocab.has("music") && vocab.has("jollof"));
  assert.ok(!vocab.has("discreet") && !vocab.has("safe"), "needs never feed a name");
  const kept = groundedNames({ names: ["Yaba Saturday Sloths", "Ikeja Ballers", "The Discreet Lot", "Lekki Live Music Club", "Yaba Saturday Sloths", "the uni guys", "Queer Yaba Club", "Jollof Park Society"] }, vocab, crew.name);
  assert.deepEqual(kept, ["Yaba Saturday Sloths", "Lekki Live Music Club", "Jollof Park Society"]);
  assert.deepEqual(groundedNames(null, vocab), []);
  assert.deepEqual(groundedNames({ names: ["suya linkup"] }, nameVocab({ taste: { likes: ["suya"] } })), ["Suya Linkup"]);
  const plain = fallbackNames(crew);
  assert.equal(plain.length, 3);
  assert.deepEqual(plain, ["The Yaba Lot", "Saturday Sloths", "Live Music Club"]);
  assert.ok(fallbackNames({ name: "x" }).length >= 2, "a crew with nothing on file still gets ideas");
});

const at = (/** @type {string} */ iso) => Date.parse(iso);
const plan = (/** @type {string} */ id, /** @type {string} */ start, /** @type {string} */ end, /** @type {Record<string, string>} */ rsvps, extra = {}) => ({ id, title: `Plan ${id}`, start, end, rsvps, status: "on", ...extra });

test("We came through: the day after a plan with 2 or more going, never on the same day, never cancelled", () => {
  const plans = [
    plan("p_one", "2026-10-22T18:00:00+01:00", "2026-10-22T21:00:00+01:00", { a: "going", b: "going", c: "maybe" }),
    plan("p_solo", "2026-10-21T18:00:00+01:00", "2026-10-21T21:00:00+01:00", { a: "going" }),
    plan("p_off", "2026-10-22T12:00:00+01:00", "2026-10-22T14:00:00+01:00", { a: "going", b: "going" }, { status: "cancelled" }),
    plan("p_next", "2026-10-24T15:00:00+01:00", "2026-10-24T18:00:00+01:00", { a: "going", b: "going" }),
  ];
  assert.equal(recapPlan(plans, at("2026-10-22T22:30:00+01:00"), "Africa/Lagos"), null, "not on the night itself");
  assert.deepEqual(recapPlan(plans, at("2026-10-23T09:00:00+01:00"), "Africa/Lagos"), { planId: "p_one", title: "Plan p_one", going: 2, date: "2026-10-22" });
  assert.equal(recapPlan(plans.slice(0, 3), at("2026-10-26T09:00:00+01:00"), "Africa/Lagos"), null, "gone after 3 days");
  assert.deepEqual(linkupIds(plans, at("2026-10-23T09:00:00+01:00")), ["p_one", "p_solo"], "a linkup is a plan that happened with someone going");
  assert.deepEqual(mergeLinkups(["p_old"], ["p_one", "p_old"]), ["p_old", "p_one"]);
  assert.equal(cameThrough(plans, "a", at("2026-10-21T22:00:00+01:00")), true);
  assert.equal(cameThrough(plans, "c", at("2026-10-23T09:00:00+01:00")), false, "a maybe is not coming through");
  assert.equal(cameThrough(plans, "b", at("2026-10-21T22:00:00+01:00")), false, "nothing has happened for b yet");
});

test("a preview card: the plan's title, day, time and place, sloths for who's going; a discreet crew gets the generic card", () => {
  const crew = { name: "The Yaba Lot 🌴", taste: null };
  const members = [{ id: "m_1", name: "Tolu Adé" }, { id: "m_2", name: "Kene" }];
  const p = { title: "Selfie Sunday 📸", start: "2026-10-25T16:00:00+01:00", end: "2026-10-25T19:00:00+01:00", place: { name: "Alali, Victoria Island", private: false }, rsvps: { m_1: "going", m_2: "maybe" }, host: null };
  const card = planCard({ crew, plan: p, members, tz: "Africa/Lagos" });
  assert.equal(card.title, "Selfie Sunday");
  assert.equal(card.when, "Sunday 25 Oct, 4pm to 7pm");
  assert.equal(card.place, "Alali, Victoria Island");
  assert.deepEqual(card.going, ["m_1"]);
  assert.equal(card.ogDescription, "Sunday 25 Oct, 4pm to 7pm at Alali, Victoria Island. 1 going. Tap to say if you're coming.");
  const home = planCard({ crew, plan: { ...p, place: { name: "12 Herbert Macaulay Way", private: true }, host: "m_1" }, members, tz: "Africa/Lagos" });
  assert.equal(home.place, "At Tolu's", "a home address never goes on a card");
  const discreet = { name: "Our lot", taste: { needs: ["discreet"] } };
  for (const c of [planCard({ crew: discreet, plan: p, members, tz: "Africa/Lagos" }), crewCard({ crew: discreet, members })]) {
    assert.equal(c.discreet, true);
    assert.deepEqual(c.going, []);
    const all = JSON.stringify(c);
    for (const secret of ["Our lot", "Selfie", "Alali", "Tolu", "Kene", "m_1"]) assert.ok(!all.includes(secret), `the discreet card leaks ${secret}`);
  }
  assert.equal(crewCard({ crew, members }).ogTitle, "The Yaba Lot on Come Through");
  assert.equal(cardText("Highlife 🎶 at the Mango Yard ₦5,000"), "Highlife at the Mango Yard ₦5,000");
});

test("sloth avatars: the same sloth for the same member, small, and every accessory in use", () => {
  assert.equal(avatarSvg("m_abc"), avatarSvg("m_abc"));
  assert.ok(avatarSvg("m_abc").length < 2200, "about a kilobyte per avatar");
  const seen = new Set(Array.from({ length: 400 }, (_, i) => avatarLook(`m_${i.toString(36)}x`).accessory));
  assert.deepEqual([...seen].sort(), [...ACCESSORIES].sort());
  for (let i = 0; i < 200; i++) {
    const l = avatarLook(`m_${i}`);
    assert.notEqual(l.wear, l.back, "an accessory never vanishes into the colour behind it");
  }
});

test("the head tags: absolute image, sizes, escaped text, and the old tags replaced", () => {
  const head = tags({ title: 'Wine & "monopoly"', description: "Friday <7pm>", image: "https://comethrough.tech/api/og/p/p_1.png?v=1&k=2" });
  assert.match(head, /<meta property="og:title" content="Wine &amp; &quot;monopoly&quot;" \/>/);
  assert.match(head, /<meta property="og:image" content="https:\/\/comethrough\.tech\/api\/og\/p\/p_1\.png\?v=1&amp;k=2" \/>/);
  assert.match(head, /og:image:width" content="1200"/);
  assert.match(head, /twitter:card" content="summary_large_image"/);
  const html = withHead('<!doctype html><html><head><meta charset="utf-8" /><title>Come Through</title><meta property="og:title" content="Come Through" /><meta name="description" content="x" /></head></html>', head);
  assert.equal((html.match(/og:title/g) || []).length, 1);
  assert.match(html, /<title>Come Through<\/title>/, "the tab keeps the app's name");
  assert.ok(html.indexOf("charset") < html.indexOf("og:title"), "the charset comes first");
});

// ---------------------------------------------------------------- the API

let clock = Date.parse("2026-10-21T09:00:00Z");
const now = () => clock;
const store = memoryStore();
const ai = fakeAi({ answers: { ...OFFLINE_ANSWERS, "name-crew": { names: ["Yaba Saturday Sloths", "Ikeja Ballers", "The Live Music Lot"] } } });
let base = "";
/** @type {import("node:http").Server} */
let server;
let webDir = "";
const S = /** @type {any} */ ({});

before(async () => {
  webDir = await fs.mkdtemp(path.join(os.tmpdir(), "ct-growth-"));
  await fs.writeFile(path.join(webDir, "index.html"), '<!doctype html><html lang="en-NG"><head><meta charset="utf-8" /><title>Come Through</title><meta property="og:title" content="Come Through" /><meta property="og:image" content="/icons/og.png" /></head><body><noscript><a href="?basic=1">Open the basic version</a></noscript></body></html>');
  const cfg = { ...config({ PUBLIC_URL: "https://comethrough.tech", WEB_URL: "https://comethrough.tech", WEB_ORIGIN: "https://comethrough.tech", STATIC_DIR: webDir }), imageMaxBytes: 4096 };
  const service = createService({ store, ai, push: fakePush(), weather: fakeWeather({ rain: () => 5 }), now, geocoder: fakeGeocoder(), places: fakeOverpass([]), pages: fakePageMeta(), spots: [], prompts: loadPrompts(), ids: makeIds(), cfg });
  server = createApi({ service, cfg, now });
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(null)));
  base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
  const crewDoc = (/** @type {string} */ id, /** @type {string} */ slug, /** @type {string} */ name, taste = {}) => ({
    id, slug, name, vibe: "chill", vibeTags: ["outside"], budget: "cheap", taste: cleanTaste(taste), rhythm: { every: "2w", day: 6, window: { from: "15:00", to: "19:00" } },
    areas: [{ label: "Yaba", lat: 6.5095, lon: 3.3711 }], tz: "Africa/Lagos", createdAt: "2026-10-20T10:00:00.000Z", inviteToken: `invite-${slug}-0123456789abcdef`,
  });
  await store.put("crews", crewDoc("c_open", "yaba-lot-ab12", "The Yaba Lot", { likes: ["live music"], placeKinds: ["park"] }));
  await store.put("crews", crewDoc("c_quiet", "our-lot-cd34", "Our Lot", { likes: ["board games"], needs: ["discreet", "safe"] }));
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
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  try {
    json = JSON.parse(buf.toString("utf8"));
  } catch {}
  return { status: res.status, json, text: buf.toString("utf8"), buf, headers: res.headers };
}

const draft = (/** @type {string} */ title, /** @type {string} */ start, /** @type {string} */ end) => ({ kind: "quick", title, start, end, tz: "Africa/Lagos", place: { name: "Freedom Park", address: "Hospital Road, Lagos Island", lat: 6.4488, lon: 3.3965, outdoor: false }, price: null, host: null, hostName: null, bring: [], source: {} });

test("API setup: members join both crews, and a plan in each", async () => {
  for (const [key, slug] of [["open", "yaba-lot-ab12"], ["quiet", "our-lot-cd34"]]) {
    const inv = `invite-${slug}-0123456789abcdef`;
    const a = await call("POST", `/api/crews/${slug}/members`, { token: inv, body: { name: "Tolu Adé", area: "Yaba" } });
    const b = await call("POST", `/api/crews/${slug}/members`, { token: inv, body: { name: "Kene", area: "Yaba" } });
    assert.equal(a.status, 201);
    S[key] = { slug, invite: inv, a: a.json.memberToken, aId: a.json.member.id, b: b.json.memberToken, bId: b.json.member.id };
    const p = await call("POST", `/api/crews/${slug}/plans`, { token: S[key].a, body: { plan: draft("Selfie Sunday at Alali VI", "2026-10-22T18:00:00+01:00", "2026-10-22T21:00:00+01:00") } });
    assert.equal(p.status, 201, p.text);
    S[key].plan = p.json.plan.id;
    for (const t of [S[key].a, S[key].b]) assert.equal((await call("PATCH", `/api/plans/${S[key].plan}`, { token: t, body: { rsvp: "going" } })).status, 200);
  }
});

test("rename: any member, inline; guests and bad names are refused; new messages use the new name", async () => {
  const { slug, invite, b } = S.open;
  assert.equal((await call("PATCH", `/api/crews/${slug}`, { token: invite, body: { name: "Guests can't" } })).status, 403);
  assert.equal((await call("PATCH", `/api/crews/${slug}`, { body: { name: "No key" } })).status, 401);
  const long = await call("PATCH", `/api/crews/${slug}`, { token: b, body: { name: "x".repeat(41) } });
  assert.equal(long.status, 400);
  assert.equal(long.json.error.fields[0].field, "name");
  const r = await call("PATCH", `/api/crews/${slug}`, { token: b, body: { name: "Yaba Saturday Sloths 🦥" } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { name: "Yaba Saturday Sloths 🦥", previous: "The Yaba Lot" });
  const read = await call("GET", `/api/crews/${slug}`, { token: invite });
  assert.equal(read.json.crew.name, "Yaba Saturday Sloths 🦥");
  assert.equal(read.json.crew.slug, slug, "links keep working");
  // undo is a rename back
  assert.equal((await call("PATCH", `/api/crews/${slug}`, { token: b, body: { name: r.json.previous } })).json.name, "The Yaba Lot");
});

test("Let the sloth name you: three grounded names, an invented place dropped and topped up by code", async () => {
  const { slug, invite, a } = S.open;
  assert.equal((await call("POST", `/api/crews/${slug}/names`, { token: invite })).status, 403);
  const r = await call("POST", `/api/crews/${slug}/names`, { token: a });
  assert.equal(r.status, 200);
  assert.equal(r.json.ai, true);
  assert.equal(r.json.names.length, 3);
  assert.deepEqual(r.json.names.slice(0, 2), ["Yaba Saturday Sloths", "The Live Music Lot"]);
  assert.ok(!r.json.names.includes("Ikeja Ballers"), "Ikeja is not one of this crew's areas");
  const sent = ai.calls.filter((c) => c.task === "name-crew").at(-1).messages.map((/** @type {any} */ m) => m.content).join("\n");
  assert.match(sent, /Neighbourhoods: Yaba/);
  assert.match(sent, /owambe/, "a Lagos crew gets the Lagos words");
  const quiet = await call("POST", `/api/crews/${S.quiet.slug}/names`, { token: S.quiet.a });
  const sentQuiet = ai.calls.filter((c) => c.task === "name-crew").at(-1).messages.map((/** @type {any} */ m) => m.content).join("\n");
  assert.equal(quiet.status, 200);
  assert.ok(!/discreet|safe/i.test(sentQuiet), "needs never reach the name prompt");
});

// a 1x1 WebP (the smallest real one)
const WEBP = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");

test("your photo: you set it, the crew sees it with its own link, nobody else does, and you can take it down", async () => {
  const { slug, invite, a, aId, b } = S.open;
  assert.equal((await call("PUT", `/api/members/${aId}/face`, { token: b, raw: WEBP, headers: { "content-type": "image/webp" } })).status, 403, "only you set your photo");
  assert.equal((await call("PUT", `/api/members/${aId}/face`, { token: a, raw: Buffer.from("not an image at all"), headers: { "content-type": "image/webp" } })).status, 415);
  assert.equal((await call("PUT", `/api/members/${aId}/face`, { token: a, raw: Buffer.alloc(60 * 1024, 1), headers: { "content-type": "image/webp" } })).status, 413);
  const set = await call("PUT", `/api/members/${aId}/face`, { token: a, raw: WEBP, headers: { "content-type": "image/webp" } });
  assert.equal(set.status, 200);
  assert.match(set.json.faceV, /^[A-Za-z0-9_-]{10}$/);
  const crew = await call("GET", `/api/crews/${slug}`, { token: invite });
  assert.equal(crew.json.members.find((/** @type {any} */ m) => m.id === aId).faceV, set.json.faceV);
  for (const t of [invite, b]) {
    const img = await call("GET", `/api/members/${aId}/face?t=${encodeURIComponent(t)}`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get("content-type"), "image/webp");
    assert.match(String(img.headers.get("cache-control")), /^private/);
    assert.deepEqual(img.buf, WEBP);
  }
  assert.equal((await call("GET", `/api/members/${aId}/face`)).status, 401, "never at a public address");
  assert.equal((await call("GET", `/api/members/${aId}/face?t=${encodeURIComponent(S.quiet.invite)}`)).status, 403, "another crew's link sees nothing");
  assert.equal((await call("DELETE", `/api/members/${aId}/face`, { token: a })).status, 204);
  assert.equal((await call("GET", `/api/members/${aId}/face?t=${encodeURIComponent(b)}`)).status, 404);
  assert.equal((await call("GET", `/api/crews/${slug}`, { token: invite })).json.members.find((/** @type {any} */ m) => m.id === aId).faceV, undefined);
});

test("the crew page: linkups, the day-after card, Got another crew, and what you have seen", async () => {
  const { slug, invite, a, aId } = S.open;
  assert.equal((await call("GET", `/api/crews/${slug}`, { token: invite })).json.growth, undefined, "guests get none of it");
  const before = (await call("GET", `/api/crews/${slug}`, { token: a })).json.growth;
  assert.deepEqual(before, { linkups: 0, recap: null, cameThrough: false, discreet: false, seen: [] });
  clock = Date.parse("2026-10-23T08:00:00Z");
  const g = (await call("GET", `/api/crews/${slug}`, { token: a })).json.growth;
  assert.equal(g.linkups, 1);
  assert.equal(g.recap.planId, S.open.plan);
  assert.equal(g.recap.going, 2);
  assert.equal(g.cameThrough, true);
  assert.equal((await call("POST", `/api/members/${aId}/seen`, { token: a, body: { key: "nonsense" } })).status, 400);
  const seen = await call("POST", `/api/members/${aId}/seen`, { token: a, body: { key: `status:${S.open.plan}` } });
  assert.deepEqual(seen.json.seen, [`status:${S.open.plan}`]);
  await call("POST", `/api/members/${aId}/seen`, { token: a, body: { key: "another-crew" } });
  assert.deepEqual((await call("GET", `/api/crews/${slug}`, { token: a })).json.growth.seen, [`status:${S.open.plan}`, "another-crew"]);
  // the linkup is remembered after the plan itself expires
  await store.delete("plans", S.open.plan);
  assert.equal((await call("GET", `/api/crews/${slug}`, { token: a })).json.growth.linkups, 1);
  assert.equal((await call("GET", `/api/crews/${S.quiet.slug}`, { token: S.quiet.a })).json.growth.discreet, true);
  clock = Date.parse("2026-10-21T09:00:00Z");
});

const WHATSAPP = "WhatsApp/2.24.20.80 A";

test("link previews: the plan's own title and card for WhatsApp, and the preview never says anyone is going", async () => {
  const { slug, invite, b } = S.open;
  const p = await call("POST", `/api/crews/${slug}/plans`, { token: b, body: { plan: draft("Highlife Under Mangoes", "2026-10-24T17:00:00+01:00", "2026-10-24T21:00:00+01:00") } });
  S.open.next = p.json.plan.id;
  const before = (await call("GET", `/api/plans/${S.open.next}`, { token: invite })).json.plan.rsvps;
  for (const ua of [WHATSAPP, "facebookexternalhit/1.1", "Twitterbot/1.0", "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)"]) {
    for (const suffix of ["", "/in", "/maybe"]) {
      const r = await call("GET", `/c/${slug}/p/${S.open.next}${suffix}?t=${encodeURIComponent(invite)}`, { headers: { "user-agent": ua } });
      assert.equal(r.status, 200);
      assert.match(r.text, /<meta property="og:title" content="Highlife Under Mangoes" \/>/);
      assert.match(r.text, /<meta property="og:description" content="Saturday 24 Oct, 5pm to 9pm at Freedom Park\. 1 going\. Tap to say if you're coming\." \/>/);
      assert.match(r.text, new RegExp(`<meta property="og:image" content="https://comethrough\\.tech/api/og/p/${S.open.next}\\.png\\?v=[A-Za-z0-9_-]+&amp;k=[A-Za-z0-9_-]+" />`));
      assert.equal((r.text.match(/og:title/g) || []).length, 1, "the generic tags are gone");
      assert.ok(!String(/og:image" content="([^"]+)"/.exec(r.text)?.[1]).includes(invite), "the image link never carries the crew's key");
    }
  }
  assert.deepEqual((await call("GET", `/api/plans/${S.open.next}`, { token: invite })).json.plan.rsvps, before, "previews never answer");
  // the crew invite
  const inv = await call("GET", `/c/${slug}?t=${encodeURIComponent(invite)}`, { headers: { "user-agent": WHATSAPP } });
  assert.match(inv.text, /og:title" content="The Yaba Lot on Come Through"/);
  // no key, a wrong key: the generic card, with an absolute image
  for (const q of ["", "?t=nope"]) {
    const g = await call("GET", `/c/${slug}/p/${S.open.next}${q}`, { headers: { "user-agent": WHATSAPP } });
    assert.match(g.text, /og:title" content="Come Through"/);
    assert.match(g.text, /og:image" content="https:\/\/comethrough\.tech\/api\/og\/default\.png"/);
    assert.ok(!g.text.includes("Highlife"));
  }
});

test("a discreet crew's preview: the generic card, no title, no crew name, no names", async () => {
  const { slug, invite, plan: id } = S.quiet;
  for (const p of [`/c/${slug}/p/${id}/in`, `/c/${slug}`]) {
    const r = await call("GET", `${p}?t=${encodeURIComponent(invite)}`, { headers: { "user-agent": WHATSAPP } });
    assert.match(r.text, /og:title" content="(A plan with your crew|Your crew's plans)"/);
    assert.match(r.text, /og:image" content="https:\/\/comethrough\.tech\/api\/og\/discreet-(plan|crew)\.png"/);
    for (const secret of ["Our Lot", "Selfie", "Tolu", "Kene", "Freedom Park"]) assert.ok(!r.text.includes(secret), `the page leaks ${secret}`);
  }
});

test("the preview image: a signed link draws a 1200x630 PNG under 300 KB; a wrong key draws nothing", async () => {
  const { slug, invite } = S.open;
  const page = await call("GET", `/c/${slug}/p/${S.open.next}?t=${encodeURIComponent(invite)}`, { headers: { "user-agent": WHATSAPP } });
  const src = /og:image" content="https:\/\/comethrough\.tech([^"]+)"/.exec(page.text)?.[1]?.replace(/&amp;/g, "&");
  assert.ok(src);
  const img = await call("GET", String(src));
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/png");
  assert.ok(img.buf.length < 300 * 1024, `${img.buf.length} bytes`);
  assert.equal(img.buf.readUInt32BE(16), 1200);
  assert.equal(img.buf.readUInt32BE(20), 630);
  assert.equal((await call("GET", String(src).replace(/k=[^&]+/, "k=wrong"))).status, 404);
  assert.equal((await call("GET", `/api/og/p/${S.open.next}.png`)).status, 404);
  // someone else going is a new card, at a new link
  await call("PATCH", `/api/plans/${S.open.next}`, { token: S.open.a, body: { rsvp: "going" } });
  const again = await call("GET", `/c/${slug}/p/${S.open.next}?t=${encodeURIComponent(invite)}`, { headers: { "user-agent": WHATSAPP } });
  assert.notEqual(/v=([A-Za-z0-9_-]+)/.exec(again.text)?.[1], /v=([A-Za-z0-9_-]+)/.exec(page.text)?.[1]);
  assert.match(again.text, /2 going/);
});
