// "Where are you coming from?", asked in the rides section of a plan you're going to, the
// first time a ride needs it. One tap uses a rough location: this phone rounds its position to
// two decimals (about a kilometre) before sending it, and the server keeps only the
// neighbourhood. Typing the area works too, for anyone who says no to location.
import { useState } from 'preact/hooks';
import { api } from '../lib/api.js';
import { AreaInput } from './AreaInput.jsx';
import { Icon } from './icons.jsx';
import { Dots } from './misc.jsx';

const round = (x) => Math.round(x * 100) / 100;

function roughPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) { reject(new Error('unsupported')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: round(p.coords.latitude), lon: round(p.coords.longitude) }),
      (e) => reject(e),
      { enableHighAccuracy: false, maximumAge: 600000, timeout: 12000 },
    );
  });
}

export function AreaAsk({ slug, onSet }) {
  const [busy, setBusy] = useState(null); // 'locating' | 'saving'
  const [typed, setTyped] = useState(null);
  const [error, setError] = useState(null);

  async function save(body) {
    setBusy('saving');
    setError(null);
    try {
      const r = await api.setArea(slug, body);
      onSet(r?.you?.area?.label || body.area?.label || body.area || '');
    } catch (e) {
      setError(e.message || "Couldn't save that. Try again.");
      setBusy(null);
    }
  }

  async function locate() {
    setBusy('locating');
    setError(null);
    try {
      const near = await roughPosition();
      await save({ near });
    } catch (e) {
      setBusy(null);
      setError(e && e.code === 1 ? 'Location is off for this site. Type your area instead.' : "Couldn't find you just now. Type your area instead.");
    }
  }

  return (
    <div class="area-ask" role="group" aria-labelledby="area-ask-title">
      <h3 id="area-ask-title" class="area-ask-title">Where are you coming from?</h3>
      <p class="small muted">Just the area, so you get a time to leave and people to ride with.</p>
      <button type="button" class="btn secondary block" onClick={locate} disabled={!!busy}>
        <Icon name="pin" size={20} /> {busy === 'locating' ? <>Finding your area <Dots /></> : 'Use my rough location'}
      </button>
      <div class="row add-area">
        <div class="grow">
          <AreaInput value={typed} onChange={(a) => (a.lat != null ? save({ area: a }) : setTyped(a))} onEnter={() => typed?.label && save({ area: typed.label })} label="Or type your area" />
        </div>
        <button type="button" class="btn secondary" onClick={() => save({ area: typed.label })} disabled={!typed?.label?.trim() || !!busy}>
          {busy === 'saving' ? <Dots /> : 'Save'}
        </button>
      </div>
      {error && <p class="error-text" role="alert">{error}</p>}
      <p class="fine">Your phone rounds the location to about a kilometre first, and only the area's name is kept.</p>
    </div>
  );
}
