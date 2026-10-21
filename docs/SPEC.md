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
5. **Rides sort themselves:** when two or more members are going, Come Through groups them into **ride pods** by area and gives each pod a leave-by time, the drop-off address to copy, and buttons for Bolt, then inDrive (then LagRide). No ride app in Lagos documents a link that fills in the drop-off, so each button opens the app's store page on a phone or its web page elsewhere (src/core/rides.mjs; docs/LOCAL-FACTS.md, "Rides").
6. **The ritual:** if the crew has a rhythm and nothing is planned in the window, Come Through creates a `ritual` plan 2 to 3 days ahead: it finds actual green space near the crew's middle (OpenStreetMap), rotates places, picks the best weather window (Open-Meteo: no rain, after the worst heat), and Gemma writes the invite in the crew's voice and explains the pick. "Come through if you can": no RSVP needed. "Nothing planned" means no plan in the slot's own hours and no outdoor plan within half a cycle: an indoor wine night on the Friday does not cancel Saturday in the park. Every window stays inside the **social hours** (weekend outdoor 11:00 to 18:30; weekday evenings 17:30 to 21:00 under a roof; see docs/LOCAL-FACTS.md). **When the window is wet**, the sloth moves to a dry stretch of at least two hours inside that day's social hours (`moved`), else the next day of the same kind in the crew's window (`next_day`), else a place a source says is covered (`covered`), else it skips the slot (`skip`: the plan is stored with `status: "cancelled"`, stays out of calendars, and no Gemma call is made); each case carries an honest `rainPlan.note` built from the forecast numbers. It never moves a hangout to 8 am.
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

Gemma runs through the Gemini API (free tier) with a server-held key. Google may use what the free tier receives to improve its products, and the UI says so where Gemma is used. What goes to Google, exactly:

| Feature | Sent to Gemma | Never sent |
|---|---|---|
| Start a crew | the setup sentence | the crew list, member names, locations |
| Add a plan | the sentence, the flyer picture, or the link plus its page's title, description and text; today's date | who is adding it, the crew list, locations |
| The ritual (explain and invite) | the picked place, its kind, the weather, the crew's vibe words, the minutes from each neighbourhood, the runners-up | member names, the crew list |

