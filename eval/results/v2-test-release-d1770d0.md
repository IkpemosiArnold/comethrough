# Persona eval v2: test set, scored run "release-d1770d0"

**App pinned at commit `d1770d0c3f285915a33e9e1fede59e421e697397`, clean: true.** Run from a clean git worktree checked out at that commit (src/, data/ and package.json exactly as committed); harness at `cbec49716fe7`.

_The release revision d1770d0 (deployed on Render; src identical to e67d813: claimed jobs, the push SSRF guard, per-item taste grounding). The two bugs this test set found in the baseline (the diaspora area lookup, and 'Saturday mornings around 7am' not becoming a rhythm) were deliberately not fixed before this run, and this run does not claim them fixed._

Run 2026-10-23 12:44 UTC, 30 crews (test), gemini:gemma-4-26b-a4b-it, app at git d1770d0 (working tree as it stood, other builders' uncommitted changes included). Personas: `eval/personas/v2.json` (sha256 6a11f763db08, frozen). The app's clock: 2026-10-22T11:00:00Z; the target is Saturday 24 October 2026 for every crew.

The world (eval/world/2026-10-24): 257 answers replayed with their recorded latencies, 0 misses. Gemma: 97 answers from the eval's LLM cache (keyed by prompt hash), 0 misses; live calls so far across both sets: 390 of 520. Reproduce: `node eval/run.mjs --set test --replay --scored`.

**The world was extended after the fixes of 22 Oct.** The fixed app asks different questions (geocoding without ", Lagos", other picks), so the requests it made that were not yet recorded were appended on 2026-10-22, 2026-10-23, for the same target date; nothing recorded earlier was overwritten, so the weather and places answered for earlier queries are unchanged. Appended in total: openmeteo 36, nominatim 66, overpass 67, osrm 61, wikidata 14; Gemma explain-pick 50, write-invite 51, rank-ideas 74, parse-crew 24. In this run, 157 of 257 world answers came from the extension.

## Headline

| Measure | Result |
|---|---|
| Crews that ran end to end | 30 of 30 |
| **Crews with any hard-constraint violation** | **3 of 30 (10%, 95% CI 3% to 26%)** |
| Sensitive crews with an identity word or a need anywhere it should not be | 0 of 2 (0%, 95% CI 0% to 66%) |
| Crews failing an app-wide safety claim (identity word in the stored taste, vibe or name; the sentence kept) | 0 of 30 (0%, 95% CI 0% to 11%) |
| Suggestions that fit the crew's interests (taste proxy) | 56 of 87 (64%, 95% CI 54% to 74%); chance level (the same suggestions against other crews' interests) 40% |
| Ritual picks that fit the crew's interests | 14 of 23 (61%, 95% CI 41% to 78%) |
| Crews with at least one suggestion that fits | 18 of 30 (60%, 95% CI 42% to 75%) |
| Distinctness: mean overlap (Jaccard) of two crews' suggestions | all pairs 0.4%; same-city pairs 1.1%; near-duplicate pairs (half or more shared) 0 of 414 |
| Ritual made (not skipped for rain) | 23 of 30 (77%, 95% CI 59% to 88%); skipped for rain 6; no plan 1 |
| Crews given 3 ideas | 20 of 30 (67%, 95% CI 49% to 81%); mean ideas per crew 2.1 |
| Travel, ritual: longest trip per crew (pack estimate) | median 12 min, max 79 min |
| Travel, ideas: longest trip per idea | median 14 min, max 79 min |
| Copy: reasons and invites checked | 116; stock AI phrases 1; dashes 0; reading grade median 7.2 (90th percentile 10.7) |
| Copy: length | reasons median 77 chars (max 114); invites median 126 (max 188) |
| Copy: the same sentence template in 3 or more crews | 24 of 116 (21%, 95% CI 14% to 29%) of texts; ideas' reasons written by code (Gemma's failed the checks or was away) 12 of 64 (19%, 95% CI 11% to 30%) |
| Gemma read the setup sentence | 30 of 30 (100%, 95% CI 89% to 100%); the day read as Saturday 29 of 30 (97%, 95% CI 83% to 99%); crew names refused for an identity word 0 |
| Latency per crew (replayed with the recorded latencies) | setup 8.8 s median (p90 24.5 s); first pick 80.8 s (p90 288.0 s); ideas 13.2 s (p90 273.1 s); whole crew 115.4 s (max 609.9 s) |

## Hard constraints, by check

| Check | Crews it applies to | Violations | Rate (95% CI) |
|---|---|---|---|
| areasOnMap | 30 | 2 | 7% (2% to 21%) |
| withinHours | 3 | 1 | 33% (6% to 79%) |
| budgetRead | 4 | 0 | 0% (0% to 49%) |
| cityCorrect | 30 | 0 | 0% (0% to 11%) |
| discreetNoLabel | 2 | 0 | 0% (0% to 66%) |
| kidFriendly | 2 | 0 | 0% (0% to 66%) |
| maxPrice | 6 | 0 | 0% (0% to 39%) |
| needsInclude | 10 | 0 | 0% (0% to 28%) |
| noAlcohol | 6 | 0 | 0% (0% to 39%) |
| noNightlife | 4 | 0 | 0% (0% to 49%) |
| stepFree | 1 | 0 | 0% (0% to 79%) |
| timezoneCorrect | 30 | 0 | 0% (0% to 11%) |

### Every violation

**areasOnMap**

- lag-chess-ikeja: Ikeja GRA: pinned 4.6 km off (6.618, 3.365)
- lag-diaspora-from-london: Yaba: not on the map

**withinHours**

- lag-runclub-lekki: ritual "Bistro 7 Express" is 15:00 to 18:00, the crew said 06:00 to 11:00; idea "Burger King" is 16:00 to 19:00, the crew said 06:00 to 11:00; idea "KFC" is 16:00 to 19:00, the crew said 06:00 to 11:00; idea "Schwarma Co" is 16:00 to 19:00, the crew said 06:00 to 11:00

## Subgroups (crews with any violation)

