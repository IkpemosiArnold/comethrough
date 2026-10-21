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
