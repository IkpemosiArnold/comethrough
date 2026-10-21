// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEdit, canEdit, createPlan, isExpired, lowFields, recentPlaces, setRsvp, upcoming, validateDraft, viewPlan } from "../src/core/plans.mjs";
import { fallbackInvite, nextSlot, ritualDraft, ritualDue } from "../src/core/ritual.mjs";
import { zonedToMs } from "../src/core/time.mjs";
import { CREW, MEMBERS, makePlan, makeRitual } from "./fixtures/plans.mjs";
import { PLACES } from "./fixtures/lagos.mjs";

const names = Object.fromEntries(MEMBERS.map((m) => [m.id, m.name]));
const at = (/** @type {string} */ date, time = "10:00") => zonedToMs(date, time);

// CREW: every other Saturday from Sat 10 Oct 2026 (so 24 Oct, 7 Nov, ...), 15:00 to 19:00
test("rhythm slots follow the cycle from the anchor", () => {
  const r = /** @type {any} */ (CREW.rhythm);
  assert.equal(nextSlot(r, "2026-10-21", "2026-10-10"), "2026-10-24");
  assert.equal(nextSlot(r, "2026-10-25", "2026-10-10"), "2026-11-07");
  assert.equal(nextSlot({ ...r, every: "1w" }, "2026-10-25", "2026-10-10"), "2026-10-31");
  assert.equal(nextSlot({ ...r, every: "4w" }, "2026-10-11", "2026-10-10"), "2026-11-07");
  assert.equal(nextSlot(r, "2026-10-24", "2026-10-10"), "2026-10-24", "on the day itself");
});

test("a ritual is due 3 days ahead of a quiet slot, and not before", () => {
  assert.deepEqual(ritualDue({ crew: CREW, now: at("2026-10-20"), plans: [] }), { due: false, reason: "not_yet", date: "2026-10-24", leadDays: 4 });
  const due = ritualDue({ crew: CREW, now: at("2026-10-21"), plans: [] });
  assert.equal(due.due, true);
  assert.equal(due.date, "2026-10-24");
  assert.equal(due.leadDays, 3);
  assert.deepEqual(due.window, { from: "15:00", to: "19:00" });
});

test("a late heartbeat still makes it the day before, never on the day", () => {
  assert.equal(ritualDue({ crew: CREW, now: at("2026-10-23", "23:30"), plans: [] }).date, "2026-10-24");
  const onTheDay = ritualDue({ crew: CREW, now: at("2026-10-24", "08:00"), plans: [] });
  assert.equal(onTheDay.due, false);
  assert.equal(onTheDay.date, "2026-11-07");
});

test("idempotent: a slot with a ritual is done; a crew with this cycle's meetup is left alone", () => {
  assert.equal(ritualDue({ crew: CREW, now: at("2026-10-22"), plans: [makeRitual()] }).reason, "exists");
  // an indoor wine night on Friday 23 Oct does not replace Saturday outside
  assert.equal(ritualDue({ crew: CREW, now: at("2026-10-22"), plans: [makePlan()] }).due, true);
  // an outdoor plan in the same cycle does
  const outside = makePlan({ place: { ...makePlan().place, outdoor: true, private: false } });
  const busy = ritualDue({ crew: CREW, now: at("2026-10-22"), plans: [outside] });
  assert.equal(busy.reason, "busy");
  assert.deepEqual(busy.blockers, ["p_wine"]);
  // and so does any plan in the slot's own hours (15:00 to 19:00), indoor or not
  const sameHours = makePlan({ start: "2026-10-24T17:00:00+01:00", end: "2026-10-24T21:00:00+01:00" });
  assert.equal(ritualDue({ crew: CREW, now: at("2026-10-22"), plans: [sameHours] }).reason, "busy");
  // but an indoor brunch that ends as the window opens does not
  const brunch = makePlan({ start: "2026-10-24T13:00:00+01:00", end: "2026-10-24T15:00:00+01:00" });
  assert.equal(ritualDue({ crew: CREW, now: at("2026-10-22"), plans: [brunch] }).due, true);
  // a cancelled plan does not count, and nor does another crew's
  assert.equal(ritualDue({ crew: CREW, now: at("2026-10-22"), plans: [{ ...outside, status: "cancelled" }] }).due, true);
  assert.equal(ritualDue({ crew: CREW, now: at("2026-10-22"), plans: [{ ...outside, crewId: "other" }] }).due, true);
  // an outdoor plan two weeks back belongs to the previous cycle
  assert.equal(ritualDue({ crew: CREW, now: at("2026-10-22"), plans: [{ ...outside, start: "2026-10-10T19:00:00+01:00", end: "2026-10-10T22:00:00+01:00" }] }).due, true);
  assert.equal(ritualDue({ crew: { ...CREW, rhythm: null }, now: at("2026-10-22"), plans: [] }).reason, "no_rhythm");
});

