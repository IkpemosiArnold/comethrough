// The sloth. Used sparingly: the start screen, the ritual panel, empty states, and while Gemma reads.
// mood: "sleepy" (default), "awake", "reading" (one eye open)
// It is a little alive: an awake sloth blinks now and then, a reading sloth's eye follows the
// lines, and `zzz` shows it asleep. With `poke`, a tap pushes it on its branch; five quick
// taps and it dozes off, and the next tap wakes it. All of it stops with reduced motion.
import { useRef, useState } from 'preact/hooks';
import { springAnimate, prefersReducedMotion } from '../lib/spring.js';

export function Sloth({ size = 120, mood = 'sleepy', branch = true, class: cls = '', title, poke = false, zzz = false }) {
  const [dozing, setDozing] = useState(false);
  const body = useRef(null);
  const taps = useRef({ n: 0, at: 0, anim: null });
  const shown = dozing ? 'sleepy' : mood;
  const eye = (cx, flip) => {
    if (shown === 'awake' || (shown === 'reading' && !flip)) {
      return <circle class={shown === 'reading' ? 'sloth-pupil' : undefined} cx={cx} cy="73" r="2.6" fill="#f3e6cf" />;
    }
    return <path d={`M${cx - 3.6} 72.5 q3.6 3 7.2 0`} stroke="#f3e6cf" stroke-width="1.8" fill="none" stroke-linecap="round" />;
  };

  // A push on the branch: the body is displaced on the very first frame, then swings back.
  function push(keyframes, spring) {
    const t = taps.current;
    if (prefersReducedMotion() || !body.current) return;
    t.anim && t.anim.cancel();
    t.anim = springAnimate(body.current, keyframes, spring, { fill: 'none' });
  }
  function onPoke() {
    const t = taps.current;
    const now = Date.now();
    if (now - t.at > 1500) t.n = 0;
    t.at = now;
    if (dozing) {
      t.n = 0;
      setDozing(false);
      push([{ transform: 'translateY(-6px)' }, { transform: 'translateY(0)' }], { damping: 0.5, response: 0.45 });
      return;
    }
    t.n += 1;
    if (t.n >= 5) { t.n = 0; setDozing(true); }
    push([{ transform: `rotate(${t.n % 2 ? 8 : -8}deg)` }, { transform: 'rotate(0deg)' }], { damping: 0.35, response: 0.6 });
  }

  return (
    <svg
      class={`sloth mood-${shown}${poke ? ' sloth-poke' : ''} ${cls}`}
      width={size}
      height={size * (140 / 120)}
      viewBox="0 0 120 140"
      overflow="visible"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : 'true'}
      onPointerDown={poke ? onPoke : undefined}
    >
      {branch && (
        <g class="sloth-branch">
          <path d="M-4 22 C 30 14, 70 30, 124 18" stroke="#5a4129" stroke-width="7" fill="none" stroke-linecap="round" />
          <path d="M96 20 c 6 -10 16 -12 22 -8 c -6 6 -14 10 -22 8z" fill="#3f8a5c" />
          <path d="M14 18 c -4 -9 -13 -12 -19 -9 c 4 7 11 10 19 9z" fill="#4f9b69" />
        </g>
      )}
      <g class="sloth-body" ref={body}>
        {/* arms up to the branch */}
        <path d="M40 74 C 34 52, 36 34, 42 22" stroke="#7a5b3e" stroke-width="11" fill="none" stroke-linecap="round" />
        <path d="M80 74 C 86 52, 84 34, 78 21" stroke="#7a5b3e" stroke-width="11" fill="none" stroke-linecap="round" />
        <path d="M38 22 q4 -6 9 -1 M76 21 q4 -6 9 -1" stroke="#3a2a1e" stroke-width="2.2" fill="none" stroke-linecap="round" />
        {/* body and head */}
        <ellipse cx="60" cy="100" rx="30" ry="32" fill="#7a5b3e" />
        <ellipse cx="60" cy="106" rx="18" ry="20" fill="#8e6c4b" />
        <circle cx="60" cy="72" r="25" fill="#8e6c4b" />
        <ellipse cx="60" cy="75" rx="20" ry="15.5" fill="#ead6b4" />
        {/* the sloth's dark eye patches, droopy */}
        <ellipse cx="50" cy="74" rx="7.5" ry="4.6" fill="#4a3626" transform="rotate(16 50 74)" />
        <ellipse cx="70" cy="74" rx="7.5" ry="4.6" fill="#4a3626" transform="rotate(-16 70 74)" />
        <g class="sloth-eyes">
          {eye(50, false)}
          {eye(70, true)}
        </g>
        <ellipse cx="60" cy="81" rx="3.6" ry="2.6" fill="#3a2a1e" />
        <path d="M55 85.5 q5 3.6 10 0" stroke="#3a2a1e" stroke-width="1.8" fill="none" stroke-linecap="round" />
        {/* legs hanging */}
        <path d="M46 126 q-2 8 2 10 M74 126 q2 8 -2 10" stroke="#6b4f36" stroke-width="9" fill="none" stroke-linecap="round" />
      </g>
      {(zzz || dozing) && (
        <g class="sloth-zzz">
          <text x="90" y="60" font-size="11">z</text>
          <text x="98" y="49" font-size="14">z</text>
          <text x="107" y="36" font-size="17">z</text>
        </g>
      )}
    </svg>
  );
}
