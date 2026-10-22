// @ts-check
// Words that say who people are rather than what they like (a safety requirement,
// docs/LOCAL-FACTS.md, "Sensitive attributes"). Kept apart from the taste so the web app can
// use the same list in the browser (the start screen says "You don't need to say who you are"
// when a sentence has one) without loading the rest of the taste code.

/**
 * Words that say who people are rather than what they like. High-risk categories are never
 * stored anywhere, the crew's name included; religion and ethnicity are kept out of the taste
 * and the vibe (a name the organiser chose, like "St Paul's youth", stays theirs).
 * Cuisines ("Lebanese food") are likes, not ethnicity.
 */
export const SENSITIVE = Object.freeze({
  orientation: /\b(queer|queers|gay|gays|lesbians?|bisexuals?|bi(?![-\w])|homosexuals?|lgbt\w*\+?|sapphics?|wlw|mlm|pansexuals?|asexuals?|same[- ]sex|same[- ]gender|dykes?|men who love men|women who love women|two[- ]spirit)\b/i,
  genderIdentity: /\b(trans(?![- ](?:amadi|ekulu))|transgender|trans women|trans men|transfem\w*|transmasc\w*|non-?binary|enby|genderqueer|gender[- ]?fluid|intersex|two[- ]spirit)\b/i,
  // reviewed 25 Oct across faiths (the eval's Hindu crew had "temple" stored): places of
  // worship, festivals, practices, texts, clergy and the words for having no faith
  religion: /\b(church|churches|christians?|catholics?|pentecostals?|anglicans?|methodists?|baptists?|evangelicals?|orthodox|presbyterians?|lutherans?|rccg|deeper life|mfm|winners chapel|living faith|celestial church|cherubim|aladura|jehovah['’]?s? witness(?:es)?|mormons?|quakers?|muslims?|islam|islamic|mosque|masjid|jumu?['’]?ah|jummah|ramadan|eid|sallah|salah|salat|hajj|umrah|quran|koran|hindus?|hinduism|temples?|mandir|puja|pooja|diwali|navratri|satsang|kirtan|bhajan|sikhs?|sikhism|gurdwara|jains?|jainism|parsis?|zoroastrians?|jewish|jews|judaism|synagogue|shul|rabbis?|kosher|shabbat|sabbath|buddhists?|buddhism|zen centre|monaster(?:y|ies)|monks?|nuns?|shrines?|baha['’]?is?|bible study|holy mass|sunday school|fellowship|born again|adventists?|hijabis?|imams?|sheikhs?|ustaz|pastors?|priests?|deacons?|vicars?|reverends?|chaplaincy|parish(?:ioners?)?|atheists?|agnostics?)\b/i,
  health: /\b(hiv|aids|diabetic|diabetes|cancer|wheelchairs?|wheelchair users?|disabled|disability|deaf|blind|visually impaired|hard of hearing|autistic|autism|adhd|neurodivergent|dyslexic|dyslexia|bipolar|schizophreni\w*|ptsd|cerebral palsy|amputees?|pregnant|sober|recovering|in recovery|alcoholics?|mental health|depression|anxiety|epileptic|epilepsy|sickle[- ]cell|chronic(?:ally)? ill)\b/i,
  ethnicity: /\b(yoruba|igbo|ibo|hausa|fulani|ijaw|efik|ibibio|tiv|urhobo|itsekiri|kanuri|nupe|idoma|igala|ebira|ogoni|isoko|annang|black|white|asian|arab|indian|chinese|lebanese|ethnic)\b(?!\s+(?:food|cuisine|restaurant|spot|music|dishes|meals?))/i,
});
/** The categories whose words never reach any stored field, the crew's name included. */
export const HIGH_RISK = Object.freeze(["orientation", "genderIdentity", "health"]);

/** The sensitive categories a text touches. */
export function sensitiveIn(/** @type {any} */ s) {
  const t = String(s ?? "");
  return /** @type {(keyof typeof SENSITIVE)[]} */ (Object.keys(SENSITIVE)).filter((k) => SENSITIVE[k].test(t));
}
/** True when a text names who people are (any sensitive category, or only `only`). */
export function hasSensitive(/** @type {any} */ s, /** @type {readonly string[]} */ only = []) {
  const hit = sensitiveIn(s);
  return only.length ? hit.some((k) => only.includes(k)) : hit.length > 0;
}

/** A text with every sensitive word taken out, tidied ("queer and mostly female" gives "mostly female"). */
export function scrubSensitive(/** @type {string} */ s) {
  let t = String(s ?? "");
  for (const re of Object.values(SENSITIVE)) t = t.replace(new RegExp(re.source, "gi"), " ");
  return t.replace(/\s+/g, " ").replace(/^\s*(and|or|&|,)\s+/i, "").replace(/\s+(and|or|&|,)\s*$/i, "").replace(/\s+,/g, ",").replace(/\(\s*\)/g, "").trim();
}

/** Every string in a JSON value with sensitive words scrubbed (for anything that is kept, like a cache). */
export function scrubDeep(/** @type {any} */ v) {
  if (typeof v === "string") return scrubSensitive(v);
  if (Array.isArray(v)) return v.map(scrubDeep);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubDeep(x)]));
  return v;
}
