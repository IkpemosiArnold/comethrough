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
      The sloth uses Gemma, Google's open model, to read and write. What you send here goes to Google. <a href="/how">How the sloth works</a>
    </p>
  );
}
