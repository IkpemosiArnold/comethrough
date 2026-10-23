# Deploying Come Through

This takes about 30 minutes. You need four things: the GitHub repository, a MongoDB Atlas
account, a Render account and a Gemini API key (aistudio.google.com/apikey). Nothing here
costs money: Atlas M0, Render's free web service and static site, and the free Gemini API tier.

The API is one Node web service. A static site in front of it serves the app's pages and
forwards `/api`, `/cal` and `/basic` to it, so the pages open at once even while the free
web service sleeps (step 5b). A GitHub Actions schedule calls its heartbeat about every 3
hours, and wakes it for plans (step 4).

## 0. Before you start

Have these values ready. Your local `.env` already holds most of them (never commit it, and
never paste it anywhere public):

| Variable | Where it comes from |
|---|---|
| `GEMINI_API_KEY` | aistudio.google.com/apikey (already in `.env`) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | already in `.env`; or `npx web-push generate-vapid-keys` |
| `VAPID_SUBJECT` | `mailto:` and an inbox you read, for example `mailto:you@example.com` |
| `TICK_SECRET` | already in `.env`; or `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `MONGODB_URI` | step 1 |
| `PUBLIC_URL` | step 2 (the Render address, later your domain) |

Keep the same VAPID keys for the life of the app. If they change, every phone that turned
on nudges has to turn them on again.

Run the checks locally first:

```sh
npm ci && npm test && npm run typecheck
npm --prefix web ci && npm --prefix web run build
```

## 1. MongoDB Atlas (Frankfurt)

1. Create a project, then a cluster: **M0 (free)**, provider **AWS**, region
   **Frankfurt (eu-central-1)**.
2. **Database Access**: add a database user with a long generated password and the role
   "Read and write to any database".
3. **Network Access**: add `0.0.0.0/0`. Render's free services have no fixed outgoing
   addresses, so a narrower list would block the app. The user and password protect the
   data.
4. **Connect, Drivers**: copy the `mongodb+srv://...` string and put the password in it.
   The database name defaults to `comethrough` (set `MONGODB_DB` to change it).

Optional check from your machine:

```sh
MONGODB_URI='mongodb+srv://...' npm run dev
curl -s localhost:3000/healthz    # "store":"mongo"
```

## 2. Render (Frankfurt)

1. Push the repository to GitHub (it must be on the default branch).
2. In Render: **New, Blueprint**, pick the repository. Render reads `render.yaml`: one
   free Node web service named `comethrough` in Frankfurt.
3. Fill in the values Render asks for (they are `sync: false` in the blueprint):
   - `PUBLIC_URL`: `https://comethrough.onrender.com` (use the address Render shows for the
     service if that name is taken; no trailing slash)
   - `GEMINI_API_KEY`, `MONGODB_URI`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
     `VAPID_SUBJECT`, `TICK_SECRET`
   - `ALLOWED_ORIGINS`: leave empty. The app and the API share one origin, so no other
     origin needs browser access.
   - `TRUST_PROXY_HOPS` is set to `3` by the blueprint: Render sits behind Cloudflare, so
     the real client is the 3rd `X-Forwarded-For` entry from the right (measured on Render).
4. Apply. The build runs `npm ci --omit=dev`, then installs and builds `web/`. The first
   deploy takes a few minutes.
5. If the service address differs from what you put in `PUBLIC_URL`, fix `PUBLIC_URL` and
   deploy again. Invite links, calendar links and push links are built from it.

## 3. Check the deploy

```sh
export PUBLIC_URL=https://comethrough.onrender.com
curl -s $PUBLIC_URL/healthz
# {"ok":true,"store":"mongo","ai":true,"push":true,"you":"<your address>"}

curl -s -H 'X-Forwarded-For: 1.2.3.4' $PUBLIC_URL/healthz
# "you" must still be your own address: not 1.2.3.4, not a 10.x, Render or Cloudflare address
```

If `you` is wrong, the rate limits key on the wrong address. Change `TRUST_PROXY_HOPS`
(try 2 or 4), deploy, and check again.

