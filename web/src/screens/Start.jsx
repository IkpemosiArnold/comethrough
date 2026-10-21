// Start a crew: one sentence (or a voice note), then Gemma's reading to confirm, then the invite link.
import { useState, useRef } from 'preact/hooks';
import { api } from '../lib/api.js';
import { myCrews, saveCrew } from '../lib/store.js';
import { navigate } from '../lib/router.js';
import { useSpeech } from '../lib/speech.js';
import { copyText, whatsappUrl } from '../lib/platform.js';
import { DAYS } from '../lib/format.js';
import { Sloth } from '../ui/Sloth.jsx';
import { Icon, WhatsAppIcon } from '../ui/icons.jsx';
import { MicButton } from '../ui/MicButton.jsx';
import { AreaInput } from '../ui/AreaInput.jsx';
import { Dots } from '../ui/misc.jsx';
import { toast } from '../ui/toast.jsx';

const EXAMPLE = 'The uni guys, every other Saturday, somewhere outside and cheap, around Yaba and Lekki';
const UNSURE = 0.7;

export function Start({ query }) {
  const [step, setStep] = useState('describe'); // describe | reading | confirm | creating | invite
  const [sentence, setSentence] = useState(query.get('s') || '');
  const [draft, setDraft] = useState(null);
  const [created, setCreated] = useState(null);
  const [error, setError] = useState(null);
  const speech = useSpeech(setSentence);
  const crews = myCrews().filter((c) => c.memberId);

  async function read(e) {
    e && e.preventDefault();
    if (!sentence.trim()) { setError('Write a sentence about your crew first. The example above is a good start.'); return; }
    speech.stop();
    setError(null);
    setStep('reading');
    try {
      const d = await api.draftCrew(sentence.trim());
      setDraft(d);
      setStep('confirm');
    } catch (err) {
      setError(err.message);
      setStep('describe');
    }
  }

  async function create() {
    setStep('creating');
    try {
      const { confidence, ...clean } = draft;
      const res = await api.createCrew(clean);
      saveCrew(res.crew.slug, { name: res.crew.name, invite: res.crew.inviteToken, inviteUrl: res.inviteUrl, organiser: true });
      if (res.member) saveCrew(res.crew.slug, { memberId: res.member.id, memberName: res.member.name, memberToken: res.member.calToken });
      setCreated(res);
      setStep('invite');
      window.scrollTo(0, 0);
    } catch (err) {
      setError(err.message);
      setStep('confirm');
    }
  }

  if (step === 'invite' && created) return <Invite created={created} />;
  if ((step === 'confirm' || step === 'creating') && draft) {
    return (
      <Confirm
        draft={draft}
        setDraft={setDraft}
        busy={step === 'creating'}
        error={error}
        onBack={() => { setStep('describe'); setError(null); }}
        onCreate={create}
      />
    );
  }

  const reading = step === 'reading';
  return (
    <div class="column start screen-enter">
      <header class="start-hero">
        <div class="start-branch" aria-hidden="true">
          <Sloth size={104} mood={reading ? 'reading' : 'sleepy'} class={reading ? 'sloth-reading' : ''} />
        </div>
        <h1 class="display display-xl painted start-title">Come through</h1>
        <p class="start-tag">The group chat does the asking. You just come through.</p>
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
        <label class="field" for="crew-sentence">
          <span class="label display display-sm">Start a crew in one sentence</span>
        </label>
        <div class="composer">
          <textarea
            id="crew-sentence"
            class="textarea"
            rows={4}
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
              <button type="button" class="chip" onClick={() => setSentence(EXAMPLE)}>Use the example</button>
            )}
          </div>
        </div>
        <p class="hint" id="crew-hint">Who you are, how often you link up, the vibe, and roughly where.</p>
        {speech.error && <p class="error-text">{speech.error}</p>}
        {error && <p class="error-text" role="alert">{error}</p>}
        <button class="btn primary block big" type="submit" disabled={reading}>
          {reading ? <>Gemma is reading it <Dots /></> : 'Set up my crew'}
        </button>
        <p class="fine">To read your sentence we send it to Gemma, Google's open model. That's all that goes to Google.</p>
      </form>

      <section class="how" aria-labelledby="how-title">
        <h2 id="how-title" class="section-label">How it works</h2>
        <ol class="how-steps">
          <li><b>Describe your crew.</b> Gemma sets up the name, the rhythm and the areas.</li>
          <li><b>Drop the link in the group chat.</b> Friends join with a name and an area. No app, no sign up.</li>
          <li><b>Plans come in lazy.</b> A flyer, a link or one sentence. Everyone taps once and rides sort themselves.</li>
        </ol>
        <p class="how-note">Got a regular day? If nobody plans anything, the sloth picks a green spot near the middle of the crew, checks the weather, and posts it.</p>
      </section>
    </div>
  );
}

function Unsure({ conf, children, note = "Gemma wasn't sure about this one." }) {
  const unsure = conf != null && conf < UNSURE;
  return (
    <div class={`confirm-field${unsure ? ' unsure' : ''}`}>
      {children}
      {unsure && <p class="unsure-note">{note}</p>}
    </div>
  );
}

