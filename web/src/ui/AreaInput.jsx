// Type-ahead for a neighbourhood. Suggestions come from the server's geocoder (Photon,
// biased to Lagos). Free text is fine too: the server geocodes it once.
import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../lib/api.js';

let uid = 0;

export function AreaInput({ value, onChange, placeholder = 'Yaba, Lekki Phase 1, Ikeja...', autoFocus, id, onEnter, label }) {
  const [text, setText] = useState(value?.label || '');
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const ctrl = useRef(null);
  const listId = useRef(`area-list-${++uid}`).current;

  useEffect(() => { setText(value?.label || ''); }, [value?.label]);

  useEffect(() => {
    const q = text.trim();
    if (q.length < 2 || q === value?.label) { setItems([]); return; }
    const timer = setTimeout(async () => {
      ctrl.current && ctrl.current.abort();
      ctrl.current = typeof AbortController !== 'undefined' ? new AbortController() : null;
      try {
        const res = await api.geocode(q, ctrl.current?.signal);
        setItems(res || []);
        setOpen(true);
        setActive(-1);
      } catch { /* aborted or offline: free text still works */ }
    }, 220);
    return () => clearTimeout(timer);
  }, [text]);

  function pick(item) {
    onChange({ label: item.label, lat: item.lat, lon: item.lon });
    setText(item.label);
    setOpen(false);
    setItems([]);
  }

  function onKey(e) {
    if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); setOpen(true); setActive((a) => (a + 1) % items.length); }
    else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); setActive((a) => (a <= 0 ? items.length - 1 : a - 1)); }
    else if (e.key === 'Enter') {
      if (open && active >= 0 && items[active]) { e.preventDefault(); pick(items[active]); }
      else if (onEnter) { e.preventDefault(); onEnter(); }
    } else if (e.key === 'Escape') setOpen(false);
  }

  return (
    <div class="combo">
      <input
        id={id}
        class="input"
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autocomplete="off"
        autocapitalize="words"
        enterkeyhint="done"
        placeholder={placeholder}
        value={text}
        autoFocus={autoFocus}
        onInput={(e) => { setText(e.currentTarget.value); onChange({ label: e.currentTarget.value }); }}
        onKeyDown={onKey}
        onFocus={() => items.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && items.length > 0 && (
        <ul class="combo-list" id={listId} role="listbox">
          {items.map((it, i) => (
            <li
              key={it.label + i}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              class={i === active ? 'active' : ''}
              onPointerDown={(e) => { e.preventDefault(); pick(it); }}
            >
              <span class="combo-main">{it.label}</span>
              {it.detail && <span class="combo-detail">{it.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
