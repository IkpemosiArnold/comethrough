# Come Through: product spec and contracts

Hacktoberfest 2026, DEV Week 3, "Slow and Steady": build something with open-source AI that rewards laziness. Started 21 Oct 2026; due Sun 25 Oct.

## The idea in one breath

Friend groups don't fail to meet for lack of wanting to. They fail on the **organiser's tax**: someone has to ask everyone, collect answers, pick a place, and sort out rides. Come Through removes that tax. Plans arrive the lazy way (a shared flyer, a link, one sentence, or the crew's own standing ritual), everyone taps once, and rides and reminders sort themselves.

**Tagline:** The group chat does the asking. You just come through.

("Come through" is Nigerian English for "show up".)

## Who and what

- **Crew:** a friend group with a name, a vibe, rough areas, and an optional **rhythm** (for example every other Saturday, somewhere outside). Joined by link; no accounts.
- **Member:** a name and a rough area (a neighbourhood, geocoded once). No phone numbers, no contacts, no email required.
- **Plan:** something the crew might do. Four ways a plan arrives:

| Kind | Example | Input | Effort |
|---|---|---|---|
| `found` | A member's friend has a show; a rave; a free event someone spotted | Share or paste a link, or upload a flyer image | One share |
| `hosted` | "Wine and monopoly at mine, Friday 7, bring a bottle" | One sentence or voice note | One sentence |
| `ritual` | Nobody planned anything for two weeks | Nothing: the crew's rhythm creates it | Zero |
| `quick` | "Who's up for suya tonight?" | One sentence | One sentence |

## Core loops

1. **Create a crew (once):** one sentence, for example "the uni guys, every other Saturday, somewhere outside and cheap, around Yaba and Lekki". Gemma parses the rhythm, vibe and areas; the organiser confirms in one tap and gets an invite link to drop in the group chat.
2. **Join (once):** open the link, type your name and area ("Yaba"), done. You get your personal calendar link: subscribe once and every plan appears in your calendar from then on.
3. **Add a plan (seconds):** share, paste or upload. Gemma extracts the title, start and end, venue, price and host from the flyer image, the page text or the sentence. One confirm screen (everything editable, nothing silently guessed: low-confidence fields are highlighted).
4. **Tap once:** "I'm going" or "Maybe". The crew sees who's going. No polls, no threads.
5. **Rides sort themselves:** when two or more members are going, Come Through groups them into **ride pods** by area and gives each pod a leave-by time, plus a one-tap Uber link with the destination filled in (Bolt: address copied).
6. **The ritual:** if the crew has a rhythm and nothing is planned in the window, Come Through creates a `ritual` plan 2 to 3 days ahead: it finds actual green space near the crew's middle (OpenStreetMap), rotates places, picks the best weather window (Open-Meteo: no rain, after the worst heat), and Gemma writes the invite in the crew's voice and explains the pick. "Come through if you can": no RSVP needed.
7. **Weather watch:** outdoor plans are rechecked; if rain moves in, the plan is marked and a one-tap WhatsApp heads-up is offered.

## Laziness rules (UX)

- Nobody installs anything to take part. The calendar subscription is the delivery channel.
- One action per intent: share, tap, or nothing.
- Every AI guess is shown and editable; nothing important is silently assumed.
- Ignoring a plan is a valid answer. No "sorry I can't make it" required.

## AI and code: who does what

| Task | Done by | Why |
|---|---|---|
| Read a flyer image, a page or a sentence into a plan | Gemma 4 (vision for flyers), JSON schema output | Messy human input |
| Parse the crew setup sentence and feedback ("closer to Ikeja next time") | Gemma 4 | Language |
| Explain a place pick, write the invite in the crew's voice | Gemma 4 | Language |
| Geocode areas and venues | Nominatim or Photon, cached | Facts |
| Find green places | Overpass (OpenStreetMap) | Open data |
| Weather windows | Open-Meteo | Open data |
| Fair place choice, rotation, pods, leave-by times | Deterministic code, tested | Never trust a model with arithmetic |
| Calendar feeds | Deterministic code (ICS) | Standards |

Gemma runs through the Gemini API (free tier) with a server-held key. Only the text or image the user deliberately submitted goes to Google; the UI says so plainly. (A future option is in-browser Gemma, reusing Selects Web's engine.)

## Data model (JSON; MongoDB Atlas in production, a file store in development)

```js
Crew   { id, slug, name, vibe, rhythm: { every: "1w"|"2w"|"4w"|null, day: 0..6, window: { from: "15:00", to: "19:00" } } | null,
         areas: [{ label, lat, lon }], createdAt, inviteToken }
Member { id, crewId, name, area: { label, lat, lon }, calToken, joinedAt }
Plan   { id, crewId, kind: "found"|"hosted"|"ritual"|"quick", title, start, end, tz: "Africa/Lagos",
         place: { name, address, lat, lon, osm?: { type, id, tags }, outdoor: bool, private: bool },
         price: { text, free: bool } | null, host: memberId | null, bring: [string],
         source: { url?, text?, image?: bool }, why: string | null, invite: string | null,
         weather: { checkedAt, summary, rainProb, tempC, ok: bool } | null,
         status: "on"|"moved"|"cancelled", confidence: { field: 0..1 },
         rsvps: { [memberId]: "going"|"maybe" }, createdBy: memberId | "sloth", createdAt, expiresAt }
Pod    (computed) { memberIds, fromLabel, leaveBy, travelMin, uberUrl, boltText }
```

Plans expire 30 days after they end. A hosted place marked `private` (a home address) is visible only to crew members.

## HTTP API (Node server)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/crews` | `{ sentence }` returns a draft `{ name, vibe, rhythm, areas }` to confirm; `{ confirm: draft }` creates the crew and returns `{ crew, inviteUrl, member? }` |
| GET | `/api/crews/:slug` | the crew, members (names and area labels only) and upcoming plans; needs the invite token or a member token |
| POST | `/api/crews/:slug/members` | `{ name, area }` returns `{ member, calendarUrl, webcalUrl }` |
| POST | `/api/crews/:slug/plans/parse` | multipart: `text` and/or `url` and/or `image`; returns a draft plan with `confidence` |
| POST | `/api/crews/:slug/plans` | creates from a confirmed draft |
| PATCH | `/api/plans/:id` | edits; `rsvp: "going"|"maybe"|null` |
| GET | `/api/plans/:id/pods` | computed ride pods |
| GET | `/cal/:calToken.ics` | the member's calendar feed (all crew plans; going ones marked) |
| POST | `/api/tick` | the scheduler's heartbeat: create due rituals, recheck weather; protected by a secret |
| GET | `/healthz` | |

Auth: unguessable tokens in links (invite token for the crew; per-member token for the member's view and calendar). No passwords.

## Partner categories (genuine uses only)

Gemma (the AI core), Render (hosting the app and the heartbeat), MongoDB Atlas (data layer), a .tech domain (comethrough.tech is available as of 21 Oct), and optionally SerpApi (finding public events near the crew).

## Credits

Builds on ideas and code from Selects (github.com/IkpemosiArnold/selects, MIT): the Gemini API client pattern and JSON salvage. Credited in the README and post, as the challenge rules require.
