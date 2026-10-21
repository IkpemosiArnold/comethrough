import { Icon } from './icons.jsx';
import { back } from '../lib/router.js';
import { firstName } from '../lib/format.js';

export function TopBar({ title, backTo, right, onBack }) {
  return (
    <header class="topbar">
      {backTo !== undefined && (
        <button class="icon-btn" onClick={() => (onBack ? onBack() : back(backTo))} aria-label="Back">
          <Icon name="back" />
        </button>
      )}
      <div class="title grow">{title}</div>
      {right}
    </header>
  );
}

export function Dots() {
  return <span class="dots" aria-hidden="true"><i /><i /><i /></span>;
}

export function Spinner({ label = 'Loading' }) {
  return (
    <div class="center-load" role="status">
      <Dots />
      <span class="sr-only">{label}</span>
    </div>
  );
}

export const KIND = {
  found: { label: 'Event', cls: 'found' },
  hosted: { label: "At someone's", cls: 'hosted' },
  ritual: { label: "Sloth's pick", cls: 'ritual' },
  quick: { label: 'Quick one', cls: 'quick' },
};

// A house plan says whose house: "At Tolu's".
export function KindSticker({ kind, host = null }) {
  const k = KIND[kind] || KIND.quick;
  const label = kind === 'hosted' && host?.name ? `At ${firstName(host.name)}'s` : k.label;
  return <span class={`sticker sticker-${k.cls}`}>{label}</span>;
}

export function ErrorNote({ error, onRetry }) {
  if (!error) return null;
  return (
    <div class="error-note" role="alert">
      <p>{error.message || String(error)}</p>
      {onRetry && <button class="btn ghost" onClick={onRetry}>Try again</button>}
    </div>
  );
}