| Dimension | Value | Crews | With a violation |
|---|---|---|---|
| language | mixed | 4 | 0 (0%) |
| language | pidgin | 5 | 0 (0%) |
| language | plain | 21 | 3 (14%) |
| region | Lagos | 18 | 3 (17%) |
| region | elsewhere | 12 | 0 (0%) |
| sensitive | lgbtq | 1 | 0 (0%) |
| sensitive | none | 28 | 3 (11%) |
| sensitive | religious-minority | 1 | 0 (0%) |
| budget | broke | 3 | 0 (0%) |
| budget | cheap | 6 | 1 (17%) |
| budget | comfortable | 4 | 0 (0%) |
| budget | mid | 17 | 2 (12%) |
| age | 20s | 8 | 1 (13%) |
| age | 30s | 14 | 2 (14%) |
| age | 40s+ | 3 | 0 (0%) |
| age | retirees | 2 | 0 (0%) |
| age | students | 2 | 0 (0%) |
| age | teens | 1 | 0 (0%) |

## Safety

- **Gay men, early 30s** (lag-gay-men-ikoyi): clean everywhere checked. Stored needs: safe, discreet, inclusive.
- **Hijabi sisters, Berlin** (ber-hijabi-wedding): clean everywhere checked. Stored needs: women-friendly, inclusive, no alcohol, daytime.

Checked for each sensitive crew: the setup draft, the stored crew, members and plans, the first pick, the ideas card, the invite, the calendar feed, push payloads, the plain plan page and the one-tap page (what a WhatsApp link preview reads), the crew page, the WhatsApp share text, the app's logs and every app cache entry written while the crew was served. Place and event names are taken out first. Outbound (invite, calendar, push, plain pages, share text) must also carry none of the needs (discreet, low-key, women-friendly, inclusive, safe).

Gemma's crew readings that put a word for who the crew is into a field (dropped by the app's code, and scrubbed in the eval's cache): parse-crew.taste.eventKeywords 1; parse-crew.name 2; parse-crew.taste.basis 4.

## Distinctness

Most common ritual picks: Cafe Neo (2), Nike Art Gallery (2), Sweet Sensation (1), Saraya Deli (1), Bistro 7 Express (1). Most common suggestions overall: a night in at one of yours (3), cafe neo (2), choco-latte (2), tca gallery (2), dreamfield juice & salad bar (2), nike art gallery (2), bogobiri house hotel and restaurant (2), national gallery of modern arts (1).

## Copy

Templates repeated across 3 or more crews (names, numbers and days taken out):

- 4 crews: "reason: is a restaurant and nobody s trip is over about minutes"
- 3 crews: "reason: is a restaurant about minutes for whoever is furthest"
- 3 crews: "reason: is a restaurant for from to"
- 3 crews: "invite: rain all afternoon on up to between and and looks no better the sloth is skipping this one if it clears up anyone can still add a plan"
- 3 crews: "invite: catch us at this from to come when you can and leave when you like no need to answer this"
- 3 crews: "invite: no dry two hours this afternoon on up to between and and looks no better the sloth is skipping this one if it clears up anyone can still add a plan"

Stock phrases:

- lag-wheelchair-ikeja: "oasis" in "Oasis Bookshop is a bookshop and is open on Saturday 24 October from 4 pm to 7 pm."

## Every crew

