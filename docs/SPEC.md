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

1. **Create a crew (once):** one sentence, for example "the uni guys, every other Saturday, somewhere outside and cheap, around Yaba and Lekki". Gemma parses the rhythm, vibe and areas; the organiser confirms in one tap and gets an invite link to drop in the group chat. For a crew with a regular day, the sloth's first pick (the ritual for the next slot) follows a few seconds later, in the background, and the invite carries it once it lands.
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
| Start a crew | the setup sentence and the optional "what you're into" line (read once, never kept) | the crew list, member names, locations |
| Tell the sloth what you're into (later) | that line | the crew list, member names, locations |
| Add a plan | the sentence, the flyer picture, or the link plus its page's title, description and text; today's date | who is adding it, the crew list, locations |
| The ritual (explain and invite) | the picked place, its kind, what of the crew's taste it fits ("an art gallery") and whether it is low-key, the weather, the crew's vibe words, the minutes from each neighbourhood, the runners-up | member names, the crew list, the crew's needs (never sent with the invite) |
| The sloth's 3 ideas (ranking) | the crew's vibe words, budget, taste (scenes, likes, place kinds, things to avoid, needs, age band, energy) and "tonight" or "weekend"; for each candidate its name, kind, day and time, place and area, price as stated, the weather, the longest trip and the minutes from each neighbourhood, the guide's name, and the crew's own history with it (visits, days ago, how many came) | member names, the crew list, tokens |
| Reading a curated weekly guide (Lagos) | the post's text from its public RSS feed, its title and date, today's date | anything about any crew |

**Run your own sloth.** Every Gemma task goes through one LLM port (`src/adapters/llm.mjs`). `LLM=gemini` (the default) uses the Gemini API as above. `LLM=ollama` uses Gemma on your own machine or server through Ollama (`OLLAMA_URL`, default `http://localhost:11434`; `OLLAMA_MODEL`, default `gemma3:4b`; `OLLAMA_VISION=auto|yes|no`; `OLLAMA_TIMEOUT_MS`, default 180000): then nothing goes to Google at all. The task's JSON schema is Ollama's `format`. A flyer needs a model with vision (Ollama reports it in `/api/show`); a text-only model refuses it with `hint`: "Reading a flyer needs a vision model, and this server runs ..., which reads text only. Type the plan or paste the link instead." and the parse screen shows that note.

