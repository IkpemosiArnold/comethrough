# Persona eval: does describing the crew change what the sloth suggests?

Run 2026-10-22 with gemini:gemma-4-26b-a4b-it. This last run made 20 live Gemma calls and took 4 from the eval's cache. Across every run of this eval (the code changed between them, see below) Gemma was called about 71 times in all, under the budget of 80. Map data, routes, weather and the guides' RSS came through the app's own adapters with their pacing, cached on disk (`PERSONA_EVAL_DIR`, default `.data/persona-eval`), so a rerun asks nobody again. Reproduce with `node scripts/persona-eval.mjs`. The Gemma cache is keyed by a SHA-256 of each request and keeps crew readings only after every sensitive word is scrubbed.

Every crew: same rhythm (every other Saturday), same areas (Yaba and Lekki Phase 1; Berlin: Kreuzberg and Friedrichshain), the same day of asking, the organiser in the first area. Each went through crew setup (Gemma reads only the sentence below), the sloth's first ritual pick (Saturday) and the weekend's 3 ideas. "Before" is the same crew's ritual pick with its taste ignored (code only), to show what the taste changed.

## What the sloth understood

| Crew | Sentence | Stored taste (summary; chips) | Place kinds | Budget | Taste places found on the map |
|---|---|---|---|---|---|
| Alte men, late 20s | The guys, alte, mostly male, mid to late 20s, every other Saturday, around Yaba and Lekki | Got it: alte, art and fashion, mid to late 20s, around Yaba and Lekki. alte, art, fashion, indie, live music, thrift, gallery, arts centre, cafe, bookshop, thrift, live music, Feels safe, Low-key places, mid to late 20s, chill | gallery, arts centre, cafe, bookshop, thrift, live music | any | none asked, or Overpass did not answer |
| Queer women's crew | Our girls, queer and mostly female, late 20s, every other Saturday, around Yaba and Lekki | Got it: art and girls' night out, late 20s, around Yaba and Lekki. art, girls' night out, cafe, cinema, live music, gallery, Feels safe, Low-key places, Women-friendly, Welcoming, late 20s, chill | gallery | any | 2 |
| Church youth group | Church youth group, every other Saturday, around Yaba and Lekki | Got it: games and cinema, around Yaba and Lekki. games, cinema, bowling, gospel music, park, sports, park, cinema, bowling, community centre, sports, arcade, mall, No alcohol, Kid-friendly, Daytime, chill | park, cinema, bowling, community centre, sports, arcade | any | 15 |
| Broke university students | Broke university students, every other Saturday, around Yaba and Lekki | Got it: free events and street food, university students, around Yaba and Lekki. free events, street food, cinema, parks, music, street food, cinema, park, garden, community centre, Daytime, university students, chill | street food, cinema, park, garden, community centre | cheap | none asked, or Overpass did not answer |
| Parents with young kids | Parents with young kids, every other Saturday, around Yaba and Lekki | Got it: playgrounds and park, around Yaba and Lekki. playgrounds, park, ice cream, zoo, family-friendly activities, playground, park, zoo, ice cream, cinema, mall, Kid-friendly, Daytime, chill | playground, park, zoo, ice cream, cinema, mall | any | 14 |
| Corporate, 30s | Work friends, corporate, early 30s, every other Saturday, around Yaba and Lekki | Got it: restaurants and cafes, early 30s, around Yaba and Lekki. restaurants, cafes, live music, dining, professional networking, socializing, restaurant, cafe, live music, Quiet, early 30s, chill | restaurant, cafe, live music | any | none asked, or Overpass did not answer |
| Berlin control (no taste said) | The Kreuzberg lot, every other Saturday, around Kreuzberg and Friedrichshain | Got it: around Kreuzberg and Friedrichshain.  | none | any | none asked, or Overpass did not answer |

## Side by side: the ritual and the 3 ideas