test("the ritual draft is a valid outdoor plan with Lagos times", () => {
  const draft = ritualDraft({ date: "2026-10-24", window: { from: "16:00", to: "19:00" }, place: PLACES.freedom });
  const v = validateDraft(draft);
  assert.ok(v.ok, JSON.stringify(v.errors));
  assert.equal(v.draft.title, "Saturday at Freedom Park");
  assert.equal(v.draft.start, "2026-10-24T16:00:00+01:00");
  assert.equal(v.draft.place.outdoor, true);
  assert.equal(v.draft.place.private, false);
  assert.ok(!/—|–/.test(fallbackInvite({ title: v.draft.title, window: { from: "16:00", to: "19:00" }, weatherText: "Dry." })));
});

test("validation: required fields, defaults flagged, limits, and no silent guesses", () => {
  const bad = validateDraft({ title: " ", start: "friday 7", place: { lat: 200, lon: 3 }, source: { url: "javascript:alert(1)" } });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors.map((e) => e.field).sort(), ["place", "source.url", "start", "title"]);
  const ok = validateDraft({ title: "Suya", start: "2026-10-21T20:00:00+01:00", confidence: { title: 0.95, start: 0.4, junk: "x" } });
  assert.ok(ok.ok);
  assert.equal(ok.draft.kind, "quick");
  assert.equal(ok.draft.end, "2026-10-21T22:00:00+01:00", "quick plans default to two hours");
  assert.deepEqual(lowFields(ok.draft.confidence, ok.filled), ["end", "kind", "place.private", "start"]);
  const hosted = validateDraft({ kind: "hosted", title: "Wine", start: "2026-10-23T19:00:00+01:00", place: { address: "12 Herbert Macaulay Way" } });
  assert.equal(hosted.draft.place.private, true, "a hosted place is private unless said otherwise");
  assert.equal(validateDraft({ title: "x", start: "2026-10-23T19:00:00+01:00", end: "2026-10-23T18:00:00+01:00" }).errors[0].field, "end");
});

test("create, RSVP and expiry", () => {
  const v = validateDraft({ kind: "hosted", title: "Wine and monopoly", start: "2026-10-23T19:00:00+01:00", host: "m1" });
  const plan = createPlan(v.draft, { id: "p1", crewId: "c1", createdBy: "m1", now: at("2026-10-21") });
  assert.deepEqual(plan.rsvps, { m1: "going" });
  assert.equal(plan.seq, 0);
  assert.equal(plan.expiresAt, "2026-11-22T22:00:00.000Z", "30 days after it ends");
  assert.ok(!isExpired(plan, at("2026-11-22", "22:00")));
  assert.ok(isExpired(plan, at("2026-11-22", "23:00")));
  const p2 = setRsvp(plan, "m2", "maybe", at("2026-10-21", "11:00"));
  assert.equal(p2.seq, 1);
  assert.equal(setRsvp(p2, "m2", "maybe", 0), p2, "no change, no bump");
  assert.deepEqual(setRsvp(p2, "m2", null, 0).rsvps, { m1: "going" });
  assert.throws(() => setRsvp(plan, "m2", /** @type {any} */ ("yes"), 0));
  assert.deepEqual(createPlan(v.draft, { id: "p2", crewId: "c1", createdBy: "sloth", now: 0 }).rsvps, {});
});

