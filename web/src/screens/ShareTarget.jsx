// The Android share sheet lands here. The service worker has already stashed the shared
// text, link and image; we pick a crew (if there's more than one) and open Add a plan.
import { useEffect, useState } from 'preact/hooks';
import { myCrews, sessionSet } from '../lib/store.js';
import { navigate } from '../lib/router.js';
import { Sloth } from '../ui/Sloth.jsx';
import { Icon } from '../ui/icons.jsx';

export function ShareTarget({ query }) {
  const crews = myCrews().filter((c) => c.memberId);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      let shared = { title: query.get('title'), text: query.get('text'), url: query.get('url'), image: false };
      if (query.get('received')) {
        try {
          const cache = await caches.open('ct-share');
          const meta = await cache.match('/share/meta');
          if (meta) shared = { ...shared, ...(await meta.json()) };
        } catch { /* nothing stashed */ }
      }
      sessionSet('ct.shared', JSON.stringify(shared));
      if (crews.length === 1) navigate(`/c/${crews[0].slug}/add?shared=1`, { replace: true });
      else setReady(true);
    })();
  }, []);

  if (!ready) return <div class="column" />;
  if (!crews.length) {
    return (
      <div class="column screen-enter empty-page">
        <Sloth size={100} />
        <h1 class="display display-lg">Join a crew first</h1>
        <p class="muted">Open your crew's link from the group chat, join, then share the flyer again.</p>
        <a class="btn primary" href="/">Start a crew instead</a>
      </div>
    );
  }
  return (
    <div class="column screen-enter">
      <h1 class="display display-lg" style={{ marginTop: '24px' }}>Which crew is this for?</h1>
      <ul class="pick-crew">
        {crews.map((c) => (
          <li key={c.slug}>
            <button class="crew-link" onClick={() => navigate(`/c/${c.slug}/add?shared=1`, { replace: true })}>
              <span class="crew-link-name">{c.name || c.slug}</span>
              <Icon name="back" size={18} class="chev" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