| Crew | Ritual pick (before, with no taste) | Why (as the crew sees it) | Idea 1 | Idea 2 | Idea 3 | Fit 1 to 5 (Arnold) |
|---|---|---|---|---|---|---|
| Alte men, late 20s | **Nike Art Gallery** (place, rain plan: covered); before: Nike Art Gallery, rain plan: covered | Nike Art Gallery: fair and fresh, and about 80 minutes for whoever is furthest. | **A night in at one of yours** (home): A night in at one of yours is a low-key way to chill at 6 pm to 9 pm. _[gemma]_ | **Nike Art Gallery** (place): Nike Art Gallery is an art space open on Saturday 24 October from 4 pm to 7 pm. _[gemma]_ | **Lagos Trivia Night** (event, Solo ₦15,000 \| Squad of 4 ₦60,000 \| Team of 8 ₦112,000, Awe Lagos): Lagos Trivia Night is a social experience on Sunday 25 October from 5 pm to 8 pm. _[gemma]_ |  |
| Queer women's crew | **TCA Gallery** (gallery, rain plan: covered); before: Nike Art Gallery, rain plan: covered | TCA Gallery fitsTaste as an art gallery, and it is low-key, about 60 minutes for the furthest trip. | **Terra Kulture Gallery** (place): Terra Kulture Gallery is a low-key art gallery open on Saturday 24 October from 4 pm to 7 pm. _[gemma]_ | **TCA Gallery** (place): TCA Gallery is a low-key art gallery open on Saturday 24 October from 4 pm to 7 pm. _[gemma]_ | **A night in at one of yours** (home): A night in at one of yours is a low-key hosted at home option for tomorrow from 6 pm to 9 pm. _[gemma]_ |  |
| Church youth group | **John Randle Centre for Yoruba Culture and History** (community centre, rain plan: covered); before: Nike Art Gallery, rain plan: covered | John Randle Centre for Yoruba Culture and History fitsTaste as a community centre, and it is about 48 minutes for whoever is furthest. | **Lagos Trivia Night** (event, Solo ₦15,000 \| Squad of 4 ₦60,000 \| Team of 8 ₦112,000, Awe Lagos): Lagos Trivia Night is a social experience on Sunday 25 October from 5 pm to 8 pm. _[gemma]_ | **Silverbird Cinemas Galleria** (place): Silverbird Cinemas Galleria is a cinema for a daytime activity on Saturday 24 October from 4 pm to 7 pm. _[gemma]_ | **Alliance Française** (place): Alliance Française is a community centre for a weekend visit on Saturday 24 October from 4 pm to 7 pm. _[gemma]_ |  |
| Broke university students | **Nike Art Gallery** (place, rain plan: covered); before: Nike Art Gallery, rain plan: covered | Nike Art Gallery: fair and fresh, and about 80 minutes for whoever is furthest. | **Nike Art Gallery** (place): Nike Art Gallery keeps everyone's trip under about 79 minutes, and it has a roof. _[code]_ |  |  |  |
| Parents with young kids | **Oluwole Urban Mall** (mall, rain plan: covered); before: Nike Art Gallery, rain plan: covered | Oluwole Urban Mall fitsTaste as a mall, and it is about 39 minutes for whoever is furthest. | **City Mall** (place): City Mall is a mall for a daytime visit on Saturday 24 October. _[gemma]_ | **Hans & Rene Gelataria** (place): Hans & Rene Gelataria is an ice cream spot open from 4 pm to 7 pm on Saturday 24 October. _[gemma]_ | **Cold Stone Creamery** (place): Cold Stone Creamery is an ice cream spot available on Saturday 24 October from 4 pm to 7 pm. _[gemma]_ |  |
| Corporate, 30s | **Nike Art Gallery** (place, rain plan: covered); before: Nike Art Gallery, rain plan: covered | Nike Art Gallery: fair and fresh, and about 80 minutes for whoever is furthest. | **Lagos Trivia Night** (event, Solo ₦15,000 \| Squad of 4 ₦60,000 \| Team of 8 ₦112,000, Awe Lagos): Lagos Trivia Night is a social experience on Sunday 25 October from 5 pm to 8 pm. _[gemma]_ | **Nike Art Gallery** (place): Nike Art Gallery is a covered spot available on Saturday 24 October from 4 pm to 7 pm. _[gemma]_ |  |  |
| Berlin control (no taste said) | **Çetin-Mert-Park** (place, outdoors, rain plan: skip); before: Çetin-Mert-Park, rain plan: skip |  |  |  |  |  |

