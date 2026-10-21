// Dev-only switch for break-ui: swaps the mock dataset at the data boundary.
// Shows only in the mock with ?data= set, never against the real server.
import { MOCK } from '../lib/api.js';
import { sessionGet } from '../lib/store.js';

const STATES = [['demo', 'Demo data'], ['worst', 'Worst case'], ['empty', 'Empty']];

export function DataToggle() {
  const current = sessionGet('ct.data');
  if (!MOCK || !current) return null;
  function pick(v) {
    const u = new URL(location.href);
    u.searchParams.set('mock', '1');
    u.searchParams.set('data', v);
    location.href = u.toString();
  }
  return (
    <div class="data-toggle" role="group" aria-label="Test data">
      {STATES.map(([v, label]) => (
        <button key={v} aria-pressed={current === v} onClick={() => pick(v)}>{label}</button>
      ))}
    </div>
  );
}