test("edits bump SEQUENCE, keep the length when only the start moves, and mark the plan moved", () => {
  const plan = makePlan({ confidence: { start: 0.5 } });
  const r = applyEdit(plan, { start: "2026-10-23T20:00:00+01:00" }, { now: at("2026-10-22") });
  assert.ok(r.ok);
  assert.equal(r.plan.end, "2026-10-24T00:00:00+01:00");
  assert.equal(r.plan.seq, 1);
  assert.equal(r.plan.status, "moved");
  assert.equal(r.plan.confidence.start, 1, "a person's edit is certain");
  assert.deepEqual(r.changed.sort(), ["end", "start", "status"]);
  const cancel = applyEdit(plan, { status: "cancelled" }, { now: 0 });
  assert.equal(cancel.plan.status, "cancelled");
  assert.equal(applyEdit(plan, { title: plan.title }, { now: 0 }).plan, plan, "a no-op edit changes nothing");
  assert.equal(applyEdit(plan, { rsvps: {} }, { now: 0 }).ok, false);
  const moved = applyEdit(makeRitual(), { place: { name: "Muri Okunola Park", lat: 6.4339, lon: 3.4231 } }, { now: 0 });
  assert.equal(moved.plan.place.osm, undefined, "a new place drops the old OSM link");
  assert.ok(canEdit(plan, "m1"));
  assert.ok(!canEdit(plan, "m3"));
  assert.ok(canEdit(makeRitual(), "m3"), "anyone may adjust the ritual");
});

test("visibility: a private address is for members only", () => {
  const plan = makePlan();
  const member = viewPlan(plan, { role: "member", memberId: "m2", names, eventIcsUrl: "https://x/e.ics" });
  assert.equal(member.place.address, "12 Herbert Macaulay Way, Yaba");
  assert.equal(member.you, "maybe");
  assert.deepEqual(member.going, ["Tolu"]);
  assert.equal(member.eventIcsUrl, "https://x/e.ics");
  const guest = viewPlan(plan, { role: "guest", names });
  assert.deepEqual(guest.place, { name: "Tolu's place", address: null, lat: null, lon: null, outdoor: false, private: true, hidden: true });
  assert.deepEqual(guest.source, {}, "the source text could hold the address");
  assert.equal(guest.you, null);
  assert.equal(guest.eventIcsUrl, undefined);
  assert.ok(!JSON.stringify(guest).includes("Herbert Macaulay"));
  // a public place is the same for everyone
  assert.equal(viewPlan(makeRitual(), { role: "guest", names }).place.name, "Freedom Park");
});

test("a rain alert offers a WhatsApp heads-up", () => {
  const wet = makeRitual({ weather: { checkedAt: "x", summary: "Rain likely (80%)", rainProb: 80, tempC: 30, ok: false } });
  const v = viewPlan(wet, { role: "member", memberId: "m1", names, planUrl: "https://comethrough.tech/c/uni-guys" });
  assert.equal(v.headsUp.text, "Heads up: rain likely (80%) for Saturday at Freedom Park. https://comethrough.tech/c/uni-guys");
  assert.match(v.headsUp.whatsappUrl, /^https:\/\/wa\.me\/\?text=Heads%20up/);
});

test("upcoming and recent places", () => {
  const plans = [makeRitual(), makePlan(), makePlan({ id: "old", start: "2026-09-01T19:00:00+01:00", end: "2026-09-01T22:00:00+01:00", expiresAt: "2026-10-01T21:00:00.000Z" })];
  assert.deepEqual(upcoming(plans, at("2026-10-22")).map((p) => p.id), ["p_wine", "p_ritual"]);
  assert.deepEqual(recentPlaces([makeRitual()], at("2026-10-22")).map((r) => r.key), ["osm:way/1002"]);
});
