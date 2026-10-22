// Faces are sloths: each member gets their own painted sloth with one thing it wears, the same
// one every time (src/core/avatar.mjs, shared with the server's WhatsApp cards). A member who
// added their own photo shows it instead, to the crew only.
import { avatarInner } from '../../../src/core/avatar.mjs';
import { firstName } from '../lib/format.js';

const drawn = new Map();
const inner = (id) => {
  let s = drawn.get(id);
  if (!s) drawn.set(id, (s = avatarInner(id)));
  return s;
};

export function Avatar({ member, size = '', ring, style, class: cls = '' }) {
  const name = member?.name || '?';
  return (
    <span class={`avatar sloth-av ${size} ${cls}`} style={{ ...(ring ? { '--ring': ring } : {}), ...style }} title={name} aria-hidden="true">
      {member?.faceUrl
        ? <img src={member.faceUrl} alt="" width="56" height="56" loading="lazy" decoding="async" />
        : <svg viewBox="0 0 48 48" dangerouslySetInnerHTML={{ __html: inner(member?.id || name) }} />}
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
