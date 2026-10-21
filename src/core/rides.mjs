// @ts-check
// Ride apps that work in Lagos, and what a web app can honestly do with each.
//
// Every entry is checked against a dated source (docs/LOCAL-FACTS.md, "Rides"). Uber is not
// here: it wound down in Nigeria effective 2 Sep 2026 (TechCabal, 2 Sep 2026).
//
// A capability is claimed only when it is documented. On 21 Oct 2026 none of these apps
// documented a link that opens it with the drop-off filled in:
//   - Bolt: bolt.eu's apple-app-site-association has webcredentials and no applinks; its
//     assetlinks.json delegates all URLs to ee.mtakso.client, but no path takes a destination,
//     and there is no developer documentation for one.
//   - inDrive: indrive.com's apple-app-site-association claims only /app/, /app/super_services,
//     /app/oauth-callback, /app/wallet/* and /app/bdu/*. None takes a destination.
//   - LagRide: lagride.ng serves no app link manifests at all.
// So the honest action is: copy the address, then open the app's store page (which shows
// "Open" when the app is installed) or its web page. When a provider documents a drop-off
// link, add a `dropoff` template here with its source and a test.

/**
 * @typedef {object} RideProvider
 * @property {string} id
 * @property {string} name
 * @property {string} blurb        a few plain words for the UI, from the sources, or ""
 * @property {{ android: string, ios: string, web: string }} links  store pages and the Lagos web page
 * @property {null} dropoff        a URL template that fills the destination; null until documented
 * @property {{ url: string, says: string }[]} sources
 * @property {string} checkedAt    "YYYY-MM-DD"
 */

/** @type {RideProvider[]} In the order the UI shows them: Bolt first, then inDrive. */
export const RIDE_PROVIDERS = [
  {
    id: "bolt",
    name: "Bolt",
    blurb: "",
    links: {
      android: "https://play.google.com/store/apps/details?id=ee.mtakso.client",
      ios: "https://apps.apple.com/ng/app/bolt-request-a-ride/id675033630",
      web: "https://bolt.eu/en-ng/cities/lagos/",
    },
    dropoff: null,
    sources: [
      { url: "https://techcabal.com/2026/09/02/uber-exits-nigeria/", says: "Uber's exit leaves the market concentrated around its biggest rivals, Bolt and inDrive (2 Sep 2026)" },
      { url: "https://techcabal.com/2026/09/03/with-uber-gone-bolt-says-nigeria-remains-an-important-market/", says: "Bolt says Nigeria remains an important market (3 Sep 2026)" },
      { url: "https://bolt.eu/en-ng/cities/lagos/", says: "Bolt's own Lagos page, HTTP 200" },
    ],
    checkedAt: "2026-10-21",
  },
  {
    id: "indrive",
    name: "inDrive",
    blurb: "You name the fare.",
    links: {
      android: "https://play.google.com/store/apps/details?id=sinet.startup.inDriver",
      ios: "https://apps.apple.com/ng/app/indrive-rides-at-your-price/id780125801",
      web: "https://indrive.com/en-ng/",
    },
    dropoff: null,
    sources: [
      { url: "https://techcabal.com/2026/09/02/uber-exits-nigeria/", says: "Bolt and inDrive are the biggest rivals left (2 Sep 2026)" },
      { url: "https://www.legit.ng/business-economy/technology/1728679-uber-leaves-nigeria-bolt-indrive-local-rivals-face-ride-hailing-battle/", says: "Bolt, inDrive and local rivals after Uber (3 Sep 2026)" },
      { url: "https://apps.apple.com/ng/app/indrive-rides-at-your-price/id780125801", says: "App Store name: inDrive, rides at your price" },
    ],
    checkedAt: "2026-10-21",
  },
  {
    id: "lagride",
    name: "LagRide",
    blurb: "Backed by Lagos State.",
    links: {
      android: "https://play.google.com/store/apps/details?id=com.lagos.emobility.client",
      ios: "https://apps.apple.com/ng/app/lagride/id6738812036",
      web: "https://www.lagride.ng/",
    },
    dropoff: null,
    sources: [
      { url: "https://www.legit.ng/business-economy/technology/1728679-uber-leaves-nigeria-bolt-indrive-local-rivals-face-ride-hailing-battle/", says: "the Lagos State-backed ride-hailing platform (3 Sep 2026)" },
      { url: "https://thecondia.com/uber-alternatives-nigeria-ride-hailing-apps/", says: "LagRide, Lagos only (11 Sep 2026)" },
    ],
    checkedAt: "2026-10-21",
  },
];

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
 * Where a ride button goes for a provider on a platform. No provider has a documented
 * drop-off link, so this is the store page on a phone (it says "Open" when the app is
 * installed) and the Lagos web page elsewhere.
 * @param {RideProvider} p
 * @param {"android"|"ios"|"other"} platform
 */
export function rideLink(p, platform) {
  return platform === "android" ? p.links.android : platform === "ios" ? p.links.ios : p.links.web;
}

/** The providers as the API sends them (no source lists; those are in this file and LOCAL-FACTS.md). */
export const ridesForApi = () => RIDE_PROVIDERS.map((p) => ({ id: p.id, name: p.name, blurb: p.blurb, links: p.links, dropoff: false }));
