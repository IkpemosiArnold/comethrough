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

## Amendments

- **23 Oct 2026: scored runs are pinned.** An external review pointed out that the first scored test run (the baseline) ran from the shared working tree. From now on the only way to score the test set is `node eval/scored.mjs --commit <sha> --label <label>`. It checks the commit out into a clean git worktree, runs the committed harness against it, refuses to score when anything outside eval/ differs from that commit, and writes the commit and "clean: true" into the report. The baseline is labelled in its report as a working-tree snapshot whose src is identical to 5d84a9b, except eval/. Each label is scored once. The persona file, its split and its hash are unchanged.
- **22 to 23 Oct 2026: the Gemma cap.** The cap on live Gemma calls across all sets was raised with approval from 250 to 370, then 420, then 520, then 650 for test-2 (Gemma on the Gemini API is free; calls stay 4.5 s apart). The harness enforces the cap given with `--llm-cap`, up to a ceiling fixed in `eval/run.mjs`. That ceiling was 520 until commit 803b039 and has been 650 since. The ledger in eval/world/2026-10-24 records every raise (`capChanges`). The test-2 recording ran under 650 and left the ledger at 520 live calls.
- **23 Oct 2026: one test persona seen by the fix agent.** While reading files, the agent fixing the three bug classes saw one persona of the original test split (lag-alte-yaba), and reports that it did not tune on it. The original test set was already spent (scored twice) by then. Test-2 was never exposed: only this harness reads it, and only to record and score.

## test-2: a second held-out set (frozen 23 Oct 2026)

| File | SHA-256 |
|---|---|
| `eval/personas/test2.json` | `9c85e913c269b4415fc650cbd83a2654a98f3ad3c38d3f0ef3f1afe69a975cde` |

Frozen on Friday 23 October 2026, before the fix commit it will measure existed. Committed and pushed before that commit landed; the git history shows the order. `node eval/personas/build-test2.mjs --check` confirms the file is what the builder makes.

**Why a second set.** The original test set had been scored twice: the working-tree baseline, and the pinned run of release d1770d0. The bugs it found were then being fixed, so it is spent for claims about those fixes.

**How it was made.** The procedure is written in full at the top of `eval/personas/build-test2.mjs`:
- **The frame.** The 30 slots keep the original test crews' cities, languages, group sizes, sensitive needs and constraint types. That gives Lagos 18; Accra, Nairobi, London, Bengaluru and São Paulo 2 each; Abuja and Berlin 1 each; 5 Pidgin, 4 mixed and 21 plain; one LGBTQ+ crew and one religious-minority crew.
- **The draw** (seed 20261023). Each slot gets a new interest (never its original one), and a budget and an age band with v2's frequencies. It gets new areas from the city's neighbourhoods, drawn with a fixed chance of stating a time, of saying free only, and of being planned from a browser abroad.
- **The sentences.** I wrote each one by hand for its drawn tuple. Every sentence shares under 45% of its words with each of the 60 v2 sentences; the highest is 42%, a new crew with a wheelchair user against v2's.
- **The hard checks** are derived from the tuple by the same rules as v2.

**What was known when it was frozen,** so a reader can judge its independence. An agent was about to fix three bug classes. Each was found on the original test set or its release run, and is to be checked on dev only:
1. Taste grounding that leaves a crew with no kinds of place should fall back to the kinds its needs imply.
2. A stated clock time ("Saturday mornings around 7am") should become the rhythm's window.
3. A crew's areas should be looked up in the crew's own country, whatever the organiser's browser zone.

The set was not designed to target these classes, and not designed to avoid them. The draw put crews into some of them: one crew states a morning time (07:00 to 11:00), one is planned from a browser abroad (Houston), three are free only, and several state a time. These are where the procedure put them; no crew was added, removed or reworded after the draw.

**The rules.**
- Each labelled run of test-2 is scored once.
- The first is the release d1770d0 (`test2-d1770d0`), recorded and scored before the fix commit. The second is the fix commit, when it lands.
- Both are pinned (`node eval/scored.mjs --commit <sha> --set test2 --label test2-<commit>`).
- No prompt or code change may be made because of test-2 results without a new freeze, said so in the post.
