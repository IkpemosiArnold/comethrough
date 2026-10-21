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

## Curated Lagos spots (data/lagos-spots.json)

Built by `node scripts/build-spots.mjs` on 21 Oct 2026: 26 spots, every coordinate from a Photon or Overpass lookup, with the service, query, OSM id and date recorded. Only meetup-shaped OSM classes and full name matches are accepted. Overpass knows only 27 named parks and beaches in the whole of Lagos, and most are labels like "bbc", "open space" or a hotel; six were kept after review.

Not found in OSM under their names, so left out rather than guessed: Elegushi Beach (only a road), Landmark Beach, Atican Beach, Alpha Beach, Eleko Beach, Bar Beach, JJT Park, Ndubuisi Kanu Park, Jhalobia Recreation Park, Omu Resort, Lagos Yacht Club, Dreamworld Africana, Lekki Leisure Lake, Point of No Return. Mapping these in OpenStreetMap would help everyone (and would fit the open-data story in the post).

## Running it

```sh
npm install
npm test               # 90 tests: core, adapters (fakes and a local HTTP server), service, API end to end
npm run typecheck      # tsc over the JSDoc types
npm run dev            # http://localhost:3000, reads .env; serves web/dist too when it is built
OFFLINE=1 npm run dev  # no keys, no network: fakes for every outside service
npm run smoke          # the live calls above (needs GEMINI_API_KEY)
```

The web dev server (Vite) proxies `/api`, `/cal` and `/healthz` to port 3000.

The MongoDB store has its own test, run against a real server when `MONGODB_URI_TEST` is set (`docker run -d --rm -p 127.0.0.1:27027:27017 mongo:8.0`, then `MONGODB_URI_TEST=mongodb://127.0.0.1:27027 npm test`). On 21 Oct it passed against MongoDB 8.0, and a full offline run of the server on MongoDB (create a crew, parse a plan, tick a ritual) worked. That run also caught two bugs, both fixed and tested: "monopoly" was read as Monday by the date-word resolver, and with only the organiser joined the ritual centred on that one member instead of the crew's declared areas.

## Deploying (checklist)

1. MongoDB Atlas: a free cluster in eu-central-1 (Frankfurt); copy the connection string.
2. Render: connect the repo; render.yaml creates one free Node service in Frankfurt. Set `PUBLIC_URL`, `GEMINI_API_KEY`, `MONGODB_URI`, and the VAPID keys (`npx web-push generate-vapid-keys`). `TICK_SECRET` is generated.
3. After the first deploy: `curl -H 'X-Forwarded-For: 1.2.3.4' $PUBLIC_URL/healthz` must show your own address in `you`. If it shows a Render or Cloudflare address, adjust `TRUST_PROXY_HOPS`.
4. GitHub: repository secret `TICK_SECRET` (the value from Render) and variable `COMETHROUGH_URL`. Run the "tick" workflow once by hand to check.
5. Custom domain: point comethrough.tech at the Render service; set `PUBLIC_URL` to it.

## Design notes

- **Core and shell.** src/core is pure and browser-safe (a test enforces it: no Node imports, no clock, no randomness, no fetch). src/adapters wraps every outside service behind a small port with a fake. src/app composes them; src/server is HTTP only.
- **Never trust a model with arithmetic.** Gemma reports the words it read ("friday", "7"); code turns them into dates and times, flags guesses, cross-checks weekdays against dates, and cuts the confidence of any text-input value not found in the source. Explanations and invites with a number not in the facts are replaced by a sentence built by code.
- **Idempotent heartbeat.** Ritual plans have a deterministic id (crew and date), every push has a dedupe key, and weather alerts fire only when the forecast turns. GitHub may run the schedule late, twice or not at all.
- **Tokens.** Invite, member and calendar tokens are separate, 192 random bits each. The calendar token is read-only because Google's servers see it. Responses carry `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, and logs never include query strings.
- **Rate limits** key on the real client: the 3rd X-Forwarded-For entry from the right on Render behind Cloudflare (measured for Selects), never the left-most.
- **Link reading** is SSRF-safe: every DNS answer must be public, the socket is pinned to the vetted address (no DNS rebinding), redirects are re-checked, 6 s and 512 KB caps, and Instagram and Facebook are not fetched (they return empty pages to servers).

## Open items

- Real-phone checks: the m.uber.com/looking link with drop[0] in Lagos (Android and iPhone), Web Push on Android Chrome and on an installed iPhone app, and webcal subscription on iPhone.
- The free Gemma quota is unpublished (a third-party source says 15 requests a minute). The server allows 20 Gemma calls a minute in total and 8 per visitor; watch for 429s in the logs.
- SerpApi (events near the crew) is not built.
- No email or account recovery by design: losing the member link means joining again. A "send me my link" option could come later.
