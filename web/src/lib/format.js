// Dates are shown in the crew's own time zone, whatever the phone is set to: a Lagos crew
// sees Lagos time, a Berlin crew Berlin time. The zone comes with the crew (crew.tz) and is
// set here when a crew loads; before that, Lagos, where the app began.
let TZ = 'Africa/Lagos';
let dayKey, weekdayLong, weekdayShort, dayNum, monthShort, hourMin, hour24;
function build() {
  dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  weekdayLong = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long' });
  weekdayShort = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short' });
  dayNum = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric' });
  monthShort = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, month: 'short' });
  hourMin = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hourCycle: 'h12' });
  hour24 = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' });
}
build();

/** Show dates in this IANA zone from now on (the crew's). Unknown zones are ignored. */
export function setZone(tz) {
  if (!tz || tz === TZ) return;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
  } catch {
    return;
  }
  TZ = tz;
  build();
}
export const zone = () => TZ;

// The zone's offset from UTC at an instant, in minutes (Lagos 60; Berlin 60 or 120).
function offsetMin(ms) {
  const p = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms))) p[type] = value;
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000) / 60000);
}

// An instant as the crew's local date and time, for date and time inputs.
export function toLocalParts(iso) {
  if (!iso) return { date: '', time: '' };
  const ms = new Date(iso).getTime();
  const d = new Date(ms + offsetMin(ms) * 60000).toISOString();
  return { date: d.slice(0, 10), time: d.slice(11, 16) };
}

// The crew's local date and time as an instant (daylight saving included).
export function fromLocalParts(date, time) {
  if (!date) return null;
  const naive = Date.parse(`${date}T${time || '12:00'}:00Z`);
  let ms = naive - offsetMin(naive) * 60000;
  ms = naive - offsetMin(ms) * 60000;
  return new Date(ms).toISOString();
}

export function now() {
  return window.__CT_NOW ? new Date(window.__CT_NOW) : new Date();
}

function daysBetween(a, b) {
  const da = new Date(dayKey.format(a) + 'T00:00:00Z');
  const db = new Date(dayKey.format(b) + 'T00:00:00Z');
  return Math.round((db - da) / 86400000);
}

// "4pm", "7:30pm"
export function time(d) {
  if (!d) return '';
  const date = new Date(d);
  const parts = hourMin.formatToParts(date);
  const h = parts.find((p) => p.type === 'hour').value;
  const m = parts.find((p) => p.type === 'minute').value;
  const ap = (parts.find((p) => p.type === 'dayPeriod')?.value || '').toLowerCase().replace(/\./g, '').replace(/\s/g, '');
  return (m === '00' ? h : `${h}:${m}`) + ap;
}

// "4 to 7pm" or "10pm to 2am"
export function timeRange(start, end) {
  if (!start) return '';
  if (!end) return time(start);
  const a = time(start), b = time(end);
  const ap = (s) => s.slice(-2);
  if (ap(a) === ap(b)) return `${a.slice(0, -2)} to ${b}`;
  return `${a} to ${b}`;
}

// "Tonight", "Today", "Tomorrow", "Saturday", "Sat 31 Oct"
export function dayLabel(d) {
  const date = new Date(d);
  const diff = daysBetween(now(), date);
  if (diff === 0) return Number(hour24.format(date)) >= 17 ? 'Tonight' : 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff > 1 && diff < 7) return weekdayLong.format(date);
  return `${weekdayShort.format(date)} ${dayNum.format(date)} ${monthShort.format(date)}`;
}

export function dayParts(d) {
  const date = new Date(d);
  return { wd: weekdayShort.format(date), num: dayNum.format(date), mon: monthShort.format(date), diff: daysBetween(now(), date) };
}

export function weekday(d) {
  return weekdayLong.format(new Date(d));
}

export function isPast(plan) {
  const end = plan.end || plan.start;
  return new Date(end) < now();
}

// Avatar colour from a stable hash of the member id or name
export function avatarTone(key = '') {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const n = (h % 6) + 1;
  return { '--av-bg': `var(--av-${n})`, '--av-ink': `var(--av-${n}-ink)` };
}

// Split into user-perceived characters, so "Ọ́" or an emoji stays whole.
const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
function graphemes(s) {
  return seg ? Array.from(seg.segment(s), (x) => x.segment) : Array.from(s);
}
// Words that start with a letter or a digit. "🎧 DJ Spinall" gives ["DJ", "Spinall"].
function words(name) {
  const all = String(name || '').trim().split(/\s+/).filter(Boolean);
  const real = all.filter((w) => /^[\p{L}\p{N}]/u.test(w));
  return real.length ? real : all;
}

export function initials(name = '') {
  const w = words(name);
  if (!w.length) return '?';
  const first = graphemes(w[0])[0] || '?';
  const last = w.length > 1 ? graphemes(w[w.length - 1])[0] : '';
  return (first + last).toUpperCase();
}

export function firstName(name = '') {
  return words(name)[0] || String(name || '').trim() || '?';
}

export function firstInitial(name = '') {
  return graphemes(initials(name))[0] || '?';
}

// "Tobi", "Tobi and Ada", "Tobi, Ada and 3 others"
export function nameList(names, max = 2) {
  if (!names.length) return '';
  if (names.length === 1) return names[0];
  if (names.length <= max) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const rest = names.length - max;
  return `${names.slice(0, max).join(', ')} and ${rest} ${rest === 1 ? 'other' : 'others'}`;
}

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function rhythmText(r) {
  if (!r || !r.every) return 'No regular day';
  const every = { '1w': 'Every', '2w': 'Every other', '4w': 'Once a month on a' }[r.every] || 'Every';
  const day = DAYS[r.day ?? 6];
  const win = r.window ? `, ${clock(r.window.from)} to ${clock(r.window.to)}` : '';
  return `${every} ${day}${win}`;
}

export function clock(hhmm = '') {
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h)) return hhmm;
  const ap = h >= 12 ? 'pm' : 'am';
  const h12 = ((h + 11) % 12) + 1;
  return m ? `${h12}:${String(m).padStart(2, '0')}${ap}` : `${h12}${ap}`;
}
