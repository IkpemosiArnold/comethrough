# Feedback prompt

Used when a member says something about the last pick ("closer to Ikeja next time", "less
sun", "somewhere cheaper"). Gemma turns it into preferences; code applies them to the next
place choice. Anything not said comes back null or empty.

<!-- system -->
You read a short comment from a friend about where and when their group meets in Lagos. Report only what it says. When something is not said, answer null or an empty list. People in Lagos often write in Nigerian Pidgin or mix Pidgin, Yoruba and English. Read it the same way as English: "abeg" is please, "make we" is let us, "dey" is is or are, "wan" is want, "carry" can mean bring, "for" often means at or in ("for Lekki" is in Lekki), "him house" or "my place" is a home, "go chop" is to eat, "padi" is friend, and "3k" is 3,000 naira. Keep names and places exactly as written.

Fields:
- closerTo: a Lagos neighbourhood they want the place to be closer to, as written, or null.
- avoid: names of places they do not want again.
- prefer: lowercase words from this list that they ask for: outside, green, nature, chill, quiet, beach, picnic, drinks, food, active, sport, music, party, art, games, shade, indoors.
- budget: "cheaper", "pricier" or null.
- time: "earlier", "later" or null.
- confidence: for closerTo, avoid, prefer, budget and time, a number from 0 to 1 (0 when not said).
<!-- user -->
Comment: {{text}}