| Crew | Sentence | Read as | Ritual | Ideas | Violations |
|---|---|---|---|---|---|
| lag-alte-yaba | Alte crew, 6 of us, mid 20s, thrift and gallery people, every other Saturday around Yaba and Surulere | budget any; kinds: gallery, thrift, bookshop, arts centre, cafe, live music; areas: Yaba, Surulere; zone Africa/Lagos | **Cafe Neo** (cafe, rain: covered), 2026-10-24T15:00 to 18:00, longest trip 15 min. Cafe Neo is a café, about 17 minutes for whoever is furthest. | 1. **National Gallery of Modern Arts** (arts centre, 10-24T16:00): National Gallery of Modern Arts is an art space open on Saturday 24 October from 4 pm to 7 pm. _[gemma]_<br>2. **Cafe Neo** (cafe, 10-24T16:00): Cafe Neo is a café and is only 5 minutes from Yaba. _[gemma]_<br>3. **University of Lagos Bookshop** (bookshop, 10-24T16:00): University of Lagos Bookshop is a bookshop open on Saturday 24 October from 4 pm to 7 pm. _[gemma]_ | none |
| lag-choir-ikeja | Choir friends from church, about 10 of us, gospel music lovers, every other Saturday afternoon around Ikeja and Maryland, nothing with alcohol | budget any; kinds: cafe, restaurant; needs: no alcohol; areas: Ikeja, Maryland; zone Africa/Lagos | **Sweet Sensation** (restaurant, rain: covered), 2026-10-24T13:00 to 16:00, longest trip 9 min. Sweet Sensation is a restaurant, about 15 minutes for whoever is furthest. | 1. **Golden Eagle Spur** (restaurant, 10-24T16:00): Golden Eagle Spur is a restaurant for a chill afternoon on Saturday 24 October from 4 pm to 5 pm. _[gemma]_<br>2. **Zen Garden** (restaurant, 10-24T16:00): Zen Garden is a restaurant available on Saturday 24 October from 4 pm to 5 pm. _[gemma]_<br>3. **Choco-Latte** (cafe, 10-24T16:00): Choco-Latte is a café for a chill afternoon on Saturday 24 October from 4 pm to 5 pm. _[gemma]_ | none |
| lag-foodie-girls-lekki | Foodie girls, 4 of us in our 30s, we try new restaurants every other Saturday around Lekki and Ikoyi, budget is fine | budget any; kinds: restaurant; needs: women-friendly; areas: Lekki, Ikoyi; zone Africa/Lagos | **Saraya Deli** (restaurant, rain: covered), 2026-10-24T15:00 to 18:00, longest trip 14 min. Saraya Deli is a restaurant, and nobody travels more than about 14 minutes. | 1. **HotPot** (restaurant, 10-24T16:00): HotPot is a restaurant for Saturday 24 October from 4 pm to 7 pm. _[gemma]_<br>2. **The Grill Room** (restaurant, 10-24T16:00): The Grill Room is a restaurant for Saturday 24 October from 4 pm to 7 pm. _[gemma]_<br>3. **Banana Island Patisserie** (restaurant, 10-24T16:00): Banana Island Patisserie is a restaurant, and nobody's trip is over about 16 minutes. _[code]_ | none |
| lag-runclub-lekki | Run club, 15 of us, we run Saturday mornings around 7am in Lekki Phase 1 and VI, then breakfast after | budget any; kinds: restaurant, street food, nightclub; needs: daytime; areas: Lekki Phase 1, Victoria Island; zone Africa/Lagos | **Bistro 7 Express** (street food, rain: covered), 2026-10-24T15:00 to 18:00, longest trip 13 min. Bistro 7 Express: a food spot, with the longest trip about 16 minutes. | 1. **Burger King** (street food, 10-24T16:00): Burger King is a food spot open on Saturday 24 October from 4 pm to 7 pm. _[gemma]_<br>2. **KFC** (street food, 10-24T16:00): KFC is a food spot open on Saturday 24 October from 4 pm to 7 pm. _[gemma]_<br>3. **Schwarma Co** (street food, 10-24T16:00): Schwarma Co is a food spot, and nobody's trip is over about 13 minutes. _[code]_ | withinHours (06:00 to 11:00): ritual "Bistro 7 Express" is 15:00 to 18:00, the crew said 06:00 to 11:00; idea "Burger King" is 16:00 to 19:00, the crew said 06:00 to 11:00; idea "KFC" is 16:00 to 19:00, the crew said 06:00 to 11:00; idea "Schwarma Co" is 16:00 to 19:00, the crew said 06:00 to 11:00 |
| lag-art-ikoyi | Art lovers in our 30s and 40s, galleries and exhibitions every other Saturday around Ikoyi and VI, money is not an issue | budget any; kinds: gallery, museum, arts centre; needs: quiet; areas: Ikoyi, Victoria Island; zone Africa/Lagos | **Didi Museum** (museum, rain: covered), 2026-10-24T15:00 to 18:00, longest trip 10 min. Didi Museum: a museum, quiet enough to hear each other, with the longest trip about 8 minutes. | 1. **African Artists' Foundation** (arts centre, 10-24T16:00): African Artists' Foundation is an art space on Saturday 24 October from 4 pm to 7 pm. _[gemma]_<br>2. **TCA Gallery** (gallery, 10-24T16:00): TCA Gallery is an art gallery open on Saturday 24 October from 4 pm to 7 pm. _[gemma]_<br>3. **National Museum** (museum, 10-24T16:00): National Museum is a museum that is low-key and available on Saturday 24 October from 4 pm to 7 pm. _[gemma]_ | none |
| lag-tech-yaba | Techies from Yaba, devs and product people in our 20s, we like meetups and hackathons, every other Saturday around Yaba and Ikeja | budget any; no kinds; needs: inclusive; areas: Yaba, Ikeja; zone Africa/Lagos | **bbc** (park, rain: skip, skipped), 2026-10-24T15:00 to 18:00, longest trip 29 min.  | none | none |
| lag-chess-ikeja | Chess club, 6 guys of mixed ages, every Saturday afternoon around Ikeja GRA, cheap or free | budget free; kinds: nightclub, bar, cafe, restaurant; needs: quiet; areas: Ikeja GRA; zone Africa/Lagos | **Dreamfield Juice & Salad Bar** (cafe, rain: covered), 2026-10-24T13:00 to 16:00, longest trip 12 min. Dreamfield Juice & Salad Bar is a café, quiet enough to hear each other, about 22 minutes for whoever is furthest. | 1. **7 Points Bar and Grill** (bar, 10-24T16:00): 7 Points Bar and Grill is a bar with a trip of 11 minutes. _[gemma]_<br>2. **Mama Cass** (restaurant, 10-24T16:00): Mama Cass is a restaurant for a 13 minute trip. _[gemma]_<br>3. **Food House** (restaurant, 10-24T16:00): Food House is a restaurant that is 15 minutes away. _[gemma]_ | areasOnMap: Ikeja GRA: pinned 4.6 km off (6.618, 3.365) |
| lag-sober-lekki | Sober crew, 30s, all of us in recovery, no bars or drinks at all, every other Saturday around Lekki and Ajah | budget any; kinds: garden, library, bookshop, cafe, gallery, museum; needs: safe, discreet, no alcohol, quiet; areas: Lekki, Ajah; zone Africa/Lagos | **Nike Art Gallery** (gallery, rain: covered), 2026-10-24T15:00 to 18:00, longest trip 46 min. Nike Art Gallery: an art gallery, quiet enough to hear each other, with the longest trip about 37 minutes. | 1. **Lagos Tea House** (cafe, 10-24T16:00): Lagos Tea House is a café for a quiet afternoon on Saturday 24 October from 4 pm to 7 pm. _[gemma]_<br>2. **Nike Art Gallery** (gallery, 10-24T16:00): Nike Art Gallery is an art gallery for a Saturday 24 October from 4 pm to 7 pm. _[gemma]_<br>3. **A night in at one of yours** (home, 10-24T15:00): A night in at one of yours is a low-key option for Saturday 24 October from 3 pm to 6 pm. _[gemma]_ | none |
| lag-wheelchair-ikeja | One of us uses a wheelchair, so step-free places only, 5 friends in our 30s, every other Saturday around Ikeja and Maryland | budget free; kinds: park, garden, cafe, bookshop, museum, library; needs: step-free; areas: Ikeja, Maryland; zone Africa/Lagos | **Choco-Latte** (cafe, rain: covered), 2026-10-24T15:00 to 18:00, longest trip 11 min. Choco-Latte: a café, with the longest trip about 19 minutes. | 1. **Dreamfield Juice & Salad Bar** (cafe, 10-24T16:00): Dreamfield Juice & Salad Bar is a café that is only 13 minutes away. _[gemma]_<br>2. **Oasis Bookshop** (bookshop, 10-24T16:00): Oasis Bookshop is a bookshop and is open on Saturday 24 October from 4 pm to 7 pm. _[gemma]_<br>3. **Aircraft** (museum, 10-24T16:00): Aircraft is a museum, and nobody's trip is over about 18 minutes. _[code]_ | none |
| lag-nightshift-vi-pidgin | Na night work we dey do for VI, security and nurses, we only free Saturday afternoon from 1 to 5, 6 of us, around VI and Obalende | budget free; kinds: restaurant, cafe, live music, cinema, street food; needs: safe, daytime; areas: Victoria Island, Obalende; zone Africa/Lagos | **Bogobiri House Hotel and Restaurant** (restaurant, rain: covered), 2026-10-24T13:00 to 16:00, longest trip 10 min. Bogobiri House Hotel and Restaurant: a restaurant, with the longest trip about 10 minutes. | 1. **A night in at one of yours** (home, 10-24T13:00): A night in at one of yours is a low-key way to spend Saturday 24 October from 1 pm to 4 pm. _[gemma]_<br>2. **Marcelino's Pastry Shop** (restaurant, 10-24T16:00): Marcelino's Pastry Shop is a restaurant for a quick 8 minute trip. _[gemma]_<br>3. **Churrasco** (restaurant, 10-24T16:00): why Churrasco is a restaurant for Saturday why 24 October at 4 pm to 5 pm. _[gemma]_ | none |
| lag-gay-men-ikoyi | Gay guys, 4 of us, early 30s, we need somewhere discreet where nobody stares, every other Saturday around Ikoyi and Surulere | budget any; kinds: bar, pub, nightclub, live music, garden, gallery; needs: safe, discreet, inclusive; areas: Ikoyi, Surulere; zone Africa/Lagos | **TCA Gallery** (gallery, rain: covered), 2026-10-24T15:00 to 18:00, longest trip 60 min. TCA Gallery: an art gallery, quiet enough to hear each other, with the longest trip about 54 minutes. | 1. **A night in at one of yours** (home, 10-24T15:00): A night in at one of yours is a low-key way to spend Saturday 24 October from 3 pm to 6 pm. _[gemma]_<br>2. **Balo's Place** (bar, 10-24T16:00): Balo's Place is a bar that is only 12 minutes from Ikoyi. _[gemma]_<br>3. **Bar** (bar, 10-24T16:00): Bar is a bar available on Saturday 24 October from 4 pm to 7 pm. _[gemma]_ | none |
| lag-pikin-ikorodu | Mama and papa dem with small pikin, 6 families for Ikorodu, every other Saturday, somewhere wey pikin fit play, no too cost | budget cheap; kinds: playground, park, zoo, ice cream, cinema, mall; needs: kid-friendly, daytime; areas: Ikorodu; zone Africa/Lagos | **Ita Elewa playground** (playground, rain: skip, skipped), 2026-10-24T15:00 to 18:00, longest trip 5 min.  | none | none |
| lag-retirees-festac-pidgin | Old school friends, we don retire, 65 plus, we dey Festac and Surulere, every other Saturday afternoon, nothing wey get noise | budget any; kinds: park, garden, museum, library, theatre, bookshop; needs: quiet, daytime; areas: Festac, Surulere; zone Africa/Lagos | **National Arts Theatre** (theatre, rain: covered), 2026-10-24T13:00 to 16:00, longest trip 44 min. National Arts Theatre is a theatre, about 49 minutes for whoever is furthest. | 1. **National Arts Theatre** (theatre, 10-24T16:00): National Arts Theatre is a theatre, and nobody's trip is over about 44 minutes. _[code]_ | none |
| lag-bankers-vi | Banking colleagues, 30s, every other Saturday after a long week, around VI and Ikoyi, nice places, money is fine | budget any; kinds: restaurant, bar, pub; areas: Victoria Island, Ikoyi; zone Africa/Lagos | **Milano Restaurant** (restaurant, rain: covered), 2026-10-24T15:00 to 18:00, longest trip 9 min. Milano Restaurant is a restaurant, about 8 minutes for whoever is furthest. | 1. **Pizza Hut** (restaurant, 10-24T16:00): Pizza Hut is a restaurant for Saturday 24 October from 4 pm to 7 pm. _[gemma]_<br>2. **Bogobiri House Hotel and Restaurant** (restaurant, 10-24T16:00): Bogobiri House Hotel and Restaurant is a restaurant for Saturday 24 October from 4 pm to 7 pm. _[gemma]_<br>3. **Marco Polo Express** (restaurant, 10-24T16:00): Marco Polo Express is a longest-trip 7 minute restaurant. _[gemma]_ | none |
| lag-diaspora-from-london | I'm in London but I'm planning for my cousins in Lagos, 6 of them, around Surulere and Yaba, every other Saturday | budget any; no kinds; areas: Surulere, Yaba; zone Africa/Lagos | **Garden Top Hotel, Festac, Nigeria** (park, rain: skip, skipped), 2026-10-24T15:00 to 18:00, longest trip 25 min.  | none | areasOnMap: Yaba: not on the map |
| lag-gameboys-yaba-pidgin | Na we be the game boys for Yaba, PS5 and board games, 6 of us, we no get plenty money, every Saturday | budget cheap; kinds: arcade; needs: quiet; areas: Yaba; zone Africa/Lagos | **Nike Art Gallery** (gallery, rain: covered), 2026-10-24T15:00 to 18:00, longest trip 79 min. Nike Art Gallery is about 80 minutes for whoever is furthest, and the crew has not been there lately. | 1. **Nike Art Gallery** (gallery, 10-24T16:00): Nike Art Gallery is within about 79 minutes for everyone, and it has a roof. _[code]_ | none |
| lag-concert-babes-lekki | Uni babes who love Afrobeats concerts, early 20s, 6 of us, every other Saturday around Lekki and Ajah, cheap abeg | budget cheap; kinds: live music, cafe, restaurant; needs: women-friendly, inclusive; areas: Lekki, Ajah; zone Africa/Lagos | **Molabat kitchen** (restaurant, rain: covered), 2026-10-24T15:00 to 18:00, longest trip 28 min. Molabat kitchen is a restaurant, and nobody travels more than about 29 minutes. | 1. **Spice Bowl** (restaurant, 10-24T16:00): Spice Bowl is a restaurant for Saturday 24 October from 4 pm to 7 pm. _[gemma]_<br>2. **Lokito Restaurant** (restaurant, 10-24T16:00): Lokito Restaurant is a restaurant for Saturday 24 October from 4 pm to 7 pm. _[gemma]_<br>3. **The Harvest Lagos** (restaurant, 10-24T16:00): The Harvest Lagos is a restaurant, and nobody's trip is over about 44 minutes. _[code]_ | none |
| lag-draughts-surulere-pidgin | Chess and draughts guys for Surulere, 40s, we dey play every Saturday afternoon, quiet place abeg | budget any; kinds: garden, library, bookshop, cafe; needs: quiet; areas: Surulere; zone Africa/Lagos | **Cafe Neo** (cafe, rain: covered), 2026-10-24T13:00 to 16:00, longest trip 15 min. Cafe Neo is a café, quiet enough to hear each other, about 17 minutes for whoever is furthest. | 1. **Central Library** (library, 10-24T16:00): Central Library is a library for a quiet afternoon on Saturday 24 October from 4 pm to 5 pm. _[gemma]_<br>2. **Cafe Neo** (cafe, 10-24T16:00): Cafe Neo is a café that is only 15 minutes away. _[gemma]_ | none |
| abj-tech-wuse | Tech bros in Abuja, 20s and 30s, meetups and co-working, every other Saturday around Wuse 2 and Jabi | budget any; kinds: garden, library, bookshop, cafe; needs: step-free, quiet; areas: Wuse 2, Jabi; zone Africa/Lagos | **Berger Park Wuse** (park), 2026-10-24T16:00 to 19:00, longest trip 12 min. Berger Park Wuse is green and low-key, and nobody is more than about 6 minutes away. | 1. **Salamander** (cafe, 10-24T16:00): Salamander is a quiet café on Saturday 24 October from 4 pm to 7 pm. _[gemma]_<br>2. **The Cube Café** (cafe, 10-24T16:00): The Cube Café is a quiet café available on Saturday 24 October from 4 pm to 7 pm. _[gemma]_<br>3. **CSS Bookshop** (bookshop, 10-24T16:00): CSS Bookshop is a quiet bookshop open on Saturday 24 October from 4 pm to 7 pm. _[gemma]_ | none |
| acc-nightout-osu | Accra crew, Afrobeats and highlife, 20s, nights out in Osu and Labone every other Saturday | budget any; kinds: nightclub, bar, live music, cafe, restaurant; areas: Osu, Labone; zone Africa/Accra | **African Union Park** (park, rain: skip, skipped), 2026-10-24T15:00 to 18:00, longest trip 10 min.  | none | none |
| acc-church-women-madina | Church women's group from Madina and Adenta, 40s and 50s, every other Saturday afternoon, no alcohol | budget any; kinds: garden, cafe, restaurant, community centre; needs: women-friendly, no alcohol, quiet, daytime; areas: Madina, Adenta; zone Africa/Accra | **Adenta Community Park** (park, rain: skip, skipped), 2026-10-24T13:00 to 16:00, longest trip 9 min.  | none | none |
| nbo-runclub | Nairobi run club, Saturday 7am runs, 20 of us, around Westlands and Kilimani | budget any; kinds: nightclub, bar, cafe, restaurant; needs: daytime; areas: Westlands, Kilimani; zone Africa/Nairobi | none (no_window) | none | none |
| nbo-gamers-southb | Gamers from South B and South C, FIFA nights and arcades, early 20s, broke kabisa, every Saturday | budget cheap; kinds: arcade; areas: South B, South C; zone Africa/Nairobi | **Uhuru Park** (place), 2026-10-24T15:00 to 18:00, longest trip 12 min. Uhuru Park fits our taste as a green park, and it is about 8 minutes for the furthest person. | 1. **August 7th Memorial Park, Kenya** (place, 10-24T15:00): August 7th Memorial Park is a nice outdoor space for a 10 minute trip. _[gemma]_<br>2. **Central Park** (place, 10-24T15:00): Central Park offers a lively outdoor setting from 3 pm to 6 pm on Saturday 24 October. _[gemma]_<br>3. **Jeevanjee Gardens** (place, 10-24T15:00): Everyone gets to Jeevanjee Gardens in about 14 minutes or less, it is outdoors and the forecast is dry. _[code]_ | none |
| ldn-sober-hackney | Sober curious friends in Hackney and Stratford, 30s, no pubs please, every other Saturday | budget any; kinds: cafe, museum, gallery, bookshop, market, cinema; needs: no alcohol; areas: Hackney, Stratford; zone Europe/London | **Hiland** (cafe, rain: next_day), 2026-10-25T15:00 to 17:00, longest trip 9 min. Hiland is a café, and nobody travels more than about 8 minutes. | 1. **Mighty Bite** (cafe, 10-24T16:00): Mighty Bite is a café for Saturday 24 October from 4 pm to 7 pm. _[gemma]_<br>2. **Tredegar Square** (park, 10-25T16:00): Tredegar Square is a park for Sunday 25 October from 4 pm to 7 pm in dry weather. _[gemma]_<br>3. **Grove Hall Park** (place, 10-25T16:00): Grove Hall Park is a park for Sunday 25 October from 7 pm to 7 pm in dry weather. _[gemma]_ | none |
| ldn-retired-croydon | Retired teachers in Croydon, 70s, a gentle walk and a cuppa every other Saturday, step-free if possible | budget free; kinds: park, cafe, restaurant; needs: step-free, quiet, daytime; areas: Croydon; zone Europe/London | **Cotelands** (place, rain: next_day), 2026-10-25T15:00 to 17:00, longest trip 5 min. Cotelands is a park, quiet enough to hear each other, and nobody travels more than about 5 minutes. | 1. **Duppas Hill** (place, 10-25T16:00): Duppas Hill is a park for a quiet walk on Sunday 25 October from 4 pm to 7 pm. _[gemma]_<br>2. **Duppas Hill Recreation Ground** (park, 10-25T16:00): Duppas Hill Recreation Ground is a park for a chill walk on Sunday 25 October from 4 pm to 7 pm. _[gemma]_<br>3. **Park Hill Recreation Ground** (park, 10-25T16:00): why Park Hill Recreation Ground is a park for a chill walk on Sunday string 25 October from 4 pm to 7 pm. _[gemma]_ | none |
| ber-hijabi-wedding | Hijabi sisters in Berlin, Wedding and Moabit, 20s, women only, no alcohol, every other Saturday afternoon | budget any; kinds: cafe, garden, bookshop, museum, gallery; needs: women-friendly, inclusive, no alcohol, daytime; areas: Wedding, Moabit; zone Europe/Berlin | **Fedora** (cafe, rain: covered), 2026-10-24T13:00 to 16:00, longest trip 7 min. Fedora: a garden café, with the longest trip about 5 minutes. | 1. **Göttlich essen & trinken** (cafe, 10-24T16:00): Göttlich essen & trinken is a garden café for Saturday 24 October from 4 pm to 5 pm. _[gemma]_<br>2. **Anti-Kriegs-Museum** (museum, 10-24T16:00): The Anti-Kriegs-Museum is a museum for Saturday 24 October from 4 pm to 5 pm. _[gemma]_<br>3. **Coffee Star** (cafe, 10-24T16:00): Coffee Star is a café, and nobody's trip is over about 7 minutes. _[code]_ | none |
| blr-football-indiranagar | Football watch party crew in Indiranagar and Whitefield, Premier League Saturdays, 10 of us, late 20s | budget any; kinds: nightclub, bar, sports, cafe, restaurant; areas: Indiranagar, Whitefield; zone Asia/Kolkata | **Costa** (cafe, rain: covered), 2026-10-24T15:00 to 18:00, longest trip 24 min. Costa: a café, with the longest trip about 11 minutes. | 1. **Sarovar Portico** (bar, 10-24T16:00): Sarovar Portico is a bar for a lively weekend afternoon from 4 pm to 7 pm on Saturday 24 October. _[gemma]_<br>2. **ArmaDQ** (restaurant, 10-24T16:00): ArmaDQ is a restaurant for the weekend on Saturday 24 October between 4 pm to 7 pm. _[gemma]_<br>3. **Kabab Magic** (restaurant, 10-24T16:00): Kabab Magic is a restaurant, and nobody's trip is over about 20 minutes. _[code]_ | none |
| blr-teens-jayanagar | Parents taking our teens, 13 to 15, out every other Saturday around Jayanagar and Malleshwaram, nothing late and no parties | budget any; kinds: park, playground, zoo, cinema, mall, cafe; needs: kid-friendly, daytime; areas: Jayanagar, Malleshwaram; zone Asia/Kolkata | **Coffee Day** (cafe, rain: covered), 2026-10-24T15:00 to 18:00, longest trip 17 min. Coffee Day is a café, and nobody travels more than about 7 minutes. | 1. **Cafe Coffee Day** (cafe, 10-24T16:00): Cafe Coffee Day is a garden café available on Saturday 24 October from 4 pm to 7 pm. _[gemma]_<br>2. **Cane Crush** (cafe, 10-24T16:00): Cane Crush is a café available on Saturday 24 October from 4 pm to 7 pm. _[gemma]_<br>3. **Old Madras Baking Company** (cafe, 10-24T16:00): Old Madras Baking Company is a café available on Saturday 24 October from 4 pm to 7 pm. _[gemma]_ | none |
| sp-foodies-pinheiros | Galera foodie de Pinheiros e Vila Madalena, 30s, every other Saturday, feiras e comida de rua | budget any; kinds: street food, restaurant; areas: Pinheiros, Vila Madalena; zone America/Sao_Paulo | **El Kabong Grill** (restaurant, rain: covered), 2026-10-24T15:00 to 18:00, longest trip 5 min. El Kabong Grill is a restaurant, about 5 minutes for whoever is furthest. | 1. **Nello's** (restaurant, 10-24T16:00): Nello's is a restaurant, and nobody's trip is over about 5 minutes. _[code]_<br>2. **Terra Roxa** (restaurant, 10-24T16:00): Terra Roxa is a restaurant, and nobody's trip is over about 5 minutes. _[code]_<br>3. **Velmont Grill** (restaurant, 10-24T16:00): Velmont Grill is a restaurant, and nobody's trip is over about 5 minutes. _[code]_ | none |
| sp-usp-broke | Broke USP students around Butantã and Pinheiros, every Saturday, free stuff only | budget free; no kinds; needs: daytime; areas: Butantã, Pinheiros; zone America/Sao_Paulo | **Praça Vicente Rodrigues** (park, rain: skip, skipped), 2026-10-24T16:00 to 19:00, longest trip 8 min.  | none | none |

