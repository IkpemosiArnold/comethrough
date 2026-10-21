// The mock backend for ?mock=1. It answers with the wire shapes in docs/SPEC.md, so the demo
// runs through the same client code as the real server. State lives in sessionStorage for the tab.

import { saveCrew, getCrew as storedCrew, sessionGet, sessionSet } from './store.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms * (window.__CT_FAST ? 0.05 : 1)));

const AREAS = [
  ['Yaba', 'Lagos Mainland', 6.5095, 3.3711], ['Surulere', 'Lagos Mainland', 6.4969, 3.3549],
  ['Lekki Phase 1', 'Eti-Osa', 6.4474, 3.4723], ['Lekki Phase 2', 'Eti-Osa', 6.4471, 3.5297],
  ['Ajah', 'Eti-Osa', 6.4683, 3.5714], ['Ikeja', 'Ikeja', 6.6018, 3.3515], ['Ikeja GRA', 'Ikeja', 6.5786, 3.3542],
  ['Gbagada', 'Kosofe', 6.5564, 3.3909], ['Ikoyi', 'Eti-Osa', 6.4549, 3.4366], ['Victoria Island', 'Eti-Osa', 6.4281, 3.4219],
  ['Lagos Island', 'Lagos Island', 6.4541, 3.3947], ['Maryland', 'Ikeja', 6.5713, 3.3667], ['Magodo', 'Kosofe', 6.6215, 3.3846],
  ['Ogudu', 'Kosofe', 6.5753, 3.3906], ['Festac Town', 'Amuwo-Odofin', 6.4667, 3.2833], ['Ilupeju', 'Mushin', 6.5531, 3.3569],
  ['Oshodi', 'Oshodi-Isolo', 6.5568, 3.3415], ['Isolo', 'Oshodi-Isolo', 6.5373, 3.3237], ['Ikorodu', 'Ikorodu', 6.6194, 3.5105],
  ['Sangotedo', 'Eti-Osa', 6.4702, 3.6303], ['Chevron', 'Eti-Osa', 6.4396, 3.5317], ['Oniru', 'Eti-Osa', 6.4325, 3.4529],
  ['Akoka', 'Lagos Mainland', 6.5244, 3.3874], ['Ebute Metta', 'Lagos Mainland', 6.4884, 3.3815], ['Obalende', 'Lagos Island', 6.4483, 3.4069],
  ['Ojodu Berger', 'Ikeja', 6.6382, 3.3659], ['Opebi', 'Ikeja', 6.5928, 3.3593], ['Allen Avenue', 'Ikeja', 6.6012, 3.3533],
  ['Bariga', 'Shomolu', 6.5394, 3.3878], ['Shomolu', 'Shomolu', 6.5392, 3.3842], ['Agungi', 'Eti-Osa', 6.4416, 3.5054],
  ['Ikota', 'Eti-Osa', 6.4489, 3.5465], ['Ogba', 'Ikeja', 6.6271, 3.3402], ['Anthony Village', 'Kosofe', 6.5596, 3.3721],
  ['Mushin', 'Mushin', 6.5273, 3.3414], ['Apapa', 'Apapa', 6.4489, 3.3592], ['Ketu', 'Kosofe', 6.5976, 3.3895],
];

const PLACES = {
  // the real places use the coordinates in data/lagos-spots.json (OpenStreetMap and Wikidata)
  muri: { name: 'Muri Okunola Park', address: 'Victoria Island', lat: 6.43782, lon: 3.425083, outdoor: true, private: false },
  // not on OpenStreetMap by name (Photon, 21 Oct 2026), so the demo leaves it unpinned
  glover: { name: 'Glover Court suya spot', address: 'Glover Court, Ikoyi', lat: null, lon: null, outdoor: true, private: false },
  tobis: { name: "Tobi's place", address: '12 Alagomeji St, Yaba', lat: 6.4985, lon: 3.3775, outdoor: false, private: true },
  freedom: { name: 'Freedom Park', address: 'Lagos Island', lat: 6.448819, lon: 3.396531, outdoor: true, private: false },
  jjt: { name: 'JJT Park', address: 'Alausa, Ikeja', lat: 6.615213, lon: 3.363948, outdoor: true, private: false },
};

