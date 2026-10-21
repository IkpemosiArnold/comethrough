// The plan page. The signature moment lives here: tap "I'm going", your face swings onto
// the branch with everyone else, the branch dips under the weight, your ride pod forms,
// and the button turns into "Tell the crew" on WhatsApp (the calendar is an extra below).
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, MOCK } from '../lib/api.js';
import { getCrew } from '../lib/store.js';
import { packUi } from '../lib/place.js';
import { navigate } from '../lib/router.js';
import { dayLabel, timeRange, time, firstName, nameList, weekday, dayParts } from '../lib/format.js';
import { copyText, isAndroid, isIOS, isStandalone, canPush, notifyState, enablePush } from '../lib/platform.js';
import { whatsappUrl, planMessage } from '../lib/share.js';
import { haptic, prefersReducedMotion, springAnimate } from '../lib/spring.js';
import { Avatar, Faces } from '../ui/Avatar.jsx';
import { Branch } from '../ui/Branch.jsx';
import { MapSnippet, mapsUrl } from '../ui/MapSnippet.jsx';
import { Icon, WhatsAppIcon } from '../ui/icons.jsx';
import { weatherIcon, weatherWords } from '../ui/Weather.jsx';
import { Sloth } from '../ui/Sloth.jsx';
import { TopBar, KindSticker, ErrorNote, Spinner } from '../ui/misc.jsx';
import { toast } from '../ui/toast.jsx';
import { NameSheet } from '../ui/NameSheet.jsx';
import { AreaAsk } from '../ui/AreaAsk.jsx';

