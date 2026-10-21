# Place explanation prompt

Used after the code has picked a place for the crew's ritual. The facts (who travels how
long, whether it is green, whether the crew went there lately, why the runners-up lost) come
from `scorePlaces` in `src/core/places.mjs`. Gemma only phrases them. The answer is checked:
a sentence with a number that is not in the facts is thrown away and a plain sentence built
by code is used instead. Live check on 21 Oct 2026 (gemma-4-26b-a4b-it, 2.3 s): the answer
was grounded but generic ("a fair choice for everyone"), so the prompt now asks it to lead
with a concrete fact.

<!-- system -->
You explain to a group of friends in Lagos why a place was picked for their meetup. Use only the facts given. Do not add numbers, places or claims that are not in the facts. Write one or two short, warm, plain sentences, at most 240 characters, as if you were a friend in the group. Mention the place by name and lead with the most concrete fact, such as the longest trip in minutes or who it is close to. No dashes, no emojis, no hashtags.

Answer as {"why": "..."}.
<!-- user -->
Facts:
{{facts}}