const MEMBERS = [
  ['m0', 'Ife Adebayo', 'Yaba'], ['m1', 'Tobi', 'Yaba'], ['m2', 'Ada Okafor', 'Surulere'], ['m3', 'Seyi', 'Lekki Phase 1'],
  ['m4', 'Kemi', 'Ikeja GRA'], ['m5', 'Dayo', 'Akoka'], ['m6', 'Chioma', 'Ajah'], ['m7', 'Femi', 'Gbagada'], ['m8', 'Zainab', 'Lekki Phase 1'],
];

function area(label) {
  const a = AREAS.find((x) => x[0].toLowerCase() === String(label).toLowerCase());
  return a ? { label: a[0], lat: a[2], lon: a[3] } : { label, lat: 6.5244, lon: 3.3792 };
}

// Dates relative to now, in Lagos time (UTC+1, no DST)
function lagosDate(daysAhead, hh, mm = 0) {
  const n = new Date(Date.now() + 3600e3); // shift to Lagos wall clock
  const d = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + daysAhead, hh - 1, mm));
  return d.toISOString();
}
function nextDow(dow, minAhead = 0) {
  const n = new Date(Date.now() + 3600e3);
  let ahead = (dow - n.getUTCDay() + 7) % 7;
  if (ahead < minAhead) ahead += 7;
  return ahead;
}

function seed() {
  const lagosHour = new Date(Date.now() + 3600e3).getUTCHours();
  const suyaDay = lagosHour >= 21 ? 1 : 0;
  const fri = nextDow(5, 1), sat = nextDow(6, 1), sun = nextDow(0, 1);
  const crew = {
    id: 'c1', slug: 'yaba-lot', name: 'The Yaba Lot', vibe: 'Outside and cheap. Good food, no long talk.',
    rhythm: { every: '2w', day: 6, window: { from: '15:00', to: '19:00' } },
    areas: [area('Yaba'), area('Lekki Phase 1')], createdAt: lagosDate(-40, 12), inviteToken: 'inv_demo',
  };
  const members = MEMBERS.map(([id, name, a], i) => ({ id, name, area: { label: a }, joinedAt: lagosDate(-40 + i, 12) }));
  const plans = [
    {
      id: 'p-suya', crewId: 'c1', kind: 'quick', title: 'Suya at Glover Court', start: lagosDate(suyaDay, 20), end: lagosDate(suyaDay, 22),
      tz: 'Africa/Lagos', place: PLACES.glover, price: { text: 'About ₦3,000 each', free: false }, host: null, bring: [],
      source: { text: "Who's up for suya tonight? Glover Court, 8ish" }, why: null, invite: null, weather: null,
      status: 'on', confidence: {}, rsvps: { m3: 'going', m5: 'maybe' }, createdBy: 'm3', createdAt: lagosDate(0, 9),
    },
    {
      id: 'p-monopoly', crewId: 'c1', kind: 'hosted', title: "Wine and Monopoly at Tobi's", start: lagosDate(fri, 19), end: lagosDate(fri, 23),
      tz: 'Africa/Lagos', place: PLACES.tobis, price: null, host: 'm1', bring: ['A bottle of wine', 'Small chops or chin chin', 'Ice'],
      source: { text: 'Wine and monopoly at mine, Friday 7, bring a bottle' }, why: null, invite: null, weather: null,
      status: 'on', confidence: {}, rsvps: { m1: 'going', m2: 'going', m7: 'maybe', m4: 'going' }, createdBy: 'm1', createdAt: lagosDate(-1, 18),
    },
    {
      id: 'p-ritual', crewId: 'c1', kind: 'ritual', title: 'Lazy Saturday at Muri Okunola Park', start: lagosDate(sat, 15), end: lagosDate(sat, 18),
      tz: 'Africa/Lagos', place: { ...PLACES.muri, osm: { type: 'way', id: 25374721, tags: { leisure: 'park' } }, entry: { free: null, note: null, source: null } }, price: null,
      host: null, bring: ['A mat or a wrapper', 'Something to share'],
      source: {}, why: "Muri Okunola sits about halfway between Yaba and Lekki, so nobody does the long trip, and you were at JJT Park last time.",
      invite: 'Mats out, music low, suya on the way. Come through if you can.',
      weather: { checkedAt: lagosDate(0, 8), summary: 'Dry, clouds after 4', rainProb: 10, tempC: 29, ok: true },
      status: 'on', confidence: {}, rsvps: { m2: 'going', m3: 'going', m8: 'going', m6: 'maybe', m5: 'going' }, createdBy: 'sloth', createdAt: lagosDate(0, 6),
    },
    {
      id: 'p-groove', crewId: 'c1', kind: 'found', title: 'Sunday Groove Sessions', start: lagosDate(sun, 18), end: lagosDate(sun, 22),
      tz: 'Africa/Lagos', place: PLACES.freedom, price: { text: '₦5,000 at the gate', free: false }, host: null, bring: [],
      source: { url: 'https://example.com/sunday-groove', image: true, imageUrl: '/mock/flyer.svg' }, why: null, invite: null,
      weather: { checkedAt: lagosDate(0, 8), summary: 'Showers possible after 8pm', rainProb: 55, tempC: 27, ok: false },
      status: 'on', confidence: {}, rsvps: { m4: 'going', m7: 'going', m1: 'maybe' }, createdBy: 'm4', createdAt: lagosDate(-2, 13),
    },
  ];
  return { crew, members, plans, me: null };
}

