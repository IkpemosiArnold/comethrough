// One-time cards, remembered on this phone ("Got another crew?", a plan's Status card), and
// small per-crew settings (a discreet crew's opt-in to the Status card). The server also
// remembers what a member has seen (growth.seen), so a second phone does not ask again.

const KEY = 'ct.once.v1';

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}
export function doneHere(key) {
  return !!read()[key];
}
export function markHere(key, value = Date.now()) {
  const all = read();
  all[key] = value;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage unavailable */ }
}
export function clearHere(key) {
  const all = read();
  delete all[key];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage unavailable */ }
}
