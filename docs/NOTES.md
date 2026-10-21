# Backend notes

Engineering notes for the Come Through server: the live smoke test, what it changed, how to run things, and what is still open. The contract is docs/SPEC.md.

## Live smoke test, Wed 21 Oct 2026 (from Lagos, Node 23)

`npm run smoke` (scripts/smoke.mjs) makes a few real calls. The results below are from the first run, at 09:48 UTC, plus two re-checks after fixes.

| Call | Service | Latency | Result |
|---|---|---|---|
| Geocode "Yaba, Lagos" | Photon | 883 ms | First hit was **Yaba College of Technology** (6.5187, 3.3741), not the district. Fixed: area lookups now ask Photon for OSM places only (`osm_tag=place`). Re-check: "Yaba" (6.5068, 3.3755), class place, 915 ms. |
| Geocode "Yaba, Lagos" | Nominatim | 663 ms | "Yaba", Lagos Mainland (6.5068, 3.3755). Used only for single lookups when `GEOCODER=nominatim`. |
| Type-ahead "Lekki Ph" | Photon | 291 ms | "Lekki Phase I" and "Lekki Phase II" (re-check). |
| Green spaces, 5 km around the Yaba and Lekki midpoint (6.4785, 3.4217) | Overpass | 192 s, failed | overpass-api.de: 502 "at capacity" in about 1 s; overpass.kumi.systems and overpass.private.coffee: no answer in 40 s; **maps.mail.ru: 200 in 17 to 19 s**. Fixed: one attempt per endpoint (35 s cap), straight on to the next, a 90 s budget, mail.ru second in the default list, a 7-day cache. Re-check: 7 named places in 20.2 s (Ikoyi Park, Muri Okunola Park, Freedom Park, Kokobire, Sports Complex, Tinubu Square, Lagos Polo Club). |
| 7-day hourly forecast at the midpoint | Open-Meteo | 801 ms | 168 hours with rain probability, apparent temperature, UV and precipitation. Wednesday noon: 82% rain, feels like 34.9 C, UV 6. Best Saturday window 15:00 to 19:00: 16:00 to 19:00, **not ok** (rain up to 94%). October is still rainy season, so the rain watch matters. |
| Gemma reads "wine and monopoly at mine friday 7, bring a bottle" | Gemini API, gemma-4-26b-a4b-it | 4.0 s | **JSON mode with a response schema was accepted** (unconfirmed in the docs). Answer: hosted, "wine and monopoly", dateWords "friday", startTime "7", atHost true, bring ["a bottle"]. After code: start 2026-10-23T19:00+01:00, host is the member, place "Tolu's place" (private), `low: ["start"]` with the note `Read "7" as 19:00.` |
| Gemma reads a flyer image (test/fixtures/flyer.png) | Gemini API, gemma-4-26b-a4b-it | 5.9 s | **Image input works**, JSON mode accepted. Read every line right: "GROOVE SESSIONS", "SUN 25 OCT", "6PM", "FREEDOM PARK", "LAGOS ISLAND", "N5,000", bring "a mat". Fixed after: shouting calmed to "Groove Sessions"; "SUN 25 OCT" now resolved by code and cross-checked against the weekday; "Freedom Park" pinned from the curated spots and marked outdoor (the model had left outdoor null). |

Two more Gemma calls checked the ritual's own prompts on real data (a Yaba, Surulere and Lekki crew, the curated spots): the pick was Tinubu Square, longest trip 35 minutes.

| Call | Latency | Result |
|---|---|---|
| explain-pick | 2.3 s | "The app picked Tinubu Square because it is a green park with a chill outside vibe. It is a fair choice for everyone to meet." Passed the grounding check, but generic: the prompt now asks it to lead with a concrete fact. |
| write-invite | 2.6 s | "Catch the chill vibe at Tinubu Square this Saturday from 16:00 to 19:00. It is a green park and a fair choice to meet up. Just come through, no need to reply 🌳" Passed: every number is in the facts, no dashes. |