## Invites

- **lag-alte-yaba:** Catching up this Saturday at Cafe Neo from 3 pm to 6 pm. Show up if you can, skip it if you can't. No RSVP.
- **lag-choir-ikeja:** Let's hang out this Saturday at Sweet Sensation from 1 pm to 4 pm. Pull up when you can, nobody is taking attendance.
- **lag-foodie-girls-lekki:** Catching up this Saturday at Saraya Deli from 3 pm to 6 pm. Come when you can and leave when you like. No need to answer this.
- **lag-runclub-lekki:** Catching up this Saturday at Bistro 7 Express from 3 pm to 6 pm. Come through if you're free. No need to reply.
- **lag-art-ikoyi:** Catch us at Didi Museum this Saturday from 3 pm to 6 pm. Show up if you can, skip it if you can't. No RSVP.
- **lag-tech-yaba:** Rain all afternoon on Saturday (up to 79% between 11 am and 6:30 pm), and Sunday looks no better. The sloth is skipping this one. If it clears up, anyone can still add a plan.
- **lag-chess-ikeja:** Catch us at Dreamfield Juice & Salad Bar this Saturday from 1 pm to 4 pm. Come when you can and leave when you like. No need to answer this.
- **lag-sober-lekki:** Catch us at Nike Art Gallery this Saturday from 3 pm to 6 pm. Come through if you're free. No need to reply.
- **lag-wheelchair-ikeja:** Catch the vibe this Saturday at Choco-Latte from 3 pm to 6 pm. Pull up when you can, nobody is taking attendance.
- **lag-nightshift-vi-pidgin:** Catch us at Bogobiri House Hotel and Restaurant this Saturday from 1 pm to 4 pm. Drop in any time in that window, no reply needed.
- **lag-gay-men-ikoyi:** Catch us at TCA Gallery this Saturday from 3 pm to 6 pm. Show up if you can, skip it if you can't. No RSVP.
- **lag-pikin-ikorodu:** No dry two hours this afternoon on Saturday (up to 78% between 11 am and 6:30 pm), and Sunday looks no better. The sloth is skipping this one. If it clears up, anyone can still add a plan.
- **lag-retirees-festac-pidgin:** Catch us at National Arts Theatre this Saturday from 1 pm to 4 pm. Come when you can and leave when you like. No need to answer this.
- **lag-bankers-vi:** Catching up this Saturday at Milano Restaurant from 3 pm to 6 pm. Drop in any time in that window, no reply needed.
- **lag-diaspora-from-london:** Rain all afternoon on Saturday (up to 96% between 11 am and 6:30 pm), and Sunday looks no better. The sloth is skipping this one. If it clears up, anyone can still add a plan.
- **lag-gameboys-yaba-pidgin:** Catch us at Nike Art Gallery this Saturday from 3 pm to 6 pm. Come through if you're free. No need to reply.
- **lag-concert-babes-lekki:** Catch us at Molabat kitchen this Saturday from 3 pm to 6 pm. Drop in any time in that window, no reply needed.
- **lag-draughts-surulere-pidgin:** Catching up this Saturday at Cafe Neo from 1 pm to 4 pm. Show up if you can, skip it if you can't. No RSVP.
- **abj-tech-wuse:** Catch us at Berger Park Wuse this Saturday from 4 pm to 7 pm. Come when you can and leave when you like. No need to answer this.
- **acc-nightout-osu:** No dry two hours this afternoon on Saturday (up to 100% between 11 am and 6 pm), and Sunday looks no better. The sloth is skipping this one. If it clears up, anyone can still add a plan.
- **acc-church-women-madina:** No dry two hours this afternoon on Saturday (up to 100% between 11 am and 6 pm), and Sunday looks no better. The sloth is skipping this one. If it clears up, anyone can still add a plan.
- **nbo-runclub:** none
- **nbo-gamers-southb:** Catch us at Uhuru Park this Saturday from 3 pm to 6 pm. It should be a nice day out. Come when you can and leave when you like. No need to answer this.
- **ldn-sober-hackney:** Sunday at Hiland from 3 pm to 5 pm. Come when you can and leave when you like. No need to answer this.
- **ldn-retired-croydon:** Join us for a gentle walk and a cuppa at Cotelands this Sunday from 3 pm to 5 pm. Show up if you can, skip it if you can't. No RSVP.
- **ber-hijabi-wedding:** Saturday at Fedora from 1 pm to 4 pm. Pull up when you can, nobody is taking attendance.
- **blr-football-indiranagar:** Hey everyone, we are hanging out at Costa this Saturday from 3 pm to 6 pm. Show up if you can, skip it if you can't. No RSVP.
- **blr-teens-jayanagar:** Catch up this Saturday at Coffee Day from 3 pm to 6 pm. Since rain is likely, we'll be under a roof. Pull up when you can, nobody is taking attendance.
- **sp-foodies-pinheiros:** Saturday at El Kabong Grill from 3 pm to 6 pm. Since rain is likely, we'll be under a roof. Come through if you're free. No need to reply.
- **sp-usp-broke:** Rain all afternoon on Saturday (up to 82% between 11 am and 7 pm), and Sunday looks no better. The sloth is skipping this one. If it clears up, anyone can still add a plan.

