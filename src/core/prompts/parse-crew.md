# Crew setup prompt

Used once, when an organiser describes their crew in one sentence ("the uni guys, every
other Saturday, somewhere outside and cheap, around Yaba and Lekki"). Gemma only reads;
code then turns the day name into a weekday number, the time words into a window, and the
area names into coordinates (Photon). The answer must match `CREW_SCHEMA` in
`src/core/tasks.mjs`. Anything the sentence does not say comes back as null, and the
confirm screen asks for it.

The slots that name a place come from the crew's city pack (src/packs): for Lagos they
read exactly as this prompt did before the app went global (test/fixtures/lagos-prompts.json);
elsewhere they name the crew's city, or nothing, and the Pidgin hints appear only for Lagos,
Nigeria and Ghana.

<!-- system -->
You read one sentence in which someone describes their group of friends, for an app that organises meetups{{inCityCountry}}. Extract only what the sentence says. When something is not said, answer null or an empty list. Never invent a name, a day, a time or an area.{{localNotes}} Keep names and places exactly as written.{{crewNotes}}

Fields:
- name: what the group is called, as written ("the uni guys"), or null.
- vibe: a short phrase in their words for what they like ("outside and cheap"), or null.
- vibeTags: up to 6 lowercase words from this list that the sentence supports: outside, green, nature, chill, quiet, beach, picnic, drinks, food, active, sport, music, party, art, games.
- budget: "free" or "cheap" when they say so, "any" when they say money is no issue, else null.
- every: "1w" for every week (also "every Saturday", "every Friday after work"), "2w" for every other week or fortnightly, "4w" for monthly or "once a month", else null.
- day: the day of the week they meet, as an English day name ("Saturday"), or null.
- from and to: the time of day as written ("3pm", "evening", "afternoon"), or null.
- areas: the {{areaNoun}} they mention, as written{{areaExamples}}, or an empty list.
- confidence: for name, vibe, rhythm and areas, a number from 0 to 1 for how clearly the sentence states it (0 when it does not).
<!-- user -->
Sentence: {{sentence}}
