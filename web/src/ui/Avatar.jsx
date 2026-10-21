import { avatarTone, initials, firstName } from '../lib/format.js';

export function Avatar({ member, size = '', ring, style, class: cls = '' }) {
  const name = member?.name || '?';
  return (
    <span
      class={`avatar ${size} ${cls}`}
      style={{ ...avatarTone(member?.id || name), ...(ring ? { '--ring': ring } : {}), ...style }}
      title={name}
      aria-hidden="true"
    >
      {size === 'lg' || size === 'xl' ? initials(name) : initials(name).slice(0, 1)}
    </span>
  );
}

// A small overlapping stack of faces with a "+n" when there are more.
export function Faces({ members, max = 4, size = '', ring, label }) {
  const shown = members.slice(0, max);
  const rest = members.length - shown.length;
  const names = members.map((m) => firstName(m.name));
  return (
    <span class="faces" role="img" aria-label={label || names.join(', ')}>
      {shown.map((m) => <Avatar key={m.id} member={m} size={size} ring={ring} />)}
      {rest > 0 && <span class="more" aria-hidden="true">+{rest}</span>}
    </span>
  );
}
