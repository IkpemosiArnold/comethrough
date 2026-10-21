// The API client. Follows docs/SPEC.md. With ?mock=1 every call goes to ./mock.js instead,
// so the UI can be built and demoed before the server exists.
//
// Auth (proposed in SPEC "UI requests"): the invite token rides as ?t= on crew reads and joins;
// the member token (Member.calToken) rides as the X-Member-Token header on everything else.

import { getCrew } from './store.js';
import { sessionGet, sessionSet } from './store.js';

const q = new URLSearchParams(location.search);
if (q.has('mock')) sessionSet('ct.mock', q.get('mock') === '0' ? '0' : '1');
export const MOCK = sessionGet('ct.mock') === '1';

let mockMod;
async function mock() {
  if (!mockMod) mockMod = await import('./mock.js');
  return mockMod;
}

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

function tokensFor(slug) {
  const c = slug ? getCrew(slug) : null;
  return { member: c?.memberToken || null, invite: c?.invite || null };
}

async function req(method, path, { slug, body, form, invite } = {}) {
  const t = tokensFor(slug);
  const headers = {};
  if (t.member) headers['X-Member-Token'] = t.member;
  let url = path;
  const inv = invite || t.invite;
  if (inv && slug) url += (url.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(inv);
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(url, { method, headers, body: payload });
  } catch {
    throw new ApiError("Couldn't reach Come Through. Check your data and try again.", 0);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const msg = data?.error || (res.status === 404 ? "That isn't here any more." : 'Something went wrong on our side. Try again in a minute.');
    throw new ApiError(msg, res.status);
  }
  return data;
}

export const api = {
  // Step 1 of starting a crew: Gemma reads the sentence into a draft.
  async draftCrew(sentence) {
    if (MOCK) return (await mock()).draftCrew(sentence);
    return req('POST', '/api/crews', { body: { sentence } });
  },
  // Step 2: the organiser confirms the (edited) draft.
  async createCrew(draft) {
    if (MOCK) return (await mock()).createCrew(draft);
    return req('POST', '/api/crews', { body: { confirm: draft } });
  },
  async getCrew(slug, invite) {
    if (MOCK) return (await mock()).getCrew(slug);
    return req('GET', `/api/crews/${encodeURIComponent(slug)}`, { slug, invite });
  },
  async join(slug, { name, area }, invite) {
    if (MOCK) return (await mock()).join(slug, { name, area });
    return req('POST', `/api/crews/${encodeURIComponent(slug)}/members`, { slug, invite, body: { name, area } });
  },
  // Proposed endpoint (UI requests): area type-ahead. Returns [{ label, detail, lat, lon }].
  async geocode(text, signal) {
    if (MOCK) return (await mock()).geocode(text);
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(text)}`, { signal });
    if (!res.ok) return [];
    return res.json();
  },
  async parsePlan(slug, { text, url, image }) {
    if (MOCK) return (await mock()).parsePlan(slug, { text, url, image });
    const form = new FormData();
    if (text) form.append('text', text);
    if (url) form.append('url', url);
    if (image) form.append('image', image, image.name || 'flyer.jpg');
    return req('POST', `/api/crews/${encodeURIComponent(slug)}/plans/parse`, { slug, form });
  },
  async createPlan(slug, draft) {
    if (MOCK) return (await mock()).createPlan(slug, draft);
    return req('POST', `/api/crews/${encodeURIComponent(slug)}/plans`, { slug, body: draft });
  },
  // Proposed endpoint (UI requests). Falls back to finding the plan in the crew read.
  async getPlan(slug, id) {
    if (MOCK) return (await mock()).getPlan(slug, id);
    try {
      return await req('GET', `/api/plans/${encodeURIComponent(id)}`, { slug });
    } catch (e) {
      if (e.status !== 404) throw e;
      const data = await api.getCrew(slug);
      const plan = (data.plans || []).find((p) => p.id === id);
      if (!plan) throw e;
      return { ...plan, members: data.members, crew: data.crew };
    }
  },
  async rsvp(slug, id, rsvp) {
    if (MOCK) return (await mock()).rsvp(slug, id, rsvp);
    return req('PATCH', `/api/plans/${encodeURIComponent(id)}`, { slug, body: { rsvp } });
  },
  // One event as a calendar file. Works on Android and iPhone without subscribing.
  eventIcsUrl(slug, id) {
    if (MOCK) return `/mock/event.ics`;
    const c = getCrew(slug);
    const m = c?.memberToken ? `?m=${encodeURIComponent(c.memberToken)}` : '';
    return `/api/plans/${encodeURIComponent(id)}/event.ics${m}`;
  },
  // Web Push. The server holds the VAPID key pair; the page asks for the public key.
  async pushKey() {
    if (MOCK) return { publicKey: null };
    return req('GET', '/api/push/key');
  },
  async subscribePush(slug, subscription) {
    if (MOCK) return { ok: true };
    return req('POST', `/api/crews/${encodeURIComponent(slug)}/push`, { slug, body: { subscription } });
  },
  async pods(slug, id) {
    if (MOCK) return (await mock()).pods(slug, id);
    return req('GET', `/api/plans/${encodeURIComponent(id)}/pods`, { slug });
  },
};
