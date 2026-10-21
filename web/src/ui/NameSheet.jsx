// The only question a friend is asked: a name, at the moment it is used (the first
// "I'm going", or "Join the crew"). A sheet over the page, so the friend never leaves the
// plan they tapped, and their face swings onto the branch on the same screen.
import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../lib/api.js';
import { myCrews } from '../lib/store.js';
import { firstName } from '../lib/format.js';
import { Dots } from './misc.jsx';

// A name this phone already used in another crew saves typing it again.
function knownName() {
  const c = myCrews().find((x) => x.memberName);
  return c ? c.memberName : '';
}

export function NameSheet({ slug, crewName, action = 'Join the crew', onClose, onJoined }) {
  const [name, setName] = useState(knownName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [closing, setClosing] = useState(false);
  const input = useRef(null);
  const sheet = useRef(null);

  function close() {
    if (busy) return;
    setClosing(true);
    setTimeout(onClose, 200);
  }

  useEffect(() => {
    const prev = document.activeElement;
    input.current && input.current.focus();
    const key = (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Tab' && sheet.current) {
        const f = [...sheet.current.querySelectorAll('input, button:not([disabled])')];
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', key);
    document.documentElement.classList.add('sheet-open');
    return () => {
      document.removeEventListener('keydown', key);
      document.documentElement.classList.remove('sheet-open');
      prev && prev.focus && prev.focus();
    };
  }, []);

  async function submit(e) {
    e.preventDefault();
    const n = name.trim();
    if (!n) { setError("Add your name so the crew knows it's you."); input.current && input.current.focus(); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await api.joinAs(slug, n, crewName);
      onJoined(res, firstName(res.member.name));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div class={`sheet-wrap${closing ? ' closing' : ''}`}>
      <div class="sheet-scrim" onClick={close} aria-hidden="true" />
      <form class="sheet" ref={sheet} role="dialog" aria-modal="true" aria-labelledby="sheet-title" onSubmit={submit}>
        <span class="sheet-grip" aria-hidden="true" />
        <h2 id="sheet-title" class="display display-md">What should the crew call you?</h2>
        <label class="sr-only" for="sheet-name">Your name</label>
        <input
          id="sheet-name"
          ref={input}
          class="input"
          value={name}
          onInput={(e) => setName(e.currentTarget.value)}
          autocomplete="given-name"
          autocapitalize="words"
          enterkeyhint="go"
          maxLength={40}
          placeholder="Your name"
        />
        {error && <p class="error-text" role="alert">{error}</p>}
        <button class="btn primary block big" type="submit" disabled={busy}>
          {busy ? <>Joining <Dots /></> : action}
        </button>
        <p class="fine">No sign-up. This phone remembers you.</p>
      </form>
    </div>
  );
}
