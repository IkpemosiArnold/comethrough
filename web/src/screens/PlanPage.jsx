// The plan page. The signature moment lives here: tap "I'm going", your face swings onto
// the branch with everyone else, the branch dips under the weight, your ride pod forms,
// and the button turns into "Add to my calendar".
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, MOCK } from '../lib/api.js';
import { getCrew } from '../lib/store.js';
import { navigate } from '../lib/router.js';
import { dayLabel, timeRange, time, firstName, nameList, weekday, dayParts } from '../lib/format.js';
import { copyText, whatsappUrl, isIOS, isStandalone, canPush, notifyState, enablePush } from '../lib/platform.js';
import { haptic, prefersReducedMotion, springAnimate } from '../lib/spring.js';
import { Avatar, Faces } from '../ui/Avatar.jsx';
import { Branch } from '../ui/Branch.jsx';
import { MapSnippet, mapsUrl } from '../ui/MapSnippet.jsx';
import { Icon, WhatsAppIcon } from '../ui/icons.jsx';
import { weatherIcon } from '../ui/Weather.jsx';
import { Sloth } from '../ui/Sloth.jsx';
import { TopBar, KindSticker, ErrorNote, Spinner } from '../ui/misc.jsx';
import { toast } from '../ui/toast.jsx';

export function PlanPage({ params, query }) {
  const { slug, id } = params;
  const mine = getCrew(slug);
  const meId = mine?.memberId || null;
  const [plan, setPlan] = useState(null);
  const [pods, setPods] = useState(null);
  const [error, setError] = useState(null);
  const [swingId, setSwingId] = useState(null);
  const [menu, setMenu] = useState(false);
  const [freshPod, setFreshPod] = useState(false);
  const branchRef = useRef(null);

  function load() {
    setError(null);
    api.getPlan(slug, id).then(setPlan).catch(setError);
    api.pods(slug, id).then((r) => setPods(r.pods)).catch(() => setPods([]));
  }
  useEffect(load, [slug, id]);
  useEffect(() => {
    if (query.get('posted')) toast('Posted. The crew can see it now.', 3000);
  }, []);

  if (error && !plan) {
    return (
      <div class="column screen-enter">
        <TopBar backTo={`/c/${slug}`} title="" />
        <div class="empty-page">
          <Sloth size={100} />
          <h1 class="display display-lg">Can't find that plan</h1>
          <ErrorNote error={error} onRetry={load} />
          <a class="btn secondary" href={`/c/${slug}`}>Back to the crew</a>
        </div>
      </div>
    );
  }
  if (!plan) return <div class="column"><TopBar backTo={`/c/${slug}`} title="" /><Spinner label="Loading the plan" /></div>;

  const members = plan.members || [];
  const byId = Object.fromEntries(members.map((m) => [m.id, m]));
  const rsvps = plan.rsvps || {};
  const going = Object.entries(rsvps).filter(([, v]) => v === 'going').map(([mid]) => byId[mid]).filter(Boolean);
  const maybe = Object.entries(rsvps).filter(([, v]) => v === 'maybe').map(([mid]) => byId[mid]).filter(Boolean);
  const my = meId ? rsvps[meId] || null : null;
  const host = plan.host && byId[plan.host];
  const crewName = plan.crew?.name || mine?.name || 'the crew';
  const invite = mine?.invite || plan.crew?.inviteToken;
  const planUrl = `${location.origin}/c/${slug}/p/${id}${invite ? `?t=${encodeURIComponent(invite)}` : ''}`;
  const when = `${dayLabel(plan.start)}, ${timeRange(plan.start, plan.end)}`;
  const shareText = `${plan.title}\n${when}${plan.place?.name ? `, ${plan.place.name}` : ''}\nCome through: ${planUrl}`;

  async function answer(value) {
    if (!meId) return;
    setMenu(false);
    const prev = my;
    const next = value === prev ? null : value;
    const nextRsvps = { ...rsvps };
    if (next) nextRsvps[meId] = next; else delete nextRsvps[meId];
    setPlan({ ...plan, rsvps: nextRsvps });
    if (next === 'going') {
      haptic(12);
      const el = branchRef.current;
      const r = el && el.getBoundingClientRect();
      const visible = r && r.top > 60 && r.bottom < window.innerHeight - 90;
      if (el && !visible) {
        el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
        setTimeout(() => setSwingId(meId), 360);
      } else setSwingId(meId);
    } else setSwingId(null);
    try {
      await api.rsvp(slug, id, next);
      const p = await api.pods(slug, id);
      setFreshPod(next === 'going');
      setPods(p.pods);
    } catch (e) {
      setPlan({ ...plan, rsvps });
      toast(e.message || "Couldn't save that. Try again.");
    }
  }

  async function copyBolt(text) {
    const ok = await copyText(text);
    toast(ok ? 'Address copied. Paste it in Bolt.' : "Couldn't copy the address");
  }

  const myPod = pods && pods.find((p) => p.memberIds.includes(meId));
  const otherPods = (pods || []).filter((p) => p !== myPod);
  const w = plan.weather;
  const outdoor = plan.place?.outdoor;
  // rides need a pin, or at least a rough spot: the neighbourhood of an address that is not
  // on the map, or a host's own neighbourhood
  const canRide = plan.place?.lat != null || !!plan.place?.near || (plan.kind === 'hosted' && !!plan.host) || (pods || []).some((p) => p.travelMin != null);

  return (
    <div class={`column plan-page screen-enter has-bar kind-${plan.kind}`}>
      <TopBar
        backTo={`/c/${slug}`}
        title={<a class="crumb" href={`/c/${slug}`}>{crewName}</a>}
        right={
          <a class="icon-btn wa-btn" href={whatsappUrl(shareText)} target="_blank" rel="noopener" data-external aria-label="Share this plan on WhatsApp">
            <WhatsAppIcon size={24} />
          </a>
        }
      />

      {plan.offline && <p class="offline-note">You're offline, so this is what the phone saw last. <button class="link-btn" onClick={load}>Refresh</button></p>}

      <header class="plan-head">
        <div class="row plan-head-tags">
          <KindSticker kind={plan.kind} />
          {plan.status === 'moved' && <span class="sticker sticker-warn">Moved</span>}
          {plan.status === 'cancelled' && <span class="sticker sticker-warn">Called off</span>}
        </div>
        <h1 class="display display-lg plan-h1">{plan.title}</h1>
        <p class="plan-when"><Icon name="calendar" size={20} /> <span>{when}</span></p>
        {plan.invite && <p class="plan-invite">{plan.invite}</p>}
      </header>

      {plan.rainPlan && plan.status !== 'cancelled' && (
        <div class={`rain-plan rain-plan-${plan.rainPlan.kind}`} role="note">
          <Icon name="rain" size={22} />
          <p class="small">{plan.rainPlan.note}</p>
        </div>
      )}

      {w && outdoor && !w.ok && (
        <div class="rain-warn" role="note">
          <Icon name="rain" size={22} />
          <div class="grow">
            <p class="strong">{w.summary}</p>
            <p class="small">{w.rainProb}% chance of rain. Worth a plan B.</p>
            <a class="btn secondary small-btn rain-btn" href={plan.headsUp?.whatsappUrl || whatsappUrl(`Heads up: ${w.summary.toLowerCase()} for ${plan.title}. ${planUrl}`)} target="_blank" rel="noopener" data-external><WhatsAppIcon size={18} /> Warn the crew</a>
          </div>
        </div>
      )}

      {plan.place?.lat != null && (
        <section class="place" aria-label="Where">
          <MapSnippet place={plan.place} />
          <div class="place-text">
            <p class="strong">{plan.place.name}</p>
            {plan.place.address && <p class="muted small">{plan.place.address}</p>}
            {plan.place.private && <p class="faint tiny">Only the crew can see this address.</p>}
          </div>
          <a class="btn ghost small-btn" href={mapsUrl(plan.place)} target="_blank" rel="noopener">Directions</a>
        </section>
      )}
      {plan.place?.lat == null && plan.place?.name && (
        <div class="place-text-only">
          <Icon name="pin" size={20} />
          <div>
            <p>{plan.place.name}{plan.place.address ? `, ${plan.place.address}` : ''}</p>
            {plan.place.hidden && !meId && <p class="small muted">The address shows once you join the crew.</p>}
            {plan.place.near && <p class="small muted">Not on the map yet, so ride times and weather are guessed from {plan.place.near.label}.</p>}
          </div>
        </div>
      )}

      <ul class="facts">
        {plan.price && (
          <li><Icon name="ticket" size={20} /><span>{plan.price.free ? (plan.price.text || 'Free') : plan.price.text}</span></li>
        )}
        {w && outdoor && (
          <li class={w.ok ? '' : 'bad'}><Icon name={weatherIcon(w)} size={20} /><span>{Math.round(w.tempC)}°, {w.ok ? w.summary.replace(/^./, (c) => c.toLowerCase()) : `${w.rainProb}% chance of rain`}</span></li>
        )}
        {host && (
          <li><Avatar member={host} /><span>{host.id === meId ? "You're hosting" : `${firstName(host.name)} is hosting`}</span></li>
        )}
      </ul>

      <section class="who" aria-labelledby="who-title" ref={branchRef}>
        <div class="row spread">
          <h2 id="who-title" class="section-label">Who's going</h2>
          <span class="who-count">{going.length ? `${going.length} going` : ''}</span>
        </div>
        {going.length > 0 ? (
          <Branch going={going} meId={meId} swingId={swingId} onSwung={() => setSwingId(null)} />
        ) : (
          <div class="branch-empty">
            <svg width="100%" height="34" viewBox="0 0 300 34" preserveAspectRatio="none" aria-hidden="true"><path d="M-5 14 Q 150 24 305 14" /></svg>
            <p class="muted">Nobody on the branch yet. Be the first?</p>
          </div>
        )}
        {maybe.length > 0 && (
          <p class="maybes"><Faces members={maybe} max={3} size="" /> <span>{nameList(maybe.map((m) => (m.id === meId ? 'You' : firstName(m.name))), 2)} {maybe.length === 1 && maybe[0].id !== meId ? 'says' : 'say'} maybe</span></p>
        )}
        <p class="quiet-no">Can't make it? No need to say anything.</p>
      </section>

      {canRide && (
        <section class="rides" aria-labelledby="rides-title">
          <h2 id="rides-title" class="section-label">Rides</h2>
          {my === 'going' && myPod && (
            <PodCard pod={myPod} byId={byId} meId={meId} fresh={freshPod} onBolt={copyBolt} />
          )}
          {my === 'going' && pods && !myPod && (
            <div class="pod pod-solo">
              <p>You're the first from your side. When someone near you says yes, you'll share a ride.</p>
            </div>
          )}
          {my !== 'going' && (
            <p class="muted rides-hint">Tap I'm going and you'll be grouped with people near you, with a time to leave.</p>
          )}
          {otherPods.length > 0 && (
            <ul class="pod-others">
              {otherPods.map((p) => (
                <li key={p.fromLabel}>
                  <Faces members={p.memberIds.map((m) => byId[m]).filter(Boolean)} max={3} />
                  <span>From {p.fromLabel}{p.leaveBy ? <>, leave by <b>{time(p.leaveBy)}</b></> : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {my === 'going' && <NudgeAsk slug={slug} />}

      {plan.why && (
        <section class="why" aria-labelledby="why-title">
          <div class="why-sloth" aria-hidden="true"><Sloth size={58} branch={false} mood="awake" /></div>
          <h2 id="why-title" class="why-title">Why this place</h2>
          <p>{plan.why}</p>
          {plan.kind === 'ritual' && (
            <p class="fine why-privacy">Gemma, Google's open model, wrote the sloth's words through Google's free API. We sent it the place, the weather, your crew's vibe words and the minutes from each neighbourhood, with no names. Google may use that to improve its products. Your crew list and locations stay with Come Through.</p>
          )}
        </section>
      )}

      {plan.bring?.length > 0 && (
        <section class="bring" aria-labelledby="bring-title">
          <h2 id="bring-title" class="section-label">Bring</h2>
          <ul class="row wrap bring-list">
            {plan.bring.map((b) => <li key={b} class="chip"><Icon name="bag" size={16} /> {b}</li>)}
          </ul>
        </section>
      )}

      {(plan.source?.imageUrl || plan.source?.url) && (
        <section class="source">
          {plan.source.imageUrl && <img class="source-flyer" src={plan.source.imageUrl} alt={`Flyer for ${plan.title}`} width="150" height="194" loading="lazy" />}
          <div>
            <p class="small muted">{plan.source.image ? 'Gemma read this from a flyer.' : 'Gemma read this from a link.'} Check the details with the organiser.</p>
            {plan.source.url && <a class="small" href={plan.source.url} target="_blank" rel="noopener">See the original</a>}
          </div>
        </section>
      )}

      <div class="plan-share">
        <a class="btn whatsapp block" href={whatsappUrl(shareText)} target="_blank" rel="noopener" data-external>
          <WhatsAppIcon /> Share in the group chat
        </a>
      </div>

      <ActionBar
        my={my}
        meId={meId}
        menu={menu}
        setMenu={setMenu}
        answer={answer}
        icsUrl={api.eventIcsUrl(slug, plan)}
        joinHref={`/c/${slug}/join${invite ? `?t=${encodeURIComponent(invite)}&` : '?'}next=${encodeURIComponent(`/c/${slug}/p/${id}`)}`}
        crewName={crewName}
        fileName={`${plan.title}.ics`}
      />
    </div>
  );
}

// Bolt documents no deep link with a destination, so we only open the app (Android) or its site.
const BOLT_URL = /Android/i.test(navigator.userAgent)
  ? 'intent://#Intent;scheme=bolt;package=ee.mtakso.client;S.browser_fallback_url=https%3A%2F%2Fbolt.eu;end'
  : 'https://bolt.eu';

// Once per device, right after the first "I'm going": the push opt-in, or the iPhone install hint.
function NudgeAsk({ slug }) {
  const [state, setState] = useState(() => {
    try { if (localStorage.getItem('ct.nudgeAsked')) return 'hidden'; } catch { /* ignore */ }
    if (notifyState() === 'granted' || notifyState() === 'denied') return 'hidden';
    if (isIOS && !isStandalone) return 'ios';
    return canPush ? 'ask' : 'hidden';
  });
  if (state === 'hidden') return null;
  const done = () => { try { localStorage.setItem('ct.nudgeAsked', '1'); } catch { /* ignore */ } setState('hidden'); };
  async function yes() {
    setState('asking');
    const r = await enablePush(api, slug);
    if (r === 'granted') toast('Nudges are on');
    done();
  }
  return (
    <aside class="nudge-inline" aria-label="Notifications">
      <Icon name="bell" size={22} />
      <div class="grow">
        {state === 'ios' ? (
          <p><b>Want a nudge if this changes?</b> On iPhone, add Come Through to your Home Screen first: tap Share, then Add to Home Screen.</p>
        ) : (
          <p><b>Get a nudge if this plan changes?</b> Rain, a new time, or your ride.</p>
        )}
        <div class="row nudge-actions">
          {state !== 'ios' && <button class="btn primary" onClick={yes} disabled={state === 'asking'}>Yes, nudge me</button>}
          <button class="btn ghost" onClick={done}>{state === 'ios' ? 'Got it' : 'Not now'}</button>
        </div>
      </div>
    </aside>
  );
}

function PodCard({ pod, byId, meId, fresh, onBolt }) {
  const ref = useRef(null);
  const [how, setHow] = useState(false);
  const people = pod.memberIds.map((m, i) => byId[m] || { id: m, name: pod.names?.[i] || '?' });
  const others = people.filter((p) => p.id !== meId);
  useEffect(() => {
    if (!fresh || !ref.current || prefersReducedMotion()) return;
    ref.current.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: 450, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'backwards' });
    const me = ref.current.querySelector('.pod-me');
    me && springAnimate(me, [{ transform: 'scale(0.6)' }, { transform: 'scale(1)' }], { damping: 0.55, response: 0.5 }, { delay: 620 });
  }, [fresh, pod.fromLabel]);
  return (
    <div class="pod pod-mine" ref={ref}>
      <div class="row pod-top">
        <div class="faces pod-faces">
          {people.slice(0, 4).map((p) => <Avatar key={p.id} member={p} size="lg" ring="var(--paper)" class={p.id === meId ? 'pod-me' : ''} />)}
          {people.length > 4 && <span class="more">+{people.length - 4}</span>}
        </div>
      </div>
      {pod.leaveBy
        ? <p class="pod-leave">Leave {pod.fromLabel} by <span class="display">{time(pod.leaveBy)}</span></p>
        : <p class="pod-leave">From {pod.fromLabel}</p>}
      <p class="muted small">
        {pod.travelMin != null ? <>About {pod.travelMin} min, an estimate</> : 'No ride time yet: the place is not on the map'}{others.length ? `, riding with ${nameList(others.map((o) => firstName(o.name)), 2)}` : ". Nobody near you yet, so it's a solo ride for now"}.
        {pod.crossesLagoon ? ' The time allows for the bridge.' : ''}
        {pod.estimate?.text && (
          <> <button type="button" class="link-btn how-btn" aria-expanded={how} onClick={() => setHow(!how)}>{how ? 'Hide' : 'How we guess'}</button></>
        )}
      </p>
      {how && pod.estimate?.text && <p class="small how-text">{pod.estimate.text}</p>}
      <div class="pod-actions">
        {pod.uberUrl && <a class="btn secondary" href={pod.uberUrl} target="_blank" rel="noopener" data-external><Icon name="car" size={20} /> Book Uber</a>}
        <div class="bolt-pair">
          <button class="btn secondary grow" onClick={() => onBolt(pod.boltText)}><Icon name="copy" size={20} /> Copy address</button>
          <a class="btn ghost" href={BOLT_URL} target="_blank" rel="noopener" data-external>Open Bolt</a>
        </div>
      </div>
    </div>
  );
}

function ActionBar({ my, meId, menu, setMenu, answer, icsUrl, joinHref, crewName, fileName }) {
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menu) return;
    // Focus moves into the menu, arrows move between items, Escape returns to the pill.
    const items = () => [...(menuRef.current?.querySelectorAll('[role=menuitem]') || [])];
    items()[0]?.focus();
    const close = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false); };
    const esc = (e) => {
      const list = items();
      const i = list.indexOf(document.activeElement);
      if (e.key === 'Escape') { setMenu(false); menuRef.current?.querySelector('.going-pill')?.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [menu]);

  if (!meId) {
    return (
      <div class="bottom-bar">
        <div>
          <a class="btn primary block big" href={joinHref}>Join {crewName} to say you're coming</a>
        </div>
      </div>
    );
  }

  return (
    <div class="bottom-bar">
      <div class={`action-bar state-${my || 'none'}`} ref={menuRef}>
        {my === 'going' ? (
          <>
            <button class="btn secondary going-pill" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-haspopup="menu">
              <Icon name="check" size={20} /> Going
            </button>
            <a class="btn primary big grow cal-btn" href={icsUrl} download={fileName} data-external>
              <Icon name="calendar" size={22} /> Add to my calendar
            </a>
            {menu && (
              <div class="answer-menu" role="menu">
                <button role="menuitem" onClick={() => answer('maybe')}>Make it a maybe</button>
                <button role="menuitem" onClick={() => answer(null)}>I can't make it any more</button>
              </div>
            )}
          </>
        ) : (
          <>
            <button class="btn primary big grow going-btn" onClick={() => answer('going')}>I'm going</button>
            <button class={`btn secondary big maybe-btn${my === 'maybe' ? ' on' : ''}`} onClick={() => answer('maybe')} aria-pressed={my === 'maybe'}>
              {my === 'maybe' && <Icon name="check" size={20} />} Maybe
            </button>
          </>
        )}
      </div>
    </div>
  );
}
