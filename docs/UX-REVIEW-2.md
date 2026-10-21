# Come Through: UX review 2

Reviewed 21 Oct 2026 on a live server (real Gemma, OpenStreetMap, Open-Meteo), at 390 x 844 in headless Chrome, as two kinds of people. Arnold's notes were that onboarding should be smoother, the copy has a cadence that feels off, and the design can be better and smoother. This review checks those three notes against evidence, and it ends with the plan that the second phase implements and the counts before and after.

## The short version

1. **The plan link that friends get in WhatsApp is broken for anyone new.** A friend who taps "New plan: Highlife Under Mangoes ... Tap the link" lands on "Can't find that plan. This link is missing its key." The plan page never reads the `?t=` key in its own link, so it works only on a phone that opened the crew link first. Most friends will meet Come Through through a plan link, so for them the product does not start. (Screenshot `v2/before-26-B2-tap-plan-link-cold-dead-end-.png`.)
2. **A friend is asked for things before seeing anything.** The invite opens a form (name, area) with no plans on it. After joining, the friend gets a notification request and a calendar choice, and only then an empty crew page. The friend who comes in through a plan is asked about notifications twice, once on joining and again after "I'm going".
3. **The organiser fills a form to confirm what Gemma already read.** Gemma read "every other Saturday" and three areas correctly, and the confirm screen still showed 11 controls, opened scrolled halfway down (so the "Did Gemma get it right?" heading was off screen), and showed times as 15:00 while the rest of the app says 3pm.
4. **The invite carries no reason to tap.** The WhatsApp text is "Come through! I made a page for the uni guys. Plans go there, you tap once if you're coming, and rides sort themselves. Join here: link". It explains the app and asks for a join. It names nothing to come to, because a new crew has nothing on it until the heartbeat runs two or three days before the crew's day.
5. **The copy has four speakers and one rhythm.** "We send", "Gemma is reading", "the sloth picked" and "This phone remembers you" all speak on the same screens, and most paragraphs use the same shape: a statement, then a short closer ("That's allowed.", "That's the whole job.", "Nothing else."). The privacy paragraph appears three times at 46 to 63 words.
6. **The crew page says the sloth is still planning a day it has already skipped.** When rain makes the sloth skip a Saturday, the skip is stored as a cancelled plan, and the crew page filters cancelled plans out, so it keeps showing "The sloth is planning Saturday... By Thursday it picks a green spot".

## How the walk was run

The server ran on port 3100 from the committed code (HEAD `1172e00`, exported to a scratch folder with its own data folder). Headless Chrome was driven through `scripts/cdp.mjs` at 390 x 844, as an Android phone, with reduced motion on. The walkthrough scripts are in the session scratchpad, and every step left a screenshot in `docs/screens/v2/before-*.png`.

There were three people:

- **A, Tolu, the organiser.** Tolu starts a crew from one sentence ("the uni guys, every other Saturday, somewhere outside and cheap, around Yaba, Lekki and Surulere"), sends the invite to WhatsApp, then adds three plans: a flyer (`test/fixtures/flyer-mango-yard.png`), an Eventbrite link, and a sentence ("wine and monopoly at mine friday 7, bring a bottle").
- **B1, Bayo, a friend.** Bayo taps the invite in WhatsApp right after the crew is made, cold, with no context.
- **B2, Chidi, a friend.** Chidi taps a plan link that Tolu posted to WhatsApp, cold.

Each step records taps (a tap on a field counts as a tap), fields filled, characters typed, decisions (a point where the person has to choose, including whether to accept an optional prompt), words on screen in the viewport, and the measured system wait. Human time is estimated with a simple model, so that before and after can be compared on the same terms: 1.1 s a tap, 0.3 s a typed character, 1.5 s a decision, and reading at 4 words a second for the words in view at each step that asks for reading. The model is rough, and it is the same model for both runs.

Gemma calls in phase 1: 14 (two full organiser runs, one of which was a script mistake, plus the heartbeat). The heartbeat made a ritual for each crew, and the forecast said 90% rain on Saturday 24 Oct, so each one was a skip, which spends no Gemma call.

## Friction log (before)

