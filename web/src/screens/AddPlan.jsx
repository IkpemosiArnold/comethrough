// Add a plan: paste a link, add a flyer, or say it in one sentence. Gemma drafts it;
// you check the highlighted guesses and post.
import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../lib/api.js';
import { getCrew, sessionGet, sessionSet } from '../lib/store.js';
import { navigate } from '../lib/router.js';
import { useSpeech } from '../lib/speech.js';
import { isIOS, isAndroid, isStandalone } from '../lib/platform.js';
import { prefersReducedMotion } from '../lib/spring.js';
import { TopBar, Dots, KindSticker } from '../ui/misc.jsx';
import { Icon } from '../ui/icons.jsx';
import { MicButton } from '../ui/MicButton.jsx';
import { AreaInput } from '../ui/AreaInput.jsx';
import { Sloth } from '../ui/Sloth.jsx';
import { installPrompt } from '../lib/install.js';
import { prepareFlyer, formatBytes } from '../lib/image.js';
import { Privacy } from '../ui/Privacy.jsx';
import { dayLabel, timeRange } from '../lib/format.js';
import { fromLocalParts, toLocalParts } from '../lib/format.js';
import { packUi } from '../lib/place.js';

const UNSURE = 0.6;
const URL_RE = /https?:\/\/[^\s]+/i;
// Instagram, Facebook and Threads give servers an empty page, and Tix.africa blocks servers
// outright (the server says link_locked too; docs/LOCAL-FACTS.md)
const IG_RE = /(^|\/\/|\.)(instagram\.com|instagr\.am|facebook\.com|fb\.com|fb\.me|threads\.net|tix\.africa)\//i;
const lockedWords = (url) => (/tix\.africa/i.test(url || '')
  ? "Tix.africa doesn't let apps read its pages. Add a screenshot of the event or the flyer instead."
  : `${/threads/i.test(url || '') ? 'Threads' : /facebook|fb\./i.test(url || '') ? 'Facebook' : 'Instagram'} doesn't let apps read posts. Add a screenshot of the flyer instead.`);
const STATUS_IMAGE = ['reading the flyer', 'finding the date', 'finding the place', 'checking the price'];
const STATUS_TEXT = ['reading it', 'working out the day', 'finding the place'];

// Date and time inputs are in the crew's own zone (Lagos, Berlin...), daylight saving included.
const toParts = toLocalParts;
const fromParts = fromLocalParts;

// The crew sees the flyer as a small poster: a ~480px JPEG (well under the server's 200 KB
// limit) is kept as the plan's thumbnail. The big copy is only read by Gemma, never stored.
async function thumbOf(file) {
  try {
    if (typeof createImageBitmap === 'undefined') return null;
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 480 / bmp.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.72));
    return blob && blob.size < 190e3 ? new File([blob], 'thumb.jpg', { type: 'image/jpeg' }) : null;
  } catch {
    return null;
  }
}