export function PlanPage({ params, query }) {
  const { slug, id } = params;
  const key = query.get('t');
  const mine = getCrew(slug);
  // a guest becomes a member at their first "I'm going", on this same page
  const [meId, setMeId] = useState(mine?.memberId || null);
  const [ask, setAsk] = useState(null); // the answer waiting for a name: 'going' | 'maybe'
  const [plan, setPlan] = useState(null);
  const [pods, setPods] = useState(null);
  const [unplaced, setUnplaced] = useState([]);
  const [myArea, setMyArea] = useState(null);
  // Lagos's ride apps until the server says otherwise; a crew elsewhere gets none, and directions
  const [rides, setRides] = useState(() => (packUi().directions ? [] : FALLBACK_RIDES));
  const [directions, setDirections] = useState(null);
  const [error, setError] = useState(null);
  const [swingId, setSwingId] = useState(null);
  const [menu, setMenu] = useState(false);
  const [freshPod, setFreshPod] = useState(false);
  const branchRef = useRef(null);

  function load() {
    setError(null);
    api.getPlan(slug, id, key).then((p) => {
      setPlan(p);
      if (p.viewer?.id) { setMeId(p.viewer.id); setMyArea(p.viewer.area?.label || null); }
      loadPods();
    }).catch(setError);
  }
  function loadPods() {
    if (!getCrew(slug)?.memberToken) { setPods([]); return Promise.resolve(); }
    return api.pods(slug, id).then((r) => { setPods(r.pods); setUnplaced(r.unplaced || []); if (r.rides) setRides(r.rides); setDirections(r.directions); }).catch(() => setPods([]));
  }
  useEffect(load, [slug, id]);
  const [posted, setPosted] = useState(() => !!query.get('posted'));

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
  const invite = plan.crew?.inviteToken || mine?.invite;
  const planUrl = `${location.origin}/c/${slug}/p/${id}${invite ? `?t=${encodeURIComponent(invite)}` : ''}`;
  const when = `${dayLabel(plan.start)}, ${timeRange(plan.start, plan.end)}`;
  const msg = { title: plan.title, when, place: plan.place?.name, url: planUrl, kind: plan.kind };
  const shareText = planMessage(msg);
  const goingText = planMessage({ ...msg, mine: 'going' });

  async function answer(value, who = meId) {
    if (!who) { setAsk(value); return; }
    setMenu(false);
    const prev = who === meId ? my : null;
    const next = value === prev ? null : value;
    const nextRsvps = { ...rsvps };
    if (next) nextRsvps[who] = next; else delete nextRsvps[who];
    setPlan({ ...plan, rsvps: nextRsvps });
    if (next === 'going') {
      haptic(12);
      const el = branchRef.current;
      const r = el && el.getBoundingClientRect();
      const visible = r && r.top > 60 && r.bottom < window.innerHeight - 90;
      if (el && !visible) {
        el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
        setTimeout(() => setSwingId(who), 360);
      } else setSwingId(who);
    } else setSwingId(null);
    try {
      await api.rsvp(slug, id, next);
      setFreshPod(next === 'going');
      await loadPods();
    } catch (e) {
      setPlan({ ...plan, rsvps });
      toast(e.message || "Couldn't save that. Try again.");
    }
  }

  async function copyAddress(text) {
    const ok = await copyText(text);
    toast(ok ? 'Address copied. Paste it as your drop-off.' : "Couldn't copy the address");
  }

  // a new friend joins with a name, and the plan needs them in its member list for the branch
  function joined(res, first) {
    const m = { id: res.member.id, name: res.member.name, area: { label: null } };
    plan.members = [...(plan.members || []).filter((x) => x.id !== m.id), m];
    setMeId(m.id);
    setMyArea(null);
    const value = ask;
    setAsk(null);
    toast(`You're in, ${first}.`);
    answer(value, m.id);
  }
  const needsArea = my === 'going' && pods !== null && !myArea && (unplaced.some((u) => u.id === meId) || !(pods || []).some((p) => p.memberIds.includes(meId)));
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

      {posted && (
        <aside class="posted-card" aria-label="Tell the crew">
          <p><b>Posted.</b> Tell the group chat so people see it.</p>
          <a class="btn whatsapp block" href={whatsappUrl(planMessage({ ...msg, posted: true }))} target="_blank" rel="noopener" data-external onClick={() => setPosted(false)}>
            <WhatsAppIcon /> Tell the crew on WhatsApp
          </a>
        </aside>
      )}

      {plan.offline && <p class="offline-note">You're offline, so this is what the phone saw last. <button class="link-btn" onClick={load}>Refresh</button></p>}

      <header class="plan-head">
        <div class="row plan-head-tags">
          <KindSticker kind={plan.kind} host={host} />
          {plan.status === 'moved' && <span class="sticker sticker-warn">Moved</span>}
          {plan.status === 'cancelled' && <span class="sticker sticker-warn">Called off</span>}
        </div>
        <h1 class="display display-lg plan-h1">{plan.title}</h1>
        <p class="plan-when"><Icon name="calendar" size={20} /> <span>{when}</span></p>
        {plan.invite && <p class="plan-invite">{plan.invite}</p>}
      </header>

      {plan.rainPlan && (plan.status !== 'cancelled' || plan.rainPlan.kind === 'skip') && (
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
            <p class="small">{w.rainProb}% chance of rain. Have a backup spot.</p>
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
        {!plan.price && plan.place?.entry && (
          <li>
            <Icon name="ticket" size={20} />
            <span>
              {entryWords(plan.place.entry)}
              {plan.place.entry.source?.url && <> <a class="fine entry-src" href={plan.place.entry.source.url} target="_blank" rel="noopener">{plan.place.entry.source.publisher || 'Source'}{plan.place.entry.source.published ? `, ${monthYear(plan.place.entry.source.published)}` : ''}</a></>}
            </span>
          </li>
        )}
        {w && outdoor && (
          <li class={w.ok ? '' : 'bad'}><Icon name={weatherIcon(w)} size={20} /><span>{weatherWords(w)}</span></li>
        )}
        {host && (
          <li><Avatar member={host} /><span>{host.id === meId ? "You're hosting" : `${firstName(host.name)} is hosting`}</span></li>
        )}
      </ul>
      {w && outdoor && <p class="fine wx-credit">Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a></p>}

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
          {needsArea && (
            <AreaAsk slug={slug} onSet={(label) => { setMyArea(label || 'set'); toast(label ? `Coming from ${label}` : 'Saved'); loadPods(); }} />
          )}
          {!needsArea && my === 'going' && myPod && (
            <PodCard pod={myPod} byId={byId} meId={meId} fresh={freshPod} onCopy={copyAddress} rides={rides} directions={directions} host={host} />
          )}
          {!needsArea && my === 'going' && pods && !myPod && (
            <div class="pod pod-solo">
              <p>You're the first from your side. When someone near you says yes, you'll share a ride.</p>
            </div>
          )}
          {my !== 'going' && (
            <p class="muted rides-hint">Tap I'm going to get a time to leave and people to ride with.</p>
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
            <p class="fine why-privacy">Gemma, Google's open model, wrote this from the place, the weather and travel times. No names went to Google.</p>
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
            <p class="small muted">{plan.source.image ? 'Gemma read this from a flyer' : 'Gemma read this from a link'}, so check the details with the organiser.</p>
            {plan.source.url && <a class="small" href={plan.source.url} target="_blank" rel="noopener">See the original</a>}
          </div>
        </section>
      )}

      <div class="plan-share">
        {my !== 'going' && (
          <a class="btn whatsapp block" href={whatsappUrl(shareText)} target="_blank" rel="noopener" data-external>
            <WhatsAppIcon /> Share in the group chat
          </a>
        )}
        {my === 'going' && api.eventIcsUrl(slug, plan) && (
          <a class="btn ghost block cal-extra" href={api.eventIcsUrl(slug, plan)} download={`${plan.title}.ics`} data-external>
            <Icon name="calendar" size={20} /> Add to my calendar
          </a>
        )}
      </div>

      {plan.rainPlan?.kind !== 'skip' && plan.status !== 'cancelled' && <ActionBar
        my={my}
        menu={menu}
        setMenu={setMenu}
        answer={answer}
        waUrl={whatsappUrl(goingText)}
      />}
      {ask && <NameSheet slug={slug} crewName={crewName} action={ask === 'maybe' ? 'Maybe' : "I'm going"} onClose={() => setAsk(null)} onJoined={joined} />}
    </div>
  );
}

// The ride apps that work in Lagos, Bolt first (the server sends the same list with the pods;
// src/packs/lagos/rides.mjs has the sources). A crew in a city with no pack gets no ride app
// named, only "Get directions" and "Copy address". None documents a link that fills in the drop-off, so a
// button opens the app's store page on a phone (it says "Open" when the app is installed) and
// the Lagos web page elsewhere, and "Copy address" does the rest.
const FALLBACK_RIDES = [
  { id: 'bolt', name: 'Bolt', blurb: '', links: { android: 'https://play.google.com/store/apps/details?id=ee.mtakso.client', ios: 'https://apps.apple.com/ng/app/bolt-request-a-ride/id675033630', web: 'https://bolt.eu/en-ng/cities/lagos/' } },
  { id: 'indrive', name: 'inDrive', blurb: 'You name the fare.', links: { android: 'https://play.google.com/store/apps/details?id=sinet.startup.inDriver', ios: 'https://apps.apple.com/ng/app/indrive-rides-at-your-price/id780125801', web: 'https://indrive.com/en-ng/' } },
];
const rideHref = (r) => (isAndroid ? r.links.android : isIOS ? r.links.ios : r.links.web);
const directionsHref = (d) => (isAndroid ? d.android : isIOS ? d.ios : d.web);

// "Free" only when a source says so (the server sends entry only with a source, or unknown)
function entryWords(entry) {
  if (entry.free === true) return 'Free to get in';
  if (entry.free === false) return entry.note || 'There is a fee to get in';
  return 'Entry: check at the gate';
}
const monthYear = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

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
          <p><b>Want a nudge if this changes?</b> On iPhone, add Come Through to your Home Screen first. Tap Share, then Add to Home Screen.</p>
        ) : (
          <p><b>Want a nudge if this changes?</b> One alert if the time or the weather changes, and one when your ride group forms.</p>
        )}
        <div class="row nudge-actions">
          {state !== 'ios' && <button class="btn primary" onClick={yes} disabled={state === 'asking'}>Yes, nudge me</button>}
          <button class="btn ghost" onClick={done}>{state === 'ios' ? 'Got it' : 'Not now'}</button>
        </div>
      </div>
    </aside>
  );
}