| Person | Step | Taps | Fields | Chars | Decisions | Words in view | Wait | What went wrong |
|---|---|---|---|---|---|---|---|---|
| A | Land on start | 0 | 0 | 0 | 1 | 90 | 1.5 s | The sentence box starts 610 px down. The first screen is the logo, the tagline and the box's label. |
| A | Type the crew sentence | 1 | 1 | 96 | 1 | | | Fine. The example is good and specific. |
| A | Gemma reads it | 1 | | | | | 4.0 s | The button says "Gemma is reading it", which is clear. |
| A | Confirm screen, add yourself | 3 | 2 | 8 | 5 | 56 | 9.0 s | Opens scrolled down, so the heading is above the fold. Eleven controls to check. Times shown as 15:00 and 19:00. The highlight on the label "How often you link up" looks like selected text. The area type-ahead took 5.3 s to answer (Photon), so suggestions arrive after a person has moved on. |
| A | Make the crew | 1 | | | | | 0.3 s | |
| A | Send the invite | 3 | | | 1 | 37 | | The invite has nothing in it to come to (see Onboarding). |
| B1 | Tap the invite cold | 1 | | | 1 | 49 | 2.5 s | A form, a vibe line ("outside and cheap") and a rhythm. No plans. "Tolu is in" is the only sign of life. |
| B1 | Name and area | 3 | 2 | 9 | 1 | | | The area is asked for "sorting rides" before there is any ride. |
| B1 | Join | 1 | | | | 135 | | The joined screen is 135 words: a lede, a notification card of 40 words, and a calendar row. |
| B1 | Say no to nudges | 1 | | | 2 | | | Asked for notifications before anything has happened. |
| B1 | See the plans | 1 | | | 1 | 74 | 1.5 s | The crew page is empty: "The sloth is planning Saturday..." and "Nothing else on yet". |
| A | Back to the crew, open Add a plan | 2 | | | 1 | 136 | 2.8 s | Add a plan is 136 words, 63 of them the privacy paragraph. |
| A | Flyer: Gemma reads it | 2 | | | | | 10.7 s | The reading screen is good: the poster, the highlighter, the size saved. |
| A | Flyer: check the draft | 0 | | | 3 | 64 | | Ten fields shown even when only the end time was unsure. The kind chips (Event, At someone's, Quick one) ask a question Gemma already answered. |
| A | Flyer: post, tell the crew | 4 | | | 1 | 83 | 0.3 s | A "Posted" card and the bottom bar both offer WhatsApp. |
| A | Link: open, paste, read | 6 | 1 | | 1 | 136 | 18.6 s | The title came back as "Selfie Sunday at Alali VI! : Things to do in Lagos Every Sunday". Three notes, one of them about the page. |
| A | Link: check, post, tell | 4 | | | 3 | 93 | 0.4 s | |
| A | Sentence: open, type, read | 4 | 1 | 50 | 1 | 136 | 5.8 s | The note says 'Read "7" as 19:00.' in 24-hour time. |
| A | Sentence: check, post, tell | 4 | | | 3 | 74 | 0.4 s | The date, start and end are all yellow, so the highlight stops meaning anything. |
| B2 | Tap a plan link cold | 1 | | | 1 | 25 | 2.5 s | **Dead end:** "Can't find that plan. This link is missing its key." |
| B2 | (if it worked) the plan as a guest | 1 | | | 1 | 86 | 2.6 s | The plan reads well. The bar says "Join the uni guys to say you're coming" on two lines. |
| B2 | Join button, name and area, join | 5 | 2 | 13 | 1 | 187 | 0.4 s | Leaves the plan for a separate join screen. |
| B2 | Say no to nudges, back to the plan | 2 | | | 2 | 88 | | |
| B2 | I'm going | 1 | | | 1 | 84 | 3.4 s | The swing is lovely. Then a second notification card appears. |
| B2 | Nudge card again | 1 | | | 1 | 87 | 0.4 s | The join screen's "Not now" is not remembered. |

Totals before:

| Person | Taps | Fields | Chars | Decisions | Words read | System wait | Estimated total |
|---|---|---|---|---|---|---|---|
| A: crew and invite | 9 | 3 | 104 | 8 | 183 | 14.9 s | 1 min 54 s |
| A: flyer plan | 8 | 0 | 0 | 5 | 357 | 14.0 s | 2 min 0 s |
| A: link plan | 10 | 1 | 0 | 4 | 229 | 19.0 s | 1 min 33 s |
| A: sentence plan | 8 | 1 | 50 | 4 | 210 | 6.2 s | 1 min 29 s |
| **A in all** | **35** | **5** | **154** | **21** | **979** | **54.1 s** | **6 min 55 s** |
| **B1: invite to crew page** | **7** | **2** | **9** | **5** | **258** | **12.6 s** | **1 min 35 s**, ending on an empty page |
| **B2: plan link to "I'm going"** | **1** | **0** | **0** | **1** | **25** | **2.5 s** | **dead end** |
| B2 if the link worked | 10 | 2 | 13 | 7 | 532 | 15.3 s | 2 min 54 s |

The B1 and B2 waits include about 8 s each in which the script waited for area suggestions that took over 5 s to arrive. A person would carry on typing, so read the B waits as an upper bound.

## Onboarding

The "aha" for a friend is seeing a real plan with faces on it and tapping once. The "aha" for the organiser is the first friend's face appearing on the branch. Both should arrive as early as possible, and every question should wait until its answer is used.

### The hypotheses, tested

**1. Value before asking.** Confirmed, and it is the biggest change. Today a friend sees a form first. The server already returns the crew's plans to anyone holding the invite key (`GET /api/crews/:slug` with the invite token), so the friend can see the crew page, the sloth's pick and the plans with faces before giving anything. A name is needed only at the first "I'm going", because that is when a face goes on the branch. One refinement: the name should be asked in a sheet over the plan, not on a separate screen, so that the swing onto the branch still happens on the same page the friend tapped. The friend never leaves the plan.

**2. Ask "Where are you coming from?" only when rides need it, with a rough location.** Confirmed, with one change. The area is used for two things: ride pods and the sloth's fair pick (`crewPoints` uses members' areas once two or more have them). So it is asked in the rides section of a plan the friend is going to, where the answer immediately turns into "Leave Ikeja by 3:05pm", and not at join. The one-tap rough location rounds the phone's position to two decimal places (about a kilometre) in the browser before it leaves the phone, the server asks Photon for the neighbourhood at that rounded point, and the member's area is stored as that neighbourhood's own centre, never the phone's position. Typing the area stays as the other option, because many people will say no to location.

