// "Where's your crew?": one question in the setup, asked when the sloth could not put the
// crew's areas on the map (the draft's `needsLocation`). Nothing is guessed: every answer is
// a tap on a place the map knows (a suggestion, a type-ahead pick, the rough location) or
// the city, which reads the sentence again there. Skipping is always fine: the crew can
// still be made, and the sloth just picks nothing until an area is on the map.
import { useState } from 'preact/hooks';
import { api } from '../lib/api.js';
import { AreaInput } from './AreaInput.jsx';
import { roughPosition } from './AreaAsk.jsx';
import { Sloth } from './Sloth.jsx';
import { Icon } from './icons.jsx';
import { Dots } from './misc.jsx';

const quoteList = (xs) => xs.map((x) => `"${x}"`).join(xs.length > 2 ? ', ' : ' or ').replace(/, ([^,]*)$/, ' or $1');
const orList = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);

// Two places with the same name read by their district: "Lekki (Eti-Osa)".
function named(options) {
  return options.map((o) => {
    const twin = options.some((x) => x !== o && x.label === o.label);
    const where = String(o.detail || '').split(',')[0].trim();
    return twin && where ? `${o.label} (${where})` : o.label;
  });
}

const pinned = (a) => a && Number.isFinite(a.lat) && Number.isFinite(a.lon);

/**
 * A typed area that has to land on the map. A pick from the type-ahead is used as it is;
 * text typed without a pick is looked up once, and what the map has is offered to tap.
 */
export function AreaFind({ onFound, label = 'Type an area', button = 'Add' }) {
  const [typed, setTyped] = useState(null);
  const [key, setKey] = useState(0);
  const [options, setOptions] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function found(a) {
    setTyped(null);
    setOptions(null);
    setError(null);
    setKey(key + 1);
    onFound({ label: a.label, lat: a.lat, lon: a.lon });
  }
  async function add() {
    const text = typed?.label?.trim();
    if (!text) return;
    if (pinned(typed)) { found(typed); return; }
    setBusy(true);
    setError(null);
    try {
      const rs = (await api.geocode(text)).filter(pinned).slice(0, 3);
      if (rs.length) setOptions(rs);
      else setError(`The sloth couldn't find "${text}" on the map either. Try a bigger area nearby, or use your rough location.`);
    } catch {
      setError("Couldn't reach the map just now. Try again in a moment.");
    }
    setBusy(false);
  }

  return (
    <div class="area-find">
      <div class="add-area row">
        <div class="grow">
          <AreaInput key={key} value={typed} label={label} onChange={(a) => { setOptions(null); setError(null); pinned(a) ? found(a) : setTyped(a); }} onEnter={add} />
        </div>
        <button type="button" class="btn secondary" onClick={add} disabled={busy || !typed?.label?.trim()}>
          {busy ? <Dots /> : button}
        </button>
      </div>
      {options && (
        <div class="where-choices" role="group" aria-label="Places on the map">
          <p class="small muted">Did you mean one of these?</p>
          {options.map((o, i) => <Choice key={o.label + i} option={o} onPick={found} />)}
        </div>
      )}
      {error && <p class="error-text" role="alert">{error}</p>}
    </div>
  );
}

function Choice({ option, name, onPick, disabled }) {
  return (
    <button type="button" class="where-choice" onClick={() => onPick(option)} disabled={disabled}>
      <Icon name="pin" size={20} />
      <span class="where-choice-text">
        <span class="where-choice-label">{name || option.label}</span>
        {option.detail && <span class="where-choice-detail">{option.detail}</span>}
      </span>
    </button>
  );
}

/**
 * The question. `ask` is { blocking: true, labels, suggestions, cities } for the whole crew
 * ("Where's your crew?"), or { label, options } for one area with more than one match
 * ("Did you mean Lekki Phase 1 or Ibeju-Lekki?").
 */
