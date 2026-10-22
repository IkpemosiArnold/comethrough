# Come Through: design

This document describes how Come Through looks, moves and talks, and why. The tokens live in `web/src/styles/tokens.css`, and this file explains them.

## Who it is for

The users are a Lagos friend crew on their phones, mostly cheap Android phones and some iPhones, who spend the day in WhatsApp. They open Come Through from a link in the group chat, often on mobile data, often outside. They should be able to read a plan, tap once, and get back to their day. The laptop is a second screen for the organiser, and the layout there is a courtesy.

## The direction: a Saturday afternoon in Lagos, hand-painted

The look comes from three things you see on a lazy Lagos weekend. First, there are the hand-painted shop signs and danfo buses, which use fat leaning letters with a hard painted shadow and a loud yellow. Second, there are the green spaces the crew actually goes to, e.g., Muri Okunola Park, JJT Park and Freedom Park, which give the canopy green and the pale leaf wall. Third, there is the sloth from the challenge theme, which hangs from a branch and does as little as possible.

The branch ties the three together. The sloth hangs from it, and so does the crew. On every plan, the people who are going hang from a branch by their arms, and the branch sags a little more with each person. That is the product's one signature idea, and every other choice stays quiet around it.

## Colour

| Token | Hex | Name and source | Used for |
|---|---|---|---|
| `--wall` | `#E3EBD2` | Painted wall, leaf pale | The page background |
| `--paper` | `#F8FAF1` | Poster paper | Raised surfaces: plan rows, forms, pods |
| `--ink` | `#14302A` | Canopy shadow | Text, and the hard shadow under primary buttons |
| `--danfo` | `#FFC21A` | Danfo bus yellow | The only action colour: "I'm going", "Add a plan", the flyer tile, the highlighter |
| `--canopy` | `#1E4A39` | Park canopy | The sloth's panel (rituals) and "Why this place" |
| `--zobo` | `#A3214F` | Zobo (hibiscus drink) | Hosted plans, rain warnings, errors |
| `--lagoon` | `#1B6782` | Lagos lagoon | Event plans, links, focus rings |
| `--fur` | `#7A5B3E` | Sloth fur | The sloth, the branch and the hanging arms |

Secondary text is `--ink-2` (`#2E463E`) and tertiary text is `--ink-3` (`#3D574E`), which is kept for genuinely secondary bits like field labels and placeholders. Links are `--lagoon` (`#124F66`) and errors and rain are `--zobo` (`#8C1C44`). The WhatsApp button uses `#0B6332`, which is darker than WhatsApp's brand green so that white text on it is 7.4:1.

Contrast (WCAG 2.x ratio, measured): body text aims for 7:1 and never goes under 4.5:1, in both themes. Ink on wall is 11.5, `--ink-2` on wall is 8.3 (9.7 on paper), `--ink-3` on wall is 6.4 (7.5 on paper), lagoon on wall is 7.3, zobo on wall is 7.2, ink on danfo is 8.7, `--on-canopy` on canopy is 8.9 and `--on-canopy-2` is 7.5, and white on the WhatsApp green is 7.4. Every avatar fill is paired with a text colour above 4.5. Dark mode redefines the same tokens (`#0F2620` wall, `#E8F0DA` ink, `#C6D6C8` ink-2 at 10.5, `#A9BFAE` ink-3 at 8.2) and keeps danfo yellow as the action colour. The only text under 7:1 on any screen is a disabled button.

## Type

