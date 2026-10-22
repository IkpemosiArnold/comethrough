// The crew page, for everyone with the link. A friend sees the sloth's pick and the plans
// before being asked for anything; the name is asked at their first "I'm going" (on a plan)
// or "Join the crew" (here). Members get "Add a plan" and the ideas when nothing is on.
import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api.js';
import { getCrew, readCrewCache as readCache, writeCrewCache as writeCache } from '../lib/store.js';
import { setPlace } from '../lib/place.js';
import { navigate } from '../lib/router.js';
import { dayParts, dayLabel, timeRange, time, isPast, firstName, weekday, nameList, rhythmText, DAYS } from '../lib/format.js';
import { copyText, isIOS, isAndroid } from '../lib/platform.js';
import { whatsappUrl, inviteMessage, planLinks } from '../lib/share.js';
import { Faces } from '../ui/Avatar.jsx';
import { Sloth } from '../ui/Sloth.jsx';
import { Icon, WhatsAppIcon } from '../ui/icons.jsx';
import { WeatherChip, weatherIcon, weatherWords } from '../ui/Weather.jsx';
import { KindSticker, ErrorNote, Dots } from '../ui/misc.jsx';
import { NameSheet } from '../ui/NameSheet.jsx';
import { toast } from '../ui/toast.jsx';
import { CrewName } from '../ui/CrewName.jsx';
import { AnotherCrew, StatusPrompt, YouHere, pickGrowthCard } from '../ui/Growth.jsx';

/** The invite for the group chat: the next plan in the first line when there is one. */
export function crewInvite(crew, plans, invite) {
  const key = invite ? `?t=${encodeURIComponent(invite)}` : '';
  const url = `${location.origin}/c/${crew.slug}${key}`;
  const next = (plans || []).find((p) => !isPast(p) && p.status !== 'cancelled');
  const plan = next ? { title: next.title, kind: next.kind, place: next.place?.name, when: `${dayLabel(next.start)}, ${timeRange(next.start, next.end)}`, links: planLinks(location.origin, crew.slug, next.id, invite) } : null;
  // the invite travels: a discreet crew, or a name that says who the crew is, stays out of it
  return inviteMessage({ crewName: crew.shareName ?? 'our crew', url, plan });
}

