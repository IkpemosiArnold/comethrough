// "Add your face": a photo made small on the phone before it leaves. Cropped to a square around
// the middle (a little above it, where faces sit in a selfie), cut to a circle, drawn at 128 px
// and saved as WebP (JPEG where the browser can't write WebP), stepped down until it is about
// 20 KB. The pure parts are tested from Node; nothing here touches the DOM at import time.

export const FACE_PX = 128;
export const FACE_TARGET = 24 * 1024;
const QUALITIES = [0.82, 0.72, 0.6, 0.5];

/** The square to cut from a picture: the full short side, a little above the middle. */
export function faceCrop(width, height) {
  const side = Math.min(width, height);
  const x = Math.round((width - side) / 2);
  const y = height > width ? Math.round((height - side) * 0.3) : 0;
  return { x, y, side };
}

/**
 * The photo, ready to upload: { blob, url } (url previews it), or throws with a plain message.
 * @param {File} file
 */
export async function prepareFace(file) {
  let bmp = null;
  try { bmp = await createImageBitmap(file); } catch { bmp = null; }
  if (!bmp) throw new Error("Couldn't open that photo. Try another one.");
  const { x, y, side } = faceCrop(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = FACE_PX;
  const ctx = canvas.getContext('2d');
  const draw = (corner) => {
    ctx.clearRect(0, 0, FACE_PX, FACE_PX);
    if (corner) { ctx.fillStyle = corner; ctx.fillRect(0, 0, FACE_PX, FACE_PX); }
    ctx.save();
    ctx.beginPath();
    ctx.arc(FACE_PX / 2, FACE_PX / 2, FACE_PX / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(bmp, x, y, side, side, 0, 0, FACE_PX, FACE_PX);
    ctx.restore();
  };
  let best = null;
  for (const type of ['image/webp', 'image/jpeg']) {
    // JPEG has no see-through corners, so they take the wall's colour
    draw(type === 'image/jpeg' ? '#f6f1e7' : null);
    for (const q of QUALITIES) {
      const blob = await new Promise((r) => canvas.toBlob(r, type, q));
      if (!blob || blob.type !== type) break;
      if (!best || blob.size < best.size) best = blob;
      if (blob.size <= FACE_TARGET) break;
    }
    if (best && best.type === type) break;
  }
  bmp.close?.();
  if (!best) throw new Error("Couldn't shrink that photo. Try another one.");
  return { blob: best, url: URL.createObjectURL(best) };
}
