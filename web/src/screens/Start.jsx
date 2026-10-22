// Start a crew: one sentence (or a voice note), then the crew as friends will see it, with
// each thing Gemma read as a row to tap and fix, then the invite with the sloth's first pick.
// When the areas are not on the map, one question comes first ("Where's your crew?").
import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api.js';
import { myCrews, saveCrew } from '../lib/store.js';
import { useSpeech } from '../lib/speech.js';
import { copyText } from '../lib/platform.js';
import { DAYS, rhythmText, clock, nameList, dayLabel, timeRange } from '../lib/format.js';
import { exampleSentence, setPlace, packUi } from '../lib/place.js';
import { whatsappUrl } from '../lib/share.js';
import { crewInvite } from './CrewHome.jsx';
import { Sloth } from '../ui/Sloth.jsx';
import { Icon, WhatsAppIcon } from '../ui/icons.jsx';
import { MicButton } from '../ui/MicButton.jsx';
import { WhereAsk, AreaFind } from '../ui/WhereAsk.jsx';
import { Dots } from '../ui/misc.jsx';
import { weatherIcon, weatherWords } from '../ui/Weather.jsx';
import { toast } from '../ui/toast.jsx';
import { AiNote, markAiNoted } from '../ui/AiNote.jsx';

// A Lagos example on a phone set to Lagos time; a nearby city's elsewhere (src/lib/place.js)
const EXAMPLE = exampleSentence();
const UNSURE = 0.6;
const top = () => window.scrollTo(0, 0);
// "Saturday", or "tomorrow" in the middle of a sentence
const dayWord = (d) => { const w = dayLabel(d); return /^(Today|Tonight|Tomorrow)$/.test(w) ? w.toLowerCase() : w; };
const pinned = (a) => a && Number.isFinite(a.lat) && Number.isFinite(a.lon);

// The questions a draft's needsLocation asks, one at a time: "Where's your crew?" when no area
// is on the map, else "Which Lekki?" for each area the map has more than one of.
function asksFor(d) {
  const n = d.needsLocation;
  if (!n) return [];
  const labels = (n.unresolved || []).filter((l) => d.areas.some((a) => a.label === l && !pinned(a)));
  if (n.blocking && !d.areas.some(pinned)) return [{ blocking: true, labels, suggestions: n.suggestions || {}, cities: n.cities || [] }];
  return labels.map((l) => ({ label: l, options: (n.suggestions?.[l] || []).filter(pinned).slice(0, 3) })).filter((q) => q.options.length);
}

// An answer to "where is it": the area as the map knows it, in place of the word typed.
function placeArea(areas, label, area) {
  const a = { label: area.label, lat: area.lat, lon: area.lon };
  const rest = areas.filter((x) => x.label !== label);
  if (rest.some((x) => x.label.toLowerCase() === a.label.toLowerCase())) return rest;
  const i = areas.findIndex((x) => x.label === label);
  return i < 0 ? [...areas, a] : [...areas.slice(0, i), a, ...areas.slice(i + 1)];
}