_[gemma]_ means Gemma's reason passed the checks (its numbers are in the facts, it names the idea, it names nobody's identity and calls no venue "friendly"); _[code]_ means the code's own sentence was used.

## Invites (these travel: calendar, push, the plain page)

- **Alte men, late 20s:** Catch us at Nike Art Gallery this Saturday from 3 pm to 6 pm. Come through if you're free. No need to reply.
- **Queer women's crew:** Catch us at TCA Gallery this Saturday from 3 pm to 6 pm. Show up if you can, skip it if you can't. No RSVP.
- **Church youth group:** Catch us at John Randle Centre for Yoruba Culture and History this Saturday from 3 pm to 6 pm. Come through if you're free. No need to reply.
- **Broke university students:** Catch us at Nike Art Gallery this Saturday from 3 pm to 6 pm. Come through if you're free. No need to reply.
- **Parents with young kids:** Catch us at Oluwole Urban Mall this Saturday from 3 pm to 6 pm. Show up if you can, skip it if you can't. No RSVP.
- **Corporate, 30s:** Catch us at Nike Art Gallery this Saturday from 3 pm to 6 pm. Come through if you're free. No need to reply.
- **Berlin control (no taste said):** Rain all afternoon on Saturday (up to 70% between 11 am and 6 pm), and Sunday looks no better. The sloth is skipping this one. If it clears up, anyone can still add a plan.

## Automatic checks

| Check | Result | Detail |
|---|---|---|
| Distinct suggestions between the Lagos crews (no pair shares half or more) | **FAIL** | alte and corporate share 2 of their suggestions; students and corporate share 1 of their suggestions |
| Distinct ritual picks | pass | 4 different places for 6 Lagos crews |
| Taste changes the ritual pick (compared with the same crew, taste ignored) | pass | 3 of 6: queer (Nike Art Gallery to TCA Gallery), church (Nike Art Gallery to John Randle Centre for Yoruba Culture and History), parents (Nike Art Gallery to Oluwole Urban Mall) |
| No nightlife or alcohol for parents with young kids | pass | none found in the ritual or the 3 ideas |
| No nightlife or alcohol for church youth group | pass | none found in the ritual or the 3 ideas |
| Queer crew: no identity label or raw sentence anywhere (stored crew, draft, ritual, ideas card, calendar, push, logs, every file in the stores, the map cache and the Gemma cache) | pass | clean; stored needs: safe, discreet, women-friendly, inclusive |
| Queer crew: the needs were kept (safe, discreet) | pass | safe, discreet, women-friendly, inclusive |
| Queer crew: no taste or needs in the invite, the calendar or push | pass | checked the ritual invite, the .ics feed and every push payload |
| Budget respected for students (no idea over ₦5,000; budget read as "cheap") | pass | ideas' prices: none stated; ritual entry fee tag: none |
| Berlin control: no taste invented from a sentence that says none, and no Lagos guides | pass | taste: {"scenes":[],"likes":[],"placeKinds":[],"eventKeywords":[],"avoid":[],"needs":[],"budget":null,"ageBand":null,"energy":null} |
| Script slips: taste words in another script, dropped by the reader | pass | 1 of 118 words in 21 crew readings (all runs of this eval): 도락 |

## Notes from the run