(A future option is in-browser Gemma, reusing Selects Web's engine.)

## Data model (JSON; MongoDB Atlas in production, a file store in development)

```js
Crew   { id, slug, name, vibe, vibeTags: [string], budget: "free"|"cheap"|"any", taste: Taste | null,
         rhythm: { every: "1w"|"2w"|"4w", day: 0..6, window: { from: "15:00", to: "19:00" }, anchor?: "YYYY-MM-DD" } | null,
         areas: [{ label, lat, lon }], tz: "Europe/Berlin", createdAt, inviteToken,
         firstPick?: { status: "pending"|"ready"|"failed", planId: string|null, reason: string|null, attempts, startedAt, updatedAt, nextTryAt },
         // the sloth's first pick as a background job (src/core/firstpick.mjs), on crews with a rhythm only
         region: { center: { lat, lon } | null, countryCode: "DE" | null, city: "Berlin" | null,
                   timezone: "Europe/Berlin", tzSource: "open-meteo"|"browser"|"legacy"|"utc" } }
         // region is derived once from the crew's areas (docs/CITY-PACKS.md) and picks the
         // city pack; a crew without one is in Lagos (tz "Africa/Lagos"), as every crew was
Member { id, crewId, name, area: { label, lat, lon } | { label, lat: null, lon: null }, token, calToken, joinedAt }
Plan   { id, crewId, kind: "found"|"hosted"|"ritual"|"quick", title, start, end, tz: the crew's zone,
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
| POST | `/api/crews` | none | `{ sentence, into?, hint?: { tz } }` | `200 { draft: { name, vibe, vibeTags, budget, rhythm, areas: [{ label, lat, lon }], region, taste: Taste }, taste: TasteView, pack: PackView, confidence: { name, vibe, rhythm, areas }, low: [field], notes: [string], ai: bool }` (Gemma reads the sentence and the optional `into` line, "what you're into", at most 300 characters; areas are geocoded; nothing is saved, and neither text is kept anywhere). `hint.tz` is the visitor's own zone: none, or "Africa/Lagos", starts the crew in Lagos as before; any other zone looks the areas up anywhere, the visitor's country first. `ai: false` means Gemma was busy: the draft is empty and the form is filled by hand |
| POST | `/api/crews` | none | `{ confirm: draft, hint?: { tz }, organiser?: { name, area } }` | `201 { crew, inviteUrl, inviteToken, member?, memberToken?, calendarUrl?, webcalUrl? }`; a crew with a rhythm has `crew.firstPick: { status: "pending", planId: null }`, and its first pick starts once this answer is sent (see `/first-pick`). The crew keeps `draft.region`, its centre moved to the confirmed areas; with no region, the hint decides, and with no hint, Lagos). `draft.taste` (the edited chips) is checked again. A name that says who the crew is (orientation, gender identity, health) is refused: `invalid`, field `name` |
| POST | `/api/crews/:slug/taste` | member | `{ sentence }` (read a "what you're into" line; nothing saved) or `{ taste: Taste }` (save the edited chips) | `200 { taste: Taste, chips, summary, saved: bool, ai?, notes? }` |
| GET | `/api/crews/:slug` | invite or member | | `{ crew: { id, slug, name, vibe, vibeTags, budget, rhythm, areas: [{ label }], tz, region: { center, countryCode, city, timezone }, pack: PackView, inviteToken, createdAt, taste?: Taste (members only) }, members: [{ id, name, area: { label } }], plans: [PlanView], you: { id, name, area: { label } } \| null }` |
| POST | `/api/crews/:slug/members` | invite | `{ name, area }` where area is a label ("Yaba") or `{ label, lat, lon }` from `/api/areas` | `201 { member, memberToken, memberUrl, calendarUrl, webcalUrl, notes }` (`memberUrl` is `/c/<slug>?t=<memberToken>`) |
| GET | `/api/areas?q=Yab&near=6.48,3.42&cc=NG` or `&tz=Europe/Berlin` | none (rate limited) | | `{ results: [{ label, detail, lat, lon, country?, city? }] }` (Photon type-ahead for neighbourhoods and towns, cached; falls back to any place). Biased to `near` (the crew's centre) and kept to `cc` when given; else by the visitor's zone `tz`: none or Lagos searches Lagos as before, any other searches anywhere |
| GET | `/api/crews/:slug/ideas?when=tonight\|weekend` | invite or member | | `200 IdeasCard` (see "Ideas: the sloth has 3 ideas"). One card of at most three ideas; cached per crew and slot for 3 hours. `400 invalid` for any other `when`; `503 ideas_off` on a server built without it |
| POST | `/api/crews/:slug/plans/parse` | member | multipart: `text`, `url`, `image` (JPEG, PNG, WebP or HEIC, at most 5 MB) and optionally `thumb` (the browser's ~400 px JPEG or WebP copy of the image, at most 200 KB, kept as the flyer thumbnail); or JSON `{ text, url }` | `200 { draft: PlanDraft, confidence: { field: 0..1 }, low: [field], notes: [string], ai: bool, model }`. `draft.source.imageUrl` is the flyer thumbnail (or a link's own https image); send `draft.source` back unchanged on create so the plan keeps it |
| POST | `/api/crews/:slug/plans` | member | `{ plan: PlanDraft }` (the confirmed, possibly edited draft) | `201 { plan: PlanView }` |
| GET | `/api/crews/:slug/first-pick?wait=0..25` | invite or member | | `200 { status: "pending"\|"ready"\|"failed", plan: PlanView \| null, reason }`: the sloth's first pick for a crew with a regular day (the ritual for the next slot, made in the background right after the crew). While it is `pending`, `wait` holds the answer up to that many seconds, so ask again at once when it comes back pending. `ready` with `plan: null` means there is nothing to pick (`reason`: busy, the crew already has a plan in that slot; no_rhythm). `failed` (no places answered, no area on the map) is tried again later by the heartbeat; share without a plan. A pick cut off by a restart starts again when asked. `crew.firstPick.status` in `GET /api/crews/:slug` says the same without the plan |
| POST | `/api/crews/:slug/first-pick` | invite or member | | the same answer, waiting up to 25 s (for clients from before 22 Oct). Counts against the Gemma limits |
| PATCH | `/api/members/:id` | that member | `{ area: "Yaba" \| { label, lat, lon } }` or `{ near: { lat, lon } }` (already rounded to two decimals on the phone; the server rounds again, names the neighbourhood there and keeps that neighbourhood's own centre) | `{ you, notes }` |
| PATCH | `/api/plans/:id` | member | `{ rsvp: "going"\|"maybe"\|null }` and/or edits `{ title, start, end, place, price, bring, status }` (edits: the creator, the host, or anyone for a ritual) | `{ plan: PlanView }` |
| GET | `/api/plans/:id` | invite or member | | `{ plan: PlanView, members, crew, you }` (one plan, same visibility rules) |
| GET | `/api/plans/:id/pods` | member | | `{ pods: [Pod], unplaced: [{ id, name }], rides: [{ id, name, blurb, links: { android, ios, web }, dropoff: false }], directions: { android, ios, web } \| null }` (the host of a hosted plan is not in a pod; `rides` is the crew's pack's verified list: Bolt, inDrive and LagRide in Lagos, none elsewhere; `directions` opens a maps app: a geo: URI, Apple Maps, Google Maps) |
| GET | `/api/flyers/:flyerId` | none (the id is an unguessable capability) | | the flyer thumbnail image, cached for a year |
| GET | `/api/plans/:id/event.ics?t=<member token>` | member | | one-event calendar file (`text/calendar`, download) for "add to my calendar" after "I'm going" |
| GET | `/cal/:calToken.ics` | calendar | | the member's subscribed feed (all crew plans; going ones marked) |
| GET | `/api/push/key` | none | | `{ publicKey }` (VAPID, for `pushManager.subscribe`) or `{ publicKey: null }` when push is off |
| POST | `/api/members/:id/push-subscription` | that member | `{ subscription }` (the browser's `PushSubscription.toJSON()`) | `204` |
| DELETE | `/api/members/:id/push-subscription` | that member | `{ endpoint }` | `204` |
| POST | `/api/tick` | `Bearer TICK_SECRET` | | `{ rituals, firstPicks, weatherChecked, rainAlerts, pushes, expired }`; idempotent. `firstPicks`: first picks that had failed (after their backoff: 1 min, 15 min, 3 h; 4 tries) or were cut off by a restart, made now |
| GET | `/healthz` | none | | `{ ok, store, ai, push, you }` (`you` is the client address the rate limits see; check it after a deploy) |

`Taste` is what the crew is into and needs (src/core/taste.mjs): `{ scenes: [string], likes: [string], placeKinds: [string], eventKeywords: [string], avoid: [string], needs: ["safe"|"discreet"|"women-friendly"|"inclusive"|"no alcohol"|"kid-friendly"|"step-free"|"quiet"|"daytime"], budget: "free"|"cheap"|"any"|null, ageBand: string|null, energy: "chill"|"lively"|"mixed"|null }`. `placeKinds` come from a closed list (park, garden, beach, playground, gallery, museum, arts centre, cafe, restaurant, street food, ice cream, bar, pub, nightclub, live music, cinema, theatre, bookshop, thrift, market, library, community centre, sports, bowling, arcade, theme park, zoo) that code maps to OpenStreetMap tags. It never holds a word for who the crew is (docs/LOCAL-FACTS.md, "Sensitive attributes"). `TasteView` is `{ chips: [{ field, value, label }], summary: "Got it: alte, art and live music, late 20s, around Yaba and Lekki Phase 1." | null }`.

`PackView` is what the web app may know about the crew's city pack: `{ id: "lagos"|"default", name, directions: bool (no ride app named), example, areaPlaceholder, pricePlaceholder, city, countryCode }`.

`PlanDraft` is a Plan without ids and bookkeeping: `{ kind, title, start, end, tz, place, price, host, hostName, bring, source }`; unknown fields are `null`, never guessed.

`PlanView` is a Plan as the viewer may see it (with `place.entry: { free: true|false|null, note, source }` on a plan with no price at a curated spot or the sloth's pick: a sourced fee, or `free: null` for "Entry: check at the gate"; never "free" without a source): a private place's `address`, `lat` and `lon` are `null` (and `place.hidden: true`, and `source` is `{}`) unless the viewer is a member; and it adds `rsvps` (by member id), `going: [name]`, `maybe: [name]`, `you: "going"|"maybe"|null`, `source.imageUrl` (the flyer thumbnail, when there is one), `eventIcsUrl` (members only) and, when rain moved in, `headsUp: { text, whatsappUrl }`. A plan whose time or place is edited becomes `status: "moved"`.

**Ideas limits.** `GET /ideas` is limited to 30 an hour per crew (after the token is checked). A cached card costs nothing else; making a new card also counts as one Gemma call against the visitor's limits below.

**Errors and limits.** Codes the UI may branch on: `invalid` (400, with `fields`), `no_token` (401), `bad_token` (403), `members_only` (403), `not_yours` (403), `not_found` (404), `link_unreadable` (422), `link_locked` (422: an Instagram, Facebook or Threads link with nothing else to read; the UI asks for the flyer picture, and no Gemma call is made), `too_large` (413), `not_an_image` (415), `slow_down` (429, with `Retry-After`). Gemma calls (crew drafts and plan parsing) are limited to 8 a minute and 80 a day per visitor and 20 a minute in all.

**Two lanes (22 Oct).** Every call to an outside service queues in a lane (`src/adapters/lanes.mjs`): `user` when someone is waiting on the screen (a crew sentence, reading or posting a plan, an RSVP's ride pods, the area type-ahead) and `background` for the heartbeat, the first pick, the ideas card and the weekly guides. Each lane has its own concurrency at each service (Gemma: 4 user calls at once, 1 background call and at most 6 background calls a minute; Photon: 2 and 1; Nominatim and OSRM: 1 and 1), the gap a service's policy asks for is shared, and the user lane goes first whenever both wait. Someone waiting is given up on with an honest fallback: Gemma after 35 s ("Fill this in yourself"), the map pin after 8 s (the place stays unpinned, and says so), the forecast after 6 s (the plan has no weather line until the heartbeat checks it). The first pick waits 8 s for the map (the curated spots carry it) and 8 s for the forecast. Overpass answers are cached a week by tile (0.02 degrees, about 2.2 km), OSRM's by 0.005 degree tile, a row per member area, so a new ritual asks only for new places.

**One tap from the chat.** Every WhatsApp message the app writes is the plan in its first line, then `I'm in: /c/:slug/p/:id/in?t=<invite>` and `Maybe: /c/:slug/p/:id/maybe?t=<invite>`. Those links open the app's one-tap page, whose script records the answer (joining first with a name on a new phone); the GET itself never answers, because WhatsApp fetches links to draw previews. For Opera Mini the same paths are a plain page with one button (and a name field on a new phone); `POST /basic/join/:slug` takes `rsvp` with `next`, so joining from a plan answers it in the same tap.

**The basic version.** For Opera Mini (User-Agent "Opera Mini" or the `X-OperaMini-Phone-UA` header) and for `?basic=1` (the `<noscript>` link), `GET /c/:slug`, `/c/:slug/join` and `/c/:slug/p/:id` with `?t=` return plain server-made HTML: the plan, who is going, and forms that `POST /basic/rsvp/:id` (`t`, `rsvp`: going, maybe or none) and `POST /basic/join/:slug` (`t`, `name`, `area`, `next`), each answered with a 303 back to the page. Other app pages say they need the full app.

**Serving and development.** The Node server also serves the built web app (`web/dist`) from the same origin: `index.html` for app routes, `sw.js` and `manifest.webmanifest` with `no-cache`, hashed assets for a year. It listens on port 3000 by default (the Vite proxy's target). `OFFLINE=1 npm run dev` runs the API with fakes for every outside service (no keys, no network; a regex stand-in plays Gemma), for UI work.

**Push messages** (when the browser subscribed): new plan in your crew, a plan you are going to changed or was cancelled, rain moved in on a plan you are going to, and your ride pod formed. Payload: `{ title, body, url, tag }`; `tag` is the plan id, so a newer message replaces an older one.

## Ideas: the sloth has 3 ideas

"Too lazy to think?": one card with three things the crew could do tonight or this weekend. Never a feed, never more than three. Code in `src/core/ideas.mjs` (pure), `src/core/feeds.mjs` (pure), `src/app/ideas.mjs` (the use case) and `src/adapters/feeds.mjs` (the polite feed fetcher).

**Sources.**
1. `place`, anywhere: green and open spaces near the crew's middle from the places pipeline (OpenStreetMap, Wikidata, a pack's curated spots), plus covered spots a source vouches for. The request waits 15 s for the map; after that the pack's curated spots stand in.
2. `usual`, anywhere: the crew's own history. Places from past plans that were not cancelled and not at someone's home, most liked first (more people going, more visits).
3. `event`, Lagos pack only: the **Awe Lagos** and **Nothing To Do In Lagos** weekly guides, read from their RSS feeds only (`https://awelagos.substack.com/feed`, `https://nothingtodoinlagos.substack.com/feed`). Each feed is fetched at most once a day (after the tick, or by the first card of the day), with `ComeThrough/0.1 (+CONTACT)` as the User-Agent, `If-None-Match`, and only while robots.txt allows the feed path (rechecked weekly; unreadable means no fetch). No other page of either site is fetched. Gemma lists a new post's events once; code then keeps only what the post itself states (the name; dates stated near the event or under its day heading and inside the post's own weekend; a time, venue or price from the event's own lines; a ticket link that is one of the post's own links). An event with no stated date, or with date confidence under 0.6, is dropped; so is one with no start time. Only these facts are stored (14 days, keyed by the post's link); the post's text is never stored or shown. Every event idea carries `source: { name, url: <the post's link>, credit }`.

**Order of work.** Deterministic filters first: inside the slot and not passed; within a distance cap of the crew's middle (places 15 km, usual 25 km, events 35 km) and nobody's trip over 90 minutes (the pack's travel model); outdoors only when the forecast for those hours is dry (rain under 40%). Then Gemma ranks what is left (at most 6 events, 4 places, 3 usual) for the crew's vibe and budget, the trips, the time and the weather, and writes one line per pick. A line with a number that is not in that idea's facts, or that does not name the idea, is replaced by the code's own sentence (`by: "code"`). When Gemma is away the card still comes, in the code's own order (one of each kind first).

**The slot.** `tonight`: today from 5 pm under a roof (from 4 pm outside, until the pack's outdoor hours end), never earlier than now. `weekend`: Friday evening, Saturday and Sunday (on a Saturday, the rest of Saturday and Sunday); places and the usual try Saturday and Sunday before Friday evening. A day with less than an hour left is dropped. All inside the pack's social hours.

```js
IdeasCard {
  when: "tonight"|"weekend", generatedAt, validUntil,          // ISO; valid for 3 hours (10 minutes when partial)
  slot: [{ date, outdoor: { from, to } | null, covered: { from, to } | null }],
  ideas: [Idea],                                                // 0 to 3, best first
  by: "gemma"|"code",                                           // who ordered the card
  sources: [{ name, url }],                                     // the guides this crew's pack reads (their home pages), [] elsewhere
  notes: [string],                                              // plain sentences to show under the card
  partial?: true,                                               // a guide was still being read; ask again in a few minutes
  cached: bool
}
Idea {
  id: "e1"|"p1"|"u1"..., kind: "event"|"place"|"usual",
  title,                                                        // "Sunset Jazz on the Lawn", "Freedom Park", "Picnic at Ikoyi Garden"
  when,                                                         // "Saturday 24 October, 4 pm to 7 pm" ("Today, ...", "Tomorrow, ...")
  start, end,                                                   // ISO with offset (end may be null)
  place: { name, address, area, lat, lon, outdoor },            // an event's venue may have no pin
  price: { text, free } | null,                                 // as the source states it; null when unknown, never "free" without a source
  why, by: "gemma"|"code",                                      // one line, grounded in the facts
  travel: { longestMinutes, from: [{ from: "Yaba", minutes }] } | null,
  weather: { text, ok, rainProb } | null,
  source?: { name: "Awe Lagos", url: <post link>, credit: "From Awe Lagos' weekly guide" },   // events only
  ticketUrl?: string | null,                                    // events only: the post's own ticket link
  draftPlan: PlanDraft                                          // POST it as { plan: draftPlan } to /api/crews/:slug/plans
}
```

`draftPlan` is a complete `PlanDraft`: `kind` "found" for an event (its `source.url` is the ticket link, else the post) and "quick" otherwise, `start` and `end` in the crew's zone, the place with its pin when known, the price as stated. One tap sends it through the existing create flow, which validates it as any other plan.

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

### UI requests: taste ("tell the sloth what you're into")

From the backend builder, 21 Oct. The setup sentence now shapes what the sloth suggests, so the setup flow should show that it understood, and let people correct it.

- **Copy that asks who the crew is has to go.** The start screen's "Who they are, when you link up, and roughly where" becomes "What you're into, when you link up, and roughly where", and How it works step 1, "Say who the crew is", becomes "Say what the crew is into". Same reason as the line below.
- **One more optional field on the setup screen,** under the crew sentence, sent as `into`: "Tell the sloth what you're into and what makes a place feel right. You don't need to say who you are." Placeholder from the crew's city, for example "art, live music, somewhere quiet". Keep that second sentence exactly; it is a safety line (same-sex relationships are criminalised in Nigeria, docs/LOCAL-FACTS.md).
- **Show the understanding.** After the draft comes back, show `taste.summary` ("Got it: alte, art and live music, late 20s, around Yaba") above the confirm form, and `taste.chips` as removable chips under it. Each chip has `field`, `value` and `label`; removing one removes `value` from `draft.taste[field]` (for `ageBand` and `energy`, set it to null). Chips with `field: "needs"` read as the organiser's own settings ("Low-key places", "No alcohol"): show them in their own row titled "What makes a place feel right". Send the edited `draft.taste` back with the confirm.
- **Never show the taste outside the members' own screens.** Not in the invite text, the WhatsApp share, the plan page a guest sees, or link previews. `crew.taste` comes only to members.
- **Edit later.** On the crew's own settings (members only), the same field: send `{ sentence }` to `POST /api/crews/:slug/taste`, show the chips that come back, then send `{ taste }` to save. Saving makes the next ideas card new.
- **A name refused.** `invalid` with field `name` on confirm means the name says who the crew is; show the message as it is, next to the name field.
- **Ideas: a new kind.** `kind: "home"` is "A night in at one of yours" (offered to a crew whose needs say discreet or safe). It has no place and no travel; its `draftPlan` is a hosted, private plan with no address, so "Make it a plan" should open the plan form for the host to add theirs rather than posting straight away.

### UI requests: ideas card

The web app already reads `GET /ideas` (`web/src/lib/api.js`, `normaliseIdeas`; `CrewHome.jsx`, `IdeasCard`). What the backend now sends, and what the card should do with it:

- **Ask once per visit.** `GET /api/crews/:slug/ideas?when=weekend` (or `tonight` on a Friday, Saturday or Sunday afternoon, as now). The answer is cached for 3 hours, so asking again is cheap; do not poll. When `partial` is true, one quiet retry after about 3 minutes may bring the guides' events.
- **Each idea:** `title`; `when` as sent (already in words); `place.name` when the title does not contain it; `why` (show as the reason; it is one sentence); the price as `price.text` when present (never write "free" unless `price.free` is true).
- **Credit and link every event.** When `source` is present, show `source.credit` ("From Awe Lagos' weekly guide") as a link to `source.url` (the guide's post), on its own line under the reason. Required by the curators' terms as we read them; never drop it, never show the post's prose. When `ticketUrl` is present, a small "Tickets" link next to it (opens outside the app).
- **One tap.** "Make it a plan" sends `{ plan: idea.draftPlan }` to `POST /api/crews/:slug/plans` as it is (a guest gets `members_only`: show "Join the crew first, then add plans."). Then open the new plan with `?posted=1` as now.
- **Notes.** Show `notes` as small muted lines under the list (for example "Rain is forecast for the open-air hours, so outdoor places are left out."). With `ideas: []`, show the existing empty state plus the first note.
- **Weather and trips** (`weather.text`, `travel.longestMinutes`) are optional extras; the reason usually carries the one that matters.
- **Errors.** `503 ideas_off`, `429 slow_down` and network errors: hide the card, as for 404 now. `400 invalid` means a bad `when`.
- **Privacy line**, once under the card: "The sloth asks Gemma to rank these. It sends neighbourhoods and minutes, never names."

### UI requests: the first pick arrives after the crew (22 Oct)

From the backend, 22 Oct. Done in `web/src/screens/Start.jsx` (`Invite`), following DESIGN.md's voice rules.

- **Make the crew** answers in the time of the one Gemma call that read the sentence. The invite screen opens at once; the first pick is not in that answer.
- While `GET /api/crews/:slug/first-pick?wait=20` says `pending`, show the ritual card in its planning state: "The sloth is picking Saturday..." over "A green spot in the middle of the crew, with the weather checked." Ask again as soon as an answer comes back pending (wait 3 s first if it came back in under 2 s); give up after about 90 s and share without a plan.
- **Nobody waits for it.** While picking, the main button is "Share now" (WhatsApp, the plain invite with the crew link), with "Or wait a few seconds, and the message will carry Saturday's spot." under it.
- **When the pick lands,** the card shows the place, the time and the weather, and the main button's message leads with the plan ("I'm in" and "Maybe" links). If "Share now" was already tapped, the button reads "Share with the plan", with "The sloth picked Freedom Park. Send it so the crew can tap I'm in." under it. Otherwise it stays "Send to the group chat".
- `ready` with no plan, `failed`, or a rain skip (the plan comes back `cancelled`, its `rainPlan.note` shown as now): "Send to the group chat" with the plain invite.

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
