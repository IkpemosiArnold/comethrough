// @ts-check
// A strict-enough RFC 5545 check for the calendars Come Through writes, used by the end to
// end script and the tests: CRLF line ends, lines folded at 75 octets with a leading space,
// balanced BEGIN and END, the required properties, and escaped TEXT values.

const TEXT_PROPS = new Set(["SUMMARY", "DESCRIPTION", "LOCATION", "X-WR-CALNAME", "X-WR-CALDESC", "COMMENT"]);
const encoder = new TextEncoder();

/**
 * @param {string} ics
 * @returns {{ ok: boolean, errors: string[], events: number, alarms: number, folded: number, longestLine: number, summaries: string[] }}
 */
export function checkIcs(ics) {
  /** @type {string[]} */
  const errors = [];
  if (!ics.endsWith("\r\n")) errors.push("does not end with CRLF");
  if (/(^|[^\r])\n/.test(ics)) errors.push("bare LF line end");
  const physical = ics.split("\r\n");
  if (physical.at(-1) === "") physical.pop();
  let longestLine = 0;
  let folded = 0;
  /** @type {string[]} */
  const lines = [];
  for (const [i, l] of physical.entries()) {
    const octets = encoder.encode(l).length;
    longestLine = Math.max(longestLine, octets);
    if (octets > 75) errors.push(`line ${i + 1} is ${octets} octets`);
    if (l.startsWith(" ") || l.startsWith("\t")) {
      if (!lines.length) errors.push("starts with a continuation line");
      else lines[lines.length - 1] += l.slice(1);
      folded++;
    } else lines.push(l);
  }
  if (lines[0] !== "BEGIN:VCALENDAR") errors.push("first line is not BEGIN:VCALENDAR");
  if (lines.at(-1) !== "END:VCALENDAR") errors.push("last line is not END:VCALENDAR");
  /** @type {string[]} */
  const stack = [];
  /** @type {Record<string, string>[]} */
  const events = [];
  /** @type {Record<string, string>} */
  let cur = {};
  let alarms = 0;
  /** @type {string[]} */
  const summaries = [];
  /** @type {Record<string, string>} */
  const calProps = {};
  for (const line of lines) {
    const m = /^([A-Z0-9-]+)((?:;[^:]*)?):(.*)$/.exec(line);
    if (!m) {
      errors.push(`not a content line: ${line.slice(0, 40)}`);
      continue;
    }
    const [, name, , value] = m;
    if (name === "BEGIN") {
      stack.push(value);
      if (value === "VEVENT") cur = {};
      if (value === "VALARM") alarms++;
      continue;
    }
    if (name === "END") {
      const top = stack.pop();
      if (top !== value) errors.push(`END:${value} closes ${top}`);
      if (value === "VEVENT") events.push(cur);
      continue;
    }
    const where = stack.at(-1);
    if (where === "VCALENDAR") calProps[name] = value;
    if (where === "VEVENT") cur[name] = value;
    if (TEXT_PROPS.has(name)) {
      // after unfolding, a comma or semicolon in TEXT must be escaped, and a backslash may
      // only start \\ \; \, \n or \N
      const bad = !escapedText(value);
      if (bad) errors.push(`${name} is not escaped: ${value.slice(0, 60)}`);
      if (name === "SUMMARY" && where === "VEVENT") summaries.push(value);
    }
  }
  if (stack.length) errors.push(`unclosed: ${stack.join(",")}`);
  if (calProps.VERSION !== "2.0") errors.push("VERSION is not 2.0");
  if (!calProps.PRODID) errors.push("no PRODID");
  for (const [i, e] of events.entries()) {
    for (const req of ["UID", "DTSTAMP", "DTSTART"]) if (!e[req]) errors.push(`event ${i + 1} has no ${req}`);
    if (e.DTSTAMP && !/^\d{8}T\d{6}Z$/.test(e.DTSTAMP)) errors.push(`event ${i + 1} DTSTAMP is not UTC: ${e.DTSTAMP}`);
  }
  const uids = events.map((e) => e.UID);
  if (new Set(uids).size !== uids.length) errors.push("duplicate UID");
  return { ok: errors.length === 0, errors, events: events.length, alarms, folded, longestLine, summaries };
}

/** True when a TEXT value has every comma and semicolon escaped and no stray backslash. */
export function escapedText(v) {
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (c === "\\") {
      if (!"\\;,nN".includes(v[i + 1] ?? "")) return false;
      i++;
    } else if (c === "," || c === ";") return false;
  }
  return true;
}