// Worst realistic data, for break-ui (?mock=1&data=worst). Every value is something a real
// Lagos crew could produce: long Yoruba and Hausa names with diacritics, a one-letter name,
// emoji, long flyer titles, a hidden home address, a crowd of 23 on the branch.
function seedWorst() {
  const db = seed();
  db.crew.name = 'Unilag Mass Comm Class of 2019 Reunion Committee 🌴';
  db.crew.vibe = 'Owambe energy on a Tuesday budget, small chops compulsory, nobody is driving to Ajah after 9pm abeg';
  db.crew.areas = [area('Lekki Phase 1'), area('Ojodu Berger'), area('Festac Town'), area('Ikorodu')];
  const names = [
    ['m0', 'Oluwadamilọlá Adébáyọ̀-Ọláolúwa', 'Ojodu Berger'], ['m1', 'Jo', 'Yaba'], ['m2', 'Abdulrahman Muhammad-Bello', 'Surulere'],
    ['m3', 'Chukwuemekachukwu', 'Lekki Phase 1'], ['m4', '🎧 DJ Spinall-not-that-one', 'Ikeja GRA'], ['m5', 'Ọmọ́tọ́ṣọ́', 'Akoka'],
    ['m6', 'Ngozi', 'Ajah'], ['m7', 'Ẹniọlá', 'Gbagada'], ['m8', 'Zainab', 'Lekki Phase 1'],
  ];
  for (let i = 9; i < 41; i++) names.push(['m' + i, ['Tolu', 'Kelechi', 'Bisi', 'Musa', 'Ifeoma', 'Segun', 'Halima', 'Uche'][i % 8] + ' ' + String.fromCharCode(65 + (i % 26)) + '.', ['Yaba', 'Ikeja', 'Ajah', 'Surulere'][i % 4]]);
  db.members = names.map(([id, name, a]) => ({ id, name, area: { label: a }, joinedAt: lagosDate(-30, 12) }));
  const many = Object.fromEntries(names.slice(0, 23).map(([id]) => [id, 'going']));
  ['m30', 'm31', 'm32', 'm33', 'm34', 'm35'].forEach((id) => { many[id] = 'maybe'; });
  const [suya, mono, ritual, groove] = db.plans;
  suya.title = 'Afrobeats Brunch and Day Party: Detty December Warm-Up Edition (Rooftop, Strictly by RSVP, Dress Code All White)';
  suya.place = { ...suya.place, name: 'The Rooftop at Landmark Beach Resort, Water Corporation Drive, Oniru' };
  suya.price = { text: 'Early bird ₦15,000, regular ₦25,000, table for 6 ₦450,000 with a bottle of Hennessy', free: false };
  suya.rsvps = { m1: 'going' };
  mono.rsvps = {};
  mono.place = { name: "Ọmọ́tọ́ṣọ́'s place", address: null, lat: null, lon: null, outdoor: false, private: true, hidden: true };
  mono.host = 'm5';
  mono.bring = ['Your own Monopoly money because last time somebody ate the ₦500 notes', 'Ice', 'A speaker that actually charges', 'Chin chin'];
  mono.end = null;
  ritual.rsvps = many;
  ritual.place = { ...ritual.place, name: 'Johnson Jakande Tinubu Park (JJT Park), Alausa Secretariat' };
  ritual.why = ritual.why + ' With 23 people coming from four corners of Lagos, it is the fairest middle the sloth could find, and the longest trip is still the one from Ikorodu.';
  groove.rsvps = { m4: 'going', m7: 'maybe' };
  groove.weather = { checkedAt: lagosDate(0, 8), summary: 'Heavy thunderstorms likely from 5pm, with strong winds near the lagoon and flooding on low roads', rainProb: 90, tempC: 26, ok: false };
  db.plans.push({ ...suya, id: 'p-same-day', title: 'Ok', kind: 'quick', place: { name: null, address: null, lat: null, lon: null, outdoor: false, private: false }, rsvps: {}, price: null, start: suya.start, weather: null });
  return db;
}

