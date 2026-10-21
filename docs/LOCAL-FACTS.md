# Local facts: does this work in Lagos today?

Every claim the app makes about Lagos, with where it comes from and when it was checked.
The rule: a local claim gets a source (a URL and the date it was checked) or a live test from
a development machine in Lagos. If it cannot be checked, it is left out or labelled plainly.

This file exists because the first build shipped a "Book Uber" button weeks after Uber left
Nigeria (2 Sep 2026). The research behind that button checked how Uber's links work, and
never asked whether Uber works in Lagos. Each section below answers that second question.

## Rides

**Uber is gone.** Uber wound down its Nigerian operations "effective 2 September 2026"
(Uber's statement as quoted by TechCabal, "Ride-hailing giant Uber to stop operating in
Nigeria, ending a 12-year run", 2 Sep 2026,
https://techcabal.com/2026/09/02/uber-exits-nigeria/; also Semafor, 4 Sep 2026,
https://www.semafor.com/article/09/04/2026/ubers-nigeria-exit-furthers-retreat-from-africa).
All checked 21 Oct 2026. Uber's Play Store listing still answers HTTP 200, so a live store
page proves nothing about whether a service runs.

What the app offers now, in this order (`src/core/rides.mjs`):

| App | Runs in Lagos? (source, published) | Drop-off link? | Button goes to |
|---|---|---|---|
| Bolt | Yes. TechCabal 2 Sep 2026: the market is now "concentrated around its biggest rivals, Bolt and inDrive"; TechCabal 3 Sep 2026: Bolt says Nigeria "remains an important market" (https://techcabal.com/2026/09/03/with-uber-gone-bolt-says-nigeria-remains-an-important-market/); Bolt's own Lagos page https://bolt.eu/en-ng/cities/lagos/ answers HTTP 200 | No. `bolt.eu/.well-known/apple-app-site-association` has only `webcredentials`, no `applinks`; `assetlinks.json` delegates all URLs to `ee.mtakso.client` but no documented path takes a destination; no developer docs found | Play: `ee.mtakso.client`; App Store: id675033630; web: bolt.eu/en-ng/cities/lagos/ |
| inDrive | Yes. TechCabal 2 Sep 2026 (above); Legit.ng 3 Sep 2026, "Uber Leaves Nigeria: Bolt, inDrive and Local Rivals Face New Ride-Hailing Battle" (https://www.legit.ng/business-economy/technology/1728679-uber-leaves-nigeria-bolt-indrive-local-rivals-face-ride-hailing-battle/) | No. `indrive.com`'s app site association claims only `/app/`, `/app/super_services`, `/app/oauth-callback`, `/app/wallet/*`, `/app/bdu/*` | Play: `sinet.startup.inDriver`; App Store: id780125801; web: indrive.com/en-ng/ (HTTP 403 to curl, so unchecked as a page) |
| LagRide | Yes. Legit.ng 3 Sep 2026 calls it "the Lagos State-backed ride-hailing platform"; Condia 11 Sep 2026 lists it as Lagos only (https://thecondia.com/uber-alternatives-nigeria-ride-hailing-apps/) | No. `lagride.ng` serves no app link manifests | Play: `com.lagos.emobility.client`; App Store: id6738812036; web: www.lagride.ng |
| Rida | **Not added.** The evidence conflicts: news lists it, but rida.app now offers only Congo (DRC) locales, its iPhone app's description does not mention Nigeria, and a driver review on 3 Sep 2026 says Lagos is not in its city list. | | |

Every store and web URL above answered HTTP 200 from this machine on 21 Oct 2026, except
inDrive's web page (403 to curl).

So the ride card says what is true: "Copy address" (the place's name and address, or nothing
for a host's home with no address), then "Bolt" and "inDrive" buttons that open the app's
store page on a phone (the store shows "Open" when the app is installed) or the Lagos web
page on a computer, and a line saying no ride app here takes a drop-off from a link. When a
provider documents one, it goes in `dropoff` with its source and a test.

**Fares:** none are shown. Bolt publishes estimates on its own route pages (for example
https://bolt.eu/en-ng/cities/lagos/route/egbeda-bus-stop-to-ajah-motor-park/), but the app
does not use them, and the others publish none.

Not verified on a phone yet: that the Play and App Store pages show "Open" for an installed
app on the devices the crew uses (DEPLOY.md, phone checklist).

## Famous spots

`data/lagos-spots.json` first came from OpenStreetMap only, and OpenStreetMap does not have
many of the places a Lagos crew actually goes by name (21 Oct 2026). Those are now added from
**Wikidata** (CC0), by `node scripts/add-wikidata-spots.mjs`, which reads each item's
coordinate location (P625) live and records the item, the licence and the date. Each item
was matched by name, place and description, and every coordinate was checked to fall inside
Lagos and near where the place is known to be. OpenStreetMap was cross-checked through
Nominatim where it had the place.

| Spot | Wikidata | Lat, lon | Note |
|---|---|---|---|
| Elegushi Beach | [Q28232226](https://www.wikidata.org/wiki/Q28232226) | 6.422055, 3.486607 | Ikate, Lekki coast |
| Landmark Beach | [Q108924711](https://www.wikidata.org/wiki/Q108924711) | 6.42256, 3.445648 | Item name "Landmark Leisure Beach" (not the hotel, Q113171526) |
| Atican Beach | [Q109516089](https://www.wikidata.org/wiki/Q109516089) | 6.424958, 3.596925 | The item is Atican Beach Resort; there is no item for the beach alone |
| Eleko Beach | [Q25042473](https://www.wikidata.org/wiki/Q25042473) | 6.4391, 3.85419 | Ibeju-Lekki |
| JJT Park (Johnson Jakande Tinubu Park) | [Q109290920](https://www.wikidata.org/wiki/Q109290920) | 6.615213, 3.363948 | Alausa, Ikeja |
| Ndubuisi Kanu Park | [Q109291010](https://www.wikidata.org/wiki/Q109291010) | 6.614232, 3.365765 | Next to JJT Park |
| Jhalobia Recreation Park | [Q109421702](https://www.wikidata.org/wiki/Q109421702) | 6.55613, 3.32211 | Airport Road |
| Omu Resort | [Q109266995](https://www.wikidata.org/wiki/Q109266995) | 6.489748, 3.753269 | Not in OpenStreetMap, so not cross-checked |
| Lagos Yacht Club | [Q22570266](https://www.wikidata.org/wiki/Q22570266) | 6.440579, 3.401908 | OSM way 591832831 agrees |
| Dreamworld Africana | [Q22080800](https://www.wikidata.org/wiki/Q22080800) | 6.458985, 3.601521 | Not in OpenStreetMap, so not cross-checked |
| Point of No Return | [Q20891702](https://www.wikidata.org/wiki/Q20891702) | 6.394334, 2.891409 | The point is the centre of Gberefu Island, not the monument |
| Nike Art Gallery | [Q25044062](https://www.wikidata.org/wiki/Q25044062) | 6.43152, 3.481894 | Indoor, so marked `covered`: the sloth may offer it when rain blocks every outdoor window. OSM way 363752678 agrees |

All checked 21 Oct 2026. Every spot in the file now has a `source` and a `verifiedAt` date.

**Not added, no open coordinates:** Alpha Beach (Lekki) and Lekki Leisure Lake. Neither has a
Wikidata item or an OpenStreetMap feature by name (21 Oct 2026). Mapping them in
OpenStreetMap would fix this for everyone.

**Not added on purpose:** Bar Beach. Wikipedia describes it in the past tense ("Bar Beach was
a beach ... on Victoria Island", summary checked 21 Oct 2026), and its Wikidata coordinate has
only three or four decimals.

## Entry fees

The app never says a place is free unless a source says so. Fees live in
`data/spot-entry-fees.json`, each with the source's URL, publisher, date and the words it
uses; a fee without a source is dropped before it reaches anyone. A plan's place gets
`entry: { free: true|false|null, note, source }`, and `free: null` shows as "Entry: check at
the gate". A plan read from a flyer or an event page keeps the price it gave, and gets no
entry line.

| Spot | Entry | Source (published; checked 21 Oct 2026) |
|---|---|---|
| Elegushi Beach | Paid: "typically around N1,000 to N2,000 at the gate", lounges and cabanas more | Nairametrics, "Most popular beaches in Lagos and cost of access in 2026" (23 May 2026), https://nairametrics.com/2026/05/23/most-popular-beaches-in-lagos-and-cost-of-access-in-2026/ |
| JJT Park | Paid: "In 2024, the Lagos State Parks and Gardens Agency (LASPARK) introduced a N1,000 access fee for individuals at public parks, including JJT Park." The same article says entry was free until 2024. | Ikeja Record, "In Lagos, accessing public parks is becoming expensive" (2 May 2025), https://ikejarecord.com/in-lagos-accessing-public-parks-is-becoming-expensive/ |
| La Campagne Tropicana | Paid resort (packages; one listed at N1.9 million) | Nairametrics, as above |
| Every other spot | Unknown: "Entry: check at the gate" | None found. LASPARK's fee covers "public parks", but the article names only JJT Park, so it is not applied to Ndubuisi Kanu Park, Freedom Park or others. Third-party guides give fees for Lekki Conservation Centre and LUFASI, but they are undated or old, so they are not used. |

An OpenStreetMap `fee` tag on a place is also a source, and is linked as one.

Fixed in this pass: the demo data said "Free to get in" for Muri Okunola Park, and the sloth's
sample explanation said "It's free"; neither had a source. The demo's worst-case text also
claimed "proper toilets" and "the gate closes at 7" for JJT Park; both are gone.

## Travel times

Leave-by times are **rough estimates, not live traffic**, and the app says so. Since this pass
they start from a real road route:

- **Road distance and bridges from OSRM** (Open Source Routing Machine) on OpenStreetMap data,
  through the public demo server `router.project-osrm.org`. Its policy (checked 21 Oct 2026,
  https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server): "reasonable, non-commercial
  use-cases. Do not exceed 1 request per second. We provide no guarantees"; the older usage
  policy page adds a valid User-Agent and ODbL attribution. The adapter sends one request at a
  time at least 1.1 s apart, names the app in its User-Agent, caches each route for a week,
  gives up after 3 s and backs off for 5 minutes after a failure. **If Come Through ever
  charges money, it needs its own OSRM server** (`OSRM_URL`), because the demo is
  non-commercial.
- **OSRM's own durations are free-flow times** with no traffic (osrm-talk mailing list, Nov
  2023, https://lists.openstreetmap.org/pipermail/osrm-talk/2023-November/002062.html). Live
  test on 21 Oct 2026: Yaba to Lekki Phase 1 is 17.3 km and "15.6 minutes", over Third
  Mainland Bridge. Nobody in Lagos does that trip in 15 minutes at 6 pm. So the app uses
  OSRM's distance and bridge names, and its own traffic bands for the speed; OSRM's time is
  only a floor.
- **A bridge is named only when the route takes it.** OSRM returns the street names of each
  step; when they include Third Mainland Bridge, Carter Bridge or Eko Bridge (the lagoon
  crossings between the mainland and the island), the estimate adds the bridge penalty and
  the ride card says "The time allows for Third Mainland Bridge." The old card said "The time
  allows for the bridge" from a two-line guess about which side of the lagoon each end was on.
  Live test: Surulere to Freedom Park takes Eko Bridge (10.1 km); Ikeja to Yaba takes no
  lagoon bridge (14.2 km).
- **When OSRM fails**, the old straight-line estimate is used (the straight line plus 40%,
  with a lagoon penalty when the ends are on different sides), and the "How we guess" line
  says "the road route was not available" and "in case the trip crosses the lagoon".
- The sloth's place ranking uses one OSRM table request (road distances from every member's
  area to every candidate); a table has no street names, so there the lagoon is judged from
  the two ends, as before.

The traffic bands are **assumptions**, kept in `LAGOS_TRAFFIC` in `src/core/geo.mjs`:

| Band | When (Lagos time) | Speed on the road distance | Lagoon bridge |
|---|---|---|---|
| Weekday rush hour | Mon to Fri, 06:00 to 10:00 and 16:00 to 21:00 | 13 km/h | +20 min |
| Weekday daytime | Mon to Fri, other hours from 05:00 to 22:00 | 20 km/h | +10 min |
| Saturday afternoon | Sat 12:00 to 21:00 (parties, weddings, markets) | 18 km/h | +12 min |
| Weekend other | Sat morning, all of Sunday | 22 km/h | +8 min |
| Night | 22:00 to 05:00 | 32 km/h | +3 min |

What backs them, and what does not:

- Lagos is not in the TomTom Traffic Index (its 551-city ranking has no Nigerian city, and
  tomtom.com/traffic-index/lagos-traffic/ returns 404; checked 21 Oct 2026).
- A 2008 study of Lagos commuters (Raji Bashiru, Indonesian Journal of Geography 40(1),
  https://journal.ugm.ac.id/ijg/article/view/2246) found three daily peaks, Monday the most
  congested day, and 57% of commuters spending 30 to 60 minutes in congestion. It does not
  give hours in its abstract.
- News on the 2019 Lekki toll gate rush-hour study puts the evening peak around 4:30 pm to
  7:30 or 8 pm (https://ripplesnigeria.com/sanwo-olu-authorises-free-passage-at-lekki-ikoyi-tollgates-on-wednesday).
  The rush-hour band (16:00 to 21:00) is wider on purpose.
- **No source was found for Saturday traffic.** The Saturday afternoon band is a Lagos
  resident's assumption and is labelled as one.
- The speeds themselves are not measured. They should be tuned against real trips by the
  crew (a "how long did it take?" tap would do it).

## Pidgin and mixed English

Lagos crews type in Nigerian Pidgin and in mixes of Pidgin, Yoruba and English. On 21 Oct
2026 the Gemma prompts were tested live against the Gemini API (gemma-4-26b-a4b-it) on 16
realistic inputs (`test/fixtures/pidgin.mjs`): 5 crew setups ("Na we be the Yaba boys o,
every other Sunday..."), 8 plans ("abeg make we link up Saturday for Lekki, I no get money",
"Olisa dey host wine and monopoly for him house Friday 7, carry your own drink", "who wan
follow me go Afrobeats rave for Eko Hotels Saturday night", "Make we go Elegushi beach Sunday
afternoon, gate na 2k, bring towel", ...) and 3 pieces of feedback ("We no wan go Freedom
Park again, and make we start later small"). Each case lists the fields the app should end
up with, after Gemma reads and code resolves. `node scripts/pidgin-eval.mjs` repeats the run.

**What went wrong on the first run, and the fixes:**

| Problem (first run) | Fix |
|---|---|
| "carry your own drink" came back as bring: "a bottle", copied from the prompt's own example | The example is gone from the prompt, and code now drops anything to bring that the message does not say, with a note |
| "every Saturday morning" came back with no rhythm | The prompt lists "every Saturday" and "once a month"; code also reads "every other", "once a month", "every Friday" and the one weekday named, in English and Pidgin |
| "VI" was dropped (two letters), so a VI crew lost an area | "VI" is accepted and expanded to Victoria Island |
| "after work" became the default 3 to 7 pm | "after work" is 5:30 to 9 pm, matching the weekday social hours |
| "Start 2pm" came back as "2nd" (from "Sat 31st") | Code reads one clear clock time from a typed message when the model misses it, at lower confidence |
| "for Lekki" with no venue gave no place | The prompt says an area alone counts as the address |
| "nothing too expensive", "make e no cost plenty money" | The prompt explains common Pidgin; code reads Pidgin money words as cheap |

**Final per-field accuracy** (each case's last live answer, with the final prompts; checked
offline by `test/pidgin.test.mjs`):

| Task | Field | Right |
|---|---|---|
| Crew setup | how often | 5/5 |
| | day | 5/5 |
| | areas | 5/5 |
| | vibe | 4/4 |
| | budget | 2/2 |
| Plan | kind (hosted, found, quick) | 7/7 |
| | date | 8/8 |
| | start time | 6/6 |
| | place | 6/6 |
| | title | 3/3 |
| | price | 6/6 (including "no price" where none was said) |
| | free | 2/2 |
| | host | 4/4 (named host, self-hosted, or none) |
| | bring | 2/2 |
| | outdoor | 1/1 |
| Feedback | closer to, avoid, prefer, cheaper, later | 6/6 |
| **All** | | **72/72** |

The first run, before the fixes, was 14 of 22 on the cases that reached Gemma. Honest
limits: 16 inputs is a small set written by the developer, not collected from real crews,
and 72/72 is on the final answers only. Gemini returned "500 Internal error" on 4 of the 48
calls that reached it (8%), and on one run the connection from Lagos dropped for 11 calls;
the app already handles both by saying Gemma is busy and letting the person fill the form.
Calls used: 48 that reached the API (under the 60 budget), plus 11 that failed before
leaving the machine.

## Data cost

Most of the crew is on prepaid mobile data, so every kilobyte is the person's money.

**Flyer uploads** (`web/src/lib/image.js`). The phone shrinks the picture before it is sent:
at most 1600 px on the long edge, WebP at quality 0.8 where the browser can write WebP
(Chrome, Opera, Firefox), JPEG otherwise (Safari), then quality 0.7 and 0.6, then 1280 and
1024 px, until it is under 400 KB. An already small JPEG, PNG or WebP is sent as it is. The
reading screen says what is being sent: "Sending 372 KB, shrunk from 10.6 MB to save your
data."

Checked in headless Chrome on 21 Oct 2026:

| Picture | Before | Sent |
|---|---|---|
| A 4032 x 3024 phone-sized photo filled with noise (the worst case for compression) | 11.1 MB JPEG | 381 KB WebP, in 1.9 s |
| The test flyer (`test/fixtures/flyer-mango-yard.png`) | 559 KB PNG | 63 KB WebP |
| The same flyer as an iPhone HEIC (made with macOS `sips`) | 84 KB HEIC | Not opened: Chrome cannot decode HEIC, so the person sees "This browser can't open iPhone HEIC photos. Take a screenshot of the flyer and add that instead." |

Safari can decode HEIC, so on an iPhone the photo is converted in the browser. That path was
not tested on a real iPhone here (DEPLOY.md, phone checklist).

**First load.** The Node server sent the app uncompressed: 159 KB for the page, the
JavaScript, the CSS and the font. It now sends Brotli (or gzip) to any browser that asks,
compressing each file once and keeping the result: **about 56 KB** on the wire for a first
visit (31 KB of JavaScript, 8 KB of CSS, a 16 KB font that is already compressed, the page).
API answers over 1 KB are compressed too. The demo data (`?mock=1`) is a separate file that
real visitors never load. Later visits come from the service worker's cache.

The map on a plan page is six OpenStreetMap tiles, about 15 to 30 KB each, loaded lazily
only on that page.

## Delivery: WhatsApp first

A Lagos crew lives in its WhatsApp group, and nobody installs an app to go to a hangout. So
the plan's link in the group chat is how most people will see a plan, and the UI now says
and does that:

- After posting a plan, a card says "Posted. Now tell the crew" with "Tell the crew on
  WhatsApp" (a `wa.me` link: "New plan: ... Tap the link and say if you're coming: <link>").
  It used to show a toast saying "The crew can see it now", which was only true for people
  who had turned on push.
- After "I'm going", the main button in the bar is "Tell the crew" on WhatsApp ("I'm going
  to ... Come through: <link>"). "Add to my calendar" moved under the page as an extra.
- The crew's Invite button opens WhatsApp directly (it opened the phone's share sheet).
- The join screen says plans come as a link in the group chat, and offers push as "a nudge
  as well", not as the way plans arrive.
- Unchanged: "Share in the group chat", the WhatsApp invite after creating a crew, and the
  WhatsApp rain heads-up.

The messages are in `web/src/lib/share.js`, tested in `test/share.test.mjs`. No claim is made
about WhatsApp's market share in Nigeria here, because none was checked for this pass.

## Opera and Opera Mini

**Opera is about a fifth of Nigerian mobile browsing.** Statcounter, mobile browser share in
Nigeria (CSV from gs.statcounter.com, checked 21 Oct 2026): Opera 19.91% in July 2026, 22.3%
in August, 18.05% in September and 19.4% for October so far; Chrome 64 to 68%, Safari 9 to
13%. Statcounter does not split Opera Mini from Opera for Android, so how many of those
people use Opera Mini is unknown.

**Opera for Android** is built on Chromium (Opera's blog, 31 Mar 2016:
https://blogs.opera.com/mobile/2016/03/brand-new-tab-switcher-web-app-discovery-opera-36-android/),
and supports what the app uses, per MDN's browser compatibility data (@mdn/browser-compat-data
8.1.6) and caniuse:

| Feature the app uses | Opera for Android | Source |
|---|---|---|
| Service worker (offline shell, the share target) | Yes, since 27 | MDN BCD; caniuse.com/serviceworkers |
| Push API (nudges) | Yes, PushManager since 29 | MDN BCD; caniuse.com/push-api; Opera blog, 15 Jun 2016 |
| Install from the web app manifest | Yes, since 26 | MDN BCD |
| Share target (share a flyer to the app) | Yes, since 63 | MDN BCD |

The app detects features instead of browsers (`web/src/lib/platform.js`), so nothing is
switched off for Opera. **Not tested on a real Opera for Android phone** (Opera is not
installed on this machine and the Playwright browser was not used). Push in Opera goes to
whatever push service Opera gives the subscription; the server's `web-push` library sends to
any standard endpoint, but an Opera delivery has not been seen yet (DEPLOY.md, phone
checklist).

**Opera Mini in extreme mode cannot run the app.** Opera's own page (help.opera.com/en/
opera-mini-and-javascript/, checked 21 Oct 2026): "During the transcoding process, JavaScript
is executed by the server", timers run for about 5 seconds, and extreme is the default
savings mode in Opera Mini 11 and later. There is no service worker. So:

- When the browser is Opera Mini (its User-Agent says "Opera Mini", or Opera's proxy sends
  `X-OperaMini-Phone-UA`, both documented by Opera), the links people tap in the group chat
  are answered with **plain HTML pages made on the server** (`src/server/basic.mjs`): the
  plan (when, where, the price or entry, the weather, the rain note, who is going), a form
  with "I'm going", "Maybe" and "Not going", a "Share on WhatsApp" link, the crew's coming
  plans, and a join form (name and area) for an invite link. Forms post and redirect, with no
  JavaScript at all.
- Any other page (starting a crew, adding a plan) says it needs the full app and suggests
  Chrome, or Opera with data savings off or on high.
- Any browser with JavaScript turned off sees a `<noscript>` link to the same basic version,
  with the page's own key kept in the link.

Tested in `test/api.test.mjs` with an Opera Mini User-Agent: view, say maybe, join from an
invite and land back on the plan, the crew page, and the noscript link. Not tested in real
Opera Mini, which only runs on phones.

## Social hours

The sloth never plans a hangout at a time people would not go. These are assumptions, not
measurements, and they live in one place (`SOCIAL_HOURS` in `src/core/weather.mjs`):

| Kind of plan | Hours (Lagos time) | Why |
|---|---|---|
| Weekend outdoor | 11:00 to 18:30 | Late enough to be up and out; done before dark. In 2025 sunset in Lagos ran from 18:25 (8 Nov) to 19:06 (11 Jul): Open-Meteo archive, `archive-api.open-meteo.com/v1/archive?latitude=6.45&longitude=3.40&daily=sunset&timezone=Africa/Lagos` for 2025, checked 21 Oct 2026. Late October and November dusk is close to 18:30, so the cut-off is tight on purpose. |
| Weekend covered or indoor | 11:00 to 21:00 | The same start, and a roof means dark does not matter. |
| Weekday evening, covered or indoor | 17:30 to 21:00 | After work. |
| Weekday outdoor | 17:30 to 18:30 | Only the light part of a weekday evening. |

When rain blocks every acceptable window, the sloth does one of these, in order:

1. Moves the plan to a dry stretch of at least two hours inside the same day's social hours.
2. Moves it to the next day, if that day is the same kind (Saturday to Sunday, never Sunday
   to Monday).
3. Offers a place with a roof, if a source says the place is covered (no curated spot has
   that yet, so in practice this step finds nothing).
4. Skips the slot and says why, from the forecast numbers: "Rain all afternoon on Saturday
   (up to 95% between 11 am and 6:30 pm), and Sunday looks no better. The sloth is skipping
   this one." No calendar entry is made for a skipped ritual, and no Gemma call is spent.

Before this change, the forecast of 21 Oct 2026 (storms from midday on Saturday 24 Oct, a
drier morning) moved the crew's Saturday afternoon to 8 to 10 am. Nobody meets friends in a
Lagos park at 8 am on a Saturday. With the same forecast the sloth now skips the slot.

Tested in `test/weather.test.mjs` and `test/service.test.mjs`.

## Event sources

Checked live on 21 Oct 2026 from this machine (a Lagos connection). The app reads a pasted
link with `src/adapters/pagemeta.mjs` and prefers the page's own schema.org event data.
`node scripts/events-check.mjs <url> ...` repeats the check.

**Eventbrite works.** Both pages answered HTTP 200 to the app's bot user agent and to a
browser user agent alike, with the event in JSON-LD rendered on the server.

| Page (what a person sees) | What the app read | Right? |
|---|---|---|
| [The Amala and Palmwine Festival 2.0](https://www.eventbrite.com/e/the-amala-and-palmwine-festival-20-tickets-2002313797469): Sun 13 Dec 2026, 12:00 to 20:00, The Stable Surulere, 41 Bode Thomas Street, free | "The Amala and Palmwine Festival 2.0", 2026-12-13 12:00 to 20:00 +01:00, The Stable Surulere, "41 Bode Thomas Street, Surulere, Lagos 101241", Free | Yes, after fixes |
| [Selfie Sunday at Alali VI!](https://www.eventbrite.com/e/selfie-sunday-at-alali-vi-things-to-do-in-lagos-every-sunday-tickets-1989728225685): next date Sun 25 Oct 2026, 16:30 to 19:00, 32 Musa Yar' Adua St, Victoria Island, from $50 | Same title, 2026-10-25 16:30 to 19:00 +01:00, venue "32 Musa Yar' Adua St", "From USD 50", with a note that the price is not in naira | Yes, after fixes |

Fixed in this pass:

- The JSON-LD type is `SocialEvent` on many Lagos pages, not `Event`. The parser already
  accepted any `...Event` type; a test now pins it.
- Free events carry `lowPrice: "0.0"` with `priceCurrency: "USD"`. Zero is now free whatever
  the currency, and no currency is shown for it.
- Prices come as `AggregateOffer` ranges. The app now says "From USD 50" (it said
  "USD 50.0"), and a naira price reads "₦15,000" (it said "NGN 15000").
- The organiser chooses the currency. A Lagos event in USD is real (the page shows "$50" to
  people too), and one listing seen that day priced naira tickets in NOK. A non-naira price
  now lowers the price confidence and adds "The page lists the price in USD, not naira.
  Check what you will pay with the organiser." This replaces the open item in NOTES.md that
  guessed Eventbrite showed bots a USD price.
- The page's `og:image` is a long `_next/image` proxy URL; the JSON-LD `image` is the direct
  `img.evbuc.com` picture, and is used first.
- A shouted title ("THE AMALA AND PALMWINE FESTIVAL 2.0") is calmed, and small words now stay
  small ("The Amala and Palmwine Festival 2.0", not "Amala And Palmwine").
- A cancelled or postponed `eventStatus` adds a note.
- A recurring event's JSON-LD gives only the next date. That is what the app shows.

**Tix.africa does not work, and cannot from a server.** Every request from this machine got
HTTP 403 from Cloudflare ("Sorry, you have been blocked"): curl with the bot user agent,
curl with a full Chrome user agent, and headless Chrome from the command line (screenshot
taken 21 Oct 2026). The page itself is a JavaScript app with no Open Graph tags and no
JSON-LD; its data comes from a GraphQL API on `core.tix.africa`, which is behind the same
block. Two current events were found for the record, from a person's browser:
[Johnny's Room Live 8](https://tix.africa/discover/johnnysroomlive8lagos) (Sun 29 Nov 2026,
Muri Okunola Park, from ₦15,850 with fees) and
[Phlenjo Dirty, Sexy Rave](https://tix.africa/discover/dsr3) (Fri 30 Oct 2026, 308 Adeola
Odeku St, Victoria Island, from ₦10,900 with fees). Both store their times as UTC while
showing the wall-clock time, so even the page's own data would be an hour off in Lagos.

So Tix.africa links are now treated like Instagram: the server spends no fetch and no Gemma
call, and the person is asked for a screenshot of the event page or the flyer, which Gemma
reads as a flyer. That path could not be tested with a real Tix screenshot, because this
machine cannot load a Tix page; the flyer path itself is tested.

**Instagram** stays "share the picture instead" (empty page to servers, checked 21 Oct 2026).

## Also found and fixed in this pass

- **The naira sign.** Gemma read the test flyer's "GATE ₦3,000" as "Gate ‸3,000" (U+2038, a
  caret) on 21 Oct 2026. A caret before a number is now turned back into ₦.
- **The demo data** pinned Muri Okunola Park and Freedom Park at made-up coordinates (the Muri
  pin landed on King's College Annex) and invented street addresses. It now uses the sourced
  coordinates from `data/lagos-spots.json`; the Glover Court suya spot, which no open map has
  by name, is left unpinned. The demo's sloth plan ran to 7pm, past the social hours; it now
  runs 3 to 6pm.
- **Wording that promised what does not exist:** "Ride links will need the address" (there
  are no ride links), and the crew home's "Rain all afternoon" on a covered pick even when the
  note covered only part of the afternoon.
- **The server sent the app uncompressed** (see "Data cost").

## Not verified, and why

- Nothing here was tried on a real phone in Lagos: the store pages' "Open" button for Bolt
  and inDrive, Opera for Android push, Opera Mini itself, HEIC on an iPhone, and the
  share target are on the phone checklist in DEPLOY.md.
- Tix.africa's screenshot path could not be tried with a real Tix page, because this machine
  is blocked by Tix.africa's Cloudflare.
- The traffic bands are assumptions; no source for Saturday traffic was found.
- Whether Rida runs in Lagos.
- How much of Opera's share in Nigeria is Opera Mini.
