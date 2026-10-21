// @ts-check
// Shared JSDoc types for Come Through. This file has no runtime code; import types with
//   /** @typedef {import("./types.mjs").Plan} Plan */
// The shapes match docs/SPEC.md ("Data model"). Times are ISO 8601 strings with an offset
// (for Lagos, +01:00), so a stored plan reads the same in any timezone.

/**
 * @typedef {{ lat: number, lon: number }} LatLon
 * @typedef {{ label: string, lat: number, lon: number }} Area
 * @typedef {"1w"|"2w"|"4w"} Every
 * @typedef {{ from: string, to: string }} TimeWindow  "HH:MM" local times
 * @typedef {{ every: Every|null, day: number, window: TimeWindow, anchor?: string }} Rhythm
 *   day: 0 (Sunday) to 6; anchor: an optional "YYYY-MM-DD" that fixes which weeks count for 2w and 4w
 */

/**
 * @typedef {object} Crew
 * @property {string} id
 * @property {string} slug
 * @property {string} name
 * @property {string|null} vibe
 * @property {string[]} [vibeTags]
 * @property {"free"|"cheap"|"any"} [budget]
 * @property {Rhythm|null} rhythm
 * @property {Area[]} areas
 * @property {string} createdAt
 * @property {string} inviteToken
 * @property {string} [tz]
 */

/**
 * @typedef {object} Member
 * @property {string} id
 * @property {string} crewId
 * @property {string} name
 * @property {Area} area
 * @property {string} token     the member's own link token (read and write as this member)
 * @property {string} calToken  read-only calendar feed token
 * @property {string} joinedAt
 */

/**
 * @typedef {object} OsmRef
 * @property {"node"|"way"|"relation"} type
 * @property {number} id
 * @property {Record<string,string>} tags
 */

/**
 * @typedef {object} Place
 * @property {string|null} name
 * @property {string|null} address
 * @property {number|null} lat
 * @property {number|null} lon
 * @property {OsmRef} [osm]
 * @property {boolean} outdoor
 * @property {boolean} private
 */

/**
 * @typedef {object} PlanWeather
 * @property {string} checkedAt
 * @property {string} summary
 * @property {number|null} rainProb
 * @property {number|null} tempC
 * @property {boolean} ok
 */

/**
 * @typedef {"found"|"hosted"|"ritual"|"quick"} PlanKind
 * @typedef {"on"|"moved"|"cancelled"} PlanStatus
 * @typedef {"going"|"maybe"} Rsvp
 */

/**
 * @typedef {object} Plan
 * @property {string} id
 * @property {string} crewId
 * @property {PlanKind} kind
 * @property {string} title
 * @property {string} start
 * @property {string} end
 * @property {string} tz
 * @property {Place} place
 * @property {{ text: string, free: boolean }|null} price
 * @property {string|null} host       a member id
 * @property {string|null} [hostName] a host named in the source who is not a member
 * @property {string[]} bring
 * @property {{ url?: string, text?: string, image?: boolean, flyerId?: string, imageUrl?: string }} source  flyerId: a stored thumbnail; imageUrl: a page's own image
 * @property {string|null} why
 * @property {string|null} invite
 * @property {PlanWeather|null} weather
 * @property {PlanStatus} status
 * @property {Record<string, number>} confidence
 * @property {Record<string, Rsvp>} rsvps
 * @property {string} createdBy       a member id or "sloth" (the ritual)
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {number} seq             bumped on every change (the ICS SEQUENCE)
 * @property {string} expiresAt
 * @property {string} [ritualFor]     the "YYYY-MM-DD" rhythm slot a ritual plan fills
 * @property {{ kind: "moved"|"next_day"|"covered"|"skip", note: string, wanted: { date: string, from: string, to: string, rainProb: number|null } }} [rainPlan]  set on a ritual whose own window was wet: what the sloth did about it, in plain words. A "skip" ritual has status "cancelled" and stays out of calendars
 */

/**
 * @typedef {object} Pod
 * @property {string[]} memberIds
 * @property {string} fromLabel
 * @property {string} leaveBy
 * @property {number} travelMin
 * @property {string|null} destinationText  what to paste into a ride app's "Where to?" box
 */

export {};
