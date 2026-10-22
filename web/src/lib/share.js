// What the crew sees in WhatsApp. For most friends this text is all of Come Through they
// need: the plan in the first line, then one link per answer. "I'm in" marks you going in
// one tap (the first time on a phone it asks only for a name), and the plan page behind it
// is the receipt: who's going, rides, the map. No dashes, and nothing says "check the app".

/** A wa.me link that opens WhatsApp with the text ready to send to a chat. */
export function whatsappUrl(text) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * A plan's links, carrying the crew's invite key (never a member's own key, which would
 * let others answer as that member).
 * @param {string} origin @param {string} slug @param {string} id @param {string|null} key
 */
export function planLinks(origin, slug, id, key) {
  const q = key ? `?t=${encodeURIComponent(key)}` : '';
  const base = `${origin}/c/${slug}/p/${id}`;
  return { url: `${base}${q}`, in: `${base}/in${q}`, maybe: `${base}/maybe${q}` };
}

// "Highlife Under Mangoes, Saturday, 5 to 9pm at The Mango Yard"; a sloth's pick is already
// named after its day and place, so it reads "Saturday, 3 to 6pm at Muri Okunola Park".
function line({ title, when, place, kind }) {
  const at = place ? ` at ${place}` : '';
  return kind === 'ritual' && place ? `${when}${at}` : `${title}, ${when}${at}`;
}

const answers = (links) => `I'm in: ${links.in}\nMaybe: ${links.maybe}`;

/**
 * The message for a plan: what it is, then "I'm in" and "Maybe".
 * @param {{ title: string, when: string, place?: string|null, kind?: string, links: { url: string, in: string, maybe: string }, mine?: 'going'|'maybe'|null, asks?: string|null }} p
 */
export function planMessage({ title, when, place, kind, links, mine = null, asks = null }) {
  // what a member's plan asks of people ("Bring wine. Come freshly waxed.") travels with it
  const ask = kind !== 'ritual' && asks ? ` ${asks}` : '';
  if (mine === 'going') return `I'm going to ${line({ title, when, place, kind })}.${ask} Come through?\n${answers(links)}`;
  return `${line({ title, when, place, kind })}.${ask} Come through?\n${answers(links)}`;
}

/** What a plan asks of people, as one line: "Bring wine and ice. Come freshly waxed." (src/core/plans.mjs, planAsks). */
export function planAsks(plan) {
  const bring = (plan?.bring || []).filter(Boolean);
  const list = bring.length <= 1 ? bring.join('') : `${bring.slice(0, -1).join(', ')} and ${bring[bring.length - 1]}`;
  const note = plan?.note ? (/[.!?]$/.test(plan.note) ? plan.note : `${plan.note}.`) : '';
  return [list ? `Bring ${list}.` : '', note].filter(Boolean).join(' ') || null;
}

/**
 * The invite to the group chat. With a plan (the sloth's first pick, or the next plan), it is
 * that plan's message; without one, it says what the link is for.
 * @param {{ crewName: string, url: string, plan?: { title: string, when: string, place?: string|null, kind?: string, links: { url: string, in: string, maybe: string } }|null }} p
 */
export function inviteMessage({ crewName, url, plan = null }) {
  if (plan) return planMessage(plan);
  return `Plans for ${crewName} live here now, so nobody has to chase the group chat. See what's on: ${url}`;
}
