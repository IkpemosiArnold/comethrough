// @ts-check
// Plan and crew factories for tests.
import { AREAS, PLACES } from "./lagos.mjs";

/** @returns {import("../../src/core/types.mjs").Plan} */
export function makePlan(over = {}) {
  return {
    id: "p_wine",
    crewId: "c1",
    kind: "hosted",
    title: "Wine and monopoly",
    start: "2026-10-23T19:00:00+01:00",
    end: "2026-10-23T23:00:00+01:00",
    tz: "Africa/Lagos",
    place: { name: "Tolu's place", address: "12 Herbert Macaulay Way, Yaba", lat: 6.5101, lon: 3.3712, outdoor: false, private: true },
    price: null,
    host: "m1",
    hostName: null,
    bring: ["a bottle"],
    source: { text: "wine and monopoly at mine friday 7, bring a bottle" },
    why: null,
    invite: null,
    weather: null,
    status: "on",
    confidence: { title: 0.9, start: 0.8 },
    rsvps: { m1: "going", m2: "maybe" },
    createdBy: "m1",
    createdAt: "2026-10-21T09:00:00.000Z",
    updatedAt: "2026-10-21T09:00:00.000Z",
    seq: 0,
    expiresAt: "2026-11-22T22:00:00.000Z",
    ...over,
  };
}

export function makeRitual(over = {}) {
  return makePlan({
    id: "p_ritual",
    kind: "ritual",
    title: "Saturday at Freedom Park",
    start: "2026-10-24T16:00:00+01:00",
    end: "2026-10-24T19:00:00+01:00",
    place: { name: PLACES.freedom.name, address: "Hospital Road, Lagos Island", lat: PLACES.freedom.lat, lon: PLACES.freedom.lon, outdoor: true, private: false, osm: PLACES.freedom.osm },
    host: null,
    bring: [],
    createdBy: "sloth",
    rsvps: {},
    ritualFor: "2026-10-24",
    ...over,
  });
}

export const MEMBERS = [
  { id: "m1", crewId: "c1", name: "Tolu", area: AREAS.yaba, token: "tok_m1", calToken: "cal_m1", joinedAt: "2026-10-21T08:00:00.000Z" },
  { id: "m2", crewId: "c1", name: "Ada", area: AREAS.surulere, token: "tok_m2", calToken: "cal_m2", joinedAt: "2026-10-21T08:00:00.000Z" },
  { id: "m3", crewId: "c1", name: "Kene", area: AREAS.lekki, token: "tok_m3", calToken: "cal_m3", joinedAt: "2026-10-21T08:00:00.000Z" },
];

export const CREW = {
  id: "c1",
  slug: "uni-guys",
  name: "The uni guys",
  vibe: "outside and cheap",
  vibeTags: ["outside", "chill"],
  budget: /** @type {"cheap"} */ ("cheap"),
  rhythm: { every: /** @type {"2w"} */ ("2w"), day: 6, window: { from: "15:00", to: "19:00" }, anchor: "2026-10-10" },
  areas: [AREAS.yaba, AREAS.lekki],
  tz: "Africa/Lagos",
  createdAt: "2026-10-01T08:00:00.000Z",
  inviteToken: "inv_c1",
};
