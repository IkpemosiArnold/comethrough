// The Status card sheet: pick up to 3 photos (or none), see the card, share it. Everything
// happens on this phone; the photos are never uploaded.
import { useEffect, useRef, useState } from 'preact/hooks';
import { makeStatusCard, shareCard } from '../lib/statuscard.js';
import { Dots } from './misc.jsx';
import { toast } from './toast.jsx';

export function StatusSheet({ crewName, linkups, onClose }) {
  const [file, setFile] = useState(null);
  const [url, setUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const pick = useRef(null);
  const canShare = (() => {
    try { return !!(file && navigator.canShare && navigator.canShare({ files: [file] })); } catch { return false; }
  })();

  useEffect(() => {
    document.documentElement.classList.add('sheet-open');
    return () => document.documentElement.classList.remove('sheet-open');
  }, []);
  useEffect(() => () => url && URL.revokeObjectURL(url), [url]);

  async function make(photos) {
    setBusy(true);
    try {
      const f = await makeStatusCard({ photos, crewName, linkups });
      setFile(f);
      setUrl(URL.createObjectURL(f));
    } catch {
      toast("Couldn't make the card on this phone. Try fewer photos.");
    } finally {
      setBusy(false);
    }
  }
  function chosen(e) {
    const photos = [...(e.currentTarget.files || [])].slice(0, 3);
    e.currentTarget.value = '';
    if (photos.length) make(photos);
  }
  // straight from the tap, with the card already made, so the share sheet opens
  function share() {
    shareCard(file).then((r) => {
      if (r === 'shared') onClose(true);
      if (r === 'unsupported') toast('This browser can only save it. Use Save the card.');
    });
  }

  return (
    <div class="sheet-wrap">
      <div class="sheet-scrim" onClick={() => onClose(false)} aria-hidden="true" />
      <div class="sheet status-sheet" role="dialog" aria-modal="true" aria-labelledby="status-sheet-title">
        <span class="sheet-grip" aria-hidden="true" />
        <h2 id="status-sheet-title" class="display display-md">A card for your Status</h2>
        {!file ? (
          <>
            <p class="muted">Add up to 3 photos from the day, or make it with the sloth alone. Your photos stay on this phone.</p>
            <input ref={pick} type="file" accept="image/*" multiple hidden onChange={chosen} />
            <button class="btn primary block big" disabled={busy} onClick={() => pick.current?.click()}>{busy ? <>Painting it <Dots /></> : 'Pick photos'}</button>
            <button class="btn ghost block" disabled={busy} onClick={() => make([])}>Make it without photos</button>
          </>
        ) : (
          <>
            <img class="status-preview" src={url} alt="Your Status card" width="1080" height="1920" />
            {canShare && <button class="btn primary block big" onClick={share}>Share</button>}
            <a class={`btn ${canShare ? 'ghost' : 'primary big'} block`} href={url} download="came-through.jpg" onClick={() => !canShare && setTimeout(() => onClose(true), 300)}>Save the card</a>
            <p class="small muted">{canShare ? 'Pick WhatsApp, then My status. Instagram and Snapchat are in the same list when they are on this phone.' : 'Save it, then post it from WhatsApp, Instagram or Snapchat.'}</p>
          </>
        )}
        <button class="btn ghost block" onClick={() => onClose(false)}>Not now</button>
      </div>
    </div>
  );
}