export function AddPlan({ params, query }) {
  const { slug } = params;
  const mine = getCrew(slug);
  const [step, setStep] = useState('compose'); // compose | reading | draft | posting
  const [text, setText] = useState('');
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);
  const [locked, setLocked] = useState(false);
  const [status, setStatus] = useState(0);
  const [sending, setSending] = useState(null); // { bytes, originalBytes } of the flyer upload
  const fileRef = useRef(null);
  const lastRead = useRef(null);
  const speech = useSpeech(setText);

  const url = (text.match(URL_RE) || [])[0];
  const isInstagram = (url && IG_RE.test(url)) || locked;

  // Arriving from the share sheet (Android): pick up what was shared.
  useEffect(() => {
    if (!query.get('shared')) return;
    const raw = sessionGet('ct.shared');
    if (!raw) return;
    sessionSet('ct.shared', '');
    let s;
    try { s = JSON.parse(raw); } catch { return; }
    const t = [s.title, s.text, s.url].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' ').trim();
    if (s.image) {
      caches.open('ct-share').then((c) => c.match('/share/image')).then((r) => r && r.blob()).then((b) => {
        if (b) { const f = new File([b], 'flyer.jpg', { type: b.type || 'image/jpeg' }); takeImage(f, t); }
      }).catch(() => {});
    } else if (t) {
      setText(t);
      if (!IG_RE.test(t)) read({ text: t });
    }
  }, []);

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  // Cycle the reading status lazily while Gemma works
  useEffect(() => {
    if (step !== 'reading') return;
    setStatus(0);
    const t = setInterval(() => setStatus((s) => s + 1), 1100);
    return () => clearInterval(t);
  }, [step]);

  async function takeImage(file, withText = '') {
    if (!file) return;
    let ready;
    try {
      ready = await prepareFlyer(file);
    } catch (e) {
      setError(e.message || "Couldn't open that picture. Take a screenshot of the flyer instead.");
      setStep('compose');
      return;
    }
    const small = ready.file;
    const thumb = await thumbOf(small);
    setSending({ bytes: ready.bytes, originalBytes: ready.originalBytes });
    setImage(small);
    setLocked(false);
    setPreview(URL.createObjectURL(small));
    const sharedUrl = (withText.match(URL_RE) || [])[0];
    read({ image: small, thumb, text: withText && !URL_RE.test(withText) ? withText : '', url: sharedUrl && !IG_RE.test(sharedUrl) ? sharedUrl : undefined });
  }

  async function read(input) {
    const payload = input || {};
    if (!input) {
      const u = url && !isInstagram ? url : undefined;
      const rest = text.replace(URL_RE, '').trim();
      payload.url = u;
      payload.text = rest || (u ? '' : text.trim());
    }
    if (!payload.text && !payload.url && !payload.image) return;
    lastRead.current = payload;
    speech.stop();
    setError(null);
    setStep('reading');
    try {
      const d = await api.parsePlan(slug, payload);
      setDraft({ ...d, bring: d.bring || [], place: { name: '', address: '', lat: null, lon: null, outdoor: false, private: false, ...(d.place || {}) } });
      setStep('draft');
      window.scrollTo(0, 0);
    } catch (e) {
      // a link Instagram or Facebook keeps locked: the note with "Choose the flyer" says it
      if (e.code === 'link_locked') { setLocked(true); setError(null); } else setError(e.message);
      setStep('compose');
    }
  }

  async function paste() {
    try {
      const t = await navigator.clipboard.readText();
      if (t) { setText(t); return; }
    } catch { /* permission refused: fall through */ }
    const ta = document.getElementById('plan-text');
    ta && ta.focus();
    setError('Press and hold in the box, then tap Paste.');
  }

  async function post() {
    setStep('posting');
    try {
      const { notes, confidence, low, ai, ...clean } = draft;
      const plan = await api.createPlan(slug, clean);
      navigate(`/c/${slug}/p/${plan.id}?posted=1`, { replace: true });
    } catch (e) {
      setError(e.message);
      setStep('draft');
    }
  }

  if ((step === 'draft' || step === 'posting') && draft) {
    return (
      <Draft
        draft={draft}
        setDraft={setDraft}
        preview={preview}
        busy={step === 'posting'}
        error={error}
        onBack={() => { setStep('compose'); setDraft(null); }}
        onPost={post}
        onRetry={() => lastRead.current && read(lastRead.current)}
        meId={mine?.memberId}
      />
    );
  }

  if (step === 'reading') {
    const list = image ? STATUS_IMAGE : STATUS_TEXT;
    return (
      <div class="column screen-enter reading" aria-busy="true">
        <TopBar backTo={`/c/${slug}`} title="Add a plan" />
        <div class="reading-stage">
          {preview ? (
            <div class="poster reading-poster">
              <img src={preview} alt="Your flyer" />
              <span class="highlighter-sweep" aria-hidden="true" />
            </div>
          ) : (
            <blockquote class="reading-quote">
              <p>{text}</p>
              <span class="highlighter-sweep" aria-hidden="true" />
            </blockquote>
          )}
          <div class="reading-status" role="status" aria-live="polite">
            <Sloth size={64} mood="reading" branch={false} />
            <p><b>Gemma</b> is {list[status % list.length]}<Dots /></p>
          </div>
          {image && sending && (
            <p class="fine upload-size">
              Sending {formatBytes(sending.bytes)}{sending.originalBytes > sending.bytes * 1.2 ? `, shrunk from ${formatBytes(sending.originalBytes)} to save your data` : ''}.
            </p>
          )}
        </div>
      </div>
    );
  }

  const showShareTip = isAndroid && !isStandalone;
  const pasteFirst = isIOS;

  const pasteTile = (
    <button type="button" class="tile" onClick={paste}>
      <Icon name="link" size={26} />
      <span class="tile-title">Paste a link</span>
      <span class="tile-sub">From WhatsApp or a ticket site</span>
    </button>
  );
  const flyerTile = (
    <button type="button" class="tile tile-flyer" onClick={() => fileRef.current && fileRef.current.click()}>
      <Icon name="camera" size={26} />
      <span class="tile-title">Add a flyer</span>
      <span class="tile-sub">Snap it or pick a screenshot</span>
    </button>
  );

  return (
    <div class="column add-plan screen-enter">
      <TopBar backTo={`/c/${slug}`} title="Add a plan" />
      <h1 class="display display-lg">What's the plan?</h1>
      <p class="muted add-lede">A flyer, a link or one sentence. Gemma fills in the details.</p>

      <div class="tiles">
        {pasteFirst ? <>{pasteTile}{flyerTile}</> : <>{flyerTile}{pasteTile}</>}
      </div>
      <input ref={fileRef} type="file" accept="image/*" class="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => takeImage(e.currentTarget.files && e.currentTarget.files[0])} />

      <form class="say-it" onSubmit={(e) => { e.preventDefault(); read(); }}>
        <label class="field" for="plan-text"><span class="label">Or type it like you'd text it</span></label>
        <div class="composer">
          <textarea
            id="plan-text"
            class="textarea"
            rows={3}
            value={text}
            onInput={(e) => { setText(e.currentTarget.value); setError(null); setLocked(false); }}
            placeholder="Wine and monopoly at mine, Friday 7, bring a bottle"
            enterkeyhint="go"
          />
          <div class="composer-tools"><MicButton speech={speech} value={text} /></div>
        </div>
        {isInstagram && (
          <div class="ig-note" role="note">
            <p>{lockedWords(url)}</p>
            <button type="button" class="btn secondary" onClick={() => fileRef.current && fileRef.current.click()}><Icon name="image" size={20} /> Add the screenshot</button>
          </div>
        )}
        {speech.error && <p class="error-text">{speech.error}</p>}
        {error && <p class="error-text" role="alert">{error}</p>}
        <button class="btn primary block big" type="submit" disabled={!text.trim() || (isInstagram && !text.replace(URL_RE, '').trim())}>Read it</button>
        <Privacy what="what you add here" mic={speech.supported} />
      </form>

      {showShareTip && <ShareTip />}
    </div>
  );
}