export function Start({ query }) {
  const [step, setStep] = useState('describe'); // describe | reading | preview | creating | invite
  const [sentence, setSentence] = useState(query.get('s') || '');
  const [draft, setDraft] = useState(null);
  const [created, setCreated] = useState(null);
  const [error, setError] = useState(null);
  const [into, setInto] = useState('');
  const [city, setCity] = useState(null);
  const [asks, setAsks] = useState([]);
  const [askAt, setAskAt] = useState(0);
  const [rereading, setRereading] = useState(null);
  const speech = useSpeech(setSentence);
  const crews = myCrews().filter((c) => c.memberId);

  async function read(e) {
    e && e.preventDefault();
    if (!sentence.trim()) { setError('Write one sentence about the crew first, or tap Try the example.'); return; }
    speech.stop();
    markAiNoted();
    setError(null);
    setStep('reading');
    try {
      const d = await api.draftCrew(sentence.trim(), { into: into.trim() || null });
      setCity(null);
      took(d);
    } catch (err) {
      setError(err.message);
      setStep('describe');
    }
  }

  // a fresh draft: ask where the crew is first when the map could not place it
  function took(d) {
    // the crew's own city: its examples, and area suggestions near the crew
    if (d.region) setPlace({ tz: d.region.timezone, region: d.region, pack: d.pack });
    setDraft(d);
    const q = asksFor(d);
    setAsks(q);
    setAskAt(0);
    setStep(q.length ? 'where' : 'preview');
    top();
  }

  function nextAsk(blockingDone) {
    if (blockingDone || askAt + 1 >= asks.length) { setStep('preview'); top(); return; }
    setAskAt(askAt + 1);
    top();
  }

  // "Or just pick the city": the sentence is read again, with the areas looked up there
  async function inCity(c) {
    setRereading(c);
    try {
      const d = await api.draftCrew(sentence.trim(), { into: into.trim() || null, city: c });
      setCity(c);
      took(d);
    } catch (err) {
      toast(err.message || "Couldn't look there just now. Try again.");
    }
    setRereading(null);
  }

  async function create(name) {
    setStep('creating');
    setError(null);
    try {
      const { confidence, low, notes, ai, pack, needsLocation, understood, ...clean } = draft;
      const res = await api.createCrew(clean, { name });
      saveCrew(res.crew.slug, { name: res.crew.name, invite: res.crew.inviteToken, inviteUrl: res.inviteUrl, organiser: true });
      if (res.member && res.memberToken) {
        saveCrew(res.crew.slug, {
          memberId: res.member.id, memberName: res.member.name, memberToken: res.memberToken,
          calendarUrl: res.calendarUrl, webcalUrl: res.webcalUrl,
        });
      }
      setCreated(res);
      setStep('invite');
      top();
    } catch (err) {
      // a name that says who the crew is: the message goes next to the name
      const named = (err.fields || []).find((f) => f.field === 'name');
      setError(named ? { name: named.message || err.message } : err.message);
      setStep('preview');
    }
  }

  const backToSentence = () => { setStep('describe'); setError(null); top(); };
  if (step === 'invite' && created) return <Invite created={created} />;
  if (step === 'where' && draft && asks[askAt]) {
    const ask = asks[askAt];
    return (
      <WhereAsk
        key={`${askAt}-${city || ''}`}
        ask={ask} step={askAt} steps={asks.length} city={city} rereading={rereading}
        onBack={backToSentence}
        onAnswer={(label, area) => { setDraft({ ...draft, areas: placeArea(draft.areas, label, area) }); nextAsk(ask.blocking); }}
        onAdd={(area) => { if (!draft.areas.some((x) => x.label.toLowerCase() === area.label.toLowerCase())) setDraft({ ...draft, areas: [...draft.areas, area] }); nextAsk(true); }}
        onCity={inCity}
        onSkip={() => nextAsk(ask.blocking)}
      />
    );
  }
  if ((step === 'preview' || step === 'creating' || step === 'where') && draft) {
    return <Preview draft={draft} setDraft={setDraft} busy={step === 'creating'} error={error} onBack={backToSentence} onCreate={create} />;
  }

  const reading = step === 'reading';
  return (
    <div class="column start screen-enter">
      <header class="start-hero">
        <div class="start-branch" aria-hidden="true">
          <Sloth size={92} mood={reading ? 'reading' : 'sleepy'} class={reading ? 'sloth-reading' : ''} />
        </div>
        <h1 class="display painted start-title">Come through</h1>
        <p class="start-tag">The lazy way to link up. You send one sentence, your crew taps once.</p>
      </header>

      {crews.length > 0 && (
        <nav class="my-crews" aria-label="Your crews">
          <h2 class="section-label">Your crews</h2>
          <ul>
            {crews.map((c) => (
              <li key={c.slug}>
                <a class="crew-link" href={`/c/${c.slug}`}>
                  <span class="crew-link-name">{c.name || c.slug}</span>
                  <Icon name="back" size={18} class="chev" />
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <form class="start-form surface" onSubmit={read} aria-busy={reading}>
        <label class="start-label" for="crew-sentence">{crews.length ? 'Start another crew, in one sentence' : 'Your crew, in one sentence'}</label>
        <div class="composer">
          <textarea
            id="crew-sentence"
            class="textarea"
            rows={3}
            placeholder={EXAMPLE}
            value={sentence}
            onInput={(e) => setSentence(e.currentTarget.value)}
            disabled={reading}
            enterkeyhint="go"
            aria-describedby="crew-hint"
          />
          <div class="composer-tools">
            <MicButton speech={speech} value={sentence} />
            {!sentence && (
              <button type="button" class="chip" onClick={() => setSentence(EXAMPLE)}>Try the example</button>
            )}
          </div>
        </div>
        <p class="hint" id="crew-hint">What you're into, when you link up, and roughly where.</p>
        {speech.error && <p class="error-text">{speech.error}</p>}
        <label class="field into-field">
          <span class="label">What you're into <span class="optional">Optional</span></span>
          <input class="input" value={into} maxLength={200} onInput={(e) => setInto(e.currentTarget.value)} placeholder={packUi().intoPlaceholder || 'art, live music, somewhere quiet'} disabled={reading} enterkeyhint="go" aria-describedby="into-hint" />
          <span class="hint" id="into-hint">Tell the sloth what you're into and what makes a place feel right. You don't need to say who you are.</span>
        </label>
        {error && <p class="error-text" role="alert">{error}</p>}
        <button class="btn primary block big" type="submit" disabled={reading}>
          {reading ? <>The sloth is reading it <Dots /></> : 'Set up my crew'}
        </button>
        <AiNote />
      </form>

      <section class="how" aria-labelledby="how-title">
        <h2 id="how-title" class="section-label">How it works</h2>
        <ol class="how-steps">
          <li><b>Say what the crew is into.</b> The sloth fills in the name, the day and the areas.</li>
          <li><b>Send the link to the group chat.</b> Friends see the plans and tap once, with no app and no sign-up.</li>
          <li><b>Add plans the lazy way,</b> from a flyer, a link or a sentence. Rides sort themselves.</li>
        </ol>
        <p class="how-note">Sloths come down from their tree about once a week, and so does your crew. Give it a regular day, and when nobody plans anything, the sloth picks a green spot in the middle of everyone and checks the weather.</p>
        <p class="fine credits">
          <a href="/how">How the sloth works</a>. Maps © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors. Weather by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a>. <a href="https://github.com/IkpemosiArnold/comethrough" target="_blank" rel="noopener">Open source</a>.
        </p>
      </section>
    </div>
  );
}

const TIMES = Array.from({ length: 31 }, (_, i) => {
  const m = 7 * 60 + i * 30; // 7am to 10pm
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
});

function TimeSelect({ value, onChange, label }) {
  const list = TIMES.includes(value) ? TIMES : [...TIMES, value].sort();
  return (
    <label class="mini">
      <span>{label}</span>
      <select class="select" value={value} onChange={(e) => onChange(e.currentTarget.value)}>
        {list.map((t) => <option key={t} value={t}>{clock(t)}</option>)}
      </select>
    </label>
  );
}

// A row of the preview: what Gemma read, plain, and the editor when tapped.
function Row({ label, value, unsure, note, open, onToggle, children }) {
  return (
    <div class={`pv-row${unsure ? ' unsure' : ''}${open ? ' open' : ''}`}>
      <button type="button" class="pv-head" aria-expanded={open} onClick={onToggle}>
        <span class="pv-text">
          <span class="pv-label">{label}</span>
          <span class="pv-value"><span class="pv-ink">{value}</span></span>
          {unsure && !open && <span class="pv-note">{note}</span>}
        </span>
        <span class="pv-edit">{open ? 'Done' : 'Change'}</span>
      </button>
      {open && <div class="pv-body">{children}</div>}
    </div>
  );
}

// "Got it: alte, art and live music, early 20s, around Yaba." Rebuilt as chips come off and
// areas land on the map, the way the server first wrote it (src/core/taste.mjs, tasteView).
function tasteSummary(t, areas) {
  if (!t) return null;
  const and = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  const list = (f) => (Array.isArray(t[f]) ? t[f] : []);
  const bits = [
    ...list('scenes').slice(0, 2),
    list('likes').length ? and(list('likes').slice(0, 2)) : list('placeKinds').length ? and(list('placeKinds').slice(0, 2)) : null,
    t.ageBand,
    areas.length ? `around ${and(areas.slice(0, 2))}` : null,
  ].filter(Boolean);
  return bits.length ? `Got it: ${bits.join(', ')}.` : null;
}

const hasChip = (t, c) => (Array.isArray(t?.[c.field]) ? t[c.field].includes(c.value) : t?.[c.field] === c.value);
function dropChip(t, c) {
  if (Array.isArray(t[c.field])) return { ...t, [c.field]: t[c.field].filter((v) => v !== c.value) };
  return { ...t, [c.field]: null };
}

function TasteChips({ chips, onRemove }) {
  return (
    <ul class="row wrap taste-chips">
      {chips.map((c) => (
        <li key={c.field + c.value} class="chip area-chip">
          {c.label}
          <button type="button" class="chip-x" aria-label={`Remove ${c.label}`} onClick={() => onRemove(c)}>
            <Icon name="close" size={16} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function knownName() {
  return (myCrews().find((x) => x.memberName) || {}).memberName || '';
}

function Preview({ draft, setDraft, busy, error, onBack, onCreate }) {
  const c = draft.confidence || {};
  const low = (f) => (draft.low || []).includes(f) || (c[f] != null && c[f] < UNSURE);
  const set = (patch) => setDraft({ ...draft, ...patch });
  const r = draft.rhythm;
  const [open, setOpen] = useState(null);
  const [editName, setEditName] = useState(draft.ai === false || !draft.name);
  const [me, setMe] = useState(knownName);
  const toggle = (k) => setOpen(open === k ? null : k);
  const offMap = draft.areas.filter((a) => !pinned(a));
  const onMap = draft.areas.filter(pinned);
  const anyUnsure = ['name', 'rhythm', 'vibe', 'areas'].some(low) || offMap.length > 0 || draft.ai === false;
  // the guessed-time note is said in the row itself; the areas the sloth asked about, in theirs
  const timeGuessed = (draft.notes || []).some((t) => /^No time was given/.test(t));
  const asked = draft.needsLocation?.unresolved || [];
  const notes = (draft.notes || []).filter((t) => !/^No time was given/.test(t) && !asked.some((l) => t.includes(`"${l}"`)));
  const nameError = error && typeof error === 'object' ? error.name : null;
  // what the sloth understood: the summary, and chips to take things off (members only, never shared)
  const chips = (draft.understood?.chips || []).filter((c) => hasChip(draft.taste, c));
  const summary = draft.understood?.summary ? tasteSummary(draft.taste, onMap.map((a) => a.label)) : null;
  const removeChip = (c) => set({ taste: dropChip(draft.taste, c) });

  function setEvery(every) {
    if (!every) set({ rhythm: null });
    else set({ rhythm: { day: r?.day ?? 6, window: r?.window || { from: '15:00', to: '19:00' }, every } });
  }
  function addArea(a) {
    if (!a || !a.label || !a.label.trim()) return;
    if (draft.areas.some((x) => x.label.toLowerCase() === a.label.trim().toLowerCase())) return;
    set({ areas: [...draft.areas, { ...a, label: a.label.trim() }] });
  }
  // no area is fine: the crew is made, and the sloth picks nothing until one is on the map
  const ready = draft.name?.trim() && me.trim();

  return (
    <div class="column screen-enter has-bar preview">
      <header class="pv-top">
        <button class="icon-btn" onClick={onBack} aria-label="Back to the sentence"><Icon name="back" /></button>
        <p class="pv-kicker">
          {draft.ai === false ? 'The sloth is busy right now, so fill these in yourself.' : anyUnsure ? 'The marked bits are guesses. Tap one to fix it.' : 'Your crew, as friends will see it. Tap anything to change it.'}
        </p>
      </header>

      {editName || nameError ? (
        <label class="pv-name-edit">
          <span class="sr-only">Crew name</span>
          <input class="input display-input" value={draft.name || ''} maxLength={40} placeholder="Crew name" onInput={(e) => set({ name: e.currentTarget.value })} onBlur={() => draft.name?.trim() && !nameError && setEditName(false)} autocapitalize="words" aria-invalid={!!nameError} aria-describedby={nameError ? 'name-error' : undefined} />
          {nameError && <span class="error-text" id="name-error" role="alert">{nameError}</span>}
        </label>
      ) : (
        <button type="button" class={`pv-name${low('name') ? ' unsure' : ''}`} onClick={() => setEditName(true)} aria-label={`Crew name: ${draft.name}. Tap to change it.`}>
          <span class="display display-xl painted">{draft.name}</span>
          <Icon name="edit" size={20} />
        </button>
      )}

      {notes.length > 0 && (
        <ul class="draft-notes" aria-label="Notes">
          {notes.map((t) => <li key={t}>{t}</li>)}
        </ul>
      )}

      {(summary || chips.length > 0) && (
        <div class="taste-got">
          {summary && <p class="taste-summary">{summary}</p>}
          {chips.some((c) => c.field !== 'needs') && <TasteChips chips={chips.filter((c) => c.field !== 'needs')} onRemove={removeChip} />}
          {chips.some((c) => c.field === 'needs') && (
            <>
              <p class="taste-needs-title">What makes a place feel right</p>
              <TasteChips chips={chips.filter((c) => c.field === 'needs')} onRemove={removeChip} />
            </>
          )}
        </div>
      )}

      <div class="pv-card surface">
        <Row label="When you link up" value={r ? rhythmText(r) : 'No regular day'} unsure={low('rhythm')} open={open === 'rhythm'} onToggle={() => toggle('rhythm')}
          note={r ? (timeGuessed ? 'No time in your sentence, so the sloth chose after the worst heat. Check it.' : 'The time is a guess. Check it.') : 'No regular day in your sentence. Pick one, or leave it.'}>
          <div class="row wrap seg">
            {[['1w', 'Every week'], ['2w', 'Every other week'], ['4w', 'Once a month'], [null, 'No regular day']].map(([v, label]) => (
              <button type="button" key={label} class="chip" aria-pressed={(r?.every || null) === v} onClick={() => setEvery(v)}>{label}</button>
            ))}
          </div>
          {r && (
            <div class="rhythm-row">
              <label class="mini">
                <span>On</span>
                <select class="select" value={r.day} onChange={(e) => set({ rhythm: { ...r, day: Number(e.currentTarget.value) } })}>
                  {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </label>
              <TimeSelect label="From" value={r.window?.from || '15:00'} onChange={(v) => set({ rhythm: { ...r, window: { ...r.window, from: v } } })} />
              <TimeSelect label="To" value={r.window?.to || '19:00'} onChange={(v) => set({ rhythm: { ...r, window: { ...r.window, to: v } } })} />
            </div>
          )}
          {r && <p class="hint">On a {DAYS[r.day]} with nothing planned, the sloth picks a spot.</p>}
        </Row>

        <Row label="The vibe" value={draft.vibe || 'Not set'} unsure={low('vibe')} open={open === 'vibe'} onToggle={() => toggle('vibe')} note="A guess. Check it.">
          <input class="input" value={draft.vibe || ''} maxLength={80} onInput={(e) => set({ vibe: e.currentTarget.value })} aria-label="The vibe" />
          <p class="hint">The sloth uses this when it picks a spot.</p>
        </Row>

        <Row label="Where the crew lives" value={draft.areas.length ? nameList(draft.areas.map((a) => a.label), 4) : 'Add an area'} unsure={low('areas') || !onMap.length || offMap.length > 0} open={open === 'areas'} onToggle={() => toggle('areas')}
          note={!onMap.length ? "No area on the map yet, so the sloth won't pick spots. Add one." : offMap.length ? `${nameList(offMap.map((a) => a.label), 2)} ${offMap.length === 1 ? "isn't" : "aren't"} on the map, so rides leave ${offMap.length === 1 ? 'it' : 'them'} out.` : 'Guesses. Add the areas people come from.'}>
          <ul class="row wrap area-chips" aria-label="Areas">
            {draft.areas.map((a) => (
              <li key={a.label} class={`chip area-chip${pinned(a) ? '' : ' off-map'}`}>
                <Icon name="pin" size={16} />
                {a.label}
                {!pinned(a) && <span class="off-map-tag">not on the map</span>}
                <button type="button" class="chip-x" aria-label={`Remove ${a.label}`} onClick={() => set({ areas: draft.areas.filter((x) => x !== a) })}>
                  <Icon name="close" size={16} />
                </button>
              </li>
            ))}
          </ul>
          <AreaFind label="Add an area" onFound={addArea} />
        </Row>
      </div>

      <label class="field pv-you">
        <span class="label">Your name</span>
        <input class="input" value={me} onInput={(e) => setMe(e.currentTarget.value)} autocomplete="given-name" autocapitalize="words" maxLength={40} placeholder="What the crew calls you" enterkeyhint="done" />
        <span class="hint">So the crew sees who started it.</span>
      </label>

      {error && !nameError && <p class="error-text" role="alert">{error}</p>}

      <div class="bottom-bar">
        <div>
          <button class="btn primary block big" onClick={() => onCreate(me.trim())} disabled={busy || !ready}>
            {busy ? <>Making it <Dots /></> : 'Make the crew'}
          </button>
        </div>
      </div>
    </div>
  );
}

// The invite. A crew with a regular day gets the sloth's first pick a few seconds after it
// is made (the server picks it in the background), and the WhatsApp text leads with it, so
// friends have something to come through to. Nobody has to wait for it: "Share now" sends
// the plain invite, and "Share with the plan" appears once the pick lands.
const PICK_TIMEOUT_MS = 90000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function useFirstPick(crew, located) {
  const on = !!crew.rhythm && located;
  const [pick, setPick] = useState(on ? 'picking' : null);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    (async () => {
      const until = Date.now() + PICK_TIMEOUT_MS;
      let misses = 0;
      while (alive && Date.now() < until) {
        const t0 = Date.now();
        try {
          const r = await api.firstPick(crew.slug, 20);
          if (!alive) return;
          if (r.status !== 'pending') {
            setPick(r.plan && r.plan.status !== 'cancelled' ? r.plan : r.plan ? { skipped: r.plan } : null);
            return;
          }
        } catch {
          if (++misses >= 3) break;
        }
        // the server answers at once when the pick is not running there: ask again calmly
        if (Date.now() - t0 < 2000) await sleep(3000);
      }
      if (alive) setPick(null);
    })();
    return () => { alive = false; };
  }, []);
  return pick;
}

function Invite({ created }) {
  const { crew, inviteUrl } = created;
  // no area on the map: the sloth picks nothing, and says so once
  const unplaced = !!created.needsLocation?.blocking;
  const pick = useFirstPick(crew, !unplaced);
  const [sharedEarly, setSharedEarly] = useState(false);
  const picking = pick === 'picking';
  const plan = pick && !picking && !pick.skipped ? pick : null;
  const message = crewInvite(crew, plan ? [plan] : [], crew.inviteToken);
  async function copy() {
    const ok = await copyText(inviteUrl);
    toast(ok ? 'Link copied' : "Couldn't copy. Press and hold the link instead.");
  }
  const day = crew.rhythm ? DAYS[crew.rhythm.day] : '';
  const shareLabel = picking ? 'Share now' : plan && sharedEarly ? 'Share with the plan' : 'Send to the group chat';
  return (
    <div class="column screen-enter invite">
      <div class="invite-sloth"><Sloth size={88} mood="awake" /></div>
      <h1 class="display display-xl painted paint-in">{crew.name} is ready</h1>
      <p class="lede">Send it to the group chat. Friends see the plans before they're asked for anything.</p>

      {picking && (
        <div class="first-pick ritual planning" role="status">
          <p class="ritual-kicker">{rhythmText(crew.rhythm)}</p>
          <p class="display ritual-title">The sloth is picking {day}<span class="ellipsis" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></p>
          <p class="ritual-when">A green spot in the middle of the crew, with the weather checked.</p>
        </div>
      )}
      {plan && (
        <a class="first-pick ritual landed" href={`/c/${crew.slug}/p/${plan.id}`}>
          <p class="ritual-kicker">The sloth picked {dayWord(plan.start)}</p>
          <p class="display ritual-title">{plan.place?.name || plan.title}</p>
          <p class="ritual-when">{timeRange(plan.start, plan.end)}</p>
          {plan.weather && <p class="ritual-wx"><Icon name={weatherIcon(plan.weather)} size={18} /> {weatherWords(plan.weather)}</p>}
        </a>
      )}
      {pick?.skipped && <p class="muted small rain-skip">{pick.skipped.rainPlan?.note}</p>}
      {unplaced && crew.rhythm && <p class="muted small">No area is on the map yet, so the sloth isn't picking {day}'s spot. Plans the crew adds still work.</p>}

      <div class="stack" style={{ '--stack': 'var(--s-3)' }}>
        <a class="btn whatsapp block big" href={whatsappUrl(message)} target="_blank" rel="noopener" data-external onClick={() => picking && setSharedEarly(true)}>
          <WhatsAppIcon /> {shareLabel}
        </a>
        {picking && <p class="hint share-wait">Or wait a few seconds, and the message will carry {day}'s spot.</p>}
        {plan && sharedEarly && <p class="hint share-wait">The sloth picked {plan.place?.name || dayWord(plan.start)}. Send it so the crew can tap I'm in.</p>}
        <button class="btn secondary block" onClick={copy}><Icon name="copy" size={20} /> Copy link</button>
      </div>

      <div class="invite-next">
        <a class="btn ghost block" href={`/c/${crew.slug}`}>Go to {crew.name}</a>
      </div>
    </div>
  );
}
