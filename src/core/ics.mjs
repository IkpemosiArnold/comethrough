// @ts-check
// iCalendar (RFC 5545) output: a member's subscribed feed of the crew's plans, and a
// one-event file for "add to my calendar". Pure string building; the server sets headers.
//
// What calendar apps rely on, and how this file meets it:
// - UID is stable forever (plan id @ domain), so an edit updates the event instead of
//   adding a copy; SEQUENCE is the plan's seq, which goes up on every change.
// - There is no METHOD property, so by RFC 5545 3.8.7.2 DTSTAMP is when the event was last
//   revised: the plan's updatedAt. An unchanged plan reads byte for byte the same on every
//   fetch, which keeps calendar apps from churning.
// - Lagos times are written with TZID=Africa/Lagos and a VTIMEZONE (WAT, UTC+01:00, no
//   daylight saving); other zones are written in UTC with a Z.
// - TEXT values are escaped (backslash, semicolon, comma, newline) and every line is
//   folded at 75 octets of UTF-8 without splitting a character; lines end in CRLF.
// - REFRESH-INTERVAL (RFC 7986) and X-PUBLISHED-TTL ask for hourly refreshes. They are
//   hints: Google refreshes subscribed feeds every 6 to 24 hours whatever we say, which is
//   why push and the one-event file exist.

import { DEFAULT_TZ, localParts, parseInstant, MINUTE } from "./time.mjs";

/** @typedef {import("./types.mjs").Plan} Plan */

const CRLF = "\r\n";
const encoder = new TextEncoder();

/** Escape a TEXT value. */
export function escapeText(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Fold one content line at 75 octets: continuation lines start with a single space, which
 * counts toward their 75. Never splits a UTF-8 character.
 * @param {string} line
 */
export function foldLine(line) {
  if (encoder.encode(line).length <= 75) return line;
  /** @type {string[]} */
  const out = [];
  let cur = "";
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = encoder.encode(ch).length;
    if (curBytes + b > limit) {
      out.push(cur);
      cur = " ";
      curBytes = 1;
      limit = 75;
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.join(CRLF);
}

/** "20261024T150000Z" */
export function utcStamp(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** "20261024T160000" in the zone */
function localStamp(ms, tz) {
  const p = localParts(ms, tz);
  return `${p.date.replace(/-/g, "")}T${p.time.replace(":", "")}${String(p.s).padStart(2, "0")}`;
}

const LAGOS_VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Africa/Lagos",
  "X-LIC-LOCATION:Africa/Lagos",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0100",
  "TZNAME:WAT",
  "DTSTART:19700101T000000",
  "END:STANDARD",
  "END:VTIMEZONE",
];

/** A date-time property: TZID form for Lagos, UTC otherwise. */
function dt(name, ms, tz) {
  return tz === "Africa/Lagos" ? `${name};TZID=Africa/Lagos:${localStamp(ms, tz)}` : `${name}:${utcStamp(ms)}`;
}

/**
 * @typedef {object} EventExtras
 * @property {string} [url]        the plan's page
 * @property {string} [leaveBy]    the member's pod leave-by (ISO)
 * @property {string} [podText]    the member's pod line ("Tolu and Ada: leave Yaba by 15:00 ...")
 * @property {string[]} [going]    names of who is going
 */

/**
 * The VEVENT lines for one plan as one member sees it.
 * @param {Plan} plan
 * @param {{ memberId?: string|null, uidDomain: string, extras?: EventExtras }} ctx
 */
export function eventLines(plan, { memberId = null, uidDomain, extras = {} }) {
  const tz = plan.tz || DEFAULT_TZ;
  const start = parseInstant(plan.start);
  const end = parseInstant(plan.end);
  const stamp = parseInstant(plan.updatedAt || plan.createdAt) || start;
  const rsvp = memberId ? plan.rsvps?.[memberId] ?? null : null;
  const cancelled = plan.status === "cancelled";
  const prefix = cancelled ? "Cancelled: " : rsvp === "going" ? "Going: " : rsvp === "maybe" ? "Maybe: " : "";
  const p = plan.place || /** @type {any} */ ({});
  const location = [p.name, p.address].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(", ");

  /** @type {string[]} */
  const desc = [];
  if (plan.weather && !plan.weather.ok) desc.push(`Weather: ${plan.weather.summary}`);
  if (plan.invite) desc.push(plan.invite);
  else if (plan.why) desc.push(plan.why);
  if (plan.price?.text) desc.push(`Price: ${plan.price.text}`);
  if (plan.bring?.length) desc.push(`Bring: ${plan.bring.join(", ")}`);
  if (extras.going?.length) desc.push(`Going: ${extras.going.join(", ")}`);
  if (rsvp === "going" && extras.podText) desc.push(extras.podText);
  if (plan.kind === "ritual") desc.push("Come through if you can. No reply needed.");
  if (extras.url) desc.push(extras.url);

  const lines = [
    "BEGIN:VEVENT",
    `UID:${plan.id}@${uidDomain}`,
    `DTSTAMP:${utcStamp(stamp)}`,
    `CREATED:${utcStamp(parseInstant(plan.createdAt) || stamp)}`,
    `LAST-MODIFIED:${utcStamp(stamp)}`,
    `SEQUENCE:${Math.max(0, Math.floor(plan.seq || 0))}`,
    dt("DTSTART", start, tz),
    dt("DTEND", Number.isFinite(end) && end > start ? end : start + 2 * 60 * MINUTE, tz),
    `SUMMARY:${escapeText(prefix + plan.title)}`,
    `STATUS:${cancelled ? "CANCELLED" : rsvp === "going" ? "CONFIRMED" : "TENTATIVE"}`,
    `TRANSP:${rsvp === "going" && !cancelled ? "OPAQUE" : "TRANSPARENT"}`,
    `CATEGORIES:${escapeText(plan.kind)}`,
  ];
  if (location) lines.push(`LOCATION:${escapeText(location)}`);
  if (Number.isFinite(p.lat) && Number.isFinite(p.lon)) lines.push(`GEO:${p.lat.toFixed(6)};${p.lon.toFixed(6)}`);
  if (desc.length) lines.push(`DESCRIPTION:${escapeText(desc.join("\n\n"))}`);
  if (extras.url) lines.push(`URL:${extras.url}`);
  if (rsvp === "going" && !cancelled) {
    const leave = extras.leaveBy ? parseInstant(extras.leaveBy) : NaN;
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      Number.isFinite(leave) ? `TRIGGER;VALUE=DATE-TIME:${utcStamp(leave - 15 * MINUTE)}` : "TRIGGER:-PT2H",
      `DESCRIPTION:${escapeText(Number.isFinite(leave) ? `Leave by ${localParts(leave, tz).time} for ${plan.title}` : `Soon: ${plan.title}`)}`,
      "END:VALARM",
    );
  }
  lines.push("END:VEVENT");
  return lines;
}

/** Wrap event lines in a VCALENDAR and serialise with folding and CRLF. */
function calendar(head, events, tzs) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Come Through//comethrough//EN", "CALSCALE:GREGORIAN", ...head];
  if (tzs.has("Africa/Lagos")) lines.push(...LAGOS_VTIMEZONE);
  for (const e of events) lines.push(...e);
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join(CRLF) + CRLF;
}

