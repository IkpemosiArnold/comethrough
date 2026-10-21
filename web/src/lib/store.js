// What this phone remembers: which crews you're in and your member token for each.
// Browser storage can be missing (private mode, cleared data), so every access is guarded.

const KEY = 'ct.crews.v1';

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}
function write(all) {
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage unavailable */ }
}

export function myCrews() {
  return Object.values(read()).sort((a, b) => (b.seenAt || 0) - (a.seenAt || 0));
}
export function getCrew(slug) {
  return read()[slug] || null;
}
export function saveCrew(slug, patch) {
  const all = read();
  all[slug] = { ...(all[slug] || { slug }), ...patch, seenAt: Date.now() };
  write(all);
  return all[slug];
}
export function forgetCrew(slug) {
  const all = read();
  delete all[slug];
  write(all);
}

// The last crew read, so the app still opens with no data connection.
export function readCrewCache(slug) {
  try { return JSON.parse(localStorage.getItem(`ct.cache.${slug}`) || 'null'); } catch { return null; }
}
export function writeCrewCache(slug, data) {
  try { localStorage.setItem(`ct.cache.${slug}`, JSON.stringify(data)); } catch { /* storage full or blocked */ }
}

export function sessionGet(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
export function sessionSet(key, value) {
  try { sessionStorage.setItem(key, value); } catch { /* ignore */ }
}
