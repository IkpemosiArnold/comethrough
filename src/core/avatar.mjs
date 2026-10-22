// @ts-check
// Sloth avatars: every member gets a small painted sloth, the same one every time, seeded
// from their member id. A colour behind it, a fur tone, and one thing it wears: a gele, shades,
// a cap, an agbada collar, headphones, coral beads, a bucket hat, a hibiscus, a bow tie, a
// beanie, a fila or hoop earrings. Drawn in the hand-painted style of the big sloth
// (web/src/ui/Sloth.jsx): flat fills, round strokes, the same fur and face colours.
//
// One source for both sides: the web app draws it inline on the branch, in pods and in
// cards, and the server draws the same sloths on WhatsApp preview cards (src/server/og.mjs),
// never a photo. Pure and browser-safe: plain hex colours (no CSS variables), no clock, no
// randomness, about 1 KB per avatar.

/** Painted-wall colours behind the sloth; every one is light enough for the dark fur. */
export const BACKS = ["#ffc21a", "#9cc58a", "#f29d7e", "#8fd0e6", "#c7b8e8", "#e9d3a0", "#f4b8c8", "#b9dcc4"];
/** Fur tones: the big sloth's own, one a touch darker, one a touch warmer. */
const FURS = [["#7a5b3e", "#8e6c4b"], ["#6b4f36", "#7f6045"], ["#86603c", "#9a7350"]];
/** What it wears, in these colours (an accessory never takes the colour behind it). */
const WEAR = ["#a3214f", "#1b6782", "#1e4a39", "#e2553b", "#ffc21a", "#14302a", "#7b3fa0"];
export const ACCESSORIES = ["gele", "shades", "cap", "agbada", "headphones", "beads", "bucket", "hibiscus", "bowtie", "beanie", "fila", "hoops"];

const FACE = "#ead6b4";
const PATCH = "#4a3626";
const DARK = "#3a2a1e";

