// A tiny history router. No dependency: the whole app has six routes.
import { useEffect, useState } from 'preact/hooks';

const listeners = new Set();

export function navigate(to, { replace = false } = {}) {
  if (to === location.pathname + location.search) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', to);
  listeners.forEach((fn) => fn());
  window.scrollTo(0, 0);
}

export function back(fallback = '/') {
  if (history.state && history.state.depth > 0) history.back();
  else if (document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1) history.back();
  else navigate(fallback, { replace: true });
}

export function useLocation() {
  const [, force] = useState(0);
  useEffect(() => {
    const on = () => force((n) => n + 1);
    listeners.add(on);
    window.addEventListener('popstate', on);
    return () => { listeners.delete(on); window.removeEventListener('popstate', on); };
  }, []);
  return { path: location.pathname, query: new URLSearchParams(location.search) };
}

// Match "/c/:slug/p/:id" style patterns. Returns params or null.
export function match(pattern, path) {
  const a = pattern.split('/').filter(Boolean);
  const b = path.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

// Intercept same-origin link clicks so <a href> works without a page load.
export function installLinkInterceptor() {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target || a.hasAttribute('download') || a.dataset.external != null) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname.startsWith('/api') || url.pathname.startsWith('/cal')) return;
    e.preventDefault();
    navigate(url.pathname + url.search);
  });
}