function Confirm({ draft, setDraft, busy, error, onBack, onCreate }) {
  const c = draft.confidence || {};
  const set = (patch) => setDraft({ ...draft, ...patch });
  const r = draft.rhythm;
  const [newArea, setNewArea] = useState(null);
  const areaKey = useRef(0);

  function setEvery(every) {
    if (!every) set({ rhythm: null });
    else set({ rhythm: { day: r?.day ?? 6, window: r?.window || { from: '15:00', to: '19:00' }, every } });
  }
  function addArea(a) {
    if (!a || !a.label || !a.label.trim()) return;
    if (draft.areas.some((x) => x.label.toLowerCase() === a.label.trim().toLowerCase())) return;
    set({ areas: [...draft.areas, { ...a, label: a.label.trim() }] });
    setNewArea(null);
    areaKey.current++;
  }

  return (
    <div class="column screen-enter has-bar">
      <header class="confirm-head">
        <button class="icon-btn" onClick={onBack} aria-label="Back to the sentence"><Icon name="back" /></button>
        <div>
          <h1 class="display display-lg">Did Gemma get it right?</h1>
          <p class="muted">Change anything that's off. The highlighted bits are guesses.</p>
        </div>
      </header>

      <div class="confirm-card surface stack" style={{ '--stack': 'var(--s-6)' }}>
        <Unsure conf={c.name}>
          <label class="field">
            <span class="label">Crew name</span>
            <input class="input display-input" value={draft.name} maxLength={40} onInput={(e) => set({ name: e.currentTarget.value })} autocapitalize="words" />
          </label>
        </Unsure>

        <Unsure conf={c.rhythm} note="Gemma couldn't find a regular day. Pick one, or leave it.">
          <fieldset class="field">
            <legend class="label">How often you link up</legend>
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
                <label class="mini">
                  <span>From</span>
                  <input class="input" type="time" value={r.window?.from} onInput={(e) => set({ rhythm: { ...r, window: { ...r.window, from: e.currentTarget.value } } })} />
                </label>
                <label class="mini">
                  <span>To</span>
                  <input class="input" type="time" value={r.window?.to} onInput={(e) => set({ rhythm: { ...r, window: { ...r.window, to: e.currentTarget.value } } })} />
                </label>
              </div>
            )}
          </fieldset>
        </Unsure>

        <Unsure conf={c.vibe}>
          <label class="field">
            <span class="label">The vibe</span>
            <input class="input" value={draft.vibe} maxLength={80} onInput={(e) => set({ vibe: e.currentTarget.value })} />
            <span class="hint">The sloth uses this to pick places and write invites.</span>
          </label>
        </Unsure>

        <Unsure conf={c.areas} note="Gemma guessed the areas. Add where people actually live.">
          <div class="field">
            <span class="label" id="areas-label">Where the crew lives</span>
            <ul class="row wrap area-chips" aria-labelledby="areas-label">
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
                <AreaInput key={areaKey.current} value={newArea} onChange={(a) => (a.lat != null ? addArea(a) : setNewArea(a))} onEnter={() => addArea(newArea)} placeholder="Add an area" label="Add an area" />
              </div>
              <button type="button" class="btn secondary" onClick={() => addArea(newArea)} disabled={!newArea?.label}>Add</button>
            </div>
          </div>
        </Unsure>
      </div>

      {error && <p class="error-text" role="alert">{error}</p>}

      <div class="bottom-bar">
        <div>
          <button class="btn primary block big" onClick={onCreate} disabled={busy || !draft.name?.trim() || !draft.areas.length}>
            {busy ? <>Making it <Dots /></> : 'Make the crew'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Invite({ created }) {
  const { crew, inviteUrl } = created;
  const message = `Come through! I made a page for ${crew.name}. Plans go there, you tap once if you're coming, and rides sort themselves. Join here: ${inviteUrl}`;
  async function copy() {
    const ok = await copyText(inviteUrl);
    toast(ok ? 'Link copied' : "Couldn't copy. Press and hold the link instead.");
  }
  const joinHref = `/c/${crew.slug}?t=${encodeURIComponent(crew.inviteToken)}`;
  return (
    <div class="column screen-enter invite">
      <div class="invite-sloth"><Sloth size={96} mood="awake" /></div>
      <h1 class="display display-xl painted">{crew.name} is ready</h1>
      <p class="lede">Drop this link in the group chat. Anyone who has it can join with a name and an area.</p>

      <div class="link-box surface">
        <p class="link-text" aria-label="Invite link">{inviteUrl}</p>
        <button class="icon-btn" onClick={copy} aria-label="Copy the invite link"><Icon name="copy" /></button>
      </div>

      <div class="stack" style={{ '--stack': 'var(--s-3)' }}>
        <a class="btn whatsapp block big" href={whatsappUrl(message)} target="_blank" rel="noopener" data-external>
          <WhatsAppIcon /> Send to the group chat
        </a>
        <button class="btn secondary block" onClick={copy}><Icon name="copy" size={20} /> Copy link</button>
      </div>

      <div class="invite-next">
        <p class="muted">You're not in it yet either. Join so you show up when you say you're going.</p>
        <a class="btn ghost block" href={joinHref} onClick={(e) => { e.preventDefault(); navigate(joinHref); }}>Join it yourself</a>
      </div>
    </div>
  );
}