/**
 * A member's subscribed feed: every live plan of the crew, going ones marked, cancelled
 * ones kept (STATUS:CANCELLED) until they expire so calendars remove them.
 * @param {object} input
 * @param {{ name: string, tz?: string }} input.crew
 * @param {{ id: string }} input.member
 * @param {Plan[]} input.plans
 * @param {number} input.now
 * @param {string} input.uidDomain
 * @param {(plan: Plan) => EventExtras} [input.extras]
 */
export function calendarFeed({ crew, member, plans, now, uidDomain, extras = () => ({}) }) {
  const live = plans
    // a ritual the sloth skipped for rain was never on anyone's calendar
    .filter((p) => !(parseInstant(p.expiresAt) <= now) && p.rainPlan?.kind !== "skip")
    .sort((a, b) => parseInstant(a.start) - parseInstant(b.start) || a.id.localeCompare(b.id));
  const name = `Come Through: ${crew.name}`;
  const head = [
    `NAME:${escapeText(name)}`,
    `X-WR-CALNAME:${escapeText(name)}`,
    `X-WR-CALDESC:${escapeText(`Plans for ${crew.name}. Tap "I'm going" in Come Through and it shows here.`)}`,
    `X-WR-TIMEZONE:${crew.tz || DEFAULT_TZ}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  return calendar(head, live.map((p) => eventLines(p, { memberId: member.id, uidDomain, extras: extras(p) })), new Set(live.map((p) => p.tz || DEFAULT_TZ)));
}

/**
 * A one-event calendar file for "add to my calendar".
 * @param {Plan} plan
 * @param {{ memberId?: string|null, uidDomain: string, extras?: EventExtras }} ctx
 */
export function singleEvent(plan, ctx) {
  return calendar([], [eventLines(plan, ctx)], new Set([plan.tz || DEFAULT_TZ]));
}

/** A safe file name for the download ("Wine and monopoly.ics"). */
export function icsFileName(title) {
  const base = String(title || "plan").replace(/[^\p{L}\p{N} '&()-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "plan";
  return `${base}.ics`;
}