export function CrewHome({ params, query, askName = false }) {
  const { slug } = params;
  const key = query?.get('t') || null;
  const mine = getCrew(slug);
  const [meId, setMeId] = useState(mine?.memberId || null);
  const [asking, setAsking] = useState(askName && !mine?.memberId);
  // a cached crew shows at once, in its own time zone
  const [data, setData] = useState(() => { const c = readCache(slug); if (c?.crew) setPlace(c.crew); return c; });
  const [error, setError] = useState(null);
  const [onceDone, setOnceDone] = useState(false);

  function load() {
    setError(null);
    api.getCrew(slug, key).then((d) => {
      setData(d);
      writeCache(slug, d);
      if (d?.you?.id) setMeId(d.you.id);
    }).catch(setError);
  }
  useEffect(load, [slug]);

  const crew = data?.crew;
  const members = data?.members || [];
  const byId = Object.fromEntries(members.map((m) => [m.id, m]));
  const live = (data?.plans || []).filter((p) => !isPast(p));
  // a ritual the sloth skipped for rain is stored as cancelled, and the panel still says so
  const ritual = live.find((p) => p.kind === 'ritual' && (p.status !== 'cancelled' || p.rainPlan?.kind === 'skip'));
  const rest = live.filter((p) => p !== ritual && p.status !== 'cancelled');
  const guest = !meId;
  const invite = crew?.inviteToken || mine?.invite;
  const inviteText = crew ? crewInvite(crew, [ritual, ...rest].filter((p) => p && p.status !== 'cancelled'), invite) : '';

  function joined(res, first) {
    setMeId(res.member.id);
    setAsking(false);
    toast(`You're in, ${first}.`);
    load();
  }

  return (
    <div class="column crew-home screen-enter has-bar">
      <header class="crew-head">
        <div class="row spread crew-top">
          <a class="crumb" href="/" aria-label="All your crews">Come Through</a>
          {!guest && crew && <a class="btn ghost invite-btn" href={whatsappUrl(inviteText)} target="_blank" rel="noopener" data-external><WhatsAppIcon size={20} /> Invite</a>}
        </div>
        {guest && crew && <p class="kicker">You've been asked to come through</p>}
        {crew ? (
          <CrewName crew={crew} slug={slug} canEdit={!guest} onRenamed={(name) => setData((d) => { const next = { ...d, crew: { ...d.crew, name } }; writeCache(slug, next); return next; })} />
        ) : (
          <div class="skeleton" style={{ height: '52px', width: '72%', marginTop: '8px' }} />
        )}
        {crew && (
          guest && members.length > 0 ? (
            <div class="row join-who">
              <Faces members={members} max={5} />
              <p class="small muted">{nameList(members.map((m) => firstName(m.name)), 2)} {members.length === 1 ? 'is' : 'are'} in</p>
            </div>
          ) : (
            <p class="crew-sub">
              {members.length <= 1 ? 'Just you so far' : `${members.length} of you`}
              {crew.areas?.length ? `, around ${nameList(crew.areas.map((a) => a.label), 3)}` : ''}
            </p>
          )
        )}
      </header>

      {error && !data && <ErrorNote error={error} onRetry={load} />}
      {error && data && <p class="offline-note">Showing what this phone saw last. <button class="link-btn" onClick={load}>Refresh</button></p>}

      {crew && <RitualPanel crew={crew} ritual={ritual} byId={byId} slug={slug} meId={meId} />}

      {crew && !guest && !onceDone && (() => {
        const card = pickGrowthCard({ growth: data?.growth, slug, meId });
        if (card === 'status') return <StatusPrompt slug={slug} crewName={crew.name} growth={data.growth} onDone={() => setOnceDone(true)} />;
        if (card === 'another') return <AnotherCrew slug={slug} meId={meId} onDone={() => setOnceDone(true)} />;
        return null;
      })()}

      {data && (
        <section class="coming" aria-labelledby="coming-title">
          <h2 id="coming-title" class="section-label">Coming up</h2>
          {rest.length === 0 ? (
            guest ? (
              <div class="empty">
                <p class="muted">Nothing else on yet. When someone adds a plan, it shows up here.</p>
              </div>
            ) : members.length <= 1 ? (
              <div class="empty">
                <p class="display display-md">Bring the crew in</p>
                <p class="muted">They see the plans before they're asked for anything.</p>
                <a class="btn whatsapp" href={whatsappUrl(inviteText)} target="_blank" rel="noopener" data-external>
                  <WhatsAppIcon /> Send the invite
                </a>
              </div>
            ) : (
              <IdeasCard slug={slug} />
            )
          ) : (
            <ol class="plan-list">
              {rest.map((p, i) => (
                <PlanRow key={p.id} plan={p} byId={byId} slug={slug} meId={meId} showDate={i === 0 || dayParts(rest[i - 1].start).num !== dayParts(p.start).num} />
              ))}
            </ol>
          )}
        </section>
      )}

      {!data && !error && <ListSkeleton />}

      {!guest && data && <CalendarMore mine={getCrew(slug)} />}
      {!guest && data && <YouHere slug={slug} me={members.find((m) => m.id === meId)} discreet={!!data.growth?.discreet} onChanged={load} />}

      <div class="bottom-bar">
        <div>
          {guest ? (
            <button class="btn primary block big" onClick={() => setAsking(true)} disabled={!crew}>Join the crew</button>
          ) : (
            <a class="btn primary block big add-plan" href={`/c/${slug}/add`}>
              <Icon name="plus" size={24} /> Add a plan
            </a>
          )}
        </div>
      </div>
      {asking && crew && <NameSheet slug={slug} crewName={crew.name} action="Join the crew" onClose={() => setAsking(false)} onJoined={joined} />}
    </div>
  );
}

// "Too lazy to think?": three ideas, each with its reason and where it came from, and one tap
// to make it a plan. One calm card, shown only when nothing else is on.
function IdeasCard({ slug }) {
  const [ideas, setIdeas] = useState(null);
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    const d = new Date().getDay();
    const when = (d === 5 || d === 6 || d === 0) && new Date().getHours() >= 14 ? 'tonight' : 'weekend';
    api.ideas(slug, when).then(setIdeas).catch(() => setIdeas([]));
  }, [slug]);
  async function make(idea) {
    if (!idea.draft) return;
    setBusy(idea.id);
    try {
      const plan = await api.createPlan(slug, idea.draft);
      navigate(`/c/${slug}/p/${plan.id}?posted=1`);
    } catch (e) {
      toast(e.message || "Couldn't make that a plan. Try again.");
      setBusy(null);
    }
  }
  if (ideas && ideas.length === 0) {
    return (
      <div class="empty">
        <p class="display display-md">Nothing else on yet</p>
        <p class="muted">Seen a flyer or got an idea? Add it and the crew taps once.</p>
      </div>
    );
  }
  return (
    <section class="ideas" aria-labelledby="ideas-title" aria-busy={!ideas}>
      <div class="ideas-sloth" aria-hidden="true"><Sloth size={52} branch={false} mood="awake" /></div>
      <h3 id="ideas-title" class="ideas-title">Too lazy to think? The sloth has three ideas.</h3>
      {!ideas ? (
        <p class="muted small">Looking around <Dots /></p>
      ) : (
        <ol class="ideas-list">
          {ideas.map((idea) => (
            <li key={idea.id} class="idea">
              <p class="idea-title">{idea.title}</p>
              {idea.when && <p class="idea-when">{idea.when}{idea.place?.name && !idea.title.includes(idea.place.name) ? ` at ${idea.place.name}` : ''}</p>}
              {idea.reason && <p class="idea-why">{idea.reason}</p>}
              {idea.source?.credit && (
                <p class="idea-src">{idea.source.url ? <a href={idea.source.url} target="_blank" rel="noopener">{idea.source.credit}</a> : idea.source.credit}</p>
              )}
              {idea.draft && (
                <button class="btn secondary idea-btn" onClick={() => make(idea)} disabled={!!busy}>
                  {busy === idea.id ? <>Making it <Dots /></> : 'Make it a plan'}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// Every plan in your calendar, for people who want that. Most people never need it: each plan
// you're going to has its own "Add to my calendar".
function CalendarMore({ mine }) {
  if (!mine?.calendarUrl) return null;
  async function copyCal() {
    const ok = await copyText(mine.calendarUrl);
    toast(ok ? 'Calendar link copied' : "Couldn't copy. Press and hold the link instead.");
  }
  const googleAdd = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(mine.webcalUrl || mine.calendarUrl)}`;
  return (
    <details class="cal-more">
      <summary>
        <Icon name="calendar" size={20} />
        <span class="grow">Every crew plan in your calendar</span>
        <Icon name="back" size={18} class="chev" />
      </summary>
      <div class="cal-body stack" style={{ '--stack': 'var(--s-3)' }}>
        <p class="muted small">Optional. Each plan you're going to has its own Add to my calendar.</p>
        {isIOS ? (
          <a class="btn secondary block" href={mine.webcalUrl} data-external>Subscribe on this iPhone</a>
        ) : isAndroid ? (
          <>
            <p class="small">The Google Calendar app on Android can't subscribe to a calendar. Copy the link, then on a computer open calendar.google.com and choose Other calendars, From URL.</p>
            <button class="btn secondary block" onClick={copyCal}><Icon name="copy" size={20} /> Copy calendar link</button>
          </>
        ) : (
          <>
            <a class="btn secondary block" href={googleAdd} target="_blank" rel="noopener">Add to Google Calendar</a>
            <a class="btn ghost block" href={mine.webcalUrl} data-external>Apple Calendar or Outlook</a>
            <button class="btn ghost block" onClick={copyCal}><Icon name="copy" size={20} /> Copy calendar link</button>
          </>
        )}
        <p class="fine">Subscribed calendars can take hours to update. This page is always current.</p>
      </div>
    </details>
  );
}

function RitualPanel({ crew, ritual, byId, slug, meId }) {
  if (ritual && ritual.rainPlan?.kind === 'skip') {
    return (
      <a class="ritual" href={`/c/${slug}/p/${ritual.id}`}>
        <div class="ritual-sloth" aria-hidden="true"><Sloth size={78} mood="sleepy" /></div>
        <p class="ritual-kicker">The sloth is skipping {dayLabel(ritual.start).toLowerCase() === 'tomorrow' ? 'tomorrow' : weekday(ritual.start)}</p>
        <p class="ritual-wx ritual-rain">{ritual.rainPlan.note}</p>
      </a>
    );
  }
  if (ritual) {
    const going = Object.entries(ritual.rsvps || {}).filter(([, v]) => v === 'going').map(([id]) => byId[id]).filter(Boolean);
    const youGoing = ritual.rsvps?.[meId] === 'going';
    const w = ritual.weather;
    return (
      <a class="ritual" href={`/c/${slug}/p/${ritual.id}`}>
        <div class="ritual-sloth" aria-hidden="true"><Sloth size={78} mood="sleepy" /></div>
        <p class="ritual-kicker">The sloth picked {dayLabel(ritual.start).toLowerCase() === 'tomorrow' ? 'tomorrow' : weekday(ritual.start)}</p>
        <h2 class="display ritual-title">{ritual.place?.name || ritual.title}</h2>
        <p class="ritual-when">{timeRange(ritual.start, ritual.end)}</p>
        {w && (
          <p class="ritual-wx"><Icon name={weatherIcon(w)} size={18} /> {weatherWords(w)}</p>
        )}
        {ritual.rainPlan && (
          <p class="ritual-wx ritual-rain">{ritual.rainPlan.kind === 'covered' ? 'Rain likely, so it picked somewhere with a roof.' : 'Moved to dodge the rain.'}</p>
        )}
        <div class="row ritual-who">
          {going.length > 0 && <Faces members={going} max={4} ring="var(--canopy)" />}
          <span class="ritual-count">
            {youGoing ? (going.length > 1 ? `You and ${going.length - 1} more` : 'You') : going.length ? `${going.length} going` : 'Come through if you can'}
          </span>
        </div>
      </a>
    );
  }
  // no area on the map: the sloth picks nothing, so it promises nothing (docs/SPEC.md, needsLocation)
  if (!crew.rhythm || (crew.region && !crew.region.center)) return null;
  const dayName = DAYS[crew.rhythm.day];
  const postBy = DAYS[(crew.rhythm.day + 5) % 7];
  return (
    <div class="ritual planning">
      <div class="ritual-sloth" aria-hidden="true"><Sloth size={78} mood="sleepy" /></div>
      <p class="ritual-kicker">{rhythmText(crew.rhythm)}</p>
      <h2 class="display ritual-title">The sloth is planning {dayName}<span class="ellipsis" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></h2>
      <p class="ritual-when">Sloths come down from their tree about once a week, and so does your crew. It posts {dayName}'s spot here by {postBy}.</p>
    </div>
  );
}

function PlanRow({ plan, byId, slug, meId, showDate }) {
  const going = Object.entries(plan.rsvps || {}).filter(([, v]) => v === 'going').map(([id]) => byId[id]).filter(Boolean);
  const maybe = Object.values(plan.rsvps || {}).filter((v) => v === 'maybe').length;
  const mine = plan.rsvps?.[meId];
  const d = dayParts(plan.start);
  const label = dayLabel(plan.start);
  const host = plan.host && byId[plan.host];
  const where = plan.place?.name || (host ? `${firstName(host.name)}'s` : 'Place to be decided');
  const flyer = plan.source?.imageUrl;
  return (
    <li class={`plan-item${showDate ? ' first-of-day' : ''}`}>
      <div class="date-rail" aria-hidden={!showDate}>
        {showDate && (
          <>
            <span class="rail-wd">{d.diff === 0 ? (label === 'Tonight' ? 'Tonight' : 'Today') : d.wd}</span>
            <span class="rail-num display">{d.num}</span>
          </>
        )}
      </div>
      <a class={`plan-row kind-${plan.kind}${flyer ? ' has-flyer' : ''}`} href={`/c/${slug}/p/${plan.id}`}>
        <div class="plan-main">
          <div class="row plan-tags">
            <KindSticker kind={plan.kind} host={host} />
            {mine === 'going' && <span class="you-badge"><Icon name="check" size={14} /> You're going</span>}
            {mine === 'maybe' && <span class="you-badge maybe">You said maybe</span>}
          </div>
          <h3 class="plan-title">{plan.title}</h3>
          <p class="plan-meta"><span class="sr-only">{label}, </span>{time(plan.start)}, {where}</p>
          <div class="row plan-foot">
            {going.length > 0 ? (
              <>
                <Faces members={going} max={4} ring="var(--paper)" />
                <span class="going-count">{going.length} going{maybe ? `, ${maybe} maybe` : ''}</span>
              </>
            ) : (
              <span class="going-count faint">Nobody yet. Be the first?</span>
            )}
            <span class="grow" />
            <WeatherChip weather={plan.place?.outdoor ? plan.weather : null} />
          </div>
        </div>
        {flyer && <img class="flyer-thumb" src={flyer} alt="" width="68" height="88" loading="lazy" decoding="async" />}
      </a>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div class="coming" aria-hidden="true">
      {[0, 1, 2].map((i) => <div key={i} class="skeleton" style={{ height: '112px', borderRadius: '20px', margin: '0 0 12px 56px' }} />)}
    </div>
  );
}
