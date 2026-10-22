// The crew's name, the big painted title. A member taps it to rename the crew in place: it saves
// when you leave the field or press Enter, and a toast offers Undo. "Let the sloth name you"
// asks for three names from the crew's areas and what it's into; one tap uses one.
import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../lib/api.js';
import { toast } from './toast.jsx';
import { Dots } from './misc.jsx';
import { Icon } from './icons.jsx';

export const NAME_MAX = 40;
const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
const chars = (s) => (seg ? Array.from(seg.segment(s), (x) => x.segment) : Array.from(s));
/** At most 40 characters as people count them (an emoji is one). */
export const clipName = (s) => chars(String(s || '')).slice(0, NAME_MAX).join('');

export function CrewName({ crew, slug, canEdit, onRenamed }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(crew.name);
  const [ideas, setIdeas] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const input = useRef(null);
  const keep = useRef(false);

  useEffect(() => { if (!editing) setValue(crew.name); }, [crew.name, editing]);
  useEffect(() => {
    if (editing && input.current) { input.current.focus(); input.current.select(); }
  }, [editing]);

  async function save(name, { fromIdea = false } = {}) {
    const next = clipName(name).replace(/\s+/g, ' ').trim();
    if (!next || next === crew.name) { setEditing(false); setError(null); return; }
    setBusy(true);
    try {
      const r = await api.renameCrew(slug, next);
      setEditing(false);
      setIdeas(null);
      setError(null);
      onRenamed(r.name);
      toast(fromIdea ? `The crew is ${r.name} now` : 'Renamed', 5000, {
        label: 'Undo',
        onClick: () => api.renameCrew(slug, r.previous).then((u) => onRenamed(u.name)).catch(() => toast("Couldn't undo. Tap the name to change it back.")),
      });
    } catch (e) {
      setError(e.fields?.[0]?.message || e.message || "Couldn't rename the crew. Try again.");
      input.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  async function askSloth() {
    setIdeas('loading');
    try {
      const names = await api.crewNames(slug);
      setIdeas(names.length ? names : []);
    } catch (e) {
      setIdeas([]);
      toast(e.message || 'The sloth is busy. Type a name instead.');
    }
    input.current?.focus();
  }

  if (!canEdit) return <h1 class="display display-xl painted crew-name">{crew.name}</h1>;
  if (!editing) {
    return (
      <h1 class="display display-xl painted crew-name">
        <button class="crew-name-btn" onClick={() => setEditing(true)} aria-label={`${crew.name}. Rename the crew`}>{crew.name}<Icon name="edit" size={20} class="crew-name-pen" /></button>
      </h1>
    );
  }
  // keep the field's focus while a chip is tapped, so leaving it does not save half a name
  const hold = (e) => { keep.current = true; e.preventDefault(); };
  return (
    <div class="crew-name-edit">
      <label class="sr-only" for="crew-name-input">Crew name</label>
      <input
        id="crew-name-input"
        ref={input}
        class="display display-xl painted crew-name crew-name-input"
        value={value}
        maxLength={NAME_MAX * 4}
        enterkeyhint="done"
        autocomplete="off"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby="crew-name-help"
        disabled={busy}
        onInput={(e) => { const v = clipName(e.currentTarget.value); setValue(v); if (v !== e.currentTarget.value) e.currentTarget.value = v; setError(null); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); save(value); }
          if (e.key === 'Escape') { setValue(crew.name); setEditing(false); setError(null); }
        }}
        onBlur={() => { if (keep.current) { keep.current = false; return; } save(value); }}
      />
      <p id="crew-name-help" class={`crew-name-help small${error ? ' is-error' : ''}`}>
        {error || `${chars(value).length} of ${NAME_MAX}. Saves when you're done.`}
      </p>
      <div class="name-chips" role="group" aria-label="Name ideas">
        {ideas === null && (
          <button class="chip sloth-chip" onPointerDown={hold} onClick={askSloth}>Let the sloth name you</button>
        )}
        {ideas === 'loading' && <span class="chip sloth-chip is-busy">The sloth is thinking <Dots /></span>}
        {Array.isArray(ideas) && ideas.map((n) => (
          <button key={n} class="chip name-idea" onPointerDown={hold} onClick={() => save(n, { fromIdea: true })}>{n}</button>
        ))}
        {Array.isArray(ideas) && ideas.length === 0 && <span class="small muted">No ideas this time. Type one.</span>}
      </div>
    </div>
  );
}
