import { Icon } from './icons.jsx';
import { back } from '../lib/router.js';

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
  hosted: { label: 'Hosted', cls: 'hosted' },
  ritual: { label: "Sloth's pick", cls: 'ritual' },
  quick: { label: 'Quick one', cls: 'quick' },
};

export function KindSticker({ kind }) {
  const k = KIND[kind] || KIND.quick;
  return <span class={`sticker sticker-${k.cls}`}>{k.label}</span>;
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