**3. The empty crew at the moment of the invite.** Confirmed. The fix is that making a crew with a regular day starts the sloth's first pick straight away, for the next slot of the rhythm, instead of waiting for the heartbeat two or three days before. The invite screen shows the pick arriving ("The sloth is picking Saturday's spot"), and when it lands, the WhatsApp text leads with it. One pick, not three ideas: three ideas would hand the organiser a choice, and the product's promise is that nobody has to choose. When the crew has no regular day, or the pick is a rain skip, the invite falls back to a plain line that still says what the link is for.

**4. Skip the confirm screen when Gemma is confident.** Partly. Skipping straight to a live crew is risky, because there is no way to edit a crew after it is made, and a wrong day would have the sloth planning the wrong Saturday for everyone who joins. The better version keeps one look before making it, but makes that look the crew page itself: the crew name painted at the top, and each thing Gemma read (the rhythm, the vibe, the areas) as a row you can tap to fix. Rows Gemma was unsure about are marked, and the others are plain text. The organiser's only field is their name, so the crew sees who made it. When Gemma is confident, this screen is read and approved with one tap.

**5. Notifications and the calendar when they are useful.** Confirmed. The join screen's notification card goes, and so does the separate joined screen. The question "Want a nudge on the day?" appears once per phone, after the first "I'm going", and a "Not now" is remembered. "Add to my calendar" stays under a plan you are going to, and the subscribed feed moves to the bottom of the crew page.

**6. The WhatsApp text is the real first screen.** Confirmed. The plan goes in the first line, and the link comes last, with one short reason to tap. The organiser can still edit the text in WhatsApp before sending.

