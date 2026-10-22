# Deploying Come Through

This takes about 30 minutes. You need four things: the GitHub repository, a MongoDB Atlas
account, a Render account and a Gemini API key (aistudio.google.com/apikey). Nothing here
costs money: Atlas M0, Render's free web service and the free Gemini API tier.

The app is one Node web service. It serves the API and the built web app from the same
origin. A GitHub Actions schedule calls its heartbeat every 3 hours.

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
2. **Actions, tick, Run workflow**. The log ends with a JSON line like
   `{"rituals":0,"weatherChecked":2,"rainAlerts":0,"pushes":0,"expired":0,"errors":0}`.
3. It then runs every 3 hours by itself (minute 17). GitHub pauses schedules after 60 days
   without activity in the repository; any commit wakes them.

The `ci` workflow runs the tests, the type check and the web build on every push.

## 5. Your own domain (optional)

1. Register the domain (comethrough.tech was free on 21 Oct 2026).
2. Render, the service, **Settings, Custom Domains**: add `comethrough.tech` and
   `www.comethrough.tech`, and create the DNS records Render shows at your registrar.
3. When Render shows the certificate as issued, set `PUBLIC_URL=https://comethrough.tech`
   on Render and `COMETHROUGH_URL` in GitHub, then deploy again.
4. Run the checks in step 3 against the new address.

Links made before the change keep pointing at the old address, which still works.

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
  day, time and place and the sloths going (never a photo), with "comethrough.tech". A
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

- **Logs**: Render, the service, Logs. One JSON line per event; query strings are never
  logged because they carry tokens.
- **Roll back**: Render, the service, Events, pick the last good deploy, Rollback.
- **Rotate a secret**: change it on Render (and in GitHub for `TICK_SECRET`), deploy.
  Rotating the VAPID keys turns nudges off on every phone until people turn them on again.
- **Limits**: the free service sleeps after 15 minutes without traffic and takes up to a
  minute to wake. Gemma calls are limited to 8 a minute and 80 a day per visitor, and 20 a
  minute in all, below the free tier's limit.
