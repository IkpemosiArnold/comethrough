// What the crew sees in WhatsApp. For most friends this text is the first screen of Come
// Through, so the plan comes first, the link last, and one short reason to tap sits between.
// Every "tell the crew" action is a wa.me link with the plan's own link in the text. Push is
// the nudge for people who turned it on, and the calendar is an extra. No dashes in the text.

/** A wa.me link that opens WhatsApp with the text ready to send to a chat. */
export function whatsappUrl(text) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

// "Highlife Under Mangoes, Saturday, 5 to 9pm at The Mango Yard"; a sloth's pick is already
// named after its day and place, so it reads "Saturday, 3 to 6pm at Muri Okunola Park".
function line({ title, when, place, kind }) {
  const at = place ? ` at ${place}` : '';
  return kind === 'ritual' && place ? `${when}${at}` : `${title}, ${when}${at}`;
}

/**
 * The message for a plan.
 * @param {{ title: string, when: string, place?: string|null, url: string, kind?: string, mine?: 'going'|'maybe'|null, posted?: boolean }} p
 */
export function planMessage({ title, when, place, url, kind, mine = null, posted = false }) {
  if (mine === 'going') return `I'm going to ${line({ title, when, place, kind })}. Come through?\n${url}`;
  if (posted) return `${line({ title, when, place, kind })}. Come through?\nTap if you're coming: ${url}`;
  return `${line({ title, when, place, kind })}. Come through?\n${url}`;
}

/**
 * The invite to the group chat. With a plan (the sloth's first pick, or the next plan), the
 * plan is the first line and the link opens that plan; without one, it says what the link is for.
 * @param {{ crewName: string, url: string, plan?: { title: string, when: string, place?: string|null, kind?: string, url: string }|null }} p
 */
export function inviteMessage({ crewName, url, plan = null }) {
  if (plan) return `${line(plan)}. Come through?\nTap if you're coming: ${plan.url}`;
  return `Plans for ${crewName} live here now, so nobody has to chase the group chat. Tap once when you're coming: ${url}`;
}
