// The one-tap answer from the chat: /c/:slug/p/:id/in and /maybe, the links in every
// WhatsApp message. Tapping "I'm in" marks you going on this page, with no navigation: your
// face swings onto the branch. The first time on a phone it asks only for a name.
// The answer is sent by this page's script, never by the GET itself, so WhatsApp's link
// preview (which fetches the link but runs no script) can never answer for anyone.
import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../lib/api.js';
import { getCrew, myCrews } from '../lib/store.js';
import { dayLabel, timeRange, firstName } from '../lib/format.js';
import { haptic } from '../lib/spring.js';
import { whatsappUrl, planMessage, planLinks } from '../lib/share.js';
import { Branch } from '../ui/Branch.jsx';
import { Sloth } from '../ui/Sloth.jsx';
import { Icon, WhatsAppIcon } from '../ui/icons.jsx';
import { KindSticker, Dots, ErrorNote, Spinner } from '../ui/misc.jsx';
import { AreaAsk } from '../ui/AreaAsk.jsx';
import { NudgeAsk } from './PlanPage.jsx';
import { toast } from '../ui/toast.jsx';

const knownName = () => (myCrews().find((x) => x.memberName) || {}).memberName || '';

export function OneTap({ params, query, answer }) {
  const { slug, id } = params;
  const key = query.get('t');
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const [meId, setMeId] = useState(getCrew(slug)?.memberId || null);
  const [state, setState] = useState('loading'); // loading | ask | saving | done
  const [name, setName] = useState(knownName);
  const [swingId, setSwingId] = useState(null);
  const [area, setArea] = useState(null);
  const done = useRef(false);

  async function record(who, current) {
    setState('saving');
    try {
      if (current.rsvps?.[who] !== answer) await api.rsvp(slug, id, answer);
      const fresh = await api.getPlan(slug, id, key);
      setPlan(fresh);
      setArea(fresh.viewer?.area?.label || null);
      setState('done');
      if (answer === 'going' && current.rsvps?.[who] !== 'going') { haptic(12); setSwingId(who); }
    } catch (e) {
      setError(e);
      setState('ask');
    }
  }

  function load() {
    setError(null);
    api.getPlan(slug, id, key).then((p) => {
      setPlan(p);
      const who = p.viewer?.id || null;
      if (who) setMeId(who);
      // a phone that is already in the crew answers straight away
      if (who && !done.current) { done.current = true; record(who, p); } else if (!who) setState('ask');
    }).catch(setError);
  }
  useEffect(load, [slug, id, answer]);

  async function join(e) {
    e.preventDefault();
    const n = name.trim();
    if (!n) { setError(new Error("Add your name so the crew knows it's you.")); return; }
    setState('saving');
    setError(null);
    try {
      const res = await api.joinAs(slug, n, plan.crew?.name);
      setMeId(res.member.id);
      toast(`You're in the crew, ${firstName(res.member.name)}.`);
      await record(res.member.id, plan);
    } catch (err) {
      setError(err);
      setState('ask');
    }
  }

  async function undo() {
    await api.rsvp(slug, id, null).catch(() => {});
    location.replace(`/c/${slug}/p/${id}${key ? `?t=${encodeURIComponent(key)}` : ''}`);
  }

  if (error && !plan) {
    return (
      <div class="column screen-enter empty-page">
        <Sloth size={100} />
        <h1 class="display display-lg">Can't find that plan</h1>
        <ErrorNote error={error} onRetry={load} />
      </div>
    );
  }
  if (!plan) return <div class="column"><Spinner label="Loading the plan" /></div>;

  const members = plan.members || [];
  const byId = Object.fromEntries(members.map((m) => [m.id, m]));
  const going = Object.entries(plan.rsvps || {}).filter(([, v]) => v === 'going').map(([mid]) => byId[mid]).filter(Boolean);
  const host = plan.host && byId[plan.host];
  const when = `${dayLabel(plan.start)}, ${timeRange(plan.start, plan.end)}`;
  const links = planLinks(location.origin, slug, id, plan.crew?.inviteToken || key);
  const me = meId && byId[meId];
  const ok = state === 'done';
  const canRide = plan.place?.lat != null || !!plan.place?.near;
  const label = answer === 'going' ? "I'm in" : 'Maybe';

  return (
    <div class="column screen-enter one-tap">
      <a class="crumb" href={`/c/${slug}${key ? `?t=${encodeURIComponent(key)}` : ''}`}>{plan.crew?.name}</a>
      <header class="ot-plan">
        <KindSticker kind={plan.kind} host={host} />
        <h1 class="display display-lg">{plan.kind === 'ritual' && plan.place?.name ? plan.place.name : plan.title}</h1>
        <p class="ot-when">{when}{plan.kind !== 'ritual' && plan.place?.name ? ` at ${plan.place.name}` : ''}</p>
      </header>

      <section class="ot-branch" aria-label="Who's going">
        {going.length > 0 ? (
          <Branch going={going} meId={meId} swingId={swingId} onSwung={() => setSwingId(null)} />
        ) : (
          <div class="branch-empty">
            <svg width="100%" height="34" viewBox="0 0 300 34" preserveAspectRatio="none" aria-hidden="true"><path d="M-5 14 Q 150 24 305 14" /></svg>
          </div>
        )}
      </section>

      {ok ? (
        <div class="ot-done" role="status">
          <p class="display display-xl painted paint-in">{answer === 'going' ? `You're in${me ? `, ${firstName(me.name)}` : ''}.` : `Maybe it is${me ? `, ${firstName(me.name)}` : ''}.`}</p>
          <p class="muted">{going.length === 1 ? "You're the first on the branch." : `${going.length} going.`} <button class="link-btn" onClick={undo}>Change my answer</button></p>
          <div class="ot-actions">
            <a class="btn secondary block" href={links.url}>The plan, rides and the map</a>
            <a class="btn ghost block" href={whatsappUrl(planMessage({ title: plan.title, when, place: plan.place?.name, kind: plan.kind, links, mine: answer === 'going' ? 'going' : null }))} target="_blank" rel="noopener" data-external>
              <WhatsAppIcon size={20} /> Tell the chat
            </a>
            {answer === 'going' && api.eventIcsUrl(slug, plan) && (
              <a class="btn ghost block" href={api.eventIcsUrl(slug, plan)} download={`${plan.title}.ics`} data-external>
                <Icon name="calendar" size={20} /> Add to my calendar
              </a>
            )}
            {answer === 'going' && api.eventIcsUrl(slug, plan) && <p class="fine">It reminds you before it's time to leave.</p>}
          </div>
          {answer === 'going' && canRide && !area && <AreaAsk slug={slug} onSet={(l) => { setArea(l || 'set'); toast(l ? `Coming from ${l}` : 'Saved'); }} />}
          {answer === 'going' && <NudgeAsk slug={slug} />}
        </div>
      ) : state === 'ask' || state === 'saving' ? (
        <form class="ot-ask" onSubmit={meId ? (e) => { e.preventDefault(); record(meId, plan); } : join}>
          {!meId && (
            <label class="field">
              <span class="label">What should the crew call you?</span>
              <input class="input" value={name} onInput={(e) => setName(e.currentTarget.value)} autocomplete="given-name" autocapitalize="words" enterkeyhint="go" maxLength={40} placeholder="Your name" autoFocus={!name} />
            </label>
          )}
          {error && <p class="error-text" role="alert">{error.message}</p>}
          <button class="btn primary block big" type="submit" disabled={state === 'saving'}>
            {state === 'saving' ? <Dots /> : label}
          </button>
          {!meId && <p class="fine">No sign-up. This phone remembers you.</p>}
        </form>
      ) : (
        <Spinner label="Saving your answer" />
      )}
    </div>
  );
}

export const OneTapIn = (p) => <OneTap {...p} answer="going" />;
export const OneTapMaybe = (p) => <OneTap {...p} answer="maybe" />;