Then the whole flow against the live service (it makes a test crew, and spends about six
Gemma calls and one heartbeat):

```sh
TICK_SECRET=... node scripts/e2e.mjs $PUBLIC_URL https://www.eventbrite.com/e/<a public event>
node scripts/push-check.mjs $PUBLIC_URL     # needs Google Chrome on this machine
```

Both print a JSON report and exit 0 when everything passed.

## 4. The heartbeat (GitHub Actions)

1. Repository **Settings, Secrets and variables, Actions**:
   - secret `TICK_SECRET`: the same value as on Render
   - variable `COMETHROUGH_URL`: the same value as `PUBLIC_URL`
   - optional variable `COMETHROUGH_API_URL`: `https://comethrough.onrender.com`, so the
     heartbeat talks to the web service directly instead of through the static site
2. **Actions, tick, Run workflow**. The log ends with a JSON line like
   `{"rituals":0,"weatherChecked":2,"rainAlerts":0,"pushes":0,"expired":0,"errors":0,"wake":[...]}`.
3. It then runs by itself every 30 minutes (minutes 7 and 37). Most runs do nothing and
   never touch the server. About every 3 hours a run does the full tick and keeps the
   tick's `wake` list (the coming plans' windows, from 2 hours before a start to 1 hour
   after) in the Actions cache. A run that finds a window open, or opening within 30
   minutes, asks `/healthz`, which wakes the server; the server then keeps itself awake to
   the window's end (see "Staying awake"). GitHub runs schedules late or drops them (on 21
   to 23 Oct the 3-hourly tick ran every 4 to 7 hours), so a window can be missed; a friend
   opening the link then wakes the server as before. GitHub pauses schedules after 60 days
   without activity in the repository; any commit wakes them.

The `ci` workflow runs the tests, the type check and the web build on every push.

## 5. Your own domain

