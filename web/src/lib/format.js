// Dates are always shown in Lagos time, whatever the phone is set to.
const TZ = 'Africa/Lagos';

const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const weekdayLong = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long' });
const weekdayShort = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short' });
const dayNum = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric' });
const monthShort = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, month: 'short' });
const hourMin = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hourCycle: 'h12' });
const hour24 = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' });

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

export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = Array.from(parts[0])[0] || '?';
  const second = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] : '';
  return (first + (second || '')).toUpperCase();
}

export function firstName(name = '') {
  return name.trim().split(/\s+/)[0] || name;
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
