// Flyer pictures, made cheap to send on Nigerian mobile data. A phone photo is often 3 to
// 5 MB; Gemma reads a flyer just as well at 1600 px on the long edge. So before upload:
//   - decode the picture in the browser (createImageBitmap);
//   - draw it at most 1600 px on its long edge;
//   - encode WebP at 0.8 where the browser can (smaller), else JPEG at 0.8;
//   - if that is still over 400 KB, step the quality down, then the size;
//   - keep the original when it is already smaller and a type the server takes.
// HEIC (iPhone photos): decoded when the browser can (Safari); when it cannot, the person is
// asked for a screenshot of the flyer, which is always a PNG or JPEG.
// Nothing here touches the DOM at import time, so the plan logic is tested from Node.

export const MAX_EDGE = 1600;
export const TARGET_BYTES = 400 * 1024;
/** Quality and size steps, tried in order until the file is under TARGET_BYTES. */
export const STEPS = [
  { edge: 1600, quality: 0.8 },
  { edge: 1600, quality: 0.7 },
  { edge: 1600, quality: 0.6 },
  { edge: 1280, quality: 0.7 },
  { edge: 1024, quality: 0.7 },
];
const SERVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export class FlyerError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export const isHeic = (file) => /^image\/hei[cf]/i.test(file?.type || '') || /\.hei[cf]$/i.test(file?.name || '');

/** The drawing size for a picture so its long edge is at most `edge`. */
export function fitSize(width, height, edge = MAX_EDGE) {
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** 312000 as "305 KB", 4200000 as "4.0 MB". */
export function formatBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Shrink a decoded picture with an encoder, step by step, until it is under the target.
 * @param {{ width: number, height: number }} size  the decoded picture's size
 * @param {(w: number, h: number, quality: number) => Promise<Blob|null>} encode
 * @returns {Promise<{ blob: Blob, step: { edge: number, quality: number } }|null>}
 */
export async function shrinkWith(size, encode) {
  let best = null;
  for (const step of STEPS) {
    const { width, height } = fitSize(size.width, size.height, step.edge);
    const blob = await encode(width, height, step.quality);
    if (!blob) continue;
    if (!best || blob.size < best.blob.size) best = { blob, step };
    if (blob.size <= TARGET_BYTES) return { blob, step };
  }
  return best;
}

/**
 * Get a flyer ready to send: { file, bytes, originalBytes }. Throws FlyerError "heic" when
 * the browser cannot open an iPhone HEIC photo, and "unreadable" for a picture it cannot
 * open at all and that is too big to send as it is.
 * @param {File} file
 */
export async function prepareFlyer(file) {
  const originalBytes = file.size;
  let bmp = null;
  try {
    bmp = typeof createImageBitmap === 'function' ? await createImageBitmap(file) : null;
  } catch {
    bmp = null;
  }
  if (!bmp) {
    if (isHeic(file)) throw new FlyerError('heic', "This browser can't open iPhone HEIC photos. Take a screenshot of the flyer and add that instead.");
    if (SERVER_TYPES.includes(file.type) && file.size <= TARGET_BYTES) return { file, bytes: file.size, originalBytes };
    throw new FlyerError('unreadable', "Couldn't open that picture. Take a screenshot of the flyer and add that instead.");
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  // WebP when this browser can write it (Chrome, Opera, Firefox); Safari falls back to JPEG
  let type = 'image/webp';
  const encode = async (w, h, q) => {
    canvas.width = w;
    canvas.height = h;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    let blob = await new Promise((r) => canvas.toBlob(r, type, q));
    if (blob && blob.type !== type) {
      type = 'image/jpeg';
      blob = await new Promise((r) => canvas.toBlob(r, type, q));
    }
    return blob;
  };
  const out = await shrinkWith({ width: bmp.width, height: bmp.height }, encode);
  bmp.close?.();
  const small = out && out.blob;
  // an already small JPEG, PNG or WebP stays as it is when shrinking would not help
  const keep = SERVER_TYPES.includes(file.type) && file.size <= TARGET_BYTES && (!small || file.size <= small.size);
  if (keep) return { file, bytes: file.size, originalBytes };
  if (!small) {
    if (SERVER_TYPES.includes(file.type) && file.size <= 5 * 1024 * 1024) return { file, bytes: file.size, originalBytes };
    throw new FlyerError('unreadable', "Couldn't shrink that picture. Take a screenshot of the flyer and add that instead.");
  }
  const ext = small.type === 'image/webp' ? 'webp' : 'jpg';
  return { file: new File([small], `flyer.${ext}`, { type: small.type }), bytes: small.size, originalBytes };
}