/** FNV-1a, 32 bits: a stable number from a member id. */
export function seedOf(/** @type {string} */ id) {
  let h = 0x811c9dc5;
  const s = String(id || "?");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The avatar's look, from the id alone.
 * @param {string} id
 * @returns {{ back: string, fur: string, furLight: string, accessory: string, wear: string, trim: string, seed: number }}
 */
export function avatarLook(id) {
  const seed = seedOf(id);
  const back = BACKS[seed % BACKS.length];
  const [fur, furLight] = FURS[(seed >>> 3) % FURS.length];
  const accessory = ACCESSORIES[(seed >>> 6) % ACCESSORIES.length];
  const wears = WEAR.filter((c) => c !== back);
  const wear = wears[(seed >>> 11) % wears.length];
  const trims = ["#ffc21a", "#f8faf1", "#e2553b"].filter((c) => c !== wear && c !== back);
  const trim = trims[(seed >>> 15) % trims.length];
  return { back, fur, furLight, accessory, wear, trim, seed };
}

/** The accessory's drawing, in front of the face (behind: the hoops' ears only). */
function wearing(/** @type {ReturnType<typeof avatarLook>} */ l) {
  const { wear: c, trim: t } = l;
  switch (l.accessory) {
    case "gele":
      return `<path d="M8 20c-1-8 6-15 16-15 9 0 17 6 16 15-5-3-10-4-16-4S13 17 8 20z" fill="${c}"/><path d="M14 10c4 3 7 4 10 4s7-1 10-4M11 15c4 1 8 2 13 2" stroke="${t}" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M30 6c4-4 9-3 10 1-3 0-6 1-8 3z" fill="${c}"/>`;
    case "shades":
      return `<rect x="12.5" y="22.5" width="10" height="6.5" rx="3" fill="#14302a"/><rect x="25.5" y="22.5" width="10" height="6.5" rx="3" fill="#14302a"/><path d="M22.5 24.5h3" stroke="#14302a" stroke-width="1.6"/><path d="M14.5 24.5l3-1" stroke="${t}" stroke-width="1.2" stroke-linecap="round"/>`;
    case "cap":
      return `<path d="M9 19c0-8 7-13 15-13s15 5 15 13z" fill="${c}"/><path d="M24 19h19c0 2-3 3.5-7 3.5H24z" fill="${c}"/><path d="M24 19h19" stroke="${DARK}" stroke-width="1" opacity=".35"/><circle cx="24" cy="6.5" r="1.6" fill="${t}"/>`;
    case "agbada":
      return `<path d="M5 48c2-7 9-10 19-10s17 3 19 10z" fill="${c}"/><path d="M18 39l6 6 6-6" stroke="${t}" stroke-width="1.8" fill="none" stroke-linejoin="round"/><circle cx="24" cy="45.5" r="1.2" fill="${t}"/>`;
    case "headphones":
      return `<path d="M8 25a16 16 0 0 1 32 0" stroke="${c}" stroke-width="3.2" fill="none" stroke-linecap="round"/><rect x="4.5" y="22" width="6" height="10" rx="3" fill="${c}"/><rect x="37.5" y="22" width="6" height="10" rx="3" fill="${c}"/><rect x="6" y="24.5" width="3" height="5" rx="1.5" fill="${t}"/>`;
    case "beads":
      return [12, 16, 20, 24, 28, 32, 36].map((x, i) => `<circle cx="${x}" cy="${41.5 + Math.abs(24 - x) * -0.12}" r="2.1" fill="${i % 2 ? t : "#d4502f"}"/>`).join("");
    case "bucket":
      return `<path d="M13 15c0-5 5-8 11-8s11 3 11 8l1.5 4h-25z" fill="${c}"/><path d="M6 20c5-2 11-3 18-3s13 1 18 3c-5 2-11 2.5-18 2.5S11 22 6 20z" fill="${c}"/><path d="M12.5 15.5h23" stroke="${t}" stroke-width="1.4"/>`;
    case "hibiscus":
      return `<g transform="translate(36 11)">${[0, 72, 144, 216, 288].map((a) => `<ellipse cx="0" cy="-4" rx="3" ry="4" fill="${c === "#ffc21a" ? "#a3214f" : c}" transform="rotate(${a})"/>`).join("")}<circle r="1.8" fill="#ffc21a"/></g>`;
    case "bowtie":
      return `<path d="M24 42l-7-4v8zM24 42l7-4v8z" fill="${c}"/><circle cx="24" cy="42" r="1.8" fill="${t}"/>`;
    case "beanie":
      return `<path d="M9 19c0-8 7-13 15-13s15 5 15 13z" fill="${c}"/><rect x="8" y="16.5" width="32" height="5" rx="2.5" fill="${t}"/><circle cx="24" cy="5.5" r="3" fill="${t}"/>`;
    case "fila":
      return `<path d="M9 18c1-6 7-10 15-10 6 0 11 2 14 6l-4 5c-4-1-8-1.5-12-1.5-5 0-9 .5-13 .5z" fill="${c}"/><path d="M38 14c2 0 3.5 1.5 3 4l-7 1z" fill="${c}"/><path d="M11 16.5c6-1 15-1 23 .5" stroke="${t}" stroke-width="1.3" fill="none"/>`;
    case "hoops":
      return `<circle cx="8.5" cy="32" r="3.2" stroke="${c === "#14302a" ? "#ffc21a" : c}" stroke-width="1.6" fill="none"/><circle cx="39.5" cy="32" r="3.2" stroke="${c === "#14302a" ? "#ffc21a" : c}" stroke-width="1.6" fill="none"/>`;
    default:
      return "";
  }
}

/**
 * The avatar's inside, for a 48 by 48 view box: the colour, the sloth's head and what it wears.
 * @param {string} id  the member id
 */
export function avatarInner(id) {
  const l = avatarLook(id);
  const head =
    `<circle cx="24" cy="26" r="16" fill="${l.furLight}"/>` +
    `<path d="M8.5 30c2 8 8 12 15.5 12s13.5-4 15.5-12c-3 4-8 7-15.5 7S11.5 34 8.5 30z" fill="${l.fur}"/>` +
    `<ellipse cx="24" cy="28" rx="12.5" ry="9.5" fill="${FACE}"/>` +
    `<ellipse cx="19" cy="27" rx="4.6" ry="2.8" fill="${PATCH}" transform="rotate(16 19 27)"/>` +
    `<ellipse cx="29" cy="27" rx="4.6" ry="2.8" fill="${PATCH}" transform="rotate(-16 29 27)"/>` +
    `<path d="M16.8 26.6q2.2 1.8 4.4 0M26.8 26.6q2.2 1.8 4.4 0" stroke="${FACE}" stroke-width="1.2" fill="none" stroke-linecap="round"/>` +
    `<ellipse cx="24" cy="31.4" rx="2.3" ry="1.6" fill="${DARK}"/>` +
    `<path d="M21.2 34.2q2.8 2 5.6 0" stroke="${DARK}" stroke-width="1.2" fill="none" stroke-linecap="round"/>`;
  // a painted edge: the wall colour, then a soft darker crescent at the bottom
  return `<rect width="48" height="48" fill="${l.back}"/><path d="M0 40c8 5 16 8 24 8s16-3 24-8v8H0z" fill="#14302a" opacity=".08"/>${head}${wearing(l)}`;
}

/**
 * A whole avatar as an SVG document (the server's cards; a data URL for anything else).
 * @param {string} id
 * @param {number} [size]
 */
export function avatarSvg(id, size = 48) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48">${avatarInner(id)}</svg>`;
}
