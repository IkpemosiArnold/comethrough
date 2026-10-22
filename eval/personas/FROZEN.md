# Persona eval v2: frozen sets

Frozen on Thursday 22 October 2026, before any run of the v2 harness.

| File | SHA-256 |
|---|---|
| `eval/personas/v2.json` | `6a11f763db089ff8b5811d6066a0e8bf0a7e9f232aa984cc00fbf082a3e31804` |

`v2.json` is built by `node eval/personas/build-v2.mjs` (fixed seed 20261022).
`node eval/personas/build-v2.mjs --check` confirms the file is what the builder makes, and
`shasum -a 256 eval/personas/v2.json` confirms the hash above. The harness checks the hash
before every run and refuses to run on a file that does not match.

## What is in it

60 crews built from explicit dimensions: budget (broke, cheap, mid, comfortable), age band
(teens with a parent, students, 20s, 30s, 40s and over, retirees), group size, interests
(alte, Afrobeats nightlife, gospel, football watch parties, gamers, foodies, book club, run
club, art, tech meetups, owambe, chess, families), constraints (no alcohol for church,
mosque, faith or sober crews; kids; a wheelchair user; night-shift workers; women only),
sensitive needs (three LGBTQ+ crews who need discretion, two religious-minority crews),
language (Nigerian Pidgin, mixed English, plain English), Lagos geography (Ikorodu, Ajah,
Ikeja, Surulere, Festac, VI, Lekki, Yaba, and crews across the lagoon) and other cities
(Abuja, Accra, Nairobi, London, Berlin, Bengaluru, São Paulo, and Totnes as the small town).

Each crew has its setup sentence, its areas with where they really are, a deterministic
taste proxy (OpenStreetMap place kinds and event keywords for its interests) and its hard
constraints as machine checks (eval/checks.mjs). The split is stratified over every
dimension: dev has 30 crews, test has 30.

## The rules

1. **The test set is run once, after the feature freeze, for the reported numbers.** The
   scored run is `node eval/run.mjs --set test --replay --scored`. The harness writes a
   marker when it has run, and a second scored test run is refused unless it is given a
   reason, which is printed at the top of `eval/results/v2-test.md`.
2. **No prompt or code change may be made because of test results** without re-freezing
   (a new persona file or a new split, a new hash here) and saying so in the post.
3. **Dev is for finding problems.** Its results may drive fixes before the freeze.
4. **Nothing in `v2.json` changes after this commit.** A fix to a persona means a v3.
5. **The world is recorded once** (eval/world/2026-10-24): every Photon, Nominatim,
   Overpass, OSRM, Open-Meteo, Wikidata and RSS answer the app asks for is kept, keyed by
   the request, and a replay fails on any request that was not recorded. The target is
   Saturday 24 October 2026 for every crew, and the app's clock is fixed at
   2026-10-22T11:00:00Z, so the forecast is whatever was recorded.
6. **Recording the test set's world is blind.** On 22 Oct the test crews go through the app
   once in record mode so that their map, route and forecast requests are kept on the same
   day as dev's. That pass uses Gemma only to read the setup sentence (the only answer that
   decides what is asked of the map); the explanation, invite and ranking are not asked
   for, no metric is computed, nothing is written but the world, and nobody reads its
   output. After the freeze, a fill-only record pass adds whatever the frozen code asks for
   that was not recorded (the report counts those requests and their dates), and then the
   scored replay runs.
7. **Gemma's answers are a separate cache, keyed by the prompt's hash**, so a changed prompt
   is asked again against the same frozen world. Live Gemma calls across both sets are
   capped at 250 (a ledger in the world folder counts them).
