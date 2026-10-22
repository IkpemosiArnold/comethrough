// The branch: who's going hangs from it, sloth style. The branch sags a little more with
// every person who comes. When you tap "I'm going", your face swings onto the branch
// and the whole branch dips under the new weight, then settles.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Avatar } from './Avatar.jsx';
import { firstName } from '../lib/format.js';
import { springAnimate, prefersReducedMotion } from '../lib/spring.js';

const SLOT = 58;      // px between hangers
const EDGE = 36;      // px from the screen edge to the first and last hanger

export function Branch({ going, meId, swingId, onSwung }) {
  const wrap = useRef(null);
  const positions = useRef(new Map());
  const [width, setWidth] = useState(358);

  // You first, then the order people said yes. As many hangers as fit the branch.
  const ordered = [...going].sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : 0));
  const fit = Math.max(3, Math.floor((width - 2 * EDGE) / SLOT) + 1);
  const shown = ordered.slice(0, ordered.length > fit ? fit - 1 : fit);
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
  const start = Math.max(EDGE, (width - (count - 1) * SLOT) / 2);
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
    // The catch shakes a leaf loose; it drifts down behind the faces.
    const li = node.closest('[data-hanger]');
    const lx = parseFloat(li.dataset.x) + 14;
    dropLeaf(wrap.current, lx, branchY(lx) - 8);
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

// A leaf falls the way leaves do: side to side, slowing at each turn, and fades near the
// ground. Made and removed here, so the branch keeps no state for it.
function dropLeaf(host, x, y) {
  if (!host || !host.animate) return;
  const leaf = document.createElement('span');
  leaf.className = 'leaf-fall';
  leaf.setAttribute('aria-hidden', 'true');
  leaf.style.left = `${x}px`;
  leaf.style.top = `${y}px`;
  leaf.innerHTML = '<svg viewBox="0 0 22 14" width="22" height="14"><path d="M1 12c5-11 15-13 20-10-5 6-13 10-20 10z" fill="#3f8a5c"/></svg>';
  host.insertBefore(leaf, host.firstChild);
  const sway = 'cubic-bezier(0.45, 0, 0.55, 1)';
  const a = leaf.animate([
    { transform: 'translate(0, 0) rotate(-12deg)', opacity: 1, easing: sway },
    { transform: 'translate(18px, 26px) rotate(38deg)', offset: 0.3, easing: sway },
    { transform: 'translate(-6px, 54px) rotate(-24deg)', offset: 0.6, easing: sway },
    { transform: 'translate(12px, 82px) rotate(28deg)', opacity: 1, offset: 0.85, easing: sway },
    { transform: 'translate(6px, 98px) rotate(12deg)', opacity: 0 },
  ], { duration: 1800, delay: 170, fill: 'backwards' });
  a.onfinish = a.oncancel = () => leaf.remove();
}
