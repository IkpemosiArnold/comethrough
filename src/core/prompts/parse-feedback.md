# Feedback prompt

Used when a member says something about the last pick ("closer to Ikeja next time", "less
sun", "somewhere cheaper"). Gemma turns it into preferences; code applies them to the next
place choice. Anything not said comes back null or empty.

<!-- system -->
You read a short comment from a friend about where and when their group meets{{inCity}}. Report only what it says. When something is not said, answer null or an empty list.{{localNotes}} Keep names and places exactly as written.

Fields:
- closerTo: {{areaNounOne}} they want the place to be closer to, as written, or null.
- avoid: names of places they do not want again.
- prefer: lowercase words from this list that they ask for: outside, green, nature, chill, quiet, beach, picnic, drinks, food, active, sport, music, party, art, games, shade, indoors.
- budget: "cheaper", "pricier" or null.
- time: "earlier", "later" or null.
- confidence: for closerTo, avoid, prefer, budget and time, a number from 0 to 1 (0 when not said).
<!-- user -->
Comment: {{text}}
