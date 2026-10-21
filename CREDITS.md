# Credits

## Code

- **Selects** (github.com/IkpemosiArnold/selects, MIT, by Arnold Ikpemosi Adeyemi). Come Through reuses:
  - the Gemini API client pattern in `src/adapters/gemini.mjs` (request body, timeouts, one retry for transient failures, retrying without a refused feature, skipping thought parts),
  - the JSON salvage and schema hint in `src/core/json.mjs`,
  - the rate limiter and the X-Forwarded-For hop rule in `src/server/http.mjs`,
  - the `<!-- system -->` / `<!-- user -->` prompt file format.

  Each copied file says so in its header.

## Data and services

- **OpenStreetMap** contributors (ODbL): places, parks and beaches through **Overpass**, and geocoding through **Nominatim** or **Photon** (komoot). © OpenStreetMap contributors.
- **Open-Meteo** (CC BY 4.0): weather forecasts.
- **Gemma** (Google DeepMind), an open model, served through the Gemini API.