### The flows after the change

Organiser: type the sentence, tap "Set up my crew", look at the crew as friends will see it, add your name, tap "Make the crew". The invite screen shows the sloth's first pick, and "Send to the group chat" sends it with the pick in the first line.

Friend, by invite: tap the link, see the crew page with the sloth's pick and any plans. Tap the pick, tap "I'm going", type a name in the sheet, tap "I'm going" again, and your face swings onto the branch.

Friend, by plan link: tap the link, see the plan, tap "I'm going", type a name, and swing on.

## Copy review

### Who speaks

Today four speakers share the screens: "we" (the privacy lines), Gemma ("Gemma is reading it"), the sloth ("The sloth picked Saturday") and the app itself ("This phone remembers you", "That's the whole job"). Switching speaker inside one screen is a large part of why the cadence feels off.

**The decision: the app speaks, in plain second person, like a friend in the group chat. The sloth is a character the app talks about, in the third person, and it has one job: the crew's regular pick. Gemma is named only where something is read or leaves the phone.** There is no "we" and no "I".

The reasons:

- The words that matter most in this product are facts: a time to leave, an address, a gate fee, whether it will rain, what goes to Google. Facts read as more trustworthy without a mascot in front of them. "The sloth couldn't reach the server" is the kind of line that makes an app feel like a toy.
- The text people forward to WhatsApp is sent by the organiser as themselves. If the app spoke as the sloth, the forwarded message would mix the sloth's voice with Tolu's.
- Keeping the sloth in the third person keeps it special. It is the one friend who always picks the spot, so "The sloth picked Muri Okunola Park" reads like the group chat talking about that friend. Gemma's invite for the pick can then be written in the crew's own voice.
- Naming Gemma at the point of reading is a promise in the challenge itself (open models), and it tells people which company sees their data.

### Cadence

These are the patterns found across all screens, with the rule that replaces each one.

| Pattern | Examples | Rule |
|---|---|---|
| A short closer after a statement | "That's allowed.", "That's the whole job.", "Nothing else." | Cut it. End on the last fact. |
| Every lede is two sentences, an explanation then an instruction | "Drop this link in the group chat. Anyone who has it can join with a name and an area." | One sentence on an action screen, or none when the screen already shows it. |
| The mechanism before the thing | "Gemma fills in the details and you check them", "Plans go there, you tap once" | Lead with what the person gets (the plan, the day, the place). |
| Triads by habit | "Who you are, how often you link up, the vibe, and roughly where", "Rain, a new time, or your ride" | Keep a list only when every item is used. |
| Colons joining clauses | "Posted. Now tell the crew: the link in the group chat is how most people will see it." | Two plain sentences, or one with "so". |
| One privacy paragraph, three times, 46 to 63 words | Start, Add a plan, Why this place | One sentence at the point of sending ("Gemma, Google's open model, reads this. Only this goes to Google."), with the full detail one tap away. |
| Two clocks | "15:00" in time inputs, "Read "7" as 19:00", "3 pm" (server) and "3pm" (app) | "3pm" everywhere a person reads a time. |

**Nigerian English, warm and not a costume.** The warmth comes from the nouns and idioms that Lagos friends already use in plain English: "come through", "link up", "the group chat", "the crew", "Who's coming through?", "Can't make it? No need to say anything." No Pidgin is added to the interface, because Pidgin chosen by an app reads as a costume, and Gemma already understands Pidgin when people write it. "Come through?" as a question at the end of a plan line is the most natural invitation in the app, so it ends every WhatsApp message.

**Plain words, per Arnold's manual.** Each button names its action and the next screen confirms it with the same verb ("Post it" leads to "Posted"). Errors say what failed and what to do. Empty states point to the next action. Nothing claims more than the product does: "About 15 min" with "How we guess" stays, and "Entry: check at the gate" stays.

### Every string, before and after

City-dependent examples and placeholders now come from the crew's city pack (`src/packs/<city>`, `ui` block), with Lagos as the flagship. The Lagos values are shown.

**WhatsApp messages (the real first screen)**

