// Where the crew on screen is: its zone (dates and times show in it) and its city pack's
// examples (placeholders), from the crew the server sends (crew.tz, crew.region, crew.pack).
// Before a crew is loaded, the visitor's own zone decides: Lagos examples for a phone set to
// Lagos time, neutral ones anywhere else.
import { setZone } from './format.js';

const LAGOS_UI = { id: 'lagos', areaPlaceholder: 'Yaba, Lekki Phase 1, Ikeja...', pricePlaceholder: 'Free, or ₦5,000 at the gate', intoPlaceholder: 'art, live music, suya, somewhere quiet', directions: false };
const NEUTRAL_UI = { id: 'default', areaPlaceholder: 'Your neighbourhood', pricePlaceholder: 'Free, or the price at the door', intoPlaceholder: 'art, live music, somewhere quiet', directions: true };

let current = null; // { tz, region, pack }

/** The visitor's own IANA zone, or null. */
export function visitorZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

const visitorInLagos = () => visitorZone() === 'Africa/Lagos';

/** Remember the crew on screen (call with the crew object the API returns). */
export function setPlace(crew) {
  if (!crew) return;
  current = { tz: crew.tz || crew.region?.timezone || null, region: crew.region || null, pack: crew.pack || null };
  if (current.tz) setZone(current.tz);
}

/** The pack's examples for the crew on screen, else for the visitor. */
export function packUi() {
  if (current?.pack) return current.pack;
  return visitorInLagos() ? LAGOS_UI : NEUTRAL_UI;
}

/** What the server needs to start a crew in the right place: the visitor's zone. */
export function hint() {
  const tz = visitorZone();
  return tz ? { tz } : null;
}

/** Query parameters for the area type-ahead: the crew's centre and country, else the visitor's zone. */
export function areaContext() {
  const c = current?.region?.center;
  if (c && Number.isFinite(c.lat) && Number.isFinite(c.lon)) return `&near=${c.lat.toFixed(4)},${c.lon.toFixed(4)}${current.region.countryCode ? `&cc=${current.region.countryCode}` : ''}`;
  const tz = visitorZone();
  return tz ? `&tz=${encodeURIComponent(tz)}` : '';
}

// Example crew sentences: Lagos's, and one for each city we test in. A visitor in one of
// those zones sees theirs; anyone else sees one that changes by the day.
const EXAMPLES = {
  'Africa/Lagos': 'Uni guys, every other Saturday, outside and cheap, around Yaba and Lekki',
  'Europe/London': 'The Peckham lot, every other Sunday, green and cheap, around Brixton',
  'Europe/Berlin': 'The Kreuzberg lot, every other Sunday, green and cheap, around Neukölln',
  'Africa/Nairobi': 'Campus crew, every Saturday afternoon, outside, around Kilimani and Westlands',
  'Asia/Kolkata': 'Office gang, every other Saturday, somewhere green, around Indiranagar',
  'America/New_York': 'The Brooklyn crew, every other Sunday, a park, around Park Slope',
};

/** The example sentence for the start screen. */
export function exampleSentence() {
  const tz = visitorZone();
  if (tz && EXAMPLES[tz]) return EXAMPLES[tz];
  const all = Object.values(EXAMPLES);
  return all[Math.floor(Date.now() / 86400000) % all.length];
}
