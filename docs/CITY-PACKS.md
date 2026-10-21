# City packs: add your city

Come Through works in any city. It was built for a crew in Lagos, and Lagos is where it
knows the most: the spots people actually go to, the ride apps that run there, how bad the
traffic gets and when people go out. That knowledge lives in a **city pack**. A city without
a pack still works, through the default pack, which makes no local claims at all.

This guide is for adding a pack for your city.

## How it fits together

```
src/core/          the global core: pure functions, no city in them (a test checks)
src/packs/
  index.mjs        regions, PACKS (the list), packFor(region), regionOf(crew)
  default.mjs      any city with no pack
  lagos/
    index.mjs      the Lagos pack: data plus small functions
    geo.mjs        the lagoon, its bridges, the traffic bands
    rides.mjs      Bolt, inDrive, LagRide, each with dated sources
data/lagos-spots.json, data/spot-entry-fees.json   the Lagos spots and their fees
```

Every crew has a **region**, worked out once from its own areas when they are first put on
the map: `{ center, countryCode, city, timezone, tzSource }`. The country and city come from
OpenStreetMap (Photon, then Nominatim at city level); the timezone comes from Open-Meteo,
whose `timezone=auto` answers with the IANA zone of a point; `tzSource` records which
("open-meteo", or "browser" when only the visitor's own zone was known). Crews from before
regions existed are all in Lagos and get the Lagos region.

`packFor(region)` returns the first pack in `PACKS` whose `matches(region)` is true, else
the default. The app layer (`src/app/service.mjs`) passes the pack's parts into the core as
parameters. The core never imports a pack.

## What a pack contains

A pack is an object with these fields (the type is `CityPack` in `src/packs/index.mjs`):

| Field | What it is | Lagos | Default |
|---|---|---|---|
| `id`, `name` | identifiers | `"lagos"`, `"Lagos"` | `"default"`, `"Anywhere"` |
| `matches(region)` | is this crew in your city? | Nigeria, inside the metro box | always |
| `travel` | the traffic model (`TravelModel` in `src/core/geo.mjs`) | bands by hour and day, the lagoon | OSRM's driving time, no bands |
| `social` | when people go out (`SocialHours`) | outdoor weekends 11:00 to 18:30 | weekends 11:00 to 19:00, weekdays 17:30 to 21:00 |
| `rides` | verified ride apps (`RideProvider[]`) | Bolt, inDrive, LagRide | none: "Get directions" instead |
| `curated`, `data` | a curated spots file and its entry fees | `data/lagos-spots.json` | none |
| `wikidataSpots` | also ask Wikidata for parks and beaches nearby | no (the curated list has them) | yes |
| `geocode(region)` | where to look things up | Lagos bias, Nigeria only, ", Lagos" added | the crew's centre, no city added |
| `local(region)` | what the prompts and readers may know (`Local` in `src/core/tasks.mjs`) | Pidgin hints, "VI", naira | the city and country names |
| `zoneNames` | short zone names for calendar files | `{ "Africa/Lagos": "WAT" }` | none |
| `addressNoise(region)` | address parts that are never a neighbourhood | Lagos, Lagos State, LA, Nigeria, NG | the city, country and code |
| `ui` | examples for the web app | "Yaba, Lekki Phase 1, Ikeja..." | "Your neighbourhood" |

Start by copying `src/packs/default.mjs`, then add what you can source. Anything you leave
as the default keeps the default's honest behaviour.

## The rule: a source and a date for every local claim

This rule exists because the first build showed a "Book Uber" button weeks after Uber left
Nigeria. The research behind that button checked how Uber's links work, and never asked
whether Uber still runs in Lagos. So:

- a local claim gets a source (a URL and the date you checked it) or a live test you ran;
- if it cannot be checked, leave it out, or label it plainly as an assumption;
- write each source in your pack's comments and in a section of `docs/LOCAL-FACTS.md`.

### Spots

A spot is a place a crew would meet: a park, a beach, a garden, a waterfront, a square.

```json
{ "name": "Muri Okunola Park", "kind": "park", "area": "Victoria Island", "lat": 6.43782, "lon": 3.425083,
  "osm": { "type": "way", "id": 224073907, "tags": { "name": "Muri Okunola Park", "leisure": "park" } },
  "source": { "service": "photon", "query": "Muri Okunola Park, Victoria Island", "url": "https://photon.komoot.io/api/?q=...", "checkedAt": "2026-10-21" },
  "verifiedAt": "2026-10-21" }
```

A spot from Wikidata has `"osm": null` and a source like
`{ "service": "wikidata", "qid": "Q25044062", "url": "https://www.wikidata.org/wiki/Q25044062", "licence": "CC0", "checkedAt": "2026-10-21" }`.
`aliases` (other names people write) is optional.

- Coordinates come from OpenStreetMap or Wikidata, never typed in by hand. The Lagos list
  was built by `scripts/build-spots.mjs` (OpenStreetMap) and `scripts/add-wikidata-spots.mjs`
  (Wikidata, CC0), which record the query, the item and the date. Adapt them for your city.
- Check each coordinate falls in your city and near where the place is known to be.
- A place with a roof can be marked `"covered": true`: the sloth offers it only when rain
  blocks every outdoor window.
- Leave out places that closed (Lagos's Bar Beach is described in the past tense) and
  places with no open coordinates (map them in OpenStreetMap instead; it helps everyone).

### Entry fees

`data/spot-entry-fees.json` holds `{ spot, free, note, source }`. The app never says "free"
without a source: an entry with no `source.url` and `source.says` is dropped, and the UI says
"Entry: check at the gate". Sources can be the venue's own page, a dated news report or an
OpenStreetMap `fee` tag.

### Ride providers

Each provider is a `RideProvider` (`src/core/rides.mjs`):

```js
{
  id: "bolt", name: "Bolt", blurb: "",
  links: { android: "https://play.google.com/store/apps/details?id=...", ios: "https://apps.apple.com/...", web: "https://..." },
  dropoff: null,
  sources: [{ url: "https://...", says: "what the source says, with its date" }],
  checkedAt: "2026-10-21",
}
```

- **Does it run in your city today?** Cite a dated source: the provider's own city page,
  a recent news report, a regulator. A live store page proves nothing (Uber's Play listing
  still answered after it left Nigeria).
- **Does it take a destination from a link?** Only claim it when the provider documents
  it (an app-links file that covers the path, or developer docs). Until then `dropoff` stays
  `null`, the button opens the app or its store page, and "Copy address" does the rest.
- No fares unless the provider publishes them.
- Put providers in the order people in your city use them.
- With no providers at all, the ride card shows "Get directions" (the phone's maps app)
  and "Copy address", and names no app. That is the right answer for a city where you have
  not checked.

### Traffic notes

The default model uses OSRM's driving time, which assumes empty roads, and says so. If you
know your city's traffic, a banded model is better. Copy `LAGOS_TRAVEL` in
`src/packs/lagos/geo.mjs`:

- `speedKmh` per band (door to door, on the road distance), and `band(ms, tz)` to pick the
  band for an instant (weekday rush hours, Saturday afternoon, night);
- `crossing`, if your city has water that only a few bridges cross: a guess from the two
  ends (`crosses(a, b)`), the bridge names as OSRM spells them (`bridges`), and a penalty
  per band. A crossing is named only when the road route actually takes one of the bridges;
- write every number down as an assumption in `docs/LOCAL-FACTS.md`, with how you got it
  (Lagos's came from local experience and were checked against OSRM routes), so it can be
  argued with.

### Social hours

When do people in your city actually meet? Lagos ends outdoor weekends at 18:30 because
that is when it gets dark. Cite sunset times (Open-Meteo's archive has them) or a source on
when people go out.

### Language and money

`local(region)` returns a `Local` (`src/core/tasks.mjs`). Each prompt string carries its own
leading space. Use it for: the city and country (`inCity`, `inCityCountry`), how people
write (Lagos: Nigerian Pidgin, mixed with Yoruba and English), short names people use for
areas (`areaFull` and `areaShort`: "VI" is Victoria Island), the local currency, a repair
for a currency sign a model misreads (`fixPrice`), and whether dates are month first.
Language hints must be things people really write; ask people from the city.

## Checklist

1. `src/packs/<city>/index.mjs`, exported and added to `PACKS` in `src/packs/index.mjs`.
2. Every claim sourced and dated in the pack and in `docs/LOCAL-FACTS.md`.
3. Tests in `test/packs.test.mjs` (or a `test/<city>.test.mjs`): `packFor` picks your pack
   for a crew in your city and not for one outside; your traffic model's numbers; your ride
   list is sourced and has no drop-off claims.
4. `npm test`, `npm run typecheck` and `npm --prefix web run build` pass. The core must still
   name no city (`test/architecture.test.mjs`).
5. A live check: `node scripts/cities-check.mjs <city>` after adding your city to the list in
   that script. Record what you saw in `docs/LOCAL-FACTS.md`.
