// The gentle extras on the crew page, each shown once and never as a nag:
//   - "We came through": the day after a plan 2 or more went to, one card offers a picture
//     for WhatsApp Status. Made on this phone; the photos never upload. A discreet crew never
//     sees it unless someone turns it on under "You in this crew", and then without the name.
//   - "Got another crew?": after your first plan that happened, once.
//   - "You in this crew": your sloth, or your own photo (for the crew only), and for a
//     discreet crew the Status card opt-in.
import { useRef, useState } from 'preact/hooks';
import { api } from '../lib/api.js';
import { doneHere, markHere, clearHere } from '../lib/once.js';
import { prepareFace } from '../lib/face.js';
import { Avatar } from './Avatar.jsx';
import { Icon } from './icons.jsx';
import { Dots } from './misc.jsx';
import { toast } from './toast.jsx';

const statusKey = (planId) => `status:${planId}`;
export const statusOptInKey = (slug) => `status-optin:${slug}`;

/** Which one-time card the crew page shows now: the Status card first, else "Got another crew?". */
export function pickGrowthCard({ growth, slug, meId }) {
  if (!growth || !meId) return null;
  const seen = growth.seen || [];
  const r = growth.recap;
  const allowed = !growth.discreet || doneHere(statusOptInKey(slug));
  if (r && allowed && !seen.includes(statusKey(r.planId)) && !doneHere(statusKey(r.planId))) return 'status';
  if (growth.cameThrough && !seen.includes('another-crew') && !doneHere(`another-crew:${meId}`) && !doneHere('another-crew')) return 'another';
  return null;
}

export function StatusPrompt({ slug, crewName, growth, onDone }) {
  const [open, setOpen] = useState(false);
  const [Sheet, setSheet] = useState(null);
  const key = statusKey(growth.recap.planId);
  function finish() {
    markHere(key);
    api.markSeen(slug, key);
    onDone();
  }
  async function start() {
    setOpen(true);
    if (!Sheet) {
      const m = await import('./StatusSheet.jsx');
      setSheet(() => m.StatusSheet);
    }
  }
  return (
    <section class="once-card status-prompt" aria-labelledby="status-title">
      <button class="once-x" onClick={finish} aria-label="Not now"><Icon name="close" size={20} /></button>
      <p id="status-title" class="once-title">You came through for {growth.recap.title}</p>
      <p class="once-body">Make a card for your Status?</p>
      <button class="btn secondary" onClick={start}>Make the card</button>
      {open && Sheet && (
        <Sheet
          crewName={growth.discreet ? null : crewName}
          linkups={growth.linkups}
          onClose={(made) => { setOpen(false); if (made) finish(); }}
        />
      )}
      {open && !Sheet && <p class="small muted">Getting the paint <Dots /></p>}
    </section>
  );
}

export function AnotherCrew({ slug, meId, onDone }) {
  function finish() {
    markHere(`another-crew:${meId}`);
    markHere('another-crew');
    api.markSeen(slug, 'another-crew');
    onDone();
  }
  return (
    <section class="once-card another-crew" aria-labelledby="another-title">
      <button class="once-x" onClick={finish} aria-label="No thanks"><Icon name="close" size={20} /></button>
      <p id="another-title" class="once-title">Got another crew?</p>
      <p class="once-body">Family, work, church people. Start one in a sentence.</p>
      <a class="btn secondary" href="/start" onClick={finish}>Start one</a>
    </section>
  );
}

// Your sloth, or your own photo. One tap opens the front camera; "Pick a photo" opens the
// gallery. The photo is cut to a circle and made about 20 KB here before it's sent.
export function YouHere({ slug, me, discreet, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [optIn, setOptIn] = useState(() => doneHere(statusOptInKey(slug)));
  const cam = useRef(null);
  const roll = useRef(null);
  if (!me) return null;
  async function picked(e) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const { blob, url } = await prepareFace(file);
      await api.setFace(slug, blob);
      URL.revokeObjectURL(url);
      toast('Your face is up. Only your crew sees it.');
      onChanged();
    } catch (err) {
      toast(err.message || "Couldn't add your photo. Try again.");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await api.removeFace(slug);
      toast('Photo removed. Your sloth is back.');
      onChanged();
    } catch (err) {
      toast(err.message || "Couldn't remove it. Try again.");
    } finally {
      setBusy(false);
    }
  }
  function toggleOptIn(e) {
    const on = e.currentTarget.checked;
    setOptIn(on);
    if (on) markHere(statusOptInKey(slug)); else clearHere(statusOptInKey(slug));
  }
  return (
    <details class="cal-more you-here">
      <summary>
        <Avatar member={me} />
        <span class="grow">You in this crew</span>
        <Icon name="back" size={18} class="chev" />
      </summary>
      <div class="cal-body stack" style={{ '--stack': 'var(--s-3)' }}>
        <div class="row you-face">
          <Avatar member={me} size="xl" />
          <p class="small">{me.faceUrl ? 'Your crew sees your photo. Nobody else does, and it never goes on a WhatsApp preview.' : 'This sloth is you. Add your face if you like: only your crew sees it.'}</p>
        </div>
        <input ref={cam} type="file" accept="image/*" capture="user" hidden onChange={picked} />
        <input ref={roll} type="file" accept="image/*" hidden onChange={picked} />
        <div class="row you-actions">
          <button class="btn secondary" disabled={busy} onClick={() => cam.current?.click()}><Icon name="camera" size={20} /> {busy ? <Dots /> : 'Add your face'}</button>
          <button class="btn ghost" disabled={busy} onClick={() => roll.current?.click()}>Pick a photo</button>
        </div>
        {me.faceUrl && <button class="link-btn small" disabled={busy} onClick={remove}>Remove my photo</button>}
        {discreet && (
          <label class="row optin">
            <input type="checkbox" checked={optIn} onChange={toggleOptIn} />
            <span class="small">After a linkup, offer a card for my Status. It never shows the crew's name.</span>
          </label>
        )}
      </div>
    </details>
  );
}