| Where | Before | After |
|---|---|---|
| Invite, with the sloth's first pick | "Come through! I made a page for the uni guys. Plans go there, you tap once if you're coming, and rides sort themselves. Join here: {link}" | "Saturday, 3 to 6pm at Muri Okunola Park. Come through?<br>Tap if you're coming: {link}" |
| Invite, no pick yet | (as above) | "Plans for the uni guys live here now, so nobody has to chase the group chat. Tap once when you're coming: {link}" |
| Invite from the crew page | "Come through! Join the uni guys here: {link}" | The same as the two lines above, using the next plan when there is one. |
| A new plan | "New plan: Highlife Under Mangoes, Sat 31 Oct, 5 to 8pm, The Mango Yard. Tap the link and say if you're coming: {link}" | "Highlife Under Mangoes, Sat 31 Oct, 5 to 8pm at The Mango Yard. Come through?<br>Tap if you're coming: {link}" |
| Sharing a plan | "{title}<br>{when}, {place}<br>Come through: {link}" | "{title}, {when} at {place}. Come through?<br>{link}" |
| After "I'm going" | "I'm going to {title}, {when}, {place}. Come through: {link}" | "I'm going to {title}, {when} at {place}. Come through?<br>{link}" |
| Opera Mini share | "{title}, {when}. Come through: {link}" | Same as "Sharing a plan". |

**Start**

| Before | After |
|---|---|
| Tagline: "The group chat does the asking. You just come through." | "Plans for your crew in one sentence. Everyone taps once." |
| Label: "Start a crew in one sentence" | "Your crew, in one sentence" |
| Hint: "Who you are, how often you link up, the vibe, and roughly where." | "Who they are, when you link up, and roughly where." |
| Chip: "Use the example" | "Try the example" |
| Error: "Write a sentence about your crew first. The example above is a good start." | "Write one sentence about the crew first, or tap Try the example." |
| Busy: "Gemma is reading it" | "Reading it with Gemma" |
| Privacy (46 to 62 words) | "Gemma, Google's open model, reads this sentence. Only the sentence goes to Google." Then "What goes where" opens the full detail. |
| "How it works" 1: "Describe your crew. Gemma sets up the name, the rhythm and the areas." | "Say who the crew is. Gemma fills in the name, the day and the areas." |
| 2: "Drop the link in the group chat. Friends join with a name and an area. No app, no sign up." | "Send the link to the group chat. Friends see the plans and tap once, with no app and no sign-up." |
| 3: "Plans come in lazy. A flyer, a link or one sentence. Everyone taps once and rides sort themselves." | "Add plans the lazy way, from a flyer, a link or a sentence. Rides sort themselves." |
| "Got a regular day? If nobody plans anything, the sloth picks a green spot near the middle of the crew, checks the weather, and posts it." | "Got a regular day? When nobody plans anything, the sloth picks a green spot in the middle of the crew and checks the weather." |
| Desk: "Made for phones. Send this page to yours, or keep going here." | "Made for your phone. Open this link there, or carry on here." |

**Setting up the crew (was "Did Gemma get it right?")**

| Before | After |
|---|---|
| "Did Gemma get it right?" | The crew name, painted, as the heading. |
| "Change anything that's off. The highlighted bits are guesses." | When sure: "Tap anything to change it." When not: "Gemma guessed the marked bits. Tap one to fix it." |
| "Over to you" / "Gemma is busy, so fill this in. It takes a minute." | "Gemma is busy right now" / "Fill these in yourself. It takes a minute." |
| "Gemma wasn't sure about this one." | "Gemma guessed this." |
| "Gemma guessed part of this, usually the time. Check the day and the hours." | "Gemma guessed the time. Check it." |
| "Gemma couldn't find a regular day. Pick one, or leave it." | "No regular day in your sentence. Pick one, or leave it." |
| "Gemma guessed the areas. Add where people actually live." | "Gemma guessed these. Add the areas people come from." |
| "The sloth uses this to pick places and write invites." | "The sloth uses this when it picks a spot." |
| Times "15:00" to "19:00" (time inputs) | "3pm" to "7pm" (a list of times) |
| "And you?" / "Add yourself now and skip the join step. You can leave this empty." | "Your name" / "So the crew sees who started it." |
| Area for the organiser | Not asked here. Asked on the first plan with rides. |
| "Make the crew" / "Making it" | "Make the crew" / "Making it" (kept) |