- **Display: Shrikhand** (one weight, Latin subset, 16 KB, self-hosted). Shrikhand is a fat, leaning display face, and it reads like the lettering on a Lagos shop sign. It is used for screen titles, crew names, plan titles on the plan page, the date numbers on the crew home, leave-by times and the tile titles. Large display text gets the "painted" treatment, which is a hard yellow offset shadow (`0.05em 0.06em 0 var(--danfo)`) like a sign-writer's drop shadow.
- **Body: the system font** (Roboto on Android, SF on iPhone). It costs nothing to load, it is tuned for each phone, and it keeps the custom face for the moments that carry personality.
- **Scale** (rem): 0.8125, 0.875, 1, 1.1875, 1.5, 2, 2.75, and a fluid `clamp(2.5rem, 11vw, 3.5rem)` for the biggest titles. The root is 17 px (`106.25%` of the browser's own size), so body text is 17 px, fine print is 14 px and the smallest label is 14 px. On an iPhone the root is `-apple-system-body`, which is 17 px at the default setting and follows the Text Size setting (Dynamic Type), so every size grows with it. Display tracking is -0.01em to -0.02em, and body tracking is 0. Display leading is 1.04, and body leading is 1.45 (`--lh-body`).
- **Inputs are 16 px** or larger, so iPhone Safari never zooms into a field.

## Shape and depth

- Radius follows hierarchy: pills (999 px) for buttons and chips, 26 px for big panels, 20 px for plan rows, 16 px for inputs, and 4 to 6 px for flyers, which are paper.
- Depth is painted, not blurred. Primary buttons sit on a hard 3 px ink shadow, and pressing one pushes it into the wall (the button moves down 2 px and the shadow shrinks to 1 px). Raised surfaces get one soft lift shadow. Flyers are tilted 2 to 3 degrees like posters pasted on a wall.

## Layout

Everything is one column, at most 480 px wide, with a 16 px gutter and safe-area padding. The main action sits in a fixed bottom bar in the thumb zone, with a gradient so content scrolls under it.

Crew home:

```
Come Through                 Invite
The Yaba Lot            (painted title)
9 of you, around Yaba and Lekki Phase 1
==============================(sloth)   branch on the panel's top edge
| The sloth picked Saturday           |
| Muri Okunola Park                   |  canopy-green panel
| 4 to 7pm / 29°. Dry                 |
| (A)(S)(Z)(D) 4 going                |
Coming up
Tonight | [Quick one]                 |
  21    | Suya at Glover Court        |  date rail on the wall,
        | 8pm, Glover Court suya spot |  plan rows on paper
        | (S) 1 going, 1 maybe        |
  Fri   | [Hosted] ...                |
[ + Add a plan ]                         fixed, danfo yellow
```

Plan page:

```
<  The Yaba Lot                   (WhatsApp)
[Sloth's pick]
Lazy Saturday at Muri Okunola Park
Saturday, 4 to 7pm
| Mats out, music low. Come through if you can.
[ OSM tiles with a painted pin, (c) OpenStreetMap ]
Muri Okunola Park                 Directions
Free to get in / 29°, dry
Who's going                         5 going
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~  the branch
  (You) (Ada) (Seyi) (Zainab) (Dayo)        hanging by their arms
Can't make it? No need to say anything.
Rides: your pod, leave Yaba by 3:05pm, Copy address, Bolt, inDrive
Why this spot? (a folded canopy panel, the sloth peeks over)
Bring: chips
[ Going ] [ Tell the crew (WhatsApp) ]      bottom bar after you tap
```

Text is left-aligned everywhere. Nothing is centred except the reading status and empty pages.

At 960 px and wider, a canopy-green panel with the sloth and the tagline fills the left 42 percent, and the app column sits on the right. The bottom bar moves with the column.

## The signature moment: you swing onto the branch

When you tap "I'm going", these things happen in order:

1. **The tap.** The button presses into the wall (120 ms, strong ease-out), and Android phones give a 12 ms vibration.
2. **The swing.** If the branch is off screen, the page scrolls to it first. Your face drops onto the left end of the branch from 26 px above, rotated -34 degrees, and swings to rest like a pendulum. The swing is a spring with a damping ratio of 0.4 and a response of 0.9 s, which settles in about 2.2 s. It is slow on purpose because it is the sloth's motion and it happens once per plan. The spring is turned into a CSS `linear()` easing and run with the Web Animations API, so it runs off the main thread on cheap phones.
3. **The weight.** Everyone already on the branch slides one place to the right (320 ms ease-out, using FLIP). The branch dips 6 px as your hands catch, then springs back (damping 0.4, response 0.65 s). The resting sag of the branch also grows with the number of people.
4. **The pod forms.** The ride pod card fades up 450 ms later with your leave-by time, and your face in the pod pops in from 60 percent scale with a small spring.
5. **The bar changes.** The bottom bar becomes "Going" (a pill you can tap to change your answer) and "Tell the crew", which opens WhatsApp with "I'm going to ... Come through: <link>" ready to send. WhatsApp is how plans travel in Lagos, so it is the main action. "Add to my calendar" (a one-event .ics file for Android and iPhone) sits under the page as an extra. The swap uses a 2 px blur crossfade.
6. **One nudge.** The first time on a device, a small card asks "Want a nudge if this changes?" and says exactly what is sent (the time or the weather changing, and the ride group forming). On iPhone outside an installed app, it explains Add to Home Screen instead.

The same swing plays on the one-tap page (`/c/:slug/p/:id/in`), which is where most friends meet it: they tap "I'm in" in the WhatsApp message, type a name the first time, and their face swings on without leaving the page.

With reduced motion turned on, your face fades in and nothing swings, slides or bounces.

## Gemma reads the flyer

The flyer path is the other moment people should enjoy:

1. **Add a flyer.** It is the biggest tile, in danfo yellow. Photos are shrunk on the phone before upload (1600 px on the long edge, WebP or JPEG at 0.8, stepped down until under 400 KB), and the reading screen says how much is being sent ("Sending 372 KB, shrunk from 10.6 MB to save your data"). An iPhone HEIC photo the browser cannot open gets a plain request for a screenshot.
2. **Reading.** The flyer is pinned slightly tilted while a highlighter band sweeps down it (linear, 1.6 s loop). The sloth opens one eye, and the status reads "Gemma is finding the date", then the place, then the price.
3. **The draft.** Fields settle in with a 45 ms stagger. Then the highlighter strokes across the labels of the fields Gemma was unsure about (the server's `low` list), and those inputs get a yellow border. Gemma's notes, such as "The flyer says Sat 31st with no month", sit above the form with yellow marker bullets.
4. **Posting** makes you the first person on the branch.

## Motion rules

| Token | Value | Use |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | Enters, presses, FLIP |
| `--ease-in-out` | `cubic-bezier(0.77, 0, 0.175, 1)` | Movement on screen |
| `--ease-drawer` | `cubic-bezier(0.32, 0.72, 0, 1)` | Sheets |
| `--d-press` | 120 ms | Button press |
| `--d-fast` | 180 ms | Colour changes, menus |
| `--d-med` | 260 ms | Toasts, bar swap |
| Swing spring | damping 0.4, response 0.9 s | The signature only |

- Page changes are a 220 ms opacity fade only. A transform on the page would trap the fixed bottom bar, and navigation happens often.
- Only `transform`, `opacity`, `filter` and `background-size` (the highlighter) are animated.
- Hover styles exist only under `(hover: hover) and (pointer: fine)`.
- The idle sloth sways 2.2 degrees over 7 s. It stops with reduced motion.

## The sloth

The sloth is a character, and it appears sparingly. It appears on the start screen, in the ritual panel, on "Why this spot?", while Gemma reads, on the invite and joined screens, and on empty or error pages. It never appears inside lists or on buttons. It has three moods: asleep (the default), awake (good news), and one eye open (reading). In copy, "the sloth" does the reading, guessing, picking and writing, always in the third person ("The sloth is reading the flyer", "The sloth picked Saturday"). Gemma is named once: in the line shown the first time a phone sends something to be read, and on How the sloth works (`/how`).

### Sloth avatars

Faces are sloths too. Each member gets a small painted sloth, the same one every time: a wall
colour behind it, a fur tone, and one thing it wears (a gele, shades, a cap, an agbada collar,
headphones, coral beads, a bucket hat, a hibiscus, a bow tie, a beanie, a fila or hoops). They
use the big sloth's own fur and face colours, flat fills and round strokes, and hang on the
branch, sit in ride pods and stack on plan rows. A member can add their own photo, which
only the crew sees. WhatsApp preview cards and Status cards only ever draw the sloths.

## Density

On a phone, every screen keeps only what is needed to act. Arnold opened the start screen on an iPhone on 22 Oct and found it "too much text, hard on the eyes": 196 words (215 counting the placeholders), three helper paragraphs, a second field, a three-step How it works and a dark-green paragraph about sloths, mostly in grey-green on pale green. The rules since then:

- The start screen is the title, one line, one field, one button, one line about Gemma and one line of attributions. It stays under 40 words above the fold and under 70 in all.
- An explanation sits behind a small "Why?" or "How?" tap, next to the thing it explains: Where's your crew, each idea, Why this spot, and the AI line, whose "How?" opens How the sloth works.
- A safety or privacy line is never removed. It gets shorter and moves to where it matters: "You don't need to say who you are." shows the moment a sentence has a word that says who people are, and the location note sits under "Use my rough location".
- Body text is ink (or `--ink-2` for secondary text), never grey on a coloured panel, and is 7:1 or more in both themes. `--ink-3` is only for labels and placeholders.

`node scripts/screens-density.mjs <before|after>` measures every screen on the demo data at 390 x 844 with an iPhone user agent, and saves light and dark screenshots to `docs/screens/density/`. Words are what a person sees on the whole screen, including placeholders; "above the fold" is the first 844 px. The ideas card and the Status sheet count only their own card.

Before and after the pass on 22 Oct (light theme words; contrast is the lowest ratio of any text on the screen, a disabled button included):

| Screen | Words before | Words after | Above the fold before | After | Lowest text contrast before (light / dark) | After |
|---|---|---|---|---|---|---|
| Landing | 215 | 38 | 107 | 38 | 5.1 / 5.5 | 7.3 / 8.7 |
| Crew preview | 71 | 51 | 71 | 51 | 4.6 / 5.5 | 7.5 / 7 |
| Invite | 46 | 39 | 46 | 39 | 5.4 / 5.4 | 7.4 / 7.2 |
| Where's your crew | 94 | 51 | 94 | 51 | 5.1 / 6.5 | 7.3 / 10 |
| Crew home | 143 | 143 | 72 | 69 | 5.1 / 5.7 | 7.5 / 7.1 |
| Plan page | 145 | 140 | 59 | 59 | 5.1 / 5.4 | 7.4 / 7.4 |
| Add a plan | 80 | 43 | 80 | 43 | 4.6 / 5.9 | 7.3 / 8.7 |
| One-tap I'm in (asks a name) | 32 | 32 | 32 | 32 | 5.1 / 6.5 | 8.3 / 8.1 |
| One-tap I'm in (answered) | 118 | 94 | 76 | 78 | 5.1 / 5.5 | 7.3 / 8.1 |
| Ideas card | 113 | 84 | 27 | 18 | 6 / 7.5 | 8.5 / 8.6 |
| Status sheet | 34 | 25 | 28 | 17 | 7.5 / 7.7 | 8.7 / 8.7 |
| How the sloth works | 230 | 183 | 136 | 104 | 5.2 / 8.8 | 7.3 / 10 |

The main text styles, as contrast on the page wall (and on paper), before and after:

| Text style | Light before | Light after | Dark before | Dark after |
|---|---|---|---|---|
| Body (`--ink`) | 11.5 | 11.5 | 13.6 | 13.6 |
| Secondary (`--ink-2`) on wall / paper | 6.4 / 7.5 | 8.3 / 9.7 | 9.0 / 7.7 | 10.5 / 9.0 |
| Labels and placeholders (`--ink-3`) on wall / paper | 5.1 / 6.0 | 6.4 / 7.5 | 6.5 / 5.5 | 8.2 / 7.0 |
| Fine print (`.fine`, was `--ink-3`, now `--ink-2`) | 5.1 | 8.3 | 6.5 | 10.5 |
| Links (`--lagoon`) | 5.2 | 7.3 | 8.8 | 10.0 |
| Second line on the canopy panel | 6.2 | 7.5 | 5.7 | 7.2 |
| White on the WhatsApp button | 5.4 | 7.4 | 5.4 | 7.4 |

The crew home and the plan page barely changed in words because nearly all their words are the crew's own plans, names and times. What changed there is contrast and the folded Why this spot?.

## Voice

The app speaks plainly, in the second person, like a friend in the group chat. There is no "we" and no "I". The sloth is the crew's lazy assistant, talked about in the third person. Laziness is the feature: the copy says what you no longer have to do. The full reasoning is in docs/UX-REVIEW-2.md.

- The WhatsApp message is the main interface: the plan in the first line, then "I'm in" and "Maybe", one link per answer. Nothing ever says "check the app".
- "Come through", "link up", "Who's going", "Leave Yaba by 3:05pm". Warmth comes from the nouns people already use, not from added Pidgin.
- Saying no is never required: "Can't make it? No need to say anything."
- Buttons name the action, and the next screen confirms it with the same verb: "Set up my crew", "Make the crew", "I'm in", "Post it", "Tell the crew".
- One question at the moment its answer is used: a name at the first "I'm in", the area when a ride needs it, the nudge after the first "I'm going".
- What goes to Google is said once, the first time something is sent to be read, under the button: "What you send goes to Google's Gemma. How?" The "How?" opens How the sloth works, where the detail lives. Cards never carry AI or data-flow lines.
- Errors say what failed and what to do. Empty states point to the next action.
- No em dashes, no colons joining clauses, no staged closers ("That's the whole job."), and times as "3pm", never "15:00".

## Platform rules

- The viewport uses `viewport-fit=cover`, `interactive-widget=resizes-content`, `100dvh` and `env(safe-area-inset-*)`, and the theme colour is set per colour scheme.
- Tap targets are 44 px or larger, and the main actions are 56 px.
- The tap highlight is removed, `touch-action: manipulation` is set, and button text cannot be selected by a long press.
- The PWA has a manifest, maskable icons, a share target for links, text and images (Android), shortcuts, and a hand-written service worker. The service worker caches the app shell for offline use, stashes shared flyers, and shows push notifications.
- Preact was chosen over React to save about 40 KB on cheap phones. The first load is about 56 KB over the wire (Brotli from the server: 31 KB of JavaScript, 8 KB of CSS, a 16 KB font, the page), and the mock layer loads only with `?mock=1`.
- The map is six OpenStreetMap tiles placed with CSS, with attribution and no map library.

## Critique: how this avoids the generic defaults

| Generic default | What Come Through does instead |
|---|---|
| Cream background, serif display, terracotta accent | A leaf-green painted wall, a leaning sign-painter face, and danfo yellow. All three come from Lagos streets and parks. |
| Near-black background with one acid accent | The light theme is the default, because people read it outdoors in the sun. The dark theme is canopy green, not black. |
| The SaaS card kit: identical rounded cards and soft grey shadows | Radius follows hierarchy. The ritual is a canopy slab with a branch on its edge, plan rows hang off a date rail, flyers are tilted paper, and primary buttons sit on hard painted shadows. |
| All-caps eyebrows, middle-dot meta strings, monospace labels, arrows on buttons | Labels are sentence case. Meta lines use commas ("8pm, Glover Court suya spot"). There is no monospace, and buttons have no arrows. |
| Fade-and-slide on every section | There is one orchestrated moment (the swing), one supporting moment (the highlighter), and press feedback. Everything else is still. |
| A generic illustration style | One small sloth drawn for this app, used in about six places, with three moods. |

Remaining risks to watch:

- Shrikhand at small sizes gets heavy, so it is never used below 19 px.
- The green wall could look washed out on low-quality Android screens. The paper surfaces and the ink text keep contrast high, but this needs a check on a real phone.
- The 2.2 s swing could feel slow to someone who taps "Going" on many plans. It plays only on your own tap and never blocks input, but this should be tested with the crew.
