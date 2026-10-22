// Said once, at the moment it is true: the first time someone sends a sentence, a link or a
// flyer to be read. After their first send, this phone remembers and the line goes away.
// The full detail lives on one page, /how.
const KEY = 'ct.aiNoted';

export function aiNoted() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
export function markAiNoted() {
  try { localStorage.setItem(KEY, '1'); } catch { /* storage blocked: the line shows again */ }
}

export function AiNote() {
  if (aiNoted()) return null;
  return (
    <p class="fine ai-note">
      What you send goes to Google's Gemma. <a href="/how" aria-label="How the sloth works">How?</a>
    </p>
  );
}