**Invite screen**

| Before | After |
|---|---|
| "{crew} is ready" | Kept. |
| "Drop this link in the group chat. Anyone who has it can join with a name and an area." | "Send it to the group chat. Friends see the plans before they're asked for anything." |
| (nothing) | Pick card: "The sloth is picking Saturday's spot" then "The sloth picked Saturday" with the place and the time. |
| "You're not in it yet either. Join so you show up when you say you're going." / "Join it yourself" | Removed (the organiser's name is part of making the crew). |

**Friend's first view (was the join screen)**

| Before | After |
|---|---|
| "You've been asked to come through" over a form | Kept as the line above the crew name, over the crew's plans. |
| "Your name" / "Your area" / "Just the neighbourhood, for sorting rides. Nobody sees your address." | Name only, in a sheet at the first "I'm going": "What should the crew call you?" |
| "Join the crew" | "I'm going" in the sheet when it came from a plan; "Join the crew" when it came from the crew page. |
| "No account and no phone number. This phone remembers you." | "No sign-up. This phone remembers you." |
| "Add your name so the crew knows who is coming." | "Add your name so the crew knows it's you." |
| "Add your area. Just the neighbourhood is enough." | Removed from join. |
| Joined screen: "You're in, {name}" / "When a plan link lands in the group chat, open it and tap once if you're coming. That's the whole job." | Removed. A toast says "You're in, {name}." |
| "Want a nudge as well?" / 40 words | Moved to after the first "I'm going" (below). |
| "Put every crew plan in your calendar" / "You don't need this. When you tap I'm going on a plan, you can add that one plan to your calendar. This is for people who want all of them." | At the bottom of the crew page: "Every crew plan in your calendar" / "Optional. Each plan you're going to has its own Add to my calendar." |

**Crew page**

| Before | After |
|---|---|
| "The sloth is planning Saturday..." / "By Thursday it picks a green spot near the middle of the crew, checks the weather, and posts it here." | "The sloth is planning Saturday..." / "It picks a green spot in the middle of the crew and posts it here by Thursday." |
| (bug) The skip never showed | "The sloth is skipping Saturday" with the rain note. |
| "Rain likely, so somewhere with a roof. Tap for why." | "Rain likely, so it picked somewhere with a roof." |
| "Moved to dodge the rain. Tap for why." | "Moved to dodge the rain." |
| "Bring the crew in first" / "Plans land better with people on the branch. Drop the invite link in the group chat." | "Bring the crew in" / "They see the plans before they're asked for anything." |
| "Nothing else on yet" / "That's allowed. Seen a flyer or got an idea? Add it and the crew taps once." | "Nothing else on yet" / "Seen a flyer or got an idea? Add it and the crew taps once." |
| Sticker "Hosted" | "At Tolu's" (the host's first name), or "At someone's". |
| Guest bar: none (the guest saw a form) | "Join the crew" |

**Add a plan**

| Before | After |
|---|---|
| "A flyer, a link or one sentence. Gemma fills in the details and you check them." | "A flyer, a link or one sentence. Gemma fills in the details." |
| Privacy (63 words) | "Gemma, Google's open model, reads what you add here. Only that goes to Google." Then "What goes where". |
| "Instagram keeps that one locked. Share the flyer picture instead: a screenshot works." | "Instagram doesn't let apps read posts. Add a screenshot of the flyer instead." |
| "Tix.africa does not let other apps read its event pages. Share a screenshot of the event page or the flyer instead." | "Tix.africa doesn't let apps read its pages. Add a screenshot of the event or the flyer instead." |
| "Choose the flyer" | "Add the screenshot" |
| "Gemma is reading the flyer" (and three more) | Kept. |

**Checking a plan (was "Here's what Gemma got")**

| Before | After |
|---|---|
| Topbar "Check the plan" + "Here's what Gemma got" + "The highlighted bits are guesses. Fix anything that's off." | When sure: "Here's the plan" / "Gemma read it from the flyer. Change anything before you post." When not: "Check the marked bits" / "Gemma guessed them. The rest came from the flyer." (or "the link", "your sentence") |
| All ten fields open | A preview of the plan as the crew will see it, with "Change the details" open only when something is marked. |
| "Over to you" / "Gemma is busy, so fill in the details, or give it another go." / "Try Gemma again" | "Gemma is busy right now" / "Fill in the details yourself, or try again in a minute." / "Try again" |
| "Gemma wasn't sure. Check this one." | "Gemma guessed this." |
| "It's outside. Watch the weather." | "It's outside, so watch the weather" |
| "It's someone's home. Only the crew sees the address." | "It's someone's home, so only the crew sees the address" |
| "Post it to the crew" | "Post it" |
| Note (server): 'Read "7" as 19:00.' | 'Read "7" as 7pm.' |
| Note (server): "Add your address if the crew does not know it; only members will see it." | "Add your address if the crew doesn't know it. Only the crew sees it." |
| Note (server): "Used the event details the page publishes." | "Read from the event page's own details." |

**Plan page**

| Before | After |
|---|---|
| "Posted. Now tell the crew: the link in the group chat is how most people will see it." | "Posted. Tell the group chat so people see it." |
| "{n}% chance of rain. Worth a plan B." | "{n}% chance of rain. Have a backup spot." |
| "Tap I'm going and you'll be grouped with people near you, with a time to leave." | "Tap I'm going to get a time to leave and people to ride with." |
| (no area) "Ask {host} for the address" | New: "Where are you coming from?" / "Just the area, for your ride time." / "Use my rough location" |
| "About 15 min, a rough estimate, riding with Tolu." | "About 15 min, riding with Tolu." (with "How we guess") |
| "No ride time yet: the place is not on the map" | "No ride time yet, because the place isn't on the map" |
| "No ride app here takes a drop-off from a link yet, so paste the address in." | "Ride apps don't take a drop-off from a link yet, so paste the address in." |
| "Get a nudge if this plan changes? Rain, a new time, or your ride." | "Want a nudge on the day?" / "One alert on the day, and one if the time or the weather changes." |
| Why-this-place privacy (52 words) | "Gemma, Google's open model, wrote this from the place, the weather and travel times. No names went to Google." |
| "Join the uni guys to say you're coming" (two lines) | "I'm going" (opens the name sheet) |
| "I can't make it any more" | Kept. |
| "Can't make it? No need to say anything." | Kept. It is the best line in the app. |

**Opera Mini pages**

| Before | After |
|---|---|
| Plan: "Join {crew} to say you're coming" / "Your area, like Yaba or Lekki" (with name) / "Join and see the plan" | "Coming? Add your name" / "Your name" / "Where you're coming from (optional), like Yaba" / "I'm going" |
| Crew: "Join {crew}" / "Join the crew" | Kept, with the area marked optional. |
| Share: "{title}, {when}. Come through: {link}" | "{title}, {when}. Come through?<br>{link}" |

## Design critique

### Is it templated?

No. This is not the generic look. The painted wall, the sign-writer's Shrikhand with a hard yellow drop, danfo yellow as the only action colour, and the sloth hanging off a branch that the crew also hangs from are choices made for this brief. Two small tells remain: the outline-only "empty" boxes (they read as disabled cards), and the stack of identical paper cards on the confirm and draft screens, where the form is chopped into equal panels.

### Overall impression

The identity is strong and the signature moment (your face swinging onto the branch) is the best thing in the product. The flows around it are built like a form-driven app, so people spend their first minute on forms before they reach the branch. The biggest opportunity is to put the branch first: show friends the plans with faces before anything else, and make the organiser's set-up screen look like the crew page they are about to share.

### What works

- **The branch.** It is a real idea, it carries information (who is going, how many), and it is the payoff of the one tap. The sag that grows with each person is a detail nobody will name and everybody will feel.
- **Honest specifics.** "Leave Surulere by 4:30pm", "Gate ₦3,000", "Not on the map yet, so ride times and weather are guessed from Surulere", "Can't make it? No need to say anything." These lines are why people would trust it.
- **The flyer reading screen.** The tilted poster, the highlighter sweep and "Sending 372 KB, shrunk from 10.6 MB to save your data" make a wait feel like work being done.

### Priority issues

1. **Forms before value (onboarding).** Covered above. Fix: the guest crew page, the name sheet at the first tap, the area at the first ride, and the nudge after the first "I'm going".
2. **The set-up screen is a form, not a preview.** Eleven controls, equal weight, opened mid-page. Fix: the crew page as the preview, with tap-to-fix rows, the painted name as the heading, and the page opening at the top. When Gemma is sure, nothing is yellow.
3. **The highlight has lost its meaning.** On the sentence plan, the date, start and end were all yellow, and labels get a yellow background like selected text. Fix: mark only the field Gemma marked low, with a small marker stroke under the label (the highlighter motif, drawn once) instead of a filled box, and keep the field border.
4. **The first viewport of Start is mostly logo.** The sentence box starts 610 px down on an 844 px screen. Fix: a one-line painted title with the sloth beside it, the tagline under it, and the composer inside the first screen.
5. **Two-line pill buttons.** "Join the uni guys to say you're coming" wraps and left-aligns inside a pill. Fix: buttons never carry a variable name. The crew name goes in the sheet title.

### Minor observations

- The theme colour for light mode is `#DCE7C8`, while the wall is `#E3EBD2`, so the browser bar is a shade off the page.
- "Who's going" and "1 going" say the same thing on one line. Keep the count only when it is above zero and the faces don't already show it.
- Kind stickers use "Hosted", which is jargon for a house plan.
- The "Posted" card and the bottom bar both offer WhatsApp after posting.
- The link plan's title kept the page's SEO tail ("Things to do in Lagos Every Sunday").
- 24-hour time inputs appear on a 12-hour product.

### Questions to consider

- What if the crew page were the onboarding? The organiser's preview, the friend's first view and the everyday home would then be one screen in three states.
- What would a confident first message look like? The first plan line in WhatsApp is the real landing page, and it can be one line.
- Does the friend ever need to "join"? Joining is a side effect of the first "I'm going", so it does not need its own screen.

### Mobile and motion check

The platform layer is already right: `viewport-fit=cover` with safe-area padding, `100dvh`, 16 px inputs, no tap highlight, `touch-action: manipulation`, `:active` press states, hover gated behind `(hover: hover) and (pointer: fine)`, `theme-color` per scheme, and reduced motion respected. Motion uses custom curves, presses at 120 ms, and only `transform` and `opacity`. The changes are about adding two moments in the same language and fixing a few seams:

- The name sheet slides up from the bottom (320 ms, the drawer curve) and goes down faster (200 ms), with a scrim. With reduced motion it fades.
- When the crew is made, the yellow paint drops in behind the crew name once (the sign-writer's stroke, 420 ms, transform only). It is the organiser's small version of the friend's swing.
- Screens that change step without a route change scroll to the top.
- The sloth's pick card on the invite screen fades up when it lands (300 ms, ease-out), and the WhatsApp button's text changes with the 2 px blur crossfade the bar already uses.

## What phase 2 changes

1. Fix the plan link for new phones (the `?t=` key on any crew route is saved and used).
2. Show guests the crew page and plan pages, with "I'm going" asking for a name in a sheet, and join plus "I'm going" in one go.
3. Remove the joined screen, ask for the area in the rides section with a rounded one-tap location, and ask for nudges once after the first "I'm going".
4. Replace the confirm form with the crew preview (tap-to-fix rows, the organiser's name only, 12-hour times).
5. Start the sloth's first pick when a crew is made, show it on the invite screen, and lead the WhatsApp text with it.
6. Make the plan check a preview with the details folded away when Gemma is sure.
7. Rewrite every string above, take city examples from the city pack, and keep the Opera Mini pages in step.
8. Fix the skipped-ritual panel, the time formats, and the server notes.

Server additions for this (all small): `POST /api/crews` starts the first pick in the background; `PATCH /api/members/:id` sets your own area; `GET /api/areas/near?lat=&lon=` names the neighbourhood at an already rounded point.

## After

(Filled in after phase 2.)
