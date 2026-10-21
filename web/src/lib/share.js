// What the crew sees in WhatsApp. WhatsApp is how a plan reaches people in Lagos: every
// "tell the crew" action is a wa.me link with the plan's own link in the text. Push is the
// nudge for people who turned it on, and the calendar is an extra. No dashes in the text.

/** A wa.me link that opens WhatsApp with the text ready to send to a chat. */
export function whatsappUrl(text) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * The message for a plan.
 * @param {{ title: string, when: string, place?: string|null, url: string, mine?: 'going'|'maybe'|null, posted?: boolean }} p
 */
export function planMessage({ title, when, place, url, mine = null, posted = false }) {
  const where = place ? `, ${place}` : '';
  if (mine === 'going') return `I'm going to ${title}, ${when}${where}. Come through: ${url}`;
  if (posted) return `New plan: ${title}, ${when}${where}. Tap the link and say if you're coming: ${url}`;
  return `${title}\n${when}${where}\nCome through: ${url}`;
}
