// @ts-check
// Getting there: ride app buttons, a universal "Get directions" link, and the text to paste
// into any app's "Where to?" box. Nothing here names a ride provider: a city pack brings its
// own list, each provider checked against a dated source (src/packs/lagos/rides.mjs and
// docs/LOCAL-FACTS.md). A city with no verified list gets directions and "Copy address"
// only, because a button for an app that does not run there is worse than no button.
//
// The directions links follow each platform's own documentation (checked 21 Oct 2026):
//   - Android: a geo: URI, "geo:0,0?q=lat,lng(label)", which opens whatever maps app the
//     phone has (developer.android.com/guide/components/intents-common#Maps);
//   - iPhone: Apple's unified Maps URL, "https://maps.apple.com/directions?destination=...&mode=driving"
//     (developer.apple.com/documentation/mapkit/unified-map-urls; iOS 18.4 and later open it
//     in Maps, earlier ones in Apple Maps on the web);
//   - anything else: Google's Maps URL, "https://www.google.com/maps/dir/?api=1&destination=...",
//     which opens the Google Maps app when installed and the browser otherwise
//     (developers.google.com/maps/documentation/urls/get-started).

/**
 * @typedef {object} RideProvider
 * @property {string} id
 * @property {string} name
 * @property {string} blurb        a few plain words for the UI, from the sources, or ""
 * @property {{ android: string, ios: string, web: string }} links  store pages and the provider's web page for the city
 * @property {null} dropoff        a URL template that fills the destination; null until documented
 * @property {{ url: string, says: string }[]} sources
 * @property {string} checkedAt    "YYYY-MM-DD"
 */

/**
 * The text to paste into any ride app's "Where to?" box: the place's name and address, with
 * repeats removed. Coordinates only when there is nothing else, because ride apps search by
 * name and address.
 * @param {{ name?: string|null, address?: string|null, lat?: number|null, lon?: number|null }} place
 * @returns {string|null}  null when there is nothing to paste (a host's home with no address)
 */
export function destinationText(place) {
  const parts = [place?.name, place?.address].filter((x) => typeof x === "string" && x.trim()).map((x) => /** @type {string} */ (x).trim());
  const text = [...new Set(parts)].join(", ");
  if (text) return text;
  if (Number.isFinite(place?.lat) && Number.isFinite(place?.lon)) return `${/** @type {number} */ (place.lat).toFixed(5)}, ${/** @type {number} */ (place.lon).toFixed(5)}`;
  return null;
}

/**
 * Where a ride button goes for a provider on a platform. No provider we have checked has a
 * documented drop-off link, so this is the store page on a phone (it says "Open" when the
 * app is installed) and the provider's web page for the city elsewhere.
 * @param {RideProvider} p
 * @param {"android"|"ios"|"other"} platform
 */
export function rideLink(p, platform) {
  return platform === "android" ? p.links.android : platform === "ios" ? p.links.ios : p.links.web;
}

/**
 * The providers as the API sends them (no source lists; those stay in the pack and
 * LOCAL-FACTS.md).
 * @param {RideProvider[]} [providers]  the city pack's verified list; none by default
 */
export const ridesForApi = (providers = []) => providers.map((p) => ({ id: p.id, name: p.name, blurb: p.blurb, links: p.links, dropoff: false }));

/**
 * "Get directions" for a place, on each platform: a geo: URI on Android, Apple Maps on an
 * iPhone, Google Maps elsewhere. The destination is the pin when there is one, else the
 * name and address as text, else null (a host's home with no address has nowhere to go).
 * @param {{ name?: string|null, address?: string|null, lat?: number|null, lon?: number|null, private?: boolean }} place
 * @returns {{ android: string, ios: string, web: string }|null}
 */
export function directionsLinks(place) {
  if (!place) return null;
  const pinned = Number.isFinite(place.lat) && Number.isFinite(place.lon);
  const text = place.private && !place.address ? null : destinationText({ name: place.name, address: place.address });
  if (!pinned && !text) return null;
  const at = pinned ? `${/** @type {number} */ (place.lat).toFixed(6)},${/** @type {number} */ (place.lon).toFixed(6)}` : null;
  const dest = at ?? /** @type {string} */ (text);
  const label = (place.name || "").replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  const enc = encodeURIComponent;
  return {
    android: at ? `geo:0,0?q=${enc(at)}${label ? enc(`(${label})`) : ""}` : `geo:0,0?q=${enc(dest)}`,
    ios: `https://maps.apple.com/directions?destination=${enc(dest)}&mode=driving`,
    web: `https://www.google.com/maps/dir/?api=1&destination=${enc(dest)}&travelmode=driving`,
  };
}
