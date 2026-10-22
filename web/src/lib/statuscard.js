// "We came through": a card for WhatsApp Status, Instagram Stories or Snapchat, made on this
// phone. The photos never leave it: they are drawn into a 1080x1920 canvas here, and the
// finished picture goes to the phone's own share sheet (Web Share with files), or saves as a
// download where sharing files is not supported. The sloth and the branch are the same
// drawings the server uses for link previews (src/core/art.mjs).
import { BRANCH, SLOTH } from '../../../src/core/art.mjs';

export const W = 1080;
export const H = 1920;
const INK = '#14302a';
const INK2 = '#3d574e';
const WALL = '#e3ebd2';
const PAPER = '#f8faf1';
const DANFO = '#ffc21a';
const CANOPY = '#1e4a39';

/** "Yaba Lot came through." and the slow-and-steady line, or the nameless version for a discreet crew. */
export function cardLines({ crewName = null, linkups = 1 }) {
  const n = Math.max(1, Number(linkups) || 1);
  return {
    head: crewName ? `${crewName} came through.` : 'We came through.',
    sub: n === 1 ? 'The first linkup, slow and steady' : `${n} linkups, slow and steady`,
  };
}

/** Where the photos go: 1 big, 2 or 3 smaller, each tilted like a print pasted on a wall. */
export function frames(count) {
  if (count === 1) return [{ cx: 540, cy: 860, size: 760, turn: -3 }];
  if (count === 2) return [{ cx: 370, cy: 730, size: 540, turn: -5 }, { cx: 705, cy: 1040, size: 540, turn: 4 }];
  if (count >= 3) return [{ cx: 320, cy: 660, size: 450, turn: -6 }, { cx: 760, cy: 820, size: 450, turn: 5 }, { cx: 440, cy: 1100, size: 450, turn: -2 }];
  return [];
}

/** Lines of text that fit a width, at most `max` lines (the last one shortened with an ellipsis). */
export function wrap(measure, text, width, max = 3) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (measure(next) <= width || !line) line = next;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  if (lines.length > max) {
    const kept = lines.slice(0, max);
    let last = kept[max - 1];
    while (last.length > 1 && measure(`${last}…`) > width) last = last.slice(0, -1);
    kept[max - 1] = `${last.trimEnd()}…`;
    return kept;
  }
  return lines;
}

async function svgImage(svg) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/**
 * Draw the card. photos: up to 3 Files from the camera roll (optional).
 * @returns {Promise<File>} a JPEG named came-through.jpg
 */
export async function makeStatusCard({ photos = [], crewName = null, linkups = 1 }) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  try { await document.fonts.load('104px Shrikhand'); } catch { /* the fallback face still reads */ }

  // the wall, with a canopy band at the foot like the app's sloth panel
  ctx.fillStyle = WALL;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = CANOPY;
  ctx.fillRect(0, H - 120, W, 120);

  const [branch, sloth] = await Promise.all([svgImage(BRANCH), svgImage(SLOTH)]);
  ctx.drawImage(branch, -60, 110, 1200, 170);

  const bitmaps = [];
  for (const f of photos.slice(0, 3)) {
    try { bitmaps.push(await createImageBitmap(f)); } catch { /* a photo that won't open is left out */ }
  }
  const spots = frames(bitmaps.length);
  bitmaps.forEach((bmp, i) => {
    const { cx, cy, size, turn } = spots[i];
    const pad = Math.round(size * 0.045);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((turn * Math.PI) / 180);
    // a hard painted shadow, then the paper, then the photo cut square from its middle
    ctx.fillStyle = 'rgba(20, 48, 42, 0.9)';
    ctx.fillRect(-size / 2 + 10, -size / 2 + 14, size, size + pad * 2);
    ctx.fillStyle = PAPER;
    ctx.fillRect(-size / 2, -size / 2, size, size + pad * 2);
    const side = Math.min(bmp.width, bmp.height);
    const inner = size - pad * 2;
    ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, -size / 2 + pad, -size / 2 + pad, inner, inner);
    // two strips of yellow tape
    ctx.fillStyle = 'rgba(255, 194, 26, 0.88)';
    ctx.rotate((-12 * Math.PI) / 180);
    ctx.fillRect(-size / 2 - 30, -size / 2 + 10, 150, 46);
    ctx.rotate((24 * Math.PI) / 180);
    ctx.fillRect(size / 2 - 150, -size / 2 - 60, 150, 46);
    ctx.restore();
    bmp.close?.();
  });

  // the sloth hangs from the branch; with no photos it is the picture
  if (bitmaps.length) ctx.drawImage(sloth, 780, 150, 220, 257);
  else ctx.drawImage(sloth, 240, 300, 600, 700);

  const { head, sub } = cardLines({ crewName, linkups });
  ctx.textBaseline = 'alphabetic';
  ctx.font = "104px Shrikhand, Georgia, serif";
  const lines = wrap((t) => ctx.measureText(t).width, head, W - 160, 3);
  // the words sit just above the canopy band, the photos above them
  const subY = H - 120 - 70;
  let y = subY - 96 - (lines.length - 1) * 116;
  for (const line of lines) {
    ctx.fillStyle = DANFO;
    ctx.fillText(line, 86, y + 8);
    ctx.fillStyle = INK;
    ctx.fillText(line, 80, y);
    y += 116;
  }
  ctx.font = '700 50px system-ui, -apple-system, Roboto, sans-serif';
  ctx.fillStyle = INK2;
  ctx.fillText(sub, 80, subY);
  ctx.font = '700 38px system-ui, -apple-system, Roboto, sans-serif';
  ctx.fillStyle = '#eef4e1';
  ctx.fillText('comethrough.tech', 80, H - 46);

  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
  return new File([blob], 'came-through.jpg', { type: 'image/jpeg' });
}

/**
 * Share the card with the phone's share sheet (WhatsApp, including My status; Instagram;
 * Snapchat; Save to Photos). Called straight from the tap, with the file already made, so
 * the browser still counts it as the person's own tap. The file goes alone: iPhones drop
 * a file that has text with it (WebKit bug 251500). Resolves 'shared', 'cancelled' or
 * 'unsupported'.
 */
export function shareCard(file) {
  const data = { files: [file] };
  if (!navigator.canShare || !navigator.share || !navigator.canShare(data)) return Promise.resolve('unsupported');
  return navigator.share(data).then(() => 'shared', (e) => (e && e.name === 'AbortError' ? 'cancelled' : 'unsupported'));
}
