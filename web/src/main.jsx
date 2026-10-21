import { render } from 'preact';
import './styles/tokens.css';
import './styles/base.css';
import './styles/screens.css';
import { App } from './app.jsx';
import { installLinkInterceptor } from './lib/router.js';
import { MOCK } from './lib/api.js';
import { getCrew } from './lib/store.js';

const q = new URLSearchParams(location.search);
if (q.has('fast')) window.__CT_FAST = true;
if (q.get('theme') === 'dark' || q.get('theme') === 'light') document.documentElement.dataset.theme = q.get('theme');

// While the on-screen keyboard is up, a fixed bottom bar would sit on top of the field being
// typed in. Mark the document so CSS can put the bar back into the page flow until typing stops.
function watchKeyboard() {
  let coarse = false;
  try { coarse = matchMedia('(pointer: coarse)').matches; } catch { /* ignore */ }
  if (!coarse) return;
  const isField = (el) => el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|file)$/.test(el.type)));
  document.addEventListener('focusin', (e) => { if (isField(e.target)) document.documentElement.setAttribute('data-kb', ''); });
  document.addEventListener('focusout', () => {
    setTimeout(() => { if (!isField(document.activeElement)) document.documentElement.removeAttribute('data-kb'); }, 60);
  });
}

async function boot() {
  // Demo mode: open a crew link and you're already a member, unless ?guest=1
  if (MOCK) {
    const m = location.pathname.match(/^\/c\/([^/]+)/);
    if (q.has('data')) {
      // Dev-only datasets for break-ui: demo, worst, empty
      const { sessionSet } = await import('./lib/store.js');
      sessionSet('ct.data', q.get('data'));
      (await import('./lib/mock.js'))._reset();
    }
    if (q.has('reset')) (await import('./lib/mock.js'))._reset();
    if (m && !q.has('guest') && (!getCrew(m[1])?.memberId || q.has('data'))) (await import('./lib/mock.js'))._seedMember(m[1]);
  }
  installLinkInterceptor();
  watchKeyboard();
  render(<App />, document.getElementById('app'));
}
boot();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