function load() {
  const raw = sessionGet('ct.mockdb');
  if (raw) { try { return JSON.parse(raw); } catch { /* reseed */ } }
  const data = sessionGet('ct.data');
  const db = data === 'worst' || data === 'quiet' ? seedWorst() : seed();
  // a quiet week for the worst-case crew: only the sloth's pick, so the ideas card shows
  if (data === 'quiet') db.plans = db.plans.filter((p) => p.kind === 'ritual');
  if (data === 'empty') { db.plans = []; db.members = db.members.slice(0, 1); }
  sessionSet('ct.mockdb', JSON.stringify(db));
  return db;
}
function save(db) { sessionSet('ct.mockdb', JSON.stringify(db)); }

const tokenFor = (id) => 'tok_' + id;
const memberFrom = (token) => (token && token.startsWith('tok_') ? token.slice(4) : null);
function err(status, message, code = 'mock') {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  throw e;
}

// PlanView: what a viewer may see, plus names and the viewer's own answer
function view(db, plan, viewerId) {
  const name = (id) => db.members.find((m) => m.id === id)?.name;
  const going = Object.entries(plan.rsvps).filter(([, v]) => v === 'going').map(([id]) => name(id)).filter(Boolean);
  const maybe = Object.entries(plan.rsvps).filter(([, v]) => v === 'maybe').map(([id]) => name(id)).filter(Boolean);
  const w = plan.weather;
  return {
    ...plan,
    going, maybe,
    you: viewerId ? plan.rsvps[viewerId] || null : null,
    eventIcsUrl: viewerId ? '/mock/event.ics' : undefined,
    headsUp: w && !w.ok ? { text: `Heads up: ${w.summary.toLowerCase()} for ${plan.title}.`, whatsappUrl: `https://wa.me/?text=${encodeURIComponent(`Heads up: ${w.summary.toLowerCase()} for ${plan.title}.`)}` } : null,
    place: plan.place?.private && !viewerId ? { ...plan.place, address: null, lat: null, lon: null, hidden: true } : plan.place,
  };
}

// ---------- crews ----------

function draftCrew(sentence) {
  const s = sentence.toLowerCase();
  const first = sentence.split(/[,.]/)[0].trim();
  const vague = first.split(/\s+/).length > 5 || first.length < 3;
  const name = vague ? 'The crew' : first.replace(/^\w/, (c) => c.toUpperCase());
  const every = /every other|fortnight|every two/.test(s) ? '2w' : /month/.test(s) ? '4w' : /every|weekly/.test(s) ? '1w' : null;
  const dayIdx = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].findIndex((d) => s.includes(d));
  const found = AREAS.filter(([l]) => s.includes(l.toLowerCase().split(' ')[0])).slice(0, 4).map(([l, , lat, lon]) => ({ label: l, lat, lon }));
  const tags = [];
  if (/outside|outdoor|park|beach/.test(s)) tags.push('outdoors');
  if (/cheap|budget|broke/.test(s)) tags.push('cheap');
  if (/chill|lazy|calm/.test(s)) tags.push('chill');
  const vibe = tags.length ? tags.join(' and ').replace(/^\w/, (c) => c.toUpperCase()).replace('Outdoors', 'Outside') : 'Easy and low-key';
  const confidence = { name: vague ? 0.3 : 0.85, rhythm: every ? 0.9 : 0.35, areas: found.length ? 0.9 : 0.3, vibe: tags.length ? 0.8 : 0.4 };
  return {
    draft: {
      name, vibe, vibeTags: tags, budget: tags.includes('cheap') ? 'cheap' : 'any',
      rhythm: every ? { every, day: dayIdx >= 0 ? dayIdx : 6, window: { from: '15:00', to: '19:00' } } : null,
      areas: found.length ? found : [area('Yaba')],
    },
    confidence,
    low: Object.entries(confidence).filter(([, v]) => v < 0.6).map(([k]) => k),
  };
}

