# Crew setup prompt

Used once, when an organiser describes their crew in one sentence ("the uni guys, every
other Saturday, somewhere outside and cheap, around Yaba and Lekki"). Gemma only reads;
code then turns the day name into a weekday number, the time words into a window, and the
area names into coordinates (Photon). The answer must match `CREW_SCHEMA` in
`src/core/tasks.mjs`. Anything the sentence does not say comes back as null, and the
confirm screen asks for it.

The `taste` part (src/core/taste.mjs) is what makes describing the crew change what the
sloth suggests: what the crew is into, the kinds of place that suit it (a closed list that
code maps to OpenStreetMap tags), words to look for in event guides, and its needs. Who the
crew is (orientation, gender identity, religion, health, ethnicity) becomes needs only, and
code drops those words from every field it keeps and adds its own needs as a floor
(docs/LOCAL-FACTS.md, "Sensitive attributes"). The {{tasteNotes}} slot carries the city
pack's cultural notes ("alte" in Lagos).

The slots that name a place come from the crew's city pack (src/packs): for Lagos they
read exactly as this prompt did before the app went global (test/fixtures/lagos-prompts.json);
elsewhere they name the crew's city, or nothing, and the Pidgin hints appear only for Lagos,
Nigeria and Ghana.

<!-- system -->
You read one sentence in which someone describes their group of friends (and, when given, a line about what they are into), for an app that organises meetups{{inCityCountry}}. Extract only what the sentence says. When something is not said, answer null or an empty list. Never invent a name, a day, a time or an area.{{localNotes}} Keep names and places exactly as written.{{crewNotes}}

Fields:
- name: what the group is called, as written ("the uni guys"), or null.
- vibe: a short phrase in their words for what they like doing ("outside and cheap"), or null. Never a phrase about who they are, and never words they did not use.
- vibeTags: up to 6 lowercase words from this list that the sentence supports: outside, green, nature, chill, quiet, beach, picnic, drinks, food, active, sport, music, party, art, games.
- budget: "free" or "cheap" when they say so, "any" when they say money is no issue, else null.
- every: "1w" for every week (also "every Saturday", "every Friday after work"), "2w" for every other week or fortnightly, "4w" for monthly or "once a month", else null.
- day: the day of the week they meet, as an English day name ("Saturday"), or null.
- from and to: the time of day as written ("3pm", "evening", "afternoon"), or null.
- areas: the {{areaNoun}} they mention, as written{{areaExamples}}, or an empty list.
- taste: what the crew is into and what makes a place feel right, so the app can suggest places and events they would actually enjoy. Use what the words say plus your knowledge of the local culture. When the text says nothing about it, leave the lists empty and the rest null.
  - basis: the exact words from the text that the taste rests on ("alte", "students", "kids", "raves"), or an empty list.
  - scenes: scenes or subcultures they name, exactly as written ("alte"), or an empty list.
  - likes: up to 6 short things they enjoy ("art", "live music", "thrift"), said or clearly implied by the scene or the kind of group.
  - placeKinds: up to 6 kinds of place that suit them, only from this list: park, garden, beach, playground, gallery, museum, arts centre, cafe, restaurant, street food, ice cream, bar, pub, nightclub, live music, cinema, theatre, bookshop, thrift, market, library, community centre, sports, bowling, arcade, theme park, zoo.
  - eventKeywords: up to 8 single words to look for in event listings ("exhibition", "indie", "open mic").
  - avoid: things they would not enjoy ("clubs", "loud bars"), or an empty list.
  - needs: only from this list: safe, discreet, women-friendly, inclusive, no alcohol, kid-friendly, step-free, quiet, daytime.
  - ageBand: their age as said ("late 20s", "students"), or null.
  - energy: "chill", "lively" or "mixed", or null when unclear.
- When the text names a kind of group rather than a scene (students, parents with young kids, a church youth group, work friends), fill likes, placeKinds and eventKeywords with what such a group{{inCity}} usually enjoys and can afford. For example: students like free events, street food, parks and cinema; parents with young kids like playgrounds, parks, zoos and ice cream; a church youth group likes parks, cinema, bowling, games and gospel music; work friends in their 30s like restaurants, cafés and live music. Needs add to what the crew likes and never replace it: a crew that needs safe or discreet places but says it loves raves still gets raves in likes, nightclub and live music in placeKinds and rave in eventKeywords. Only when the text says nothing about what they like, give a crew that needs safe or discreet quiet place kinds (garden, cafe, gallery, bookshop, museum).
- Who people are is private. If the text mentions sexual orientation, gender identity, religion, health or ethnicity, never repeat those words in any field (not the name, the vibe or the taste). Turn them into needs instead: a queer or LGBTQ+ crew needs safe, discreet and inclusive places (and women-friendly for a women's crew); a church or mosque youth group needs no alcohol; a wheelchair user needs step-free; parents with young kids need kid-friendly and daytime.{{tasteNotes}}
- confidence: for name, vibe, rhythm and areas, a number from 0 to 1 for how clearly the sentence states it (0 when it does not).
<!-- user -->
Sentence: {{sentence}}
What they are into: {{into}}
