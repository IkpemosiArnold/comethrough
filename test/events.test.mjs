// @ts-check
// Real Lagos event pages, checked live on 21 Oct 2026 (docs/LOCAL-FACTS.md, "Event sources").
// The Eventbrite fixtures are the meta tags and the Event JSON-LD of two public pages, trimmed;
// the expected values are what a person saw on those pages in a browser that day.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { money, parseHtmlMeta } from "../src/core/htmlmeta.mjs";
import { isLockedLink, lockedMessage, lockedSite } from "../src/core/netguard.mjs";
import { readPlan as coreReadPlan, readCrewSetup as coreReadCrewSetup } from "../src/core/tasks.mjs";
import { LAGOS_LOCAL } from "../src/packs/lagos/index.mjs";
// The crew in these tests is in Lagos: its zone, short names ("VI"), naira and Pidgin come
// from the Lagos city pack now, so the readers get it passed in.
const LAGOS_TZ = "Africa/Lagos";
/** @type {typeof coreReadPlan} */
const readPlan = (d, input) => coreReadPlan(d, { tz: LAGOS_TZ, local: LAGOS_LOCAL, ...input });
/** @type {typeof coreReadCrewSetup} */
const readCrewSetup = (d, input, local = LAGOS_LOCAL) => coreReadCrewSetup(d, input, local);


const today = "2026-10-21";
const member = { id: "m1", name: "Tolu" };
const page = (/** @type {string} */ f) => fs.readFileSync(new URL(`./fixtures/events/${f}`, import.meta.url), "utf8");

test("Eventbrite, a free festival: title, date, venue and Free, though the page says 0.0 USD", () => {
  const url = "https://www.eventbrite.com/e/the-amala-and-palmwine-festival-20-tickets-2002313797469";
  const meta = parseHtmlMeta(page("eventbrite-amala-palmwine.html"), url);
  assert.equal(meta.event?.free, true);
  assert.equal(meta.event?.currency, null, "a zero price in USD is free, not a dollar price");
  assert.match(meta.event?.image || "", /^https:\/\/img\.evbuc\.com\//, "the direct image, not the _next proxy");
  const r = readPlan({}, { url, pageMeta: meta, today, member });
  assert.equal(r.draft.title, "The Amala and Palmwine Festival 2.0");
  assert.equal(r.draft.start, "2026-12-13T12:00:00+01:00");
  assert.equal(r.draft.end, "2026-12-13T20:00:00+01:00");
  assert.equal(r.draft.place.name, "The Stable Surulere");
  assert.equal(r.draft.place.address, "41 Bode Thomas Street, Surulere, Lagos 101241");
  assert.deepEqual(r.draft.price, { text: "Free", free: true });
  assert.ok(!r.notes.some((n) => /USD/.test(n)));
});

test("Eventbrite, a SocialEvent priced in dollars: From USD 50, flagged for a second look", () => {
  const url = "https://www.eventbrite.com/e/selfie-sunday-at-alali-vi-things-to-do-in-lagos-every-sunday-tickets-1989728225685";
  const meta = parseHtmlMeta(page("eventbrite-selfie-sunday.html"), url);
  assert.equal(meta.event?.price, "From USD 50", "lowPrice 50.0, highPrice 161.9");
  assert.equal(meta.event?.currency, "USD");
  const r = readPlan({}, { url, pageMeta: meta, today, member });
  assert.equal(r.draft.title, "Selfie Sunday at Alali VI", "the site's tail goes (src/core/titles.mjs)");
  assert.equal(r.draft.start, "2026-10-25T16:30:00+01:00", "the next of its repeating dates");
  assert.equal(r.draft.place.address, "32 Musa Yar' Adua Street, Lagos, LA 106104");
  assert.deepEqual(r.draft.price, { text: "From USD 50", free: false });
  assert.ok(r.notes.includes("The page lists the price in USD, not naira. Check what you will pay with the organiser."));
  assert.ok(r.confidence.price <= 0.5);
});

test("event prices: naira with the sign, other currencies by code, cancelled events flagged", () => {
  assert.equal(money(15000, "NGN"), "₦15,000");
  assert.equal(money(161.9, "USD"), "USD 161.90");
  const html = `<script type="application/ld+json">{"@type":"MusicEvent","name":"Show","startDate":"2026-11-01T19:00:00+01:00","eventStatus":"https://schema.org/EventPostponed","offers":{"@type":"Offer","price":"15000","priceCurrency":"NGN"}}</script>`;
  const meta = parseHtmlMeta(html, "https://example.com/e");
  assert.equal(meta.event?.price, "₦15,000");
  const r = readPlan({}, { url: "https://example.com/e", pageMeta: meta, today, member });
  assert.ok(r.notes.some((n) => /marks this event as postponed/.test(n)));
  assert.ok(!r.notes.some((n) => /not naira/.test(n)));
});

test("Tix.africa blocks servers (Cloudflare 403), so its links are locked with their own words", () => {
  for (const u of ["https://tix.africa/discover/dsr3", "https://www.tix.africa/discover/johnnysroomlive8lagos"]) {
    assert.equal(lockedSite(u), "Tix.africa");
    assert.ok(isLockedLink(u));
  }
  assert.match(lockedMessage("Tix.africa"), /^Tix\.africa does not let other apps read its event pages\. Share a screenshot/);
  assert.equal(lockedSite("https://www.instagram.com/p/x"), "Instagram");
  assert.equal(lockedSite("https://fb.me/x"), "Facebook");
  assert.equal(lockedSite("https://www.eventbrite.com/e/1"), null);
});
