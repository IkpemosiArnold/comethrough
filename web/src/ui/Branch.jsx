// The branch: who's going hangs from it, sloth style. The branch sags a little more with
// every person who comes. When you tap "I'm going", your face swings onto the branch
// and the whole branch dips under the new weight, then settles.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Avatar } from './Avatar.jsx';
import { firstName } from '../lib/format.js';
import { springAnimate, prefersReducedMotion } from '../lib/spring.js';

const SLOT = 58;      // px between hangers
const MAX_SHOWN = 7;

export function Branch({ going, meId, swingId, onSwung }) {
  const wrap = useRef(null);
  const positions = useRef(new Map());
  const [width, setWidth] = useState(358);

  // You first, then the order people said yes
  const ordered = [...going].sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : 0));
  const shown = ordered.slice(0, MAX_SHOWN - (ordered.length > MAX_SHOWN ? 1 : 0));
  const rest = ordered.length - shown.length;
  const count = shown.length + (rest > 0 ? 1 : 0);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth || 358);
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro && ro.observe(el);
    return () => ro && ro.disconnect();
  }, []);

  // The sag grows with weight, up to a limit
  const sag = 6 + Math.min(going.length, 8) * 1.6;
  const top = 14;
  const branchY = (x) => {
    const t = Math.min(Math.max(x / width, 0), 1);
    return top + sag * 4 * t * (1 - t);
  };
  const start = Math.max(SLOT / 2 + 6, (width - (count - 1) * SLOT) / 2);
  const xAt = (i) => start + i * SLOT;

  // FLIP: anyone who moved along the branch slides to their new spot.
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const reduce = prefersReducedMotion();
    const next = new Map();
    el.querySelectorAll('[data-hanger]').forEach((node) => {
      const id = node.dataset.hanger;
      const x = parseFloat(node.dataset.x);
      next.set(id, x);
      const prev = positions.current.get(id);
      if (prev != null && prev !== x && !reduce && id !== swingId) {
        node.animate([{ transform: `translateX(${prev - x}px)` }, { transform: 'translateX(0)' }], {
          duration: 320,
          easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
        });
      }
    });
    positions.current = next;
  });

  // The swing, on the hanger that just joined
  useLayoutEffect(() => {
    if (!swingId || !wrap.current) return;
    const node = wrap.current.querySelector(`[data-hanger="${swingId}"] .hanger-swing`);
    const branch = wrap.current.querySelector('.branch-sway');
    if (!node) return;
    if (prefersReducedMotion()) {
      node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease' });
      onSwung && onSwung();
      return;
    }
    // A lazy pendulum: low damping, slow response. Long on purpose; it happens once per plan.
    const a = springAnimate(
      node,
      [
        { transform: 'translateY(-26px) rotate(-34deg)', opacity: 0 },
        { transform: 'translateY(0) rotate(0deg)', opacity: 1 },
      ],
      { damping: 0.4, response: 0.9 },
    );
    node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' });
    // The branch takes the weight: a quick dip as the hands catch, then a springy settle.
    if (branch) {
      const dip = branch.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(6px)' }], {
        duration: 120, delay: 70, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'forwards',
      });
      dip.onfinish = () => {
        springAnimate(branch, [{ transform: 'translateY(6px)' }, { transform: 'translateY(0)' }], { damping: 0.4, response: 0.65 });
        dip.cancel();
      };
    }
    a && (a.onfinish = () => onSwung && onSwung());
  }, [swingId]);

  const d = `M -10 ${top} Q ${width / 2} ${top + sag * 2} ${width + 10} ${top}`;

  return (
    <div class="branch" ref={wrap}>
      <div class="branch-sway">
        <svg class="branch-line" width={width} height="60" viewBox={`0 0 ${width} 60`} aria-hidden="true">
          <path d={d} />
          <path class="leaf" d={`M ${width * 0.84} ${branchY(width * 0.84) - 2} c 6 -11 17 -13 23 -9 c -6 7 -15 11 -23 9z`} />
          <path class="leaf" d={`M ${width * 0.1} ${branchY(width * 0.1) - 1} c -3 -10 -12 -13 -18 -10 c 3 7 10 11 18 10z`} />
        </svg>
        <ul class="hangers">
          {shown.map((m, i) => {
            const x = xAt(i);
            const isMe = m.id === meId;
            return (
              <li key={m.id} data-hanger={m.id} data-x={x} class="hanger" style={{ left: `${x}px`, top: `${branchY(x)}px` }}>
                <div class="hanger-swing" style={swingId === m.id ? { opacity: 0 } : undefined}>
                  <span class="arms" aria-hidden="true" />
                  <Avatar member={m} size="lg" ring={isMe ? 'var(--danfo)' : undefined} />
                  <span class={`hanger-name${isMe ? ' me' : ''}`} title={m.name}>{isMe ? 'You' : firstName(m.name)}</span>
                </div>
              </li>
            );
          })}
          {rest > 0 && (
            <li class="hanger" data-hanger="__more" data-x={xAt(shown.length)} style={{ left: `${xAt(shown.length)}px`, top: `${branchY(xAt(shown.length))}px` }}>
              <div class="hanger-swing">
                <span class="arms" aria-hidden="true" />
                <span class="avatar lg more-bubble">+{rest}</span>
                <span class="hanger-name">more</span>
              </div>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
