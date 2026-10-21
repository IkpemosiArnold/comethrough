// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarFeed, escapeText, foldLine, icsFileName, singleEvent } from "../src/core/ics.mjs";
import { makePlan, makeRitual } from "./fixtures/plans.mjs";

const enc = new TextEncoder();
const NOW = Date.parse("2026-10-22T12:00:00Z");

/**
 * A small RFC 5545 structure check: CRLF line ends, physical lines of at most 75 octets,
 * balanced BEGIN/END, the required properties, and a VTIMEZONE for every TZID used.
 * Returns the unfolded logical lines.
 * @param {string} ics
 */
function validate(ics) {
  assert.ok(ics.endsWith("\r\n"), "ends with CRLF");
  assert.ok(!/[^\r]\n/.test(ics), "every newline is CRLF");
  const physical = ics.slice(0, -2).split("\r\n");
  for (const l of physical) assert.ok(enc.encode(l).length <= 75, `line over 75 octets: ${l}`);
  const lines = ics.replace(/\r\n[ \t]/g, "").slice(0, -2).split("\r\n");
  /** @type {string[]} */
  const stack = [];
  /** @type {Record<string, Set<string>>[]} */
  const props = [];
  const tzids = new Set();
  const defined = new Set();
  for (const l of lines) {
    const name = l.split(/[:;]/)[0];
    if (name === "BEGIN") {
      stack.push(l.slice(6));
      props.push({ [l.slice(6)]: new Set() });
    } else if (name === "END") {
      const comp = stack.pop();
      assert.equal(l.slice(4), comp, "END matches BEGIN");
      const seen = props.pop()?.[/** @type {string} */ (comp)] || new Set();
      if (comp === "VCALENDAR") for (const r of ["VERSION", "PRODID"]) assert.ok(seen.has(r), `VCALENDAR needs ${r}`);
      if (comp === "VEVENT") for (const r of ["UID", "DTSTAMP", "DTSTART"]) assert.ok(seen.has(r), `VEVENT needs ${r}`);
    } else {
      const top = props.at(-1);
      top?.[/** @type {string} */ (stack.at(-1))].add(name);
      const tz = l.match(/;TZID=([^:;]+)/);
      if (tz) tzids.add(tz[1]);
      if (name === "TZID") defined.add(l.slice(5));
    }
  }
  assert.equal(stack.length, 0, "every component is closed");
  for (const t of tzids) assert.ok(defined.has(t), `VTIMEZONE for ${t}`);
  return lines;
}

const feed = () =>
  calendarFeed({
    crew: { name: "The uni guys", tz: "Africa/Lagos" },
    member: { id: "m1" },
    plans: [
      makeRitual({ seq: 2 }),
      makePlan(),
      makePlan({ id: "p_cancel", title: "Suya, cancelled", status: "cancelled", seq: 3 }),
      makePlan({ id: "p_old", expiresAt: "2026-10-01T00:00:00.000Z" }),
    ],
    now: NOW,
    uidDomain: "comethrough.tech",
    extras: (p) => ({ url: `https://comethrough.tech/p/${p.id}`, going: ["Tolu"], leaveBy: p.id === "p_wine" ? "2026-10-23T18:20:00+01:00" : undefined }),
  });

test("the feed is valid RFC 5545 and carries the subscription hints", () => {
  const lines = validate(feed());
  for (const l of ["VERSION:2.0", "X-WR-CALNAME:Come Through: The uni guys", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H", "X-WR-TIMEZONE:Africa/Lagos", "TZID:Africa/Lagos"]) {
    assert.ok(lines.includes(l), `has ${l}`);
  }
  assert.ok(!lines.some((l) => l.startsWith("METHOD")), "no METHOD, so DTSTAMP means last revised");
});

test("events: stable UIDs, SEQUENCE, Lagos times, going marked, expired left out, sorted", () => {
  const lines = validate(feed());
  const uids = lines.filter((l) => l.startsWith("UID:"));
  assert.deepEqual(uids, ["UID:p_cancel@comethrough.tech", "UID:p_wine@comethrough.tech", "UID:p_ritual@comethrough.tech"]);
  assert.ok(lines.includes("DTSTART;TZID=Africa/Lagos:20261023T190000"));
  assert.ok(lines.includes("DTSTAMP:20261021T090000Z"));
  assert.ok(lines.includes("SUMMARY:Going: Wine and monopoly"));
  assert.ok(lines.includes("STATUS:CONFIRMED"));
  assert.ok(lines.includes("SEQUENCE:2"));
  assert.ok(lines.includes("SUMMARY:Cancelled: Suya\\, cancelled"));
  assert.ok(lines.includes("STATUS:CANCELLED"));
  assert.ok(lines.includes("GEO:6.510100;3.371200"));
  // the alarm for a going plan fires 15 minutes before leave-by
  assert.ok(lines.includes("TRIGGER;VALUE=DATE-TIME:20261023T170500Z"));
  // the ritual is not RSVPed by m1: tentative and transparent
  const ritual = lines.slice(lines.indexOf("UID:p_ritual@comethrough.tech"));
  assert.ok(ritual.includes("STATUS:TENTATIVE"));
  assert.ok(ritual.includes("TRANSP:TRANSPARENT"));
});

test("the same plans give the same bytes (no churn on refresh)", () => {
  assert.equal(feed(), feed());
});

test("escaping and folding", () => {
  assert.equal(escapeText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
  const long = `DESCRIPTION:${"x".repeat(200)}`;
  const folded = foldLine(long);
  const parts = folded.split("\r\n");
  assert.ok(parts.every((p) => enc.encode(p).length <= 75));
  assert.ok(parts.slice(1).every((p) => p.startsWith(" ")));
  assert.equal(folded.replace(/\r\n /g, ""), long);
  // multi-byte characters are never split across a fold
  const naija = `SUMMARY:${"Ọjọ́ àìkú ní Èkó ₦5,000 ".repeat(8)}`;
  const f2 = foldLine(naija).split("\r\n");
  for (const p of f2) {
    assert.ok(enc.encode(p).length <= 75);
    assert.ok(!p.includes("�"));
  }
  assert.equal(foldLine(naija).replace(/\r\n /g, ""), naija);
  assert.equal(foldLine("SHORT:line"), "SHORT:line");
});

test("a one-event file for 'add to my calendar'", () => {
  const ics = singleEvent(makePlan(), { memberId: "m1", uidDomain: "comethrough.tech", extras: { url: "https://comethrough.tech/p/p_wine" } });
  const lines = validate(ics);
  assert.equal(lines.filter((l) => l === "BEGIN:VEVENT").length, 1);
  assert.ok(lines.includes("UID:p_wine@comethrough.tech"), "same UID as the feed, so the two agree");
  assert.ok(lines.includes("TRIGGER:-PT2H"));
  assert.equal(icsFileName("Wine & monopoly: at mine!"), "Wine & monopoly at mine.ics");
});

test("a plan in another zone is written in UTC", () => {
  const ics = singleEvent(makePlan({ tz: "Europe/London", start: "2026-10-23T19:00:00+01:00", end: "2026-10-23T22:00:00+01:00" }), { uidDomain: "x" });
  const lines = validate(ics);
  assert.ok(lines.includes("DTSTART:20261023T180000Z"));
  assert.ok(!lines.includes("BEGIN:VTIMEZONE"));
});
