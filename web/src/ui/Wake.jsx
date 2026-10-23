// The sloth is waking up. The pages open at once from the static site; when the API behind
// them is still asleep (Render's free plan naps after 15 quiet minutes), this card says so,
// with the seconds counting, until the server answers. If it never does (about 90 s), it says
// that plainly and offers a retry. Few words: the sloth asleep says most of it.
import { useEffect, useRef, useState } from 'preact/hooks';
import { waker } from '../lib/wake.js';
import { Sloth } from './Sloth.jsx';

const clock = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

export function WakeCard() {
  const w = waker();
  const [s, setS] = useState(w.state);
  const [woke, setWoke] = useState(false);
  const [, tick] = useState(0);

  const last = useRef(w.state.phase);
  useEffect(() => {
    const on = (next) => {
      // a short "awake" once it was shown waking, then the card goes
      if (next.phase === 'up' && (last.current === 'waking' || last.current === 'down')) setWoke(true);
      last.current = next.phase;
      setS(next);
    };
    const off = w.subscribe(on);
    // the phase may have moved between the first render and this effect
    if (w.state !== s) on(w.state);
    return off;
  }, []);
  useEffect(() => {
    if (!woke) return;
    const id = setTimeout(() => setWoke(false), 1400);
    return () => clearTimeout(id);
  }, [woke]);
  useEffect(() => {
    if (s.phase !== 'waking') return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [s.phase]);

  const phase = woke && s.phase === 'up' ? 'woke' : s.phase;
  if (phase !== 'waking' && phase !== 'down' && phase !== 'woke') return null;
  const sec = Math.max(0, Math.floor((Date.now() - s.since) / 1000));

  return (
    <div class={`wake-card wake-${phase}`} role="status" aria-live="polite">
      <Sloth size={44} mood={phase === 'woke' ? 'awake' : 'sleepy'} zzz={phase === 'waking'} />
      {phase === 'waking' && (
        <div class="wake-text">
          <p class="wake-title">The sloth is waking up</p>
          <p class="wake-sub"><span class="wake-clock" aria-hidden="true">{clock(sec)}</span> It naps when the crew is quiet.</p>
        </div>
      )}
      {phase === 'woke' && (
        <div class="wake-text">
          <p class="wake-title">Awake</p>
        </div>
      )}
      {phase === 'down' && (
        <>
          <div class="wake-text">
            <p class="wake-title">Still asleep</p>
            <p class="wake-sub">The server didn't wake. Try again in a minute.</p>
          </div>
          <button class="btn ghost small-btn wake-retry" onClick={() => w.retry()}>Try again</button>
        </>
      )}
    </div>
  );
}