export function WhereAsk({ ask, step, steps, city, rereading, onBack, onAnswer, onAdd, onCity, onSkip }) {
  const [busy, setBusy] = useState(null); // 'locating'
  const [error, setError] = useState(null);
  const [neither, setNeither] = useState(false);
  const blocking = !!ask.blocking;

  async function locate() {
    setBusy('locating');
    setError(null);
    try {
      const area = await api.roughArea(await roughPosition());
      if (!pinned(area)) throw new Error('none');
      onAdd(area);
    } catch (e) {
      setBusy(null);
      setError(e && e.code === 1 ? 'Location is off for this site. Type an area instead.' : "Couldn't name your area just now. Type it instead.");
    }
  }

  const suggestions = blocking
    ? ask.labels.flatMap((l) => (ask.suggestions?.[l] || []).filter(pinned).map((o) => ({ ...o, for: l }))).slice(0, 4)
    : ask.options;
  const names = named(suggestions);

  return (
    <div class="column screen-enter where">
      <header class="pv-top">
        <button class="icon-btn" onClick={onBack} aria-label="Back to the sentence"><Icon name="back" /></button>
        <p class="pv-kicker">{steps > 1 ? `One more thing, ${step + 1} of ${steps}` : 'One thing first'}</p>
      </header>

      <div class="where-sloth" aria-hidden="true"><Sloth size={64} mood="reading" /></div>

      {blocking ? (
        <>
          <h1 class="display display-lg painted where-title">Where's your crew?</h1>
          <p class="lede">
            {ask.labels.length
              ? `The sloth couldn't find ${quoteList(ask.labels)} on the map${city ? ` in ${city}` : ''}.`
              : "The sloth couldn't tell where the crew is from your sentence."}
          </p>
          <p class="muted where-why">It won't pick a spot or suggest anything until it knows roughly where you are.</p>
        </>
      ) : (
        <>
          <h1 class="display display-lg painted where-title">Which {ask.label}?</h1>
          <p class="lede">
            {suggestions.length > 1
              ? `The sloth found more than one "${ask.label}" on the map. Did you mean ${orList(names)}?`
              : `You wrote "${ask.label}". Did you mean ${names[0]}?`}
          </p>
        </>
      )}

      {suggestions.length > 0 && (
        <div class="where-choices" role="group" aria-label={blocking ? 'Places the map has' : `Places called ${ask.label}`}>
          {blocking && <p class="section-label">Did you mean</p>}
          {suggestions.map((o, i) => (
            <Choice key={o.label + i} option={o} name={names[i]} disabled={!!busy || rereading} onPick={(a) => onAnswer(blocking ? a.for : ask.label, a)} />
          ))}
        </div>
      )}

      {blocking ? (
        <div class="where-other stack" style={{ '--stack': 'var(--s-3)' }}>
          <button type="button" class="btn secondary block" onClick={locate} disabled={!!busy || rereading}>
            <Icon name="pin" size={20} /> {busy === 'locating' ? <>Finding your area <Dots /></> : 'Use my rough location'}
          </button>
          <AreaFind label="Or type an area" onFound={onAdd} />
          {ask.cities?.length > 0 && (
            <div class="where-cities">
              <p class="small muted">Or just pick the city, and the sloth looks again there.</p>
              <div class="row wrap seg">
                {ask.cities.map((c) => (
                  <button type="button" key={c} class="chip" aria-pressed={city === c} disabled={rereading} onClick={() => onCity(c)}>
                    {rereading === c ? <>{c} <Dots /></> : c}
                  </button>
                ))}
              </div>
            </div>
          )}
          {error && <p class="error-text" role="alert">{error}</p>}
          <p class="fine">Your phone rounds the location to about a kilometre first, and only the area's name is kept.</p>
        </div>
      ) : neither ? (
        <div class="where-other">
          <AreaFind label={`Type where ${ask.label} is`} button="Use it" onFound={(a) => onAnswer(ask.label, a)} />
        </div>
      ) : (
        <button type="button" class="link-btn where-neither" onClick={() => setNeither(true)}>Neither of these</button>
      )}

      <div class="where-skip">
        <button type="button" class="link-btn" onClick={onSkip} disabled={rereading}>{blocking ? 'Skip for now' : `Leave ${ask.label} off the map`}</button>
        <p class="fine">{blocking ? "You can still make the crew. The sloth just won't pick spots until an area is on the map." : 'Rides and fair picks will leave it out.'}</p>
      </div>
    </div>
  );
}