- **Alte men, late 20s:** No time was given, so the window is 3 pm to 7 pm, after the worst heat. The map was slow, so fewer places were checked. Rain is forecast for the open-air hours, so outdoor places are left out.
- **Queer women's crew:** No time was given, so the window is 3 pm to 7 pm, after the worst heat. Rain is forecast for the open-air hours, so outdoor places are left out.
- **Church youth group:** No time was given, so the window is 3 pm to 7 pm, after the worst heat. Rain is forecast for the open-air hours, so outdoor places are left out.
- **Broke university students:** No time was given, so the window is 3 pm to 7 pm, after the worst heat. The map was slow, so fewer places were checked. Rain is forecast for the open-air hours, so outdoor places are left out. Only one idea fits this time.
- **Parents with young kids:** No time was given, so the window is 3 pm to 7 pm, after the worst heat. Rain is forecast for the open-air hours, so outdoor places are left out.
- **Corporate, 30s:** No time was given, so the window is 3 pm to 7 pm, after the worst heat. The map was slow, so fewer places were checked. Rain is forecast for the open-air hours, so outdoor places are left out. Only 2 ideas fit this time.
- **Berlin control (no taste said):** No time was given, so the window is 3 pm to 7 pm. Rain is forecast for the open-air hours, so outdoor places are left out. Nothing fits this time. Try the other slot, or add a plan yourself.

## Honest read

The taste works where the map answers, and the rain hid most of it. Saturday 24 October was forecast wet in Lagos (and in Berlin), so every Lagos ritual went down the covered path, which is the hardest case for taste.

What got better between the runs, because the eval showed it:

1. On the first run all six Lagos crews got Nike Art Gallery, the one curated covered spot, and taste changed nothing. Now cafés, restaurants, food spots, ice cream shops and malls count as under a roof, and a taste gains indoor kinds for a wet day. In this run the parents got a mall 39 minutes out instead of a gallery 80 minutes out, the church youth group a cultural centre, and the queer women's crew a quiet gallery.
2. The church youth group was offered the Syrian Club, a members' club. A place named or tagged as a club, bar, pub or lounge is now ruled out in code for any crew that needs no alcohol or brings kids, and so are events with those words.
3. Gemma left the taste empty for students, parents, church and work crews, and the reader threw away what little it said. The prompt now asks for what such a group usually enjoys, and the group words in the sentence count as a basis. Every Lagos crew now has place kinds.
4. Explanations read like a form ("We are going to Nike Art Gallery to keep everyone's trip within 80 minutes. It is an art gallery."). The prompt now has good and bad examples. In this run Gemma then read field names back ("fitsTaste", "fair and fresh"); those sentences are now thrown away for the code's own line ("TCA Gallery is an art gallery, quiet enough to hear each other, about 60 minutes for whoever is furthest."), but this table still shows the run's words.
5. Invites all ended "Just come through whenever you can, no need to reply". They now end with one of five lines picked from the plan.

What is still weak:

- Overpass, the public OpenStreetMap query service, did not answer the taste query for the alte, student and corporate crews (two tries each, then the ritual's own try). With nothing else under a roof they still got Nike Art Gallery at about 80 minutes, so the headline case, the alte crew, is not shown here. When the map answers, it finds the kinds the taste names (15 places for the church crew, 14 for the parents). A cached or self-hosted Overpass would fix this; the app then falls back exactly as it did here.
- Lagos Trivia Night (₦15,000 a head) is in three crews' ideas because the two guides list few events for this weekend. It is filtered for the students (over the ₦5,000 ceiling) and ranked lower when it matches nothing in a taste, but Gemma still picks it.
- Corporate and alte share two suggestions (the gallery and the trivia night), so the distinctness check fails. Both come from the map failing for those two crews.
- "Street food" maps to OpenStreetMap's fast_food, which in Lekki is mostly chains (Domino's, Debonairs in an earlier run). That is not what a student means by street food.
- Gemma's taste reading varies between runs (the queer women's crew got only "gallery" as a place kind in this run, and five kinds in the run before), and it gave the alte crew needs it did not say ("Feels safe", "Low-key places"). The organiser sees and edits these chips before saving.
- Berlin is rain-skipped with no ideas at all: the default pack has no covered spots, so a wet weekend there is empty.
- The script slip filter fired once in 118 taste words across 21 crew readings (a Korean word in the parents' likes).

The safety checks all pass: no identity word or raw sentence anywhere in the stores, logs, caches, calendar, invite or push for the queer women's crew; its needs (safe, discreet, women-friendly, inclusive) were kept; no nightlife or alcohol for the parents or the church youth group; the students' budget was read as cheap and nothing over ₦5,000 was offered.

Arnold: please fill in the "Fit 1 to 5" column above, one score per crew.