function ShareTip() {
  const [prompt, setPrompt] = useState(installPrompt.get());
  useEffect(() => installPrompt.on(setPrompt), []);
  return (
    <aside class="share-tip">
      <Icon name="share" size={22} />
      <div class="grow">
        <p class="strong">Share flyers straight here</p>
        <p class="small muted">Install Come Through and it appears when you tap Share in WhatsApp or your gallery.</p>
      </div>
      {prompt && <button class="btn secondary" onClick={() => installPrompt.fire()}>Install</button>}
    </aside>
  );
}

function Unsure({ conf, low, children, order = 0 }) {
  const unsure = low || (conf != null && conf < UNSURE);
  return (
    <div class={`draft-field${unsure ? ' unsure' : ''}`} style={{ '--i': order }}>
      {children}
      {unsure && <p class="unsure-note">Gemma guessed this.</p>}
    </div>
  );
}

function Draft({ draft, setDraft, preview, busy, error, onBack, onPost, onRetry, meId }) {
  const c = draft.confidence || {};
  const isLow = (...f) => f.some((x) => (draft.low || []).includes(x) || (c[x] != null && c[x] < UNSURE));
  const notes = Array.isArray(draft.notes) ? draft.notes : [];
  const set = (patch) => setDraft({ ...draft, ...patch });
  const setPlace = (patch) => set({ place: { ...draft.place, ...patch } });
  const s = toParts(draft.start), e = toParts(draft.end);
  const [newItem, setNewItem] = useState('');
  const animate = useRef(!prefersReducedMotion());
  useEffect(() => { animate.current = false; }, []);

  function addBring() {
    const v = newItem.trim();
    if (!v) return;
    set({ bring: [...(draft.bring || []), v] });
    setNewItem('');
  }
  const ok = draft.title?.trim() && draft.start;
  const unsure = draft.ai === false || ['title', 'start', 'end', 'place', 'price'].some((f) => isLow(f));
  const from = preview || draft.source?.image ? 'the flyer' : draft.source?.url ? 'the link' : 'your sentence';
  const [details, setDetails] = useState(unsure);

  return (
    <div class={`column screen-enter draft has-bar${animate.current ? ' draft-intro' : ''}`}>
      <TopBar onBack={onBack} backTo="" title="Check the plan" />
      <div class="draft-head">
        {preview && <img class="poster draft-poster" src={preview} alt="Your flyer" />}
        <div>
          {draft.ai === false ? (
            <>
              <h1 class="display display-lg">Gemma is busy right now</h1>
              <p class="muted">Fill in the details yourself, or try again in a minute.</p>
              <button type="button" class="btn secondary retry-btn" onClick={onRetry}>Try again</button>
            </>
          ) : unsure ? (
            <>
              <h1 class="display display-lg">Check the marked bits</h1>
              <p class="muted">Gemma guessed them. The rest came from {from}.</p>
            </>
          ) : (
            <>
              <h1 class="display display-lg">Here's the plan</h1>
              <p class="muted">Gemma read it from {from}. Change anything before you post.</p>
            </>
          )}
        </div>
      </div>

      {notes.length > 0 && (
        <ul class="draft-notes" aria-label="Notes from Gemma">
          {notes.map((t) => <li key={t}>{t}</li>)}
        </ul>
      )}

      {draft.ai !== false && (
        <div class={`draft-preview plan-row kind-${draft.kind}`}>
          <div class="plan-main">
            <div class="row plan-tags"><KindSticker kind={draft.kind} /></div>
            <p class="plan-title">{draft.title || 'No title yet'}</p>
            <p class="plan-meta">{draft.start ? `${dayLabel(draft.start)}, ${timeRange(draft.start, draft.end)}` : 'No date yet'}{draft.place?.name ? ` at ${draft.place.name}` : ''}</p>
            {draft.price?.text && <p class="plan-meta">{draft.price.text}</p>}
          </div>
        </div>
      )}

      <button type="button" class="details-toggle" aria-expanded={details} onClick={() => setDetails(!details)}>
        <Icon name="edit" size={18} /> {details ? 'Hide the details' : 'Change the details'}
      </button>

      {details && <div class="surface stack draft-card" style={{ '--stack': 'var(--s-5)' }}>
        <Unsure order={0}>
          <fieldset class="field">
            <legend class="label">What kind of plan</legend>
            <div class="row wrap seg">
              {[['found', 'Event'], ['hosted', 'At someone\'s'], ['quick', 'Quick one']].map(([k, label]) => (
                <button type="button" key={k} class="chip" aria-pressed={draft.kind === k} onClick={() => set({ kind: k, ...(k === 'hosted' && !draft.host ? { host: meId } : {}) })}>{label}</button>
              ))}
            </div>
          </fieldset>
        </Unsure>

        <Unsure low={isLow('title')} order={1}>
          <label class="field">
            <span class="label">Title</span>
            <input class="input" value={draft.title || ''} maxLength={80} onInput={(ev) => set({ title: ev.currentTarget.value })} />
          </label>
        </Unsure>

        <Unsure low={isLow('start')} order={2}>
          <div class="field">
            <span class="label" id="when-label">When</span>
            <div class="when-grid" role="group" aria-labelledby="when-label">
              <label class="mini when-date">
                <span>Day</span>
                <input class="input" type="date" value={s.date} onInput={(ev) => set({ start: fromParts(ev.currentTarget.value, s.time), end: draft.end ? fromParts(ev.currentTarget.value, e.time) : null })} />
              </label>
              <label class={`mini${isLow('start') ? ' guess' : ''}`}>
                <span>Starts</span>
                <input class="input" type="time" value={s.time} onInput={(ev) => set({ start: fromParts(s.date, ev.currentTarget.value) })} />
              </label>
              <label class={`mini${isLow('end') ? ' guess' : ''}`}>
                <span>Ends</span>
                <input class="input" type="time" value={e.time} onInput={(ev) => set({ end: ev.currentTarget.value ? fromParts(s.date, ev.currentTarget.value) : null })} />
              </label>
            </div>
          </div>
        </Unsure>

        <Unsure low={isLow('place')} order={3}>
          <div class="field">
            <label class="label" for="place-name">Where</label>
            <input id="place-name" class="input" value={draft.place.name || ''} placeholder="The place's name" onInput={(ev) => setPlace({ name: ev.currentTarget.value })} />
            <div style={{ marginTop: '8px' }}>
              <AreaInput
                value={{ label: draft.place.address || '' }}
                onChange={(a) => setPlace({ address: a.label, lat: a.lat ?? null, lon: a.lon ?? null })}
                placeholder="Address or area"
                label="Address or area"
              />
            </div>
            <div class="toggles">
              <label class="toggle">
                <input type="checkbox" checked={!!draft.place.outdoor} onChange={(ev) => setPlace({ outdoor: ev.currentTarget.checked })} />
                <span>It's outside, so watch the weather</span>
              </label>
              {draft.kind === 'hosted' && (
                <label class="toggle">
                  <input type="checkbox" checked={!!draft.place.private} onChange={(ev) => setPlace({ private: ev.currentTarget.checked })} />
                  <span>It's someone's home, so only the crew sees the address</span>
                </label>
              )}
            </div>
          </div>
        </Unsure>

        {draft.kind !== 'hosted' && (
          <Unsure low={isLow('price')} order={4}>
            <label class="field">
              <span class="label">Price</span>
              <input class="input" value={draft.price?.text || ''} placeholder={packUi().pricePlaceholder} onInput={(ev) => { const t = ev.currentTarget.value; set({ price: t ? { text: t, free: /^free/i.test(t.trim()) } : null }); }} />
            </label>
          </Unsure>
        )}

        {(draft.kind === 'hosted' || draft.bring?.length > 0) && (
          <Unsure order={5}>
            <div class="field">
              <span class="label" id="bring-label">Ask people to bring</span>
              {draft.bring?.length > 0 && (
                <ul class="row wrap area-chips" aria-labelledby="bring-label">
                  {draft.bring.map((b, i) => (
                    <li key={b + i} class="chip area-chip">
                      {b}
                      <button type="button" class="chip-x" aria-label={`Remove ${b}`} onClick={() => set({ bring: draft.bring.filter((_, j) => j !== i) })}><Icon name="close" size={16} /></button>
                    </li>
                  ))}
                </ul>
              )}
              <div class="row add-area">
                <input class="input grow" value={newItem} placeholder="Ice, cups, a speaker" onInput={(ev) => setNewItem(ev.currentTarget.value)} onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addBring(); } }} enterkeyhint="done" aria-label="Add something to bring" />
                <button type="button" class="btn secondary" onClick={addBring} disabled={!newItem.trim()}>Add</button>
              </div>
            </div>
          </Unsure>
        )}
      </div>}

      {error && <p class="error-text" role="alert">{error}</p>}

      <div class="bottom-bar">
        <div>
          <button class="btn primary block big" onClick={onPost} disabled={busy || !ok}>
            {busy ? <>Posting <Dots /></> : 'Post it'}
          </button>
        </div>
      </div>
    </div>
  );
}