(A future option is in-browser Gemma, reusing Selects Web's engine.)

## Data model (JSON; MongoDB Atlas in production, a file store in development)

```js
Crew   { id, slug, name, vibe, vibeTags: [string], budget: "free"|"cheap"|"any",
         rhythm: { every: "1w"|"2w"|"4w", day: 0..6, window: { from: "15:00", to: "19:00" }, anchor?: "YYYY-MM-DD" } | null,
         areas: [{ label, lat, lon }], tz: "Africa/Lagos", createdAt, inviteToken }
Member { id, crewId, name, area: { label, lat, lon } | { label, lat: null, lon: null }, token, calToken, joinedAt }
Plan   { id, crewId, kind: "found"|"hosted"|"ritual"|"quick", title, start, end, tz: "Africa/Lagos",
         place: { name, address, lat, lon, osm?: { type, id, tags }, outdoor: bool, private: bool },
         price: { text, free: bool } | null, host: memberId | null, hostName: string | null, bring: [string],
         source: { url?, text?, image?: bool }, why: string | null, invite: string | null,
         weather: { checkedAt, summary, rainProb, tempC, ok: bool } | null,
         status: "on"|"moved"|"cancelled", confidence: { field: 0..1 },
         rsvps: { [memberId]: "going"|"maybe" }, createdBy: memberId | "sloth", createdAt, updatedAt, seq, expiresAt,
         ritualFor?: "YYYY-MM-DD", rainPlan?: { kind: "moved"|"next_day"|"covered"|"skip", note, wanted: { date, from, to, rainProb } } }
         // place.near?: { label, lat, lon }: an unpinned place's neighbourhood (from its address, or the host's area), for ride times and weather only
Push   { id, memberId, crewId, endpoint, keys: { p256dh, auth }, createdAt }
Pod    (computed) { memberIds, names, fromLabel, solo, leaveBy, travelMin, crossesLagoon, bridge, destinationText, shareText,
         estimate: { band, source: "road"|"straight", roadKm, speedKmh, lagoonMin, bridge, pickupMin, bufferMin, judgedAt, approxTo, text } | null }
         // roadKm and bridge come from an OSRM road route when there is one (source "road"); bridge is the lagoon
         // bridge the route takes, by name, else null. Without a route the straight-line estimate is used and says so.
         // travelMin is an estimate from the map, never live traffic; estimate.text says what was assumed.
         // A place with no pin uses place.near (or the host's area) for times, never as the drop-off.
```

Times are ISO 8601 with an offset (`2026-10-24T16:00:00+01:00`). Plans expire 30 days after they end. A hosted place marked `private` (a home address) is visible only to crew members. `seq` goes up on every change (it is the calendar SEQUENCE). `token` is the member's own link secret (read and write as that member); `calToken` only reads the calendar feed, because calendar apps and Google's servers see that URL.

## HTTP API (Node server)

All JSON. Errors are `{ error: { code, message, fields? } }` with a 4xx or 5xx status; `message` is plain words the UI can show.

**Auth:** unguessable tokens in links, no passwords. Send a token as `Authorization: Bearer <token>`, or as `?t=<token>` on links that must work by themselves (the .ics downloads). Three kinds: the crew's **invite token** (see the crew, join it), a **member token** (everything a member does), and a **calendar token** (the feed only).

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/api/crews` | none | `{ sentence }` | `200 { draft: { name, vibe, vibeTags, budget, rhythm, areas: [{ label, lat, lon }] }, confidence: { name, vibe, rhythm, areas }, low: [field], notes: [string], ai: bool }` (Gemma reads the sentence; areas are geocoded; nothing is saved). `ai: false` means Gemma was busy: the draft is empty and the form is filled by hand |
| POST | `/api/crews` | none | `{ confirm: draft, organiser?: { name, area } }` | `201 { crew, inviteUrl, inviteToken, member?, memberToken?, calendarUrl?, webcalUrl? }` |
| GET | `/api/crews/:slug` | invite or member | | `{ crew: { id, slug, name, vibe, vibeTags, budget, rhythm, areas: [{ label }], tz, inviteToken, createdAt }, members: [{ id, name, area: { label } }], plans: [PlanView], you: { id, name, area: { label } } \| null }` |
| POST | `/api/crews/:slug/members` | invite | `{ name, area }` where area is a label ("Yaba") or `{ label, lat, lon }` from `/api/areas` | `201 { member, memberToken, memberUrl, calendarUrl, webcalUrl, notes }` (`memberUrl` is `/c/<slug>?t=<memberToken>`) |
| GET | `/api/areas?q=Yab` | none (rate limited) | | `{ results: [{ label, detail, lat, lon }] }` (Photon type-ahead for neighbourhoods and towns, biased to Lagos, cached; falls back to any place) |
| POST | `/api/crews/:slug/plans/parse` | member | multipart: `text`, `url`, `image` (JPEG, PNG, WebP or HEIC, at most 5 MB) and optionally `thumb` (the browser's ~400 px JPEG or WebP copy of the image, at most 200 KB, kept as the flyer thumbnail); or JSON `{ text, url }` | `200 { draft: PlanDraft, confidence: { field: 0..1 }, low: [field], notes: [string], ai: bool, model }`. `draft.source.imageUrl` is the flyer thumbnail (or a link's own https image); send `draft.source` back unchanged on create so the plan keeps it |
| POST | `/api/crews/:slug/plans` | member | `{ plan: PlanDraft }` (the confirmed, possibly edited draft) | `201 { plan: PlanView }` |
| PATCH | `/api/plans/:id` | member | `{ rsvp: "going"\|"maybe"\|null }` and/or edits `{ title, start, end, place, price, bring, status }` (edits: the creator, the host, or anyone for a ritual) | `{ plan: PlanView }` |
| GET | `/api/plans/:id` | invite or member | | `{ plan: PlanView, members, crew, you }` (one plan, same visibility rules) |
| GET | `/api/plans/:id/pods` | member | | `{ pods: [Pod], unplaced: [{ id, name }], rides: [{ id, name, blurb, links: { android, ios, web }, dropoff: false }] }` (the host of a hosted plan is not in a pod; `rides` lists Bolt, inDrive and LagRide in that order) |
| GET | `/api/flyers/:flyerId` | none (the id is an unguessable capability) | | the flyer thumbnail image, cached for a year |
| GET | `/api/plans/:id/event.ics?t=<member token>` | member | | one-event calendar file (`text/calendar`, download) for "add to my calendar" after "I'm going" |
| GET | `/cal/:calToken.ics` | calendar | | the member's subscribed feed (all crew plans; going ones marked) |
| GET | `/api/push/key` | none | | `{ publicKey }` (VAPID, for `pushManager.subscribe`) or `{ publicKey: null }` when push is off |
| POST | `/api/members/:id/push-subscription` | that member | `{ subscription }` (the browser's `PushSubscription.toJSON()`) | `204` |
| DELETE | `/api/members/:id/push-subscription` | that member | `{ endpoint }` | `204` |
| POST | `/api/tick` | `Bearer TICK_SECRET` | | `{ rituals, weatherChecked, rainAlerts, pushes, expired }`; idempotent |
| GET | `/healthz` | none | | `{ ok, store, ai, push, you }` (`you` is the client address the rate limits see; check it after a deploy) |

`PlanDraft` is a Plan without ids and bookkeeping: `{ kind, title, start, end, tz, place, price, host, hostName, bring, source }`; unknown fields are `null`, never guessed.

`PlanView` is a Plan as the viewer may see it (with `place.entry: { free: true|false|null, note, source }` on a plan with no price at a curated spot or the sloth's pick: a sourced fee, or `free: null` for "Entry: check at the gate"; never "free" without a source): a private place's `address`, `lat` and `lon` are `null` (and `place.hidden: true`, and `source` is `{}`) unless the viewer is a member; and it adds `rsvps` (by member id), `going: [name]`, `maybe: [name]`, `you: "going"|"maybe"|null`, `source.imageUrl` (the flyer thumbnail, when there is one), `eventIcsUrl` (members only) and, when rain moved in, `headsUp: { text, whatsappUrl }`. A plan whose time or place is edited becomes `status: "moved"`.

**Errors and limits.** Codes the UI may branch on: `invalid` (400, with `fields`), `no_token` (401), `bad_token` (403), `members_only` (403), `not_yours` (403), `not_found` (404), `link_unreadable` (422), `link_locked` (422: an Instagram, Facebook or Threads link with nothing else to read; the UI asks for the flyer picture, and no Gemma call is made), `too_large` (413), `not_an_image` (415), `slow_down` (429, with `Retry-After`). Gemma calls (crew drafts and plan parsing) are limited to 8 a minute and 80 a day per visitor and 20 a minute in all.

**Serving and development.** The Node server also serves the built web app (`web/dist`) from the same origin: `index.html` for app routes, `sw.js` and `manifest.webmanifest` with `no-cache`, hashed assets for a year. It listens on port 3000 by default (the Vite proxy's target). `OFFLINE=1 npm run dev` runs the API with fakes for every outside service (no keys, no network; a regex stand-in plays Gemma), for UI work.

**Push messages** (when the browser subscribed): new plan in your crew, a plan you are going to changed or was cancelled, rain moved in on a plan you are going to, and your ride pod formed. Payload: `{ title, body, url, tag }`; `tag` is the plan id, so a newer message replaces an older one.

## Delivery: how a plan reaches people (from the 21 Oct research)

- **WhatsApp is the primary channel.** Every "tell the crew" action is a `https://wa.me/?text=...` link with the plan's own link in the text: the card after posting a plan ("Tell the crew on WhatsApp"), the main bar button after "I'm going" ("Tell the crew"), the crew's Invite button, "Share in the group chat" and the rain heads-up. The messages live in `web/src/lib/share.js`.
- **Web Push** is the nudge for people who turn it on. It works on Android Chrome with no install, and on iPhone only once the app is added to the Home Screen. Keys come from the env (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`).
- **One-tap "add to my calendar":** after "I'm going", the UI offers `eventIcsUrl` (a single-event .ics). It works on Android and iPhone.
- **The subscribed feed** (`webcal://.../cal/<calToken>.ics`) stays for iPhone and desktop. The Google Calendar app on Android cannot subscribe (only calendar.google.com on a computer can), and Google refreshes feeds every 6 to 24 hours, so the feed is never the place for last-minute news.
- **The calendar** is an extra: "Add to my calendar" sits under the plan after "I'm going", not in the bar.

## Scheduler

Render cron jobs are not free, and the free web service sleeps after 15 minutes. A GitHub Actions schedule (`.github/workflows/tick.yml`, every 3 hours) POSTs `/api/tick` with `TICK_SECRET` (a repository secret), a 120 s timeout and two retries, which also wakes the service. Runs can be late or dropped, so the tick is idempotent: a ritual is keyed by its crew and date, weather alerts fire only on a change, and each push is sent once.

## Hosting and data

Render web service and MongoDB Atlas (Free tier), both in **Frankfurt** (eu-central-1). Without `MONGODB_URI` the server uses JSON files under `.data/` (development and tests).

## UI requests (for the web builder)

- Area inputs: type-ahead from `GET /api/areas?q=` (debounce 300 ms, at least 2 characters); send the chosen `{ label, lat, lon }` when joining. Free text still works.
- After "I'm going": the bar's main button is "Tell the crew" on WhatsApp; "Add to my calendar" (`eventIcsUrl`) sits under the page; and once per device ask for push ("Get a nudge when plans change"). On iPhone outside an installed app, show "Add to Home Screen to get nudges" instead of the push prompt.
- On the join success screen, show the calendar subscription as optional, with "open on a computer" wording for Android users.
- Rides: "Copy address" (`pod.destinationText`), then a button per ride app from `rides` (Bolt, then inDrive), going to `links.android`, `links.ios` or `links.web` by platform. `dropoff` is false for every app (none documents a drop-off link).
- Highlight draft fields listed in `low` (confidence under 0.6). Show the "only what you submit goes to Google" note on the parse screen.
- Instagram links do not give the server the flyer (Instagram returns an empty page), so for Instagram ask for a screenshot of the flyer.

### Requests from the web builder (21 Oct)

The web app in `web/` is built against the contract above. These are the gaps it found. Each one has a fallback in the UI, so none of them blocks the backend.

Status (backend, 21 Oct): all done. The app is served with those cache rules; `rsvps` is in every PlanView; flyer thumbnails are stored from the optional `thumb` part (or the image itself when it is under 200 KB) and appear as `source.imageUrl`; link plans use the page's own https image; the host is left out of pods; and `GET /api/plans/:id` exists.

- **Serve the web app.** Serve `web/dist` as static files, with `index.html` as the fallback for `/`, `/start`, `/share`, and `/c/*`. Serve `/sw.js` and `/manifest.webmanifest` from the root with `Cache-Control: no-cache`, so a new deploy reaches phones.
- **Keep `rsvps` in `PlanView`.** The branch and the ride pods match faces to member ids, so the UI reads `plan.rsvps` (`{ memberId: "going"|"maybe" }`) together with `members`. The name lists `going` and `maybe` are not enough on their own.
- **`memberUrl`** works as built (`/c/<slug>?t=<memberToken>`): the join screen sees `you` in the crew read, saves the member, and opens the crew. No change needed.
- **A flyer thumbnail.** Please add `source.imageUrl` to `PlanView` for plans read from a flyer: a small stored copy (about 400 px wide JPEG) or a data URL. The crew list shows the flyer as a pasted poster, and the plan page shows it under "Gemma read this from a flyer". Without it, the UI shows neither.
- **Pod fields used:** `memberIds`, `names`, `fromLabel`, `solo`, `leaveBy` (ISO), `travelMin`, `crossesLagoon` and `destinationText`. The host of a hosted plan should not be put in a pod.
- **Optional:** `GET /api/plans/:id` with member or invite auth would let the plan page load one plan instead of the whole crew. Today the UI reads the crew and finds the plan.

## Partner categories (genuine uses only)

Gemma (the AI core), Render (hosting the app and the heartbeat), MongoDB Atlas (data layer), a .tech domain (comethrough.tech is available as of 21 Oct), and optionally SerpApi (finding public events near the crew).

## Credits

Builds on ideas and code from Selects (github.com/IkpemosiArnold/selects, MIT): the Gemini API client pattern and JSON salvage. Credited in the README and post, as the challenge rules require.
