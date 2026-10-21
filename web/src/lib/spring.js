// Turns a spring (damping ratio + response, Apple's two numbers) into a CSS linear() easing
// so the browser runs it off the main thread through WAAPI. Falls back to a strong ease-out.

const cache = new Map();

export function spring({ damping = 1, response = 0.4 } = {}) {
  const key = damping + ':' + response;
  if (cache.has(key)) return cache.get(key);
  const w0 = (2 * Math.PI) / response;
  const z = damping;
  const wd = w0 * Math.sqrt(Math.max(1 - z * z, 0));
  const x = (t) => {
    if (z < 1) return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t));
    return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  };
  // Find the settle time: when the value stays within 0.1% of the target.
  let duration = 0;
  for (let t = 0; t < 5; t += 1 / 120) {
    if (Math.abs(1 - x(t)) > 0.001) duration = t;
  }
  duration = Math.max(duration, 0.1);
  const steps = 48;
  const pts = [];
  for (let i = 0; i <= steps; i++) pts.push(+x((duration * i) / steps).toFixed(4));
  pts[steps] = 1;
  const out = { easing: `linear(${pts.join(', ')})`, duration: Math.round(duration * 1000) };
  cache.set(key, out);
  return out;
}

let linearOK;
export function supportsLinear() {
  if (linearOK === undefined) {
    try { linearOK = CSS.supports('animation-timing-function', 'linear(0, 1)'); } catch { linearOK = false; }
  }
  return linearOK;
}

export function prefersReducedMotion() {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

// Animate with a spring when supported; otherwise a 400ms strong ease-out.
export function springAnimate(el, keyframes, opts = {}, extra = {}) {
  if (!el || !el.animate) return null;
  const s = spring(opts);
  return el.animate(keyframes, {
    duration: supportsLinear() ? s.duration : 420,
    easing: supportsLinear() ? s.easing : 'cubic-bezier(0.23, 1, 0.32, 1)',
    fill: 'both',
    ...extra,
  });
}

export function haptic(ms = 10) {
  try { navigator.vibrate && navigator.vibrate(ms); } catch { /* not supported */ }
}