What this settles from the research:

- Gemma 4 on the free Gemini API takes images and honours `responseMimeType` plus `responseSchema`. The adapter still retries without JSON mode if a model refuses it, and always parses with salvage.
- No fallback model is needed for vision. `GEMMA_VISION_MODEL` exists if one is ever wanted.
- The public Overpass instances cannot be relied on at request time. Overpass runs only in the heartbeat, is cached for a week, and the curated spots cover the ritual when it fails.

## Integration run, Wed 21 Oct 2026 (afternoon)

The backend and the web app were built in parallel against the spec. This run joined them
and drove the real app over HTTP, first with `OFFLINE=1`, then live (Gemma
gemma-4-26b-a4b-it, Photon, Overpass, Open-Meteo), with `scripts/e2e.mjs`.

The flow: a crew from one sentence; Tolu (Yaba, the organiser), Amaka (Lekki Phase 1),
Seyi (Surulere) and Bayo (Ikeja) join; plans arrive as a sentence ("wine and monopoly at
mine friday 7, bring a bottle"), a made-up flyer (`test/fixtures/flyer-mango-yard.png`:
"Highlife Under Mangoes", The Mango Yard, Surulere, Sat 31 Oct, 5pm, gate N3,000), a public
Eventbrite page, and an Instagram link; RSVPs; pods; the feed and one event file checked
against RFC 5545 (`scripts/ics-check.mjs`); two heartbeats.

| Step | Live result |
|---|---|
| Crew sentence | 3.7 to 6.3 s; name, every other Saturday, vibe, three areas geocoded by Photon |
| Sentence plan | 3.6 s; hosted, Friday 19:00 (flagged), host Tolu, bring a bottle |
| Flyer plan | 5.7 to 11 s; every field right; address not on the map, so ride times and weather use Surulere. Once Gemma took over 25 s and the draft came back empty: the screen now says "Over to you" with "Try Gemma again" |
| Event link | 4.4 to 5.9 s; the page's own event data (Sat 24 Oct 13:00 to 15:00), pinned at the Sheraton, Ikeja; flyer image from og:image |
| Instagram link | 422 `link_locked` in 2 ms, no Gemma call |
| Pods | Seyi to Tolu's: 14 min from Surulere; Amaka: 103 min from Lekki on a Friday evening, across the bridge; a ride link on pinned plans only (Uber then; since replaced by Bolt and inDrive, see LOCAL-FACTS.md) |
| Calendar | feed: 3 events, every line 75 octets or less, 9 folded, escaping correct, ETag 304; event.ics: one event with an alarm |
| Heartbeat | tick 1 made the ritual in 44 s (Overpass at capacity, the curated spots carried it); tick 2 made nothing |
| Rain | Saturday 3 to 7 pm forecast up to 95% rain, so the ritual moved to 8 to 10 am (34%) with the note "Rain is likely from 3 pm to 7 pm (up to 95%), so the sloth moved it to 8 am to 10 am..." (Since replaced: nobody meets in a Lagos park at 8 am on a Saturday. The sloth now stays inside social hours and, with this forecast, skips the slot. See LOCAL-FACTS.md.) |
| Web Push | headless Chrome subscribed through FCM; a new plan by another member arrived as a notification (`scripts/push-check.mjs`) |

Bugs found and fixed, each with a test:

- **The ritual never came for an active crew.** Any plan within half a cycle blocked it, so
  an indoor Friday wine night cancelled Saturday in the park. Now only a plan in the slot's
  own hours, or an outdoor plan in the cycle, counts.
- **A wet ritual just went out wet.** Now `ritualWindow` moves it to a dry daylight stretch
  that day, else the next day, else keeps the least wet hours and says so (`rainPlan`).
- **The heartbeat could take 166 s**, past Cloudflare's 100 s, when Overpass was down (90 s
  budget, tried at two radii). Now 40 s, one try per tick.
- **Member names went to Google** in the ritual's explanation. Now only neighbourhoods and
  minutes.
