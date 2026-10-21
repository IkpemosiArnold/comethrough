// Join: a name and an area. Then one gentle nudge opt-in, and the calendar as a secondary option.
import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api.js';
import { getCrew, saveCrew } from '../lib/store.js';
import { navigate } from '../lib/router.js';
import { firstName, nameList, rhythmText } from '../lib/format.js';
import { isIOS, isAndroid, isStandalone, canPush, notifyState, enablePush, copyText } from '../lib/platform.js';
import { Faces } from '../ui/Avatar.jsx';
import { AreaInput } from '../ui/AreaInput.jsx';
import { Icon } from '../ui/icons.jsx';
import { Dots, ErrorNote } from '../ui/misc.jsx';
import { Sloth } from '../ui/Sloth.jsx';
import { toast } from '../ui/toast.jsx';

export function Join({ params, query }) {
  const { slug } = params;
  const invite = query.get('t') || getCrew(slug)?.invite;
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [name, setName] = useState('');
  const [area, setArea] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [joined, setJoined] = useState(query.get('step') === 'done' ? { member: { name: 'Ife Adebayo' }, calendarUrl: `${location.origin}/cal/demo.ics`, webcalUrl: `webcal://${location.host}/cal/demo.ics` } : null);

  function load() {
    setLoadError(null);
    api.getCrew(slug, invite).then(setData).catch(setLoadError);
  }
  useEffect(load, [slug]);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) { setError('Add your name so the crew knows who is coming.'); return; }
    if (!area?.label?.trim()) { setError('Add your area. Just the neighbourhood is enough.'); return; }
    setBusy(true);
    setError(null);
    try {
      // A picked suggestion goes as { label, lat, lon }; typed text goes as a plain label.
      const res = await api.join(slug, { name: name.trim(), area: area.lat != null ? area : area.label.trim() }, invite);
      saveCrew(slug, {
        name: data?.crew?.name, memberId: res.member.id, memberName: res.member.name,
        memberToken: res.memberToken, calendarUrl: res.calendarUrl, webcalUrl: res.webcalUrl,
      });
      setJoined(res);
      window.scrollTo(0, 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (joined) return <Joined slug={slug} res={joined} next={safeNext(query.get('next'), slug)} />;

  if (loadError) {
    return (
      <div class="column screen-enter empty-page">
        <Sloth size={100} />
        <h1 class="display display-lg">Can't open this crew</h1>
        <ErrorNote error={loadError} onRetry={load} />
        <p class="muted">If the link came from the group chat, ask for it again. Links stop working if the crew is deleted.</p>
      </div>
    );
  }

  const crew = data?.crew;
  const members = data?.members || [];
  return (
    <div class="column screen-enter join">
      <header class="join-head">
        <p class="kicker">You've been asked to come through</p>
        {crew ? <h1 class="display display-xl painted">{crew.name}</h1> : <div class="skeleton" style={{ height: '52px', width: '70%' }} />}
        {members.length > 0 && (
          <div class="row join-who">
            <Faces members={members} max={5} />
            <p class="small muted">{nameList(members.map((m) => firstName(m.name)), 2)} {members.length === 1 ? 'is' : 'are'} in</p>
          </div>
        )}
        {crew && (
          <ul class="crew-facts">
            {crew.vibe && <li>{crew.vibe}</li>}
            {crew.rhythm && <li>{rhythmText(crew.rhythm)}</li>}
          </ul>
        )}
      </header>

      <form class="surface stack join-form" onSubmit={submit} style={{ '--stack': 'var(--s-5)' }}>
        <label class="field">
          <span class="label">Your name</span>
          <input class="input" value={name} onInput={(e) => setName(e.currentTarget.value)} autocomplete="given-name" autocapitalize="words" enterkeyhint="next" maxLength={40} placeholder="What the crew calls you" />
        </label>
        <div class="field">
          <label class="label" for="join-area">Your area</label>
          <AreaInput id="join-area" value={area} onChange={setArea} />
          <p class="hint">Just the neighbourhood, for sorting rides. Nobody sees your address.</p>
        </div>
        {error && <p class="error-text" role="alert">{error}</p>}
        <button class="btn primary block big" type="submit" disabled={busy}>
          {busy ? <>Joining <Dots /></> : 'Join the crew'}
        </button>
        <p class="fine">No account and no phone number. This phone remembers you.</p>
      </form>
    </div>
  );
}

function safeNext(next, slug) {
  return next && next.startsWith(`/c/${slug}/`) ? next : `/c/${slug}`;
}

function Joined({ slug, res, next }) {
  const [perm, setPerm] = useState(notifyState());
  const [asking, setAsking] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const iosNeedsInstall = isIOS && !isStandalone;
  const showNudge = canPush || iosNeedsInstall;

  async function nudge() {
    setAsking(true);
    const r = await enablePush(api, slug);
    setPerm(r);
    setAsking(false);
    if (r === 'granted') toast('Nudges are on');
  }
  async function copyCal() {
    const ok = await copyText(res.calendarUrl);
    toast(ok ? 'Calendar link copied' : "Couldn't copy. Press and hold the link instead.");
  }
  const googleAdd = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(res.webcalUrl || res.calendarUrl)}`;

  return (
    <div class="column screen-enter joined has-bar">
      <div class="joined-head">
        <Sloth size={92} mood="awake" />
        <h1 class="display display-xl painted">You're in, {firstName(res.member.name)}</h1>
        <p class="lede">When a plan drops, tap once if you're coming. That's the whole job.</p>
      </div>

      {showNudge && !skipped && (
        <section class="nudge surface" aria-labelledby="nudge-title">
          <div class="nudge-icon"><Icon name="bell" size={26} /></div>
          <h2 id="nudge-title" class="display display-md">Get a nudge when plans drop?</h2>
          {perm === 'granted' ? (
            <p class="nudge-on"><Icon name="check" size={20} /> Nudges are on. You'll hear about new plans and rain.</p>
          ) : perm === 'denied' ? (
            <p class="muted">Nudges are blocked for this site in your browser settings. You can still check here, and plans land in the group chat too.</p>
          ) : iosNeedsInstall ? (
            <>
              <p class="muted">On iPhone, nudges only work from the Home Screen. It takes ten seconds:</p>
              <ol class="ios-steps">
                <li>Tap <span class="inline-icon"><Icon name="share" size={18} label="Share" /></span> in Safari's toolbar.</li>
                <li>Tap <b>Add to Home Screen</b>.</li>
                <li>Open Come Through from your Home Screen and tap <b>Yes, nudge me</b>.</li>
              </ol>
              <button class="btn ghost" onClick={() => setSkipped(true)}>Maybe later</button>
            </>
          ) : (
            <>
              <p class="muted">One nudge when someone posts a plan, and one if rain moves in on a plan you're going to. Nothing else.</p>
              <div class="row nudge-actions">
                <button class="btn primary" onClick={nudge} disabled={asking}>{asking ? <>Asking <Dots /></> : 'Yes, nudge me'}</button>
                <button class="btn ghost" onClick={() => setSkipped(true)}>Not now</button>
              </div>
            </>
          )}
        </section>
      )}

      <details class="cal-more">
        <summary>
          <Icon name="calendar" size={20} />
          <span class="grow">Put every crew plan in your calendar</span>
          <Icon name="back" size={18} class="chev" />
        </summary>
        <div class="cal-body stack" style={{ '--stack': 'var(--s-3)' }}>
          <p class="muted small">You don't need this. When you tap I'm going on a plan, you can add that one plan to your calendar. This is for people who want all of them.</p>
          {isIOS ? (
            <a class="btn secondary block" href={res.webcalUrl} data-external>Subscribe on this iPhone</a>
          ) : isAndroid ? (
            <>
              <p class="small">Google Calendar's Android app can't subscribe to a calendar. Copy the link, then on a computer open calendar.google.com, go to Other calendars, and choose From URL.</p>
              <button class="btn secondary block" onClick={copyCal}><Icon name="copy" size={20} /> Copy calendar link</button>
            </>
          ) : (
            <>
              <a class="btn secondary block" href={googleAdd} target="_blank" rel="noopener">Add to Google Calendar</a>
              <a class="btn ghost block" href={res.webcalUrl} data-external>Apple Calendar or Outlook</a>
              <button class="btn ghost block" onClick={copyCal}><Icon name="copy" size={20} /> Copy calendar link</button>
            </>
          )}
          <p class="fine">Subscribed calendars can take hours to update. This page and the nudges are always current.</p>
        </div>
      </details>

      <div class="bottom-bar">
        <div>
          <button class="btn primary block big" onClick={() => navigate(next, { replace: true })}>
            See the plans
          </button>
        </div>
      </div>
    </div>
  );
}