function PodCard({ pod, byId, meId, fresh, onCopy, rides, directions = null, host = null }) {
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
        {pod.travelMin != null ? <>About {pod.travelMin} min</> : "No ride time yet, because the place isn't on the map"}{others.length ? `, riding with ${nameList(others.map((o) => firstName(o.name)), 2)}` : ". Nobody near you yet, so it's a solo ride for now"}.
        {pod.bridge ? ` The time allows for ${pod.bridge}.` : ''}
        {pod.estimate?.text && (
          <> <button type="button" class="link-btn how-btn" aria-expanded={how} onClick={() => setHow(!how)}>{how ? 'Hide' : 'How we guess'}</button></>
        )}
      </p>
      {how && pod.estimate?.text && <p class="small how-text">{pod.estimate.text}</p>}
      <div class="pod-actions">
        {!pod.destinationText && host && host.id !== meId && <p class="small muted">Ask {firstName(host.name)} for the address, then book your ride.</p>}
        {pod.destinationText && (
          <button class="btn secondary block" onClick={() => onCopy(pod.destinationText)}><Icon name="copy" size={20} /> Copy address</button>
        )}
        {rides.length > 0 ? (
          <>
            <div class="ride-apps">
              {rides.slice(0, 2).map((r) => (
                <a key={r.id} class="btn ghost grow" href={rideHref(r)} target="_blank" rel="noopener" data-external><Icon name="car" size={20} /> {r.name}</a>
              ))}
            </div>
            <p class="fine ride-fine">
              Ride apps don't take a drop-off from a link yet, so paste the address in.
              {rides.length > 2 && <> Also: {rides.slice(2).map((r, i) => <span key={r.id}>{i ? ', ' : ''}<a href={rideHref(r)} target="_blank" rel="noopener" data-external>{r.name}</a></span>)}.</>}
            </p>
          </>
        ) : (
          <>
            {directions && (
              <div class="ride-apps">
                <a class="btn ghost grow" href={directionsHref(directions)} target="_blank" rel="noopener" data-external><Icon name="car" size={20} /> Get directions</a>
              </div>
            )}
            <p class="fine ride-fine">Opens your maps app. For a ride, paste the address into whichever app you use.</p>
          </>
        )}
      </div>
    </div>
  );
}

// A guest sees the same two buttons as a member: the name is asked when they tap.
function ActionBar({ my, menu, setMenu, answer, waUrl }) {
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

  return (
    <div class="bottom-bar">
      <div class={`action-bar state-${my || 'none'}`} ref={menuRef}>
        {my === 'going' ? (
          <>
            <button class="btn secondary going-pill" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-haspopup="menu">
              <Icon name="check" size={20} /> Going
            </button>
            <a class="btn whatsapp big grow cal-btn" href={waUrl} target="_blank" rel="noopener" data-external>
              <WhatsAppIcon /> Tell the crew
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