- **Instagram links spent a Gemma call** on an empty page. Now `link_locked`, no call.
- **Unpinned places had no ride times and a silent failure.** The note was dropped; now the
  person is told, and the neighbourhood in the address (or the host's area) gives ride times
  and weather, never a ride link.
- **Flyer thumbnails never reached the server**: the web app did not send `thumb`. It now
  sends a 480 px JPEG.
- **Crew drafts lost the server's notes** in the web client, and the rhythm note said
  "couldn't find a regular day" when only the time was guessed.
- Smaller: "wine and monopoly" now gets a capital; shouted hosts and prices are calmed;
  repeated address parts go; "Dry" only below 20% rain ("Mostly dry (34%)" otherwise);
  invites say "8 am to 10 am"; a pod from two areas says both; no "Copy address" when there
  is no address; an Android phone is never taken for an iPad; no marker animation under
  reduced motion; invalid `ALLOWED_ORIGINS` entries no longer crash the server at boot.

## The sloth's 3 ideas: live runs, Wed 21 Oct 2026 (afternoon)

`GET /api/crews/:slug/ideas` (docs/SPEC.md, "Ideas"). Checked with `scripts/feeds-check.mjs`
(the two Lagos guides through Gemma) and `scripts/ideas-check.mjs` (a whole card for a made-up
Yaba, Lekki Phase 1 and Surulere crew, "outside and music", cheap), against
gemma-4-26b-a4b-it, Photon, Overpass and Open-Meteo. The feeds were fetched twice that day
(once in the research, once for the first check); later runs read those saved copies with
`FEEDS_DIR`, so no feed was fetched a third time.

| Step | Result |
|---|---|
| Fetch both feeds (robots.txt first) | 200 in 1.1 to 1.3 s, 20 posts each, about 410 KB; `/feed` allowed for `*` |
| Read the newest Awe Lagos post (16 to 18 Oct) | 12 events listed, 12 kept, 32 s. Dates, times, venues, prices as stated, and each event's own ticket link |
| Read the newest Nothing To Do In Lagos post (15 to 18 Oct) | 13 listed, 12 kept (a "title_placeholder" dropped: not in the post), 34 s |
| The first card (cold caches) | **215 s.** Overpass took longer than the 15 s budget, and 25 venue lookups ran for events that had already passed |
| The card after the guides were read (as after the heartbeat) | **17 s**, 2 ideas: Lagos Trivia Night (Sun 25 Oct, the only guide event still to come that Wednesday, "From Awe Lagos' weekly guide") and Nike Art Gallery (Sat 4 to 7 pm, a roof: rain was forecast all weekend, so no outdoor places) |

Bugs found and fixed in these runs:

- **Slow first card.** Venues are now looked up only for events still to come, within 20 s
  per post; a card waits at most 25 s for a guide being read (it goes on in the background,
  and that card is kept 10 minutes instead of 3 hours); a slow map gives way to the curated
  spots after 15 s.
- **An event under a far day heading was dropped** ("B3AM Galaxy" sat 3,000 characters below
  "SATURDAY, OCTOBER 17"). The nearest day heading above an event now counts as stating its
  date.
- **Gemma picked none of two.** Asked for "the three best" of two ideas it answered
  `{"picks": []}`. The message now says how many to pick; re-run: both picked, both reasons
  grounded (3.3 s).
- **Reading a whole guide timed out** at the default 25 s. The extraction asks for two minutes.
- Weekend places and the usual now try Saturday and Sunday before a Friday evening (a covered
  place on Friday at rush hour failed the 90-minute trip cap).

Gemini API 500s came back on two of five long reads that day. A post whose facts could not
be read is fetched again in full on the next day's try (no `If-None-Match`).

## Run your own sloth: Ollama on this Mac, Wed 21 Oct 2026

`LLM=ollama OLLAMA_MODEL=gemma3-4b-hf:latest OLLAMA_TIMEOUT_MS=900000 node scripts/llm-check.mjs`,
Ollama 0.12.5, on a 2017 MacBook Pro (Intel Core i5-7360U, 2 cores, 16 GB, CPU only). The
model was imported without a vision projector (`/api/show` lists only `completion`).

| Task | Tokens in / out | Time | Result |
|---|---|---|---|
| parse-crew ("the uni guys, every other Saturday, somewhere outside and cheap, around Yaba and Lekki") | 517 / 122 | 217 s | Right: "the uni guys", cheap, every 2 weeks on Saturday, Yaba and Lekki |
| parse-plan ("wine and monopoly at mine friday 7, bring a bottle") | 654 / 173 | 300 s | Right: hosted, "Wine and monopoly", Fri 23 Oct 19:00, bring a bottle |
| explain-pick | 364 / 28 | 89 s | Grounded: "Freedom Park is a good choice because it keeps everyone's trip from Yaba within 28 minutes." |
| parse-plan with a flyer | | 0 s | Refused before any call: "Reading a flyer needs a vision model, and this server runs gemma3-4b-hf:latest, which reads text only. Type the plan or paste the link instead." |

The first run, with the default 180 s timeout, finished only explain-pick (70 s). Raw speed
on this machine is about 9 tokens a second in and 4 out; the JSON schema grammar roughly
doubles the time. So: the port and the adapter work, and the answers were right for
these three sentences, and a laptop this old is far too slow for people waiting on a screen
(the server's request timeout follows `OLLAMA_TIMEOUT_MS` when `LLM=ollama`). A recent Mac
or any GPU, or `gemma3:12b` on a small GPU server, is the realistic self-hosted setup.
Not run on Ollama: the two ideas tasks (reading a whole guide would take this machine well
over the 3 minute default).

## Curated Lagos spots (data/lagos-spots.json)

Built by `node scripts/build-spots.mjs` on 21 Oct 2026: 26 spots, every coordinate from a Photon or Overpass lookup, with the service, query, OSM id and date recorded. Only meetup-shaped OSM classes and full name matches are accepted. Overpass knows only 27 named parks and beaches in the whole of Lagos, and most are labels like "bbc", "open space" or a hotel; six were kept after review.

Not found in OSM under their names on 21 Oct 2026: Elegushi Beach (only a road), Landmark Beach, Atican Beach, Alpha Beach, Eleko Beach, Bar Beach, JJT Park, Ndubuisi Kanu Park, Jhalobia Recreation Park, Omu Resort, Lagos Yacht Club, Dreamworld Africana, Lekki Leisure Lake, Point of No Return. Twelve of them are now added from Wikidata (CC0) by `scripts/add-wikidata-spots.mjs`; Alpha Beach and Lekki Leisure Lake have no open coordinates anywhere, and Bar Beach is left out on purpose. Details in LOCAL-FACTS.md, "Famous spots". Mapping these in OpenStreetMap would still help everyone.

## Running it

```sh
npm install
npm test               # 179 tests: core, city packs, adapters (fakes and a local HTTP server), service, API end to end
npm run typecheck      # tsc over the JSDoc types
npm run dev            # http://localhost:3000, reads .env; serves web/dist too when it is built
OFFLINE=1 npm run dev  # no keys, no network: fakes for every outside service
npm run smoke          # the live calls above (needs GEMINI_API_KEY)
node scripts/llm-check.mjs                  # three Gemma tasks through the LLM port (LLM=ollama for your own model), with timings
node scripts/feeds-check.mjs                # the Lagos guides' feeds read live (FEEDS_DIR=dir reads saved copies)
node scripts/ideas-check.mjs [tonight|weekend]   # a whole ideas card for a made-up Lagos crew, live
node scripts/pidgin-eval.mjs                # 16 Pidgin and mixed English inputs, live, per-field accuracy
node scripts/cities-check.mjs [city ...]    # a crew in Lagos, London, Berlin, Nairobi, Bengaluru and New York, live (LOCAL-FACTS.md, "Beyond Lagos")
node scripts/events-check.mjs <url> ...     # real event pages through the link reader
npm run e2e -- <base> <event link>          # the whole flow over HTTP (scripts/e2e.mjs)
node scripts/push-check.mjs <base>          # real Web Push through headless Chrome and FCM
node scripts/screens-real.mjs <base> docs/screens/real <event link>   # screenshots on live data
node scripts/screens-mock.mjs <base> docs/screens                    # the plan screens on the demo data
```

The web dev server (Vite) proxies `/api`, `/cal` and `/healthz` to port 3000.

The MongoDB store has its own test, run against a real server when `MONGODB_URI_TEST` is set (`docker run -d --rm -p 127.0.0.1:27027:27017 mongo:8.0`, then `MONGODB_URI_TEST=mongodb://127.0.0.1:27027 npm test`). On 21 Oct it passed against MongoDB 8.0, and a full offline run of the server on MongoDB (create a crew, parse a plan, tick a ritual) worked. That run also caught two bugs, both fixed and tested: "monopoly" was read as Monday by the date-word resolver, and with only the organiser joined the ritual centred on that one member instead of the crew's declared areas.

## Deploying

Exact steps, checks after deploy and the phone checklist: [DEPLOY.md](DEPLOY.md).

## Design notes

- **Core and shell.** src/core is pure and browser-safe (a test enforces it: no Node imports, no clock, no randomness, no fetch). src/adapters wraps every outside service behind a small port with a fake. src/app composes them; src/server is HTTP only.
- **Never trust a model with arithmetic.** Gemma reports the words it read ("friday", "7"); code turns them into dates and times, flags guesses, cross-checks weekdays against dates, and cuts the confidence of any text-input value not found in the source. Explanations and invites with a number not in the facts are replaced by a sentence built by code.
- **Idempotent heartbeat.** Ritual plans have a deterministic id (crew and date), every push has a dedupe key, and weather alerts fire only when the forecast turns. GitHub may run the schedule late, twice or not at all.
- **Tokens.** Invite, member and calendar tokens are separate, 192 random bits each. The calendar token is read-only because Google's servers see it. Responses carry `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, and logs never include query strings.
- **Rate limits** key on the real client: the 3rd X-Forwarded-For entry from the right on Render behind Cloudflare (measured for Selects), never the left-most.
- **Link reading** is SSRF-safe: every DNS answer must be public, the socket is pinned to the vetted address (no DNS rebinding), redirects are re-checked, 6 s and 512 KB caps, and Instagram and Facebook are not fetched (they return empty pages to servers).

## Open items

- Real-phone checks (listed in DEPLOY.md, step 6): Web Push on Android Chrome and on an
  installed iPhone app, the Bolt and inDrive buttons, the one-event file,
  webcal on iPhone, the Android share target, an iPhone HEIC flyer, and voice input.
- The free Gemma quota is unpublished (a third-party source says 15 requests a minute). The
  server allows 20 Gemma calls a minute in total and 8 per visitor; watch for 429s in the
  logs. A vision call took over 25 s once in six tries on 21 Oct.
- Eventbrite prices are in whatever currency the organiser chose (often USD for Lagos events).
  A non-naira price now gets a note and lower confidence. Tix.africa blocks servers, so its
  links ask for a screenshot. See LOCAL-FACTS.md, "Event sources".
- SerpApi (events near the crew) is not built.
- Ask Awe Lagos and Nothing To Do In Lagos for permission to list their picks (with the
  credit and link the app already shows). Until then the feeds are read with a small
  footprint (LOCAL-FACTS.md, "Curated weekly guides").
- The ideas card has not been seen with a week's fresh guides yet: on Wednesday 21 Oct only
  one guide event was still to come. Re-run `scripts/ideas-check.mjs` on Friday.
- Ollama was tested only with a 4B text model on an old CPU. The two ideas tasks were not
  run on it, and no vision model was tried.
- No email or account recovery by design: losing the member link means joining again. A "send me my link" option could come later.
