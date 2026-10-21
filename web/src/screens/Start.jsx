// Start a crew: one sentence (or a voice note), then the crew as friends will see it, with
// each thing Gemma read as a row to tap and fix, then the invite with the sloth's first pick.
import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api.js';
import { myCrews, saveCrew } from '../lib/store.js';
import { useSpeech } from '../lib/speech.js';
import { copyText } from '../lib/platform.js';
import { DAYS, rhythmText, clock, nameList, dayLabel, timeRange } from '../lib/format.js';
import { exampleSentence, setPlace } from '../lib/place.js';
import { whatsappUrl } from '../lib/share.js';
import { crewInvite } from './CrewHome.jsx';
import { Sloth } from '../ui/Sloth.jsx';
import { Icon, WhatsAppIcon } from '../ui/icons.jsx';
import { MicButton } from '../ui/MicButton.jsx';
import { AreaInput } from '../ui/AreaInput.jsx';
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

export function Start({ query }) {
  const [step, setStep] = useState('describe'); // describe | reading | preview | creating | invite
  const [sentence, setSentence] = useState(query.get('s') || '');
  const [draft, setDraft] = useState(null);
  const [created, setCreated] = useState(null);
  const [error, setError] = useState(null);
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
      const d = await api.draftCrew(sentence.trim());
      // the crew's own city: its examples, and area suggestions near the crew
      if (d.region) setPlace({ tz: d.region.timezone, region: d.region, pack: d.pack });
      setDraft(d);
      setStep('preview');
      top();
    } catch (err) {
      setError(err.message);
      setStep('describe');
    }
  }

  async function create(name) {
    setStep('creating');
    try {
      const { confidence, low, notes, ai, pack, ...clean } = draft;
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
      setError(err.message);
      setStep('preview');
    }
  }

  if (step === 'invite' && created) return <Invite created={created} />;
  if ((step === 'preview' || step === 'creating') && draft) {
    return <Preview draft={draft} setDraft={setDraft} busy={step === 'creating'} error={error} onBack={() => { setStep('describe'); setError(null); top(); }} onCreate={create} />;
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
        <p class="hint" id="crew-hint">Who they are, when you link up, and roughly where.</p>
        {speech.error && <p class="error-text">{speech.error}</p>}
        {error && <p class="error-text" role="alert">{error}</p>}
        <button class="btn primary block big" type="submit" disabled={reading}>
          {reading ? <>The sloth is reading it <Dots /></> : 'Set up my crew'}
        </button>
        <AiNote />
      </form>

      <section class="how" aria-labelledby="how-title">
        <h2 id="how-title" class="section-label">How it works</h2>
        <ol class="how-steps">
          <li><b>Say who the crew is.</b> The sloth fills in the name, the day and the areas.</li>
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
          <span class="pv-value">{value}</span>
          {unsure && !open && <span class="pv-note">{note}</span>}
        </span>
        <span class="pv-edit">{open ? 'Done' : 'Change'}</span>
      </button>
      {open && <div class="pv-body">{children}</div>}
    </div>
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
  const [newArea, setNewArea] = useState(null);
  const [areaKey, setAreaKey] = useState(0);
  const toggle = (k) => setOpen(open === k ? null : k);
  const anyUnsure = ['name', 'rhythm', 'vibe', 'areas'].some(low) || draft.ai === false;

  function setEvery(every) {
    if (!every) set({ rhythm: null });
    else set({ rhythm: { day: r?.day ?? 6, window: r?.window || { from: '15:00', to: '19:00' }, every } });
  }
  function addArea(a) {
    if (!a || !a.label || !a.label.trim()) return;
    if (draft.areas.some((x) => x.label.toLowerCase() === a.label.trim().toLowerCase())) return;
    set({ areas: [...draft.areas, { ...a, label: a.label.trim() }] });
    setNewArea(null);
    setAreaKey(areaKey + 1);
  }
  const ready = draft.name?.trim() && draft.areas.length && me.trim();

  return (
    <div class="column screen-enter has-bar preview">
      <header class="pv-top">
        <button class="icon-btn" onClick={onBack} aria-label="Back to the sentence"><Icon name="back" /></button>
        <p class="pv-kicker">
          {draft.ai === false ? 'The sloth is busy right now, so fill these in yourself.' : anyUnsure ? 'The marked bits are guesses. Tap one to fix it.' : 'Your crew, as friends will see it. Tap anything to change it.'}
        </p>
      </header>

      {editName ? (
        <label class="pv-name-edit">
          <span class="sr-only">Crew name</span>
          <input class="input display-input" value={draft.name || ''} maxLength={40} placeholder="Crew name" onInput={(e) => set({ name: e.currentTarget.value })} onBlur={() => draft.name?.trim() && setEditName(false)} autocapitalize="words" />
        </label>
      ) : (
        <button type="button" class={`pv-name${low('name') ? ' unsure' : ''}`} onClick={() => setEditName(true)} aria-label={`Crew name: ${draft.name}. Tap to change it.`}>
          <span class="display display-xl painted">{draft.name}</span>
          <Icon name="edit" size={20} />
        </button>
      )}

      {draft.notes?.length > 0 && (
        <ul class="draft-notes" aria-label="Notes">
          {draft.notes.map((t) => <li key={t}>{t}</li>)}
        </ul>
      )}

      <div class="pv-card surface">
        <Row label="When you link up" value={r ? rhythmText(r) : 'No regular day'} unsure={low('rhythm')} open={open === 'rhythm'} onToggle={() => toggle('rhythm')}
          note={r ? 'The time is a guess. Check it.' : 'No regular day in your sentence. Pick one, or leave it.'}>
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

        <Row label="Where the crew lives" value={draft.areas.length ? nameList(draft.areas.map((a) => a.label), 4) : 'Add an area'} unsure={low('areas') || !draft.areas.length} open={open === 'areas'} onToggle={() => toggle('areas')} note="Guesses. Add the areas people come from.">
          <ul class="row wrap area-chips" aria-label="Areas">
            {draft.areas.map((a) => (
              <li key={a.label} class="chip area-chip">
                <Icon name="pin" size={16} />
                {a.label}
                <button type="button" class="chip-x" aria-label={`Remove ${a.label}`} onClick={() => set({ areas: draft.areas.filter((x) => x !== a) })}>
                  <Icon name="close" size={16} />
                </button>
              </li>
            ))}
          </ul>
          <div class="add-area row">
            <div class="grow">
              <AreaInput key={areaKey} value={newArea} onChange={(a) => (a.lat != null ? addArea(a) : setNewArea(a))} onEnter={() => addArea(newArea)} label="Add an area" />
            </div>
            <button type="button" class="btn secondary" onClick={() => addArea(newArea)} disabled={!newArea?.label}>Add</button>
          </div>
        </Row>
      </div>

      <label class="field pv-you">
        <span class="label">Your name</span>
        <input class="input" value={me} onInput={(e) => setMe(e.currentTarget.value)} autocomplete="given-name" autocapitalize="words" maxLength={40} placeholder="What the crew calls you" enterkeyhint="done" />
        <span class="hint">So the crew sees who started it.</span>
      </label>

      {error && <p class="error-text" role="alert">{error}</p>}

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

// The invite. A crew with a regular day gets the sloth's first pick straight away, and the
// WhatsApp text leads with it, so friends have something to come through to.
function Invite({ created }) {
  const { crew, inviteUrl } = created;
  const [pick, setPick] = useState(crew.rhythm ? 'picking' : null);
  useEffect(() => {
    if (!crew.rhythm) return;
    let alive = true;
    api.firstPick(crew.slug)
      .then((r) => alive && setPick(r.plan && r.plan.status !== 'cancelled' ? r.plan : r.plan ? { skipped: r.plan } : null))
      .catch(() => alive && setPick(null));
    return () => { alive = false; };
  }, []);
  const plan = pick && pick !== 'picking' && !pick.skipped ? pick : null;
  const message = crewInvite(crew, plan ? [plan] : [], crew.inviteToken);
  async function copy() {
    const ok = await copyText(inviteUrl);
    toast(ok ? 'Link copied' : "Couldn't copy. Press and hold the link instead.");
  }
  const day = crew.rhythm ? DAYS[crew.rhythm.day] : '';
  return (
    <div class="column screen-enter invite">
      <div class="invite-sloth"><Sloth size={88} mood="awake" /></div>
      <h1 class="display display-xl painted paint-in">{crew.name} is ready</h1>
      <p class="lede">Send it to the group chat. Friends see the plans before they're asked for anything.</p>

      {pick === 'picking' && (
        <div class="first-pick ritual planning" role="status">
          <p class="ritual-kicker">{rhythmText(crew.rhythm)}</p>
          <p class="display ritual-title">The sloth is picking {day}'s spot<span class="ellipsis" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></p>
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

      <div class="stack" style={{ '--stack': 'var(--s-3)' }}>
        <a class="btn whatsapp block big" href={whatsappUrl(message)} target="_blank" rel="noopener" data-external>
          <WhatsAppIcon /> Send to the group chat
        </a>
        <button class="btn secondary block" onClick={copy}><Icon name="copy" size={20} /> Copy link</button>
      </div>

      <div class="invite-next">
        <a class="btn ghost block" href={`/c/${crew.slug}`}>Go to {crew.name}</a>
      </div>
    </div>
  );
}