function createCrew(db, { confirm, organiser }) {
  const slug = (confirm.name || 'crew').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'crew';
  const inviteToken = 'inv_' + Math.random().toString(36).slice(2, 8);
  db.crew = { ...db.crew, ...confirm, slug, id: 'c-new', inviteToken };
  db.members = [];
  db.plans = [];
  const out = { crew: db.crew, inviteUrl: `${location.origin}/c/${slug}?t=${inviteToken}`, inviteToken };
  if (organiser?.name) Object.assign(out, addMember(db, organiser));
  return out;
}

function addMember(db, { name, area: a }) {
  const id = 'm' + Math.random().toString(36).slice(2, 7);
  const ar = typeof a === 'string' ? area(a) : (a?.lat != null ? a : area(a?.label || ''));
  const member = { id, crewId: db.crew.id, name, area: ar, calToken: 'cal_' + id, joinedAt: new Date().toISOString() };
  db.members.push({ id, name, area: { label: ar.label }, joinedAt: member.joinedAt });
  return {
    member, memberToken: tokenFor(id), memberUrl: `${location.origin}/c/${db.crew.slug}?m=${tokenFor(id)}`,
    calendarUrl: `${location.origin}/cal/${member.calToken}.ics`,
    webcalUrl: `webcal://${location.host}/cal/${member.calToken}.ics`,
  };
}

// Three ideas for a quiet weekend. Demo data only: the real ones come from the server.
export function ideas() {
  const sat = nextDow(6, 1), sun = nextDow(0, 1);
  const idea = (id, title, reason, place, day, hh, hours, kind, source = null) => ({
    id, title, why: reason, place, source,
    when: `${day === sun ? 'Sunday' : 'Saturday'}, ${hh - 12} to ${hh + hours - 12}pm`,
    draftPlan: { kind, title, start: lagosDate(day, hh), end: lagosDate(day, hh + hours), tz: 'Africa/Lagos', place, price: null, host: null, bring: [], source: source?.url ? { url: source.url } : {} },
  });
  if (/worst|quiet/.test(sessionGet('ct.data') || '')) {
    return [
      idea('i-long', 'Lagos Jazz Series Presents: An Evening of Highlife, Juju and Afro Jazz Classics Under the Stars (Rooftop Edition)', 'Starts after the heat breaks, about 40 minutes for most of you, and the Ikorodu side shares one ride through Ketu.', { ...PLACES.freedom, name: 'Freedom Park Lagos, Old Broad Street, Lagos Island (by the Broad Street gate)' }, sun, 16, 3, 'found', { name: 'Awe Lagos', url: 'https://example.com/a-very-long-guide-url/weekly/2026/10/everything-happening-in-lagos-this-weekend', credit: "From a Lagos weekly guide with a very long name (demo)" }),
      idea('i-ok', 'Ok', '', PLACES.muri, sat, 15, 3, 'quick'),
      idea('i-noplace', 'Small chops and catch-up', 'Nobody has been out since the wedding.', null, sat, 16, 2, 'quick'),
    ];
  }
  return [
    idea('i-freedom', 'Sunday evening at Freedom Park', 'Lagos Island is about the middle for Yaba and Lekki, and the evening is cooler.', PLACES.freedom, sun, 16, 3, 'found', { name: 'A Lagos guide (demo)', url: null, credit: "From a Lagos weekly guide (demo)" }),
    idea('i-muri', 'Lazy Saturday at Muri Okunola Park', 'Shade, space for a mat, and nobody has picked it this month.', PLACES.muri, sat, 15, 3, 'quick'),
    idea('i-jjt', 'Small chops at JJT Park', 'Closest for the Ikeja side, so they skip the bridge for once.', PLACES.jjt, sat, 16, 2, 'quick'),
  ];
}

