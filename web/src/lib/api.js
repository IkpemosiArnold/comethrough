// The API client, following docs/SPEC.md ("HTTP API"). Responses are normalised here so the
// screens see plain objects. With ?mock=1 every call goes to ./mock.js instead, which returns
// the same wire shapes, so the demo and the real server run through the same code below.
//
// Auth: `Authorization: Bearer <token>`, the member token when this phone has one for the
// crew, otherwise the crew's invite token. The .ics download carries the token as ?t=.

import { getCrew, saveCrew, sessionGet, sessionSet, readCrewCache, writeCrewCache } from './store.js';
import { areaContext, hint, setPlace } from './place.js';

const q = new URLSearchParams(location.search);
if (q.has('mock')) sessionSet('ct.mock', q.get('mock') === '0' ? '0' : '1');
export const MOCK = sessionGet('ct.mock') === '1';

let mockMod;
async function mock() {
  if (!mockMod) mockMod = await import('./mock.js');
  return mockMod;
}

export class ApiError extends Error {
  constructor(message, status, code, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

function bearer(slug, invite) {
  const c = slug ? getCrew(slug) : null;
  return c?.memberToken || invite || c?.invite || null;
}

async function req(method, path, { slug, invite, body, form, token } = {}) {
  if (MOCK) return (await mock()).handle(method, path, { body, form, token: token || bearer(slug, invite) });
  const headers = {};
  const t = token || bearer(slug, invite);
  if (t) headers.Authorization = `Bearer ${t}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(path, { method, headers, body: payload });
  } catch {
    throw new ApiError("Couldn't reach Come Through. Check your data and try again.", 0, 'offline');
  }
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const e = data?.error;
    const msg = (typeof e === 'string' ? e : e?.message) ||
      (res.status === 404 ? "That isn't here any more." : res.status === 401 || res.status === 403 ? 'This link has stopped working. Ask the crew for a fresh one.' : 'Something went wrong on our side. Try again in a minute.');
    throw new ApiError(msg, res.status, e?.code, e?.fields);
  }
  return data;
}

const enc = encodeURIComponent;

// Ideas may come from the server or the demo; keep only what the card can show.
function normaliseIdeas(list) {
  return (Array.isArray(list) ? list : []).filter((x) => x && x.title).slice(0, 3).map((x, i) => ({
    id: x.id || `idea-${i}`,
    title: String(x.title),
    reason: x.reason || x.why || '',
    when: x.when || null,
    place: x.place || null,
    source: x.source && (x.source.name || x.source.url) ? { name: x.source.name || null, url: x.source.url || null } : null,
    draft: x.draft || x.plan || null,
  }));
}

// The branch and the pods match faces to member ids. If a PlanView arrives without `rsvps`
// (only the name lists `going` and `maybe`, plus `you`), rebuild it from the member list.
function withRsvps(plan, members = [], you = null) {
  if (!plan || plan.rsvps) return plan;
  const ids = new Map();
  for (const m of members) {
    if (you && m.id === you.id) continue;
    if (!ids.has(m.name)) ids.set(m.name, []);
    ids.get(m.name).push(m.id);
  }
  const rsvps = {};
  if (you && plan.you) rsvps[you.id] = plan.you;
  for (const value of ['going', 'maybe']) {
    let skippedYou = false;
    for (const name of plan[value] || []) {
      if (you && plan.you === value && name === you.name && !skippedYou) { skippedYou = true; continue; }
      const id = ids.get(name)?.shift();
      if (id) rsvps[id] = value;
    }
  }
  return { ...plan, rsvps };
}

export const api = {
  // Step 1 of starting a crew: Gemma reads the sentence. Nothing is saved yet.
  // The visitor's own zone goes with it, so a crew started in Berlin is not looked for in Lagos.
  async draftCrew(sentence) {
    const r = await req('POST', '/api/crews', { body: { sentence, hint: hint() } });
    return { ...r.draft, pack: r.pack || null, confidence: r.confidence || {}, low: r.low || [], notes: r.notes || [], ai: r.ai !== false };
  },
  // Step 2: the organiser confirms the edited draft, and can join in the same step.
  async createCrew(draft, organiser) {
    const r = await req('POST', '/api/crews', { body: { confirm: draft, hint: hint(), ...(organiser ? { organiser } : {}) } });
    return { ...r, crew: { ...r.crew, inviteToken: r.inviteToken || r.crew?.inviteToken } };
  },
  // { crew, members, plans, you }
  // A link's ?t= can be the crew's invite key or a member's own key (a member's link opened
  // on a second phone). When the server answers with `you`, this phone becomes that member.
  async getCrew(slug, invite) {
    const d = await req('GET', `/api/crews/${enc(slug)}`, { slug, invite });
    setPlace(d.crew);
    const mine = getCrew(slug);
    if (d.you?.id && mine?.memberId !== d.you.id) {
      const token = mine?.memberToken || invite || mine?.invite;
      if (token) saveCrew(slug, { name: d.crew?.name, memberId: d.you.id, memberName: d.you.name, memberToken: token });
    } else if (d.crew?.name && mine?.name !== d.crew.name) saveCrew(slug, { name: d.crew.name });
    return { ...d, plans: (d.plans || []).map((p) => withRsvps(p, d.members, d.you)) };
  },
  // Join with just a name: the first "I'm going", or "Join the crew". The area comes later,
  // on the first plan with rides. This phone becomes the member.
  async joinAs(slug, name, crewName) {
    const res = await api.join(slug, { name }, null);
    saveCrew(slug, { name: crewName, memberId: res.member.id, memberName: res.member.name, memberToken: res.memberToken, calendarUrl: res.calendarUrl, webcalUrl: res.webcalUrl });
    return res;
  },
  // Where you're coming from: { area: "Yaba" | { label, lat, lon } } or { near: { lat, lon } }
  // (rounded to two decimals on this phone first). Returns { you, notes }.
  async setArea(slug, body) {
    const c = getCrew(slug);
    if (MOCK) return (await mock()).setArea(c?.memberId, body);
    return req('PATCH', `/api/members/${enc(c?.memberId || '')}`, { slug, body });
  },
  // The sloth's first pick for a new crew with a regular day: { plan, reason }.
  async firstPick(slug) {
    const r = await req('POST', `/api/crews/${enc(slug)}/first-pick`, { slug });
    return { plan: r?.plan ? withRsvps(r.plan, [], null) : null, reason: r?.reason || null };
  },
  // Three ideas for a crew with nothing on: [{ id, title, reason, when, place, source, draft }].
  // A server without the endpoint yet answers 404, and the card simply does not show.
  async ideas(slug, when = 'weekend') {
    if (MOCK) return normaliseIdeas((await mock()).ideas(when));
    try {
      const r = await req('GET', `/api/crews/${enc(slug)}/ideas?when=${enc(when)}`, { slug });
      return normaliseIdeas(r?.ideas || r);
    } catch (e) {
      if (e.status === 404 || e.status === 405) return [];
      throw e;
    }
  },
  // { member, memberToken, memberUrl, calendarUrl, webcalUrl }
  async join(slug, { name, area }, invite) {
    return req('POST', `/api/crews/${enc(slug)}/members`, { token: invite || getCrew(slug)?.invite, body: { name, area } });
  },
  // Area type-ahead (Photon on the server, biased to the crew's centre once there is a crew,
  // else to the visitor's zone): [{ label, detail, lat, lon }]
  async geocode(text, signal) {
    if (MOCK) return (await mock()).areas(text);
    const res = await fetch(`/api/areas?q=${enc(text)}${areaContext()}`, { signal });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  },
  // A draft plan from text, a link and/or a flyer image
  // `thumb` is the browser's small copy of the flyer, kept as the plan's poster
  async parsePlan(slug, { text, url, image, thumb }) {
    let opts;
    if (image) {
      const form = new FormData();
      if (text) form.append('text', text);
      if (url) form.append('url', url);
      form.append('image', image, image.name || 'flyer.jpg');
      if (thumb) form.append('thumb', thumb, 'thumb.jpg');
      opts = { slug, form };
    } else {
      opts = { slug, body: { text: text || undefined, url: url || undefined } };
    }
    const r = await req('POST', `/api/crews/${enc(slug)}/plans/parse`, opts);
    return { ...r.draft, confidence: r.confidence || {}, low: r.low || [], notes: r.notes || [], ai: r.ai !== false };
  },
  async createPlan(slug, draft) {
    const r = await req('POST', `/api/crews/${enc(slug)}/plans`, { slug, body: { plan: draft } });
    return r.plan;
  },
  // There is no single-plan read in the contract, so the plan page reads the crew.
  async getPlan(slug, id, invite) {
    let data, offline = false;
    try {
      data = await api.getCrew(slug, invite);
      writeCrewCache(slug, data);
    } catch (e) {
      data = e.code === 'offline' ? readCrewCache(slug) : null;
      if (!data) throw e;
      setPlace(data.crew);
      offline = true;
    }
    const plan = (data.plans || []).find((p) => p.id === id);
    if (!plan) throw new ApiError("That plan isn't here any more. It may have ended.", 404);
    return { ...plan, members: data.members || [], crew: data.crew, viewer: data.you, offline };
  },
  async rsvp(slug, id, rsvp) {
    const r = await req('PATCH', `/api/plans/${enc(id)}`, { slug, body: { rsvp } });
    return r.plan;
  },
  // { pods: [Pod], unplaced: [{ id, name }], rides: the ride apps the crew's city pack has
  // verified (none outside Lagos), directions: { android, ios, web } or null }
  async pods(slug, id) {
    const r = await req('GET', `/api/plans/${enc(id)}/pods`, { slug });
    return { pods: r?.pods || [], unplaced: r?.unplaced || [], rides: Array.isArray(r?.rides) ? r.rides : null, directions: r?.directions || null };
  },
  // A single-event calendar file. Works on Android and iPhone without subscribing.
  eventIcsUrl(slug, plan) {
    if (plan.eventIcsUrl) return plan.eventIcsUrl;
    if (MOCK) return '/mock/event.ics';
    const t = getCrew(slug)?.memberToken;
    return `/api/plans/${enc(plan.id)}/event.ics${t ? `?t=${enc(t)}` : ''}`;
  },
  // Web Push: the public VAPID key, then this browser's subscription for this member.
  async pushKey() {
    if (MOCK) return { publicKey: null };
    return req('GET', '/api/push/key');
  },
  async subscribePush(slug, subscription) {
    const c = getCrew(slug);
    if (!c?.memberId) return null;
    return req('POST', `/api/members/${enc(c.memberId)}/push-subscription`, { slug, body: { subscription } });
  },
};