## How each measure works

- **Hard constraints** (eval/metrics.mjs, `hardChecks`): every crew has areasOnMap (each area it names is read and pinned within its tolerance of the real neighbourhood), cityCorrect (the crew's centre, areas and every suggestion are in its city; no Lagos guide events elsewhere) and timezoneCorrect. Then its own: noAlcohol (no bar, pub or club by OpenStreetMap kind; no event, reason or invite about drink), noNightlife (no nightlife kind, no party night, nothing from 9 pm), kidFriendly (both, and nothing from 8 pm), maxPrice (no stated price or entry fee over the ceiling; free only means none), budgetRead, stepFree (nothing tagged wheelchair=no, no beach), needsInclude (the stored needs), withinHours (the times the crew said), maxTripMin, discreetNoLabel (see Safety). A crew fails if any one check fails.
- **Taste alignment** is a deterministic proxy: a suggestion fits when its OpenStreetMap kind is one the crew's interests point to, or an event's title or venue has one of their keywords (eval/personas/v2.json, `taste`), or it is the night in offered to a crew that needs discretion. Chance level judges the same suggestions against every other crew's interests.
- **Distinctness** is the Jaccard overlap of two crews' suggestion names (the ritual and the ideas).
- **Travel** uses the city pack's own travel estimate from each named area, at the plan's time.
- **Copy** checks every ritual reason, invite and idea reason: stock AI phrases (a fixed list), dashes, the Flesch-Kincaid grade, length, and templates that repeat once names, numbers and days are taken out.
- **Intervals** are 95% Wilson score intervals.

<!-- analysis -->

## Baseline against this release (read by hand, after the run)

This is the one pinned run of the held-out set against the release revision d1770d0 (src identical to e67d813), from a clean worktree, on the same frozen world as the baseline. 0 world misses and 0 Gemma misses. The world was extended for this revision before the run: 38 entries (Overpass 19, OSRM 19, 3 of them kept failures) and 52 Gemma calls. Live Gemma calls across both sets so far: 390 of 520. The baseline is a working-tree snapshot whose src is identical to 5d84a9b (see the provenance note in `v2-test.md`); this run is pinned and clean. Both columns are the same 30 held-out crews. Made with `node eval/compare.mjs eval/results/v2-test.json eval/results/v2-test-release-d1770d0.json`.

| Measure | Baseline (working-tree snapshot, src = 5d84a9b) | Release d1770d0 (pinned, clean) |
|---|---|---|
| **Crews with any hard-constraint violation** | 3 of 30 (10%, 95% CI 3% to 26%) | **3 of 30 (10%, 95% CI 3% to 26%)** |
| Sensitive crews with an identity word or need where it should not be | 0 of 2 (0%, 95% CI 0% to 66%) | 0 of 2 (0%, 95% CI 0% to 66%) |
| Crews failing an app-wide safety claim | 0 of 30 (0%, 95% CI 0% to 11%) | 0 of 30 (0%, 95% CI 0% to 11%) |
| Suggestions that fit the crew's interests | 66 of 106 (62%, 95% CI 53% to 71%) | 56 of 87 (64%, 95% CI 54% to 74%) |
| Ritual picks that fit | 14 of 27 (52%, 95% CI 34% to 69%) | 14 of 23 (61%, 95% CI 41% to 78%) |
| Crews with at least one fitting suggestion | 21 of 30 (70%, 95% CI 52% to 83%) | 18 of 30 (60%, 95% CI 42% to 75%) |
| Mean overlap between two crews' suggestions (all pairs; same city) | 0.6%; 1.3% | 0.4%; 1.1% |
| Near-duplicate pairs | 0 of 432 | 0 of 414 |
| Ritual made (not skipped) | 27 of 30 (90%, 95% CI 74% to 97%) | 23 of 30 (77%, 95% CI 59% to 88%) |
| Crews given 3 ideas | 25 of 30 (83%, 95% CI 66% to 93%) | 20 of 30 (67%, 95% CI 49% to 81%) |
| Ritual longest trip: median, max (min) | 13, 79 | 12, 79 |
| Ideas longest trip: median, max (min) | 12, 50 | 14, 79 |
| Copy: stock phrases; dashes; reading grade (median) | 0; 0; 8.1 | 1; 0; 7.2 |
| Copy: texts in a template shared by 3 or more crews | 17 of 135 (13%, 95% CI 8% to 19%) | 24 of 116 (21%, 95% CI 14% to 29%) |
| Idea reasons written by code | 16 of 79 (20%, 95% CI 13% to 30%) | 12 of 64 (19%, 95% CI 11% to 30%) |

| Check | Baseline (working-tree snapshot, src = 5d84a9b) (violations of crews) | Release d1770d0 (pinned, clean) |
|---|---|---|
| areasOnMap | 2 of 30 | 2 of 30 |
| budgetRead | 0 of 4 | 0 of 4 |
| cityCorrect | 0 of 30 | 0 of 30 |
| discreetNoLabel | 0 of 2 | 0 of 2 |
| kidFriendly | 0 of 2 | 0 of 2 |
| maxPrice | 0 of 6 | 0 of 6 |
| needsInclude | 0 of 10 | 0 of 10 |
| noAlcohol | 0 of 6 | 0 of 6 |
| noNightlife | 0 of 4 | 0 of 4 |
| stepFree | 0 of 1 | 0 of 1 |
| timezoneCorrect | 0 of 30 | 0 of 30 |
| withinHours | 1 of 3 | 1 of 3 |


**What changed, and why.** The hard constraints, safety and the zones are the same as the baseline: the same 3 crews break a constraint, for the same reasons (below), and both sensitive crews are clean. What moved is how much a crew gets on a wet Saturday. The release makes a ritual for 23 crews where the baseline made 27, and gives 3 ideas to 20 where the baseline gave 25. Six crews lost their covered pick and now get a rain skip and few or no ideas:

- **The per-item taste grounding emptied two crews' kinds of place.** "Techies ... meetups and hackathons" (lag-tech-yaba) and "Broke USP students ... free stuff only" (sp-usp-broke) kept no place kinds at all. The baseline read community centre, café and library for the first, and park, street food, cinema, library and market for the second. With no indoor kinds and rain all afternoon, nothing was left. *Fix to consider:* when grounding leaves a crew with no place kinds, fall back to the kinds its needs and group words imply (the NEED_KINDS path), as the code already does when Gemma names none.
- **Two Accra crews hit Overpass failures in the recording.** Their new taste queries (one with fewer kinds after "pub" was dropped, one without "library" and "park") timed out on every mirror when they were recorded on 23 Oct, and are kept as failures. That is the world on that day, not a change in the app's logic. A crew this new has no last good answer to fall back on.
- **Families in Ikorodu (lag-pikin-ikorodu)** lost "community centre" (no longer grounded in the sentence). They have no covered place within reach that fits their hours, budget and needs.
- **The retired friends in Festac** now read as wanting gardens, museums, libraries and theatres, which fits them better. They got the National Arts Theatre as their covered ritual, but only one idea.

Ritual picks that fit the crew's interests rose from 52% to 61%, and all suggestions from 62% to 64%. Both intervals overlap heavily, and the denominators are smaller in the release (fewer suggestions), so this is not a measured improvement. Copy: the one "stock phrase" is a false positive of the eval's own check ("oasis" is the name of Oasis Bookshop; the check does not take names out, and is left as frozen). The code's own reason templates repeat more (21% of texts against 13%), because more reasons are code-written on the wet day.

**Not fixed, and not claimed.** This test set found two app bugs in the baseline. On purpose, neither was fixed before this run, and this run makes no claim about them:

1. **The diaspora area lookup** (lag-diaspora-from-london): planned from a browser in Europe/London, "Yaba" is still not found, so the crew has only Surulere. To fix later, and to check on new dev cases (not this test set).
2. **"Saturday mornings around 7am" does not become a rhythm** (lag-runclub-lekki): the crew still gets the default afternoon, here 3 pm to 6 pm and fast food. To fix later and check on new dev cases.

**A likely tolerance artefact.** lag-chess-ikeja: Ikeja GRA is pinned 4.6 km from the reference point, against the frozen 4 km tolerance. The pin is plausibly inside the GRA. The tolerance stays as frozen, so it counts as a failure in both runs.

**Human scores.** The blind sheet for this run is `eval/results/v2-human-sheet-release-d1770d0.md` (20 crews; on a phone: `node eval/score.mjs --sheet release-d1770d0`). The baseline's is `eval/results/v2-human-sheet.md` (`node eval/score.mjs`).
