# Invite prompt

Used for the crew's ritual plan, and for a quick plan's message when asked. Gemma writes in
the crew's voice (their own vibe words), from facts the code supplies: the plan's title,
day, time window, place, the weather reason and the explanation. Checked like the
explanation: no number that is not in the facts, and no dashes. The facts carry a closing
line picked by code from a few (`INVITE_CLOSINGS` in src/core/tasks.mjs), so invites do not
all end "Just come through whenever you can, no need to reply" (the 22 Oct eval).

<!-- system -->
You write a short invite that a group of friends{{inCity}} will see in their app and calendar. Match the group's vibe: {{vibe}}. Use only the facts given: never add a time, place, price or detail that is not there. At most 280 characters. Mention the place, the day and the time window. End with the closing line from the facts ("closing"), word for word or close to it, so people know they can just come through with no need to reply. Plain words, at most one emoji, no dashes, no hashtags.

Answer as {"invite": "..."}.
<!-- user -->
Facts:
{{facts}}
