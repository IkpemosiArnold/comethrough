// Crew home: the sloth's next pick, the plans coming up, and one big "Add a plan".
import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api.js';
import { getCrew, saveCrew, readCrewCache as readCache, writeCrewCache as writeCache } from '../lib/store.js';
import { dayParts, dayLabel, timeRange, time, isPast, firstName, weekday, nameList, rhythmText, DAYS } from '../lib/format.js';
import { copyText, whatsappUrl } from '../lib/platform.js';
import { Faces } from '../ui/Avatar.jsx';
import { Sloth } from '../ui/Sloth.jsx';
import { Icon, WhatsAppIcon } from '../ui/icons.jsx';
import { WeatherChip, weatherIcon } from '../ui/Weather.jsx';
import { KindSticker, ErrorNote } from '../ui/misc.jsx';
import { toast } from '../ui/toast.jsx';


export function CrewHome({ params }) {
  const { slug } = params;
  const mine = getCrew(slug);
  const [data, setData] = useState(() => readCache(slug));
  const [error, setError] = useState(null);

  function load() {
    setError(null);
    api.getCrew(slug).then((d) => {
      setData(d);
      writeCache(slug, d);
      if (d?.crew?.name && d.crew.name !== mine?.name) saveCrew(slug, { name: d.crew.name });
      if (d?.you?.id && d.you.id !== mine?.memberId) saveCrew(slug, { memberId: d.you.id, memberName: d.you.name });
    }).catch(setError);
  }
  useEffect(load, [slug]);

  const crew = data?.crew;
  const members = data?.members || [];
  const byId = Object.fromEntries(members.map((m) => [m.id, m]));
  const plans = (data?.plans || []).filter((p) => !isPast(p) && p.status !== 'cancelled');
  const ritual = plans.find((p) => p.kind === 'ritual');
  const rest = plans.filter((p) => p !== ritual);
  const meId = mine?.memberId;

  const inviteUrl = mine?.inviteUrl || (crew ? `${location.origin}/c/${slug}?t=${encodeURIComponent(crew.inviteToken || mine?.invite || '')}` : '');
  async function invite() {
    const text = `Come through! Join ${crew?.name || 'the crew'} here: ${inviteUrl}`;
    if (navigator.share) {
      try { await navigator.share({ title: crew?.name, text, url: inviteUrl }); return; } catch (e) { if (e?.name === 'AbortError') return; }
    }
    const ok = await copyText(inviteUrl);
    toast(ok ? 'Invite link copied' : "Couldn't copy the link");
  }

  return (
    <div class="column crew-home screen-enter has-bar">
      <header class="crew-head">
        <div class="row spread crew-top">
          <a class="crumb" href="/" aria-label="All your crews">Come Through</a>
          <button class="btn ghost invite-btn" onClick={invite}><Icon name="people" size={20} /> Invite</button>
        </div>
        {crew ? (
          <h1 class="display display-xl painted crew-name">{crew.name}</h1>
        ) : (
          <div class="skeleton" style={{ height: '52px', width: '72%', marginTop: '8px' }} />
        )}
        {crew && (
          <p class="crew-sub">
            {members.length <= 1 ? 'Just you so far' : `${members.length} of you`}
            {crew.areas?.length ? `, around ${nameList(crew.areas.map((a) => a.label), 3)}` : ''}
          </p>
        )}
      </header>

      {error && !data && <ErrorNote error={error} onRetry={load} />}
      {error && data && <p class="offline-note">Showing what this phone saw last. <button class="link-btn" onClick={load}>Refresh</button></p>}

      {crew && <RitualPanel crew={crew} ritual={ritual} byId={byId} slug={slug} meId={meId} />}

      {data && (
        <section class="coming" aria-labelledby="coming-title">
          <h2 id="coming-title" class="section-label">Coming up</h2>
          {rest.length === 0 ? (
            members.length <= 1 ? (
              <div class="empty">
                <p class="display display-md">Bring the crew in first</p>
                <p class="muted">Plans land better with people on the branch. Drop the invite link in the group chat.</p>
                <a class="btn whatsapp" href={whatsappUrl(`Come through! Join ${crew?.name || 'the crew'} here: ${inviteUrl}`)} target="_blank" rel="noopener" data-external>
                  <WhatsAppIcon /> Send the invite
                </a>
              </div>
            ) : (
              <div class="empty">
                <p class="display display-md">Nothing else on yet</p>
                <p class="muted">That's allowed. Seen a flyer or got an idea? Add it and the crew taps once.</p>
              </div>
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

      <div class="bottom-bar">
        <div>
          <a class="btn primary block big add-plan" href={`/c/${slug}/add`}>
            <Icon name="plus" size={24} /> Add a plan
          </a>
        </div>
      </div>
    </div>
  );
}

function RitualPanel({ crew, ritual, byId, slug, meId }) {
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
          <p class="ritual-wx"><Icon name={weatherIcon(w)} size={18} /> {Math.round(w.tempC)}°. {w.ok ? w.summary : `${w.rainProb}% chance of rain`}</p>
        )}
        {ritual.rainPlan && (
          <p class="ritual-wx ritual-rain">{ritual.rainPlan.kind === 'wet' ? 'No dry stretch this weekend. Bring cover.' : 'Moved to dodge the rain. Tap for why.'}</p>
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
  if (!crew.rhythm) return null;
  const dayName = DAYS[crew.rhythm.day];
  const postBy = DAYS[(crew.rhythm.day + 5) % 7];
  return (
    <div class="ritual planning">
      <div class="ritual-sloth" aria-hidden="true"><Sloth size={78} mood="sleepy" /></div>
      <p class="ritual-kicker">{rhythmText(crew.rhythm)}</p>
      <h2 class="display ritual-title">The sloth is planning {dayName}<span class="ellipsis" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></h2>
      <p class="ritual-when">By {postBy} it picks a green spot near the middle of the crew, checks the weather, and posts it here.</p>
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
            <KindSticker kind={plan.kind} />
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
