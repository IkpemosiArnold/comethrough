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

Secondary text is `--ink-2` (`#3D574E`) and tertiary text is `--ink-3` (`#4F655B`). The WhatsApp button uses `#0E7A3F`, which is darker than WhatsApp's brand green so that white text passes AA.

Contrast (WCAG 2.x ratio, measured): ink on wall is 11.5, `--ink-2` on wall is 6.4, `--ink-3` on wall is 5.1, ink on danfo is 8.7, text on canopy is 8.9, zobo on paper is 6.9, lagoon on paper is 6.0, and white on the WhatsApp green is 5.4. Every avatar fill is paired with a text colour above 4.5. Dark mode redefines the same tokens (`#0F2620` wall, `#E8F0DA` ink) and keeps danfo yellow as the action colour, and every dark pair checked is above 4.5.

## Type

- **Display: Shrikhand** (one weight, Latin subset, 16 KB, self-hosted). Shrikhand is a fat, leaning display face, and it reads like the lettering on a Lagos shop sign. It is used for screen titles, crew names, plan titles on the plan page, the date numbers on the crew home, leave-by times and the tile titles. Large display text gets the "painted" treatment, which is a hard yellow offset shadow (`0.05em 0.06em 0 var(--danfo)`) like a sign-writer's drop shadow.
- **Body: the system font** (Roboto on Android, SF on iPhone). It costs nothing to load, it is tuned for each phone, and it keeps the custom face for the moments that carry personality.
- **Scale** (rem, 16 px root): 13, 14, 16, 19, 24, 32, 44, and a fluid `clamp(2.5rem, 11vw, 3.5rem)` for the biggest titles. Display tracking is -0.01em to -0.02em, and body tracking is 0. Display leading is 1.04, and body leading is 1.5.
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
Why this place (canopy panel, the sloth peeks over)
Bring: chips
[ Going ] [ Add to my calendar ]            bottom bar after you tap
```

Text is left-aligned everywhere. Nothing is centred except the reading status and empty pages.

At 960 px and wider, a canopy-green panel with the sloth and the tagline fills the left 42 percent, and the app column sits on the right. The bottom bar moves with the column.

## The signature moment: you swing onto the branch

When you tap "I'm going", these things happen in order:

1. **The tap.** The button presses into the wall (120 ms, strong ease-out), and Android phones give a 12 ms vibration.
2. **The swing.** If the branch is off screen, the page scrolls to it first. Your face drops onto the left end of the branch from 26 px above, rotated -34 degrees, and swings to rest like a pendulum. The swing is a spring with a damping ratio of 0.4 and a response of 0.9 s, which settles in about 2.2 s. It is slow on purpose because it is the sloth's motion and it happens once per plan. The spring is turned into a CSS `linear()` easing and run with the Web Animations API, so it runs off the main thread on cheap phones.
3. **The weight.** Everyone already on the branch slides one place to the right (320 ms ease-out, using FLIP). The branch dips 6 px as your hands catch, then springs back (damping 0.4, response 0.65 s). The resting sag of the branch also grows with the number of people.
4. **The pod forms.** The ride pod card fades up 450 ms later with your leave-by time, and your face in the pod pops in from 60 percent scale with a small spring.
5. **The bar changes.** The bottom bar becomes "Going" (a pill you can tap to change your answer) and "Add to my calendar", which downloads a one-event .ics file that works on Android and iPhone. The swap uses a 2 px blur crossfade.
6. **One nudge.** The first time on a device, a small card asks "Get a nudge if this plan changes?". On iPhone outside an installed app, it explains Add to Home Screen instead.

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

The sloth is a character, and it appears sparingly. It appears on the start screen, in the ritual panel, on "Why this place", while Gemma reads, on the invite and joined screens, and on empty or error pages. It never appears inside lists or on buttons. It has three moods: asleep (the default), awake (good news), and one eye open (reading). In copy, "the sloth" is the one who plans rituals ("The sloth is planning Saturday..."). Gemma is named as the model that reads things, because the challenge is about open models and users should know what reads their data.

## Voice

The copy follows the core of Arnold's copywriting manual. It names the person's situation, says exactly what happens next, and makes the button say the action. The tone is plain Nigerian English with warmth and without caricature.

- "Come through", "Who's going", "Leave Yaba by 3:05pm", "Drop this link in the group chat".
- Saying no is never required: "Can't make it? No need to say anything."
- Buttons name the action: "Set up my crew", "Join the crew", "Post it to the crew", "Add to my calendar", "Copy address".
- Privacy is stated where data leaves the phone: "To read your sentence we send it to Gemma, Google's open model. That's all that goes to Google."
- Errors say what failed and what to do: "Couldn't reach Come Through. Check your data and try again."
- Empty states point to the next action: "Bring the crew in first" with a WhatsApp invite button.
- There are no em dashes, no exclamation marks except in the WhatsApp invite text people send to friends, and no slang added to sound local.

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