export async function setArea(memberId, body) {
  await wait(500);
  const db = load();
  const m = db.members.find((x) => x.id === memberId);
  const label = body.near ? 'Yaba' : (typeof body.area === 'string' ? body.area : body.area?.label);
  if (m) { m.area = { label }; save(db); }
  return { you: m ? { id: m.id, name: m.name, area: { label } } : null, notes: [] };
}

export async function areas(text) {
  await wait(150);
  const t = text.trim().toLowerCase();
  if (!t) return [];
  return AREAS.filter(([l]) => l.toLowerCase().includes(t))
    .sort((a, b) => a[0].toLowerCase().indexOf(t) - b[0].toLowerCase().indexOf(t))
    .slice(0, 5)
    .map(([label, detail, lat, lon]) => ({ label, detail: `${detail}, Lagos`, lat, lon }));
}

// ---------- plans ----------

function parsePlan(viewer, { text, url, image }) {
  const sat = nextDow(6, 1), fri = nextDow(5, 1);
  const pack = (draft, confidence, notes = []) => ({
    draft: { tz: 'Africa/Lagos', host: null, hostName: null, bring: [], price: null, ...draft },
    confidence, low: Object.entries(confidence).filter(([, v]) => v < 0.6).map(([k]) => k), notes,
  });
  if (image) {
    return pack({
      kind: 'found', title: 'Highlife on the Lagoon', start: lagosDate(sat + 7, 17), end: null,
      place: { name: 'Terra Kulture Arena', address: '1376 Tiamiyu Savage St, Victoria Island', lat: 6.4262, lon: 3.4237, outdoor: false, private: false },
      price: { text: '₦10,000, or ₦8,000 early bird', free: false }, source: { url: url || undefined, image: true },
    }, { title: 0.95, start: 0.5, end: 0.2, place: 0.9, price: 0.85 },
    ['The flyer says "Sat 31st" with no month, so the date is the next Saturday the 31st.', 'There is no end time on the flyer.']);
  }
  if (url) {
    return pack({
      kind: 'found', title: 'Lagos Photo Walk: Lagos Island', start: lagosDate(sat, 8), end: lagosDate(sat, 11),
      place: { name: 'Tinubu Square', address: 'Broad St, Lagos Island', lat: 6.4531, lon: 3.3895, outdoor: true, private: false },
      price: null, bring: ['Water', 'Comfortable shoes'], source: { url },
    }, { title: 0.9, start: 0.85, end: 0.8, place: 0.55, price: 0.95 }, ['The page names two meeting points. This is the first one.']);
  }
  const s = (text || '').toLowerCase();
  const hosted = /\bmine\b|my place|at mine|bring/.test(s);
  const me = db0().members.find((m) => m.id === viewer);
  if (hosted) {
    return pack({
      kind: 'hosted', title: 'Wine and Monopoly at yours', start: lagosDate(fri, 19), end: null,
      place: { name: me ? `${me.name.split(' ')[0]}'s place` : 'Your place', address: null, lat: null, lon: null, outdoor: false, private: true },
      host: viewer, hostName: me?.name || null, bring: ['A bottle'], source: { text },
    }, { title: 0.8, start: 0.85, end: 0.2, place: 0.4 }, ['Add your address. Only the crew sees it.']);
  }
  return pack({
    kind: 'quick', title: (text || 'Hang out').replace(/\?$/, '').replace(/^who'?s (up|down) for /i, '').replace(/^\w/, (c) => c.toUpperCase()),
    start: lagosDate(0, 20), end: null, place: { name: null, address: null, lat: null, lon: null, outdoor: true, private: false }, source: { text },
  }, { title: 0.8, start: 0.7, end: 0.2, place: 0.2 }, ['No place in the message.']);
}

const km = (a, b) => {
  const R = 6371, toR = (x) => (x * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLon = toR(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

function pods(db, plan) {
  if (!plan || !plan.place?.lat) return { pods: [], unplaced: [], rides: RIDES };
  // The host is already there, so the host never needs a ride.
  const going = Object.entries(plan.rsvps).filter(([mid, v]) => v === 'going' && mid !== plan.host).map(([mid]) => db.members.find((m) => m.id === mid)).filter(Boolean);
  const hubs = [area('Yaba'), area('Lekki Phase 1'), area('Ikeja'), area('Surulere')];
  const groups = new Map();
  for (const m of going) {
    const a = area(m.area.label);
    const hub = hubs.reduce((best, h) => (km(a, h) < km(a, best) ? h : best), hubs[0]);
    if (!groups.has(hub.label)) groups.set(hub.label, { hub, people: [] });
    groups.get(hub.label).people.push(m);
  }
  const dest = plan.place;
  const list = [...groups.values()].map(({ hub, people }) => {
    const travelMin = Math.round(km(hub, dest) * 3.2 + 12);
    const leave = new Date(new Date(plan.start).getTime() - (travelMin + 10) * 60e3);
    leave.setUTCMinutes(Math.floor(leave.getUTCMinutes() / 5) * 5, 0, 0);
    const crossesLagoon = (hub.lon > 3.41) !== (dest.lon > 3.41) || (hub.lat > 6.47 && dest.lat < 6.46);
    return {
      memberIds: people.map((p) => p.id), names: people.map((p) => p.name), fromLabel: hub.label, solo: people.length === 1,
      leaveBy: leave.toISOString(), travelMin, crossesLagoon,
      bridge: null,
      estimate: { band: 'weekend', source: 'straight', text: `A rough estimate, not live traffic: ${Math.round(km(hub, dest) * 1.4 * 10) / 10} km at about 22 km/h in weekend traffic (the road route was not available, so this is the straight line plus 40%)${crossesLagoon ? ', 8 min in case the trip crosses the lagoon' : ''}. Leave-by adds 15 min to spare.` },
      destinationText: [dest.name, dest.address].filter(Boolean).join(', '),
      shareText: `Leaving ${hub.label} by ${leave.toISOString()} for ${plan.title}`,
    };
  });
  return { pods: list, unplaced: [], rides: RIDES };
}

// The same list the server sends (src/core/rides.mjs), Bolt first
const RIDES = [
  { id: 'bolt', name: 'Bolt', blurb: '', links: { android: 'https://play.google.com/store/apps/details?id=ee.mtakso.client', ios: 'https://apps.apple.com/ng/app/bolt-request-a-ride/id675033630', web: 'https://bolt.eu/en-ng/cities/lagos/' }, dropoff: false },
  { id: 'indrive', name: 'inDrive', blurb: 'You name the fare.', links: { android: 'https://play.google.com/store/apps/details?id=sinet.startup.inDriver', ios: 'https://apps.apple.com/ng/app/indrive-rides-at-your-price/id780125801', web: 'https://indrive.com/en-ng/' }, dropoff: false },
  { id: 'lagride', name: 'LagRide', blurb: 'Backed by Lagos State.', links: { android: 'https://play.google.com/store/apps/details?id=com.lagos.emobility.client', ios: 'https://apps.apple.com/ng/app/lagride/id6738812036', web: 'https://www.lagride.ng/' }, dropoff: false },
];

let _db;
function db0() { return _db || (_db = load()); }

// The router: method + path, like the real server
export async function handle(method, path, { body, form, token }) {
  const db = load();
  _db = db;
  const viewer = memberFrom(token);
  const url = new URL(path, location.origin);
  const p = url.pathname;
  let m;
  if (form) body = { text: form.get('text') || undefined, url: form.get('url') || undefined, image: form.get('image') || undefined };

  if (method === 'POST' && p === '/api/crews') {
    await wait(body.sentence ? 1500 : 700);
    if (body.sentence) return draftCrew(body.sentence);
    const out = createCrew(db, body);
    save(db);
    return out;
  }
  if (method === 'GET' && (m = p.match(/^\/api\/crews\/([^/]+)$/))) {
    await wait(350);
    const you = viewer ? db.members.find((x) => x.id === viewer) : null;
    const plans = db.plans.filter((x) => x.status !== 'cancelled').sort((a, b) => a.start.localeCompare(b.start)).map((x) => view(db, x, viewer));
    // The demo crew answers to any slug, so shared demo links never 404.
    return { crew: { ...db.crew, slug: decodeURIComponent(m[1]) }, members: db.members, plans, you: you ? { id: you.id, name: you.name } : null };
  }
  if (method === 'POST' && (m = p.match(/^\/api\/crews\/([^/]+)\/members$/))) {
    await wait(800);
    if (!body.name?.trim()) err(400, 'Add your name so the crew knows who is coming.');
    const out = addMember(db, body);
    save(db);
    return out;
  }
  if (method === 'POST' && p.endsWith('/plans/parse')) {
    await wait(body.image ? 2600 : 1500);
    return parsePlan(viewer, body);
  }
  if (method === 'POST' && p.endsWith('/plans')) {
    await wait(600);
    const me = viewer || 'm0';
    const draft = body.plan;
    const plan = {
      id: 'p-' + Math.random().toString(36).slice(2, 8), crewId: db.crew.id, tz: 'Africa/Lagos', why: null, invite: null, weather: null,
      status: 'on', rsvps: { [me]: 'going' }, createdBy: me, createdAt: new Date().toISOString(), bring: [], confidence: {}, ...draft,
    };
    if (plan.source?.image && !plan.source.imageUrl) plan.source = { ...plan.source, imageUrl: '/mock/flyer-highlife.svg' };
    if (plan.place?.outdoor && plan.start) plan.weather = { checkedAt: new Date().toISOString(), summary: 'Dry most of the day', rainProb: 15, tempC: 30, ok: true };
    db.plans.push(plan);
    save(db);
    return { plan: view(db, plan, viewer) };
  }
  if (method === 'POST' && p.endsWith('/first-pick')) {
    await wait(2200);
    let r = db.plans.find((x) => x.kind === 'ritual');
    if (!r && db.crew.rhythm) {
      const day = nextDow(db.crew.rhythm.day ?? 6, 1);
      r = {
        id: 'p-first', crewId: db.crew.id, kind: 'ritual', title: 'Saturday at Muri Okunola Park', start: lagosDate(day, 15), end: lagosDate(day, 18),
        tz: 'Africa/Lagos', place: PLACES.muri, price: null, host: null, bring: [], source: {}, status: 'on', confidence: {}, rsvps: {},
        why: 'Muri Okunola Park keeps everyone within about 35 minutes, and it has shade for the afternoon.',
        invite: 'Saturday, 3 to 6pm at Muri Okunola Park. Mats out, music low. Come through if you can.',
        weather: { checkedAt: new Date().toISOString(), summary: 'Dry, a little cloud', rainProb: 10, tempC: 30, ok: true }, createdBy: 'sloth', createdAt: new Date().toISOString(),
      };
      db.plans.push(r);
      save(db);
    }
    return { plan: r ? view(db, r, viewer) : null, reason: r ? 'made' : 'no_rhythm' };
  }
  if (method === 'PATCH' && (m = p.match(/^\/api\/plans\/([^/]+)$/))) {
    await wait(250);
    const plan = db.plans.find((x) => x.id === m[1]);
    if (!plan) err(404, "That plan isn't here any more.");
    const me = viewer || 'm0';
    if ('rsvp' in body) { if (body.rsvp) plan.rsvps[me] = body.rsvp; else delete plan.rsvps[me]; }
    save(db);
    return { plan: view(db, plan, viewer) };
  }
  if (method === 'GET' && (m = p.match(/^\/api\/plans\/([^/]+)\/pods$/))) {
    await wait(400);
    return pods(db, db.plans.find((x) => x.id === m[1]));
  }
  err(404, 'The demo does not know that request.');
}

export function _reset() { sessionSet('ct.mockdb', ''); }
export function _seedMember(slug, id = 'm0') {
  const m = MEMBERS.find((x) => x[0] === id);
  saveCrew(slug, { name: 'The Yaba Lot', memberId: id, memberName: m[1], memberToken: tokenFor(id), invite: 'inv_demo', calendarUrl: `${location.origin}/cal/cal_${id}.ics`, webcalUrl: `webcal://${location.host}/cal/cal_${id}.ics` });
}