The live address is **comethrough.ikpemosi.work** (a subdomain of the owner's domain; no new domain is registered).

1. Render, the service, **Settings, Custom Domains**: add `comethrough.ikpemosi.work`.
2. At the DNS host for ikpemosi.work (Namecheap, Advanced DNS): a **CNAME**, host `comethrough`, value `<service>.onrender.com` (the address Render shows). Touch no other record.
3. When Render shows the certificate as issued, set `PUBLIC_URL=https://comethrough.ikpemosi.work` (and `WEB_URL` if set)
   on Render and `COMETHROUGH_URL` in GitHub, then deploy again.
4. Run the checks in step 3 against the new address.

Links made before the change keep pointing at the old address, which still works.

## 5b. The static site in front (the pages never sleep)

The free web service sleeps after 15 minutes without traffic, and Render answers a browser
that opens it then with its own "Application loading" page for about a minute. Friends who
tapped a link in WhatsApp saw only that. So the pages now come from a free Render static
site, `comethrough-web` (static sites never sleep and use no instance hours), and the app
shows the sloth waking up while the API catches up (web/src/lib/wake.js).

What was set up (23 Oct 2026, through the Render API; render.yaml describes it):

- **Build**: `npm --prefix web ci --include=dev && npm --prefix web run build`, publish
  `web/dist`, from `main`, rebuilt only when `web/**` or `src/core/**` changes.
- **Rewrites, in order**: `/api/*`, `/cal/*`, `/healthz` and `/basic/*` to
  `https://comethrough.onrender.com/...`, then `/*` to `/index.html` (the app's own
  routes). A file that exists (`/assets/...`, `/sw.js`, `/og-card.png`) is served as it is.
- **Headers**: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, a year's
  cache for `/assets/*`, `no-cache` for `/sw.js` and the manifest.

What the rewrite proxy does, measured against `comethrough-web.onrender.com` on 23 Oct:

- POST and PATCH JSON bodies, multipart flyer uploads, a binary PUT (a photo), bearer tokens,
  `?t=` tokens, statuses 200, 201, 204, 304, 400, 401, 403, 404, 405, 413 and 422, content
  types and bodies all pass through byte for byte (`scripts/e2e.mjs` passes through it).
  There are no cookies. It adds about 0.3 to 0.5 s per request (it goes out through
  Cloudflare in Seattle) and held a 28.6 s Gemma call without trouble.
- **While the web service sleeps**, a `fetch()` (Accept `*/*`) is held until the server is
  up and then answered normally: GET, PATCH with its body, and a calendar app's feed request
  all came back 200 after the 24 s cold start. A request that asks for HTML gets Render's
  loading page (503, `x-render-routing: hibernate-pending-wake`), so the app treats any
  answer that is not its own JSON as "still waking", waits and asks again.
- **The client address**: the proxy adds `client, cloudflare-edge, cloudflare-edge` to
  `X-Forwarded-For` and connects from Render's 74.220.48.0/20, so with
  `TRUST_PROXY_HOPS=3` the server would see the proxy's address. It now looks 3 entries
  further left when the trusted entry is in that block (`FRONT_PROXY_CIDRS`,
  `FRONT_PROXY_HOPS`; src/server/http.mjs). Check both addresses after a deploy:

  ```sh
  curl -s -H 'X-Forwarded-For: 1.2.3.4' https://comethrough-web.onrender.com/healthz
  curl -s -H 'X-Forwarded-For: 1.2.3.4' https://comethrough.onrender.com/healthz
  # "you" must be your own address both times
  ```

Link previews: the static site cannot draw a card per crew or plan, so every link it serves
shows one generic card (`web/public/og-card.png`, drawn by `node scripts/og-card.mjs` with
the server's own card code). The web service still draws the per-link cards for any link
that points at it.

Opera Mini and phones without JavaScript: the plain pages now live under `/basic/c/...`
(forwarded to the web service). The static page sends Opera Mini there from a tiny script
in `index.html`, and its `<noscript>` link, `/basic/here`, finds the page it was on from the
Referer.

**Moving the domain** (Arnold changes DNS; nothing else on ikpemosi.work is touched):

1. Remove `comethrough.ikpemosi.work` from the web service (Render, comethrough,
   Settings, Custom Domains), then add it to `comethrough-web`.
2. Namecheap, ikpemosi.work, Advanced DNS: change the one record for the host
   `comethrough` to **CNAME**, host `comethrough`, value `comethrough-web.onrender.com`.
3. Wait for Render to show the certificate as issued, then run the checks in step 3 and
   the two `curl` lines above against `https://comethrough.ikpemosi.work`.

`PUBLIC_URL` stays `https://comethrough.ikpemosi.work`: calendar, invite and push links keep
their address, and the static site forwards `/cal` and `/api` to the web service.

## 5c. Staying awake (a capped window)

Render's free instance hours are 750 a month per workspace, shared by every free web
service in it; when they run out, Render suspends all of them until the next month. So
Come Through never stays awake around the clock. It keeps itself awake only while it is
useful (src/core/warm.mjs, src/app/warm.mjs):

- for 3 hours after a crew is made, someone joins, a plan is made, edited or answered, or
  "Tell the crew" is tapped (a beacon to `POST /api/crews/:slug/shared`);
- from 2 hours before to 1 hour after each coming plan's start (the heartbeat wakes it).

While one of these holds, the server asks its own public address
(`RENDER_EXTERNAL_URL/healthz`) every 10 to 12 minutes, which reaches it through Render's
front door like any visitor. It counts its warm hours per calendar month in MongoDB
(`meta/warm`) and stops at `WARM_CAP_HOURS` (150 by default; 0 turns it off). The logs show
`warm_start`, `warm_ping`, `warm_stop` (with the stretch's hours and the month's total) and
`warm_cap`; a self-ping's request line carries `"self":true`.

What it costs, roughly: the heartbeat's wake-ups (about 4 to 8 a day, each about 16 minutes
awake) are 30 to 65 hours a month; the warm window is at most 150. With the other free
services in the workspace mostly asleep, that leaves room under 750.

## 6. Checks only a real phone can do

The server side of each is tested (see docs/NOTES.md). These need a phone in Lagos:

- **Push on Android Chrome**: open your member link, tap "Yes, nudge me", allow. Have
  someone else post a plan: the nudge arrives, and tapping it opens the plan.
- **Push on iPhone** (iOS 16.4 or later): Share, Add to Home Screen, open Come Through from
  the Home Screen, tap "Yes, nudge me". Same test.
- **Rides**: "Copy address", then "Bolt" or "inDrive": on Android the button opens the
  app's Play Store page and on iPhone its App Store page, each showing "Open" when the app is
  installed; the copied address pastes into "Where to?". No ride app in Lagos documents a
  link that fills in the drop-off (docs/LOCAL-FACTS.md, "Rides").
- **Add to my calendar**: the `.ics` download opens the calendar app on Android and iPhone.
- **Calendar subscription**: the webcal link subscribes on iPhone; on Android it works only
  from calendar.google.com on a computer.
- **Share a flyer**: install the app on Android (Add to Home screen), share a flyer from the
  gallery or WhatsApp to Come Through: it opens Add a plan with the picture.
- **A real flyer photo**, including an iPhone HEIC photo, read by Gemma.
- **Voice**: the "Say it" button on Android Chrome with a Nigerian English sentence.

**Friday phone check: the growth features** (22 Oct; the sources are in docs/LOCAL-FACTS.md,
"Sharing a Status card"). On an Android phone with Chrome and Opera, and an iPhone with
Safari, each with WhatsApp, Instagram and Snapchat installed:

- **Link previews**: paste a plan link (the "I'm in" one too) and a crew invite into a
  WhatsApp chat, Facebook Messenger, X, iMessage and Slack. Each shows the plan's title,
  day, time and place and the sloths going (never a photo), with the site's address. A
  discreet crew's link shows "A plan with your crew" and nothing else. Nobody is marked
  going by the preview. WhatsApp caches a link's preview: test with a fresh plan.
- **Status card, Share**: on the crew page the day after a plan with 2 or more going, "Make
  the card", pick 3 photos, Share. Note for each phone and browser: does the sheet open; does
  WhatsApp offer "My status" (reported for Android beta 2.25.20.3 and iOS 25.22.83, not
  confirmed on stable); does Instagram appear, and with Stories or only Feed and Chats; does
  Snapchat appear; is there "Save image" or "Save to Photos"; how is the 1080x1920 card
  cropped in each.
- **Status card, Save**: where sharing files is not supported (Firefox), "Save the card"
  downloads a JPEG that the gallery shows.
- **Add your face**: "Add your face" opens the front camera on Android and iPhone
  (`capture="user"`); "Pick a photo" opens the gallery; an iPhone HEIC photo opens in Safari.
  The photo shows on the branch for the crew; "Remove my photo" brings the sloth back.
- **Rename**: tap the crew's name, type with the phone's keyboard (emoji too), tap Done:
  the name saves and Undo works; the next WhatsApp invite uses the new name.

## 7. Running it

- **What the sloth leaves empty**: every Gemma call logs a `gemma_fields` line (the task,
  the output fields that came back empty, the attempts, whether a retry or another model ran)
  and every read crew or plan a `gemma_read` line (the fields the app kept empty, the fields
  code dropped, and `fallback` when code made a best guess). Field names only, never what
  anyone wrote. For the stored crews and plans, `MONGODB_URI=... node scripts/live-report.mjs`
  prints the empty fields per crew and plan, with counts, read only, with no names, text or
  tokens.
- **Logs**: Render, the service, Logs. One JSON line per event; query strings are never
  logged because they carry tokens.
- **Roll back**: Render, the service, Events, pick the last good deploy, Rollback.
- **Rotate a secret**: change it on Render (and in GitHub for `TICK_SECRET`), deploy.
  Rotating the VAPID keys turns nudges off on every phone until people turn them on again.
- **Limits**: the free service sleeps after 15 minutes without traffic and takes up to a
  minute to wake (24 to 33 s measured on 23 Oct); the pages do not wait for it (step 5b),
  and it stays awake around activity and plans up to a monthly cap (step 5c). Gemma calls are limited to 8 a minute and 80 a day per visitor, and 20 a
  minute in all, below the free tier's limit.
