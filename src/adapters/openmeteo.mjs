// @ts-check
// Hourly forecasts from Open-Meteo (free for non-commercial use, CC BY 4.0; attribution in
// CREDITS.md and the UI). Hours come back in the zone asked for (the crew's), so "16:00" is
// the crew's own local time; with no zone, "auto" asks for the point's own zone. Cached for
// an hour per ~1 km cell.
//
// timezoneAt gives the IANA zone of a point (timezone=auto answers with it, for example
// "Europe/Berlin"): that is how a new crew's region gets its zone. Cached for 30 days.

import { hoursFromOpenMeteo } from "../core/weather.mjs";
import { cached, fetchJson } from "./http.mjs";

/** @typedef {import("./http.mjs").Cache} Cache */
/** @typedef {import("../core/weather.mjs").Hour} Hour */

/** is_day lets an outdoor plan end with the light (src/core/weather.mjs, litHours). */
export const HOURLY = ["precipitation_probability", "apparent_temperature", "uv_index", "precipitation", "temperature_2m", "is_day"];

/** The forecast URL for a point. */
export function forecastUrl(base, { lat, lon }, { tz = "auto", days = 7 } = {}) {
  const u = new URL(base);
  u.searchParams.set("latitude", lat.toFixed(3));
  u.searchParams.set("longitude", lon.toFixed(3));
  u.searchParams.set("hourly", HOURLY.join(","));
  u.searchParams.set("timezone", tz);
  u.searchParams.set("forecast_days", String(Math.min(16, Math.max(1, days))));
  return u.href;
}

/** The smallest request that answers with a point's zone. */
export function zoneUrl(base, { lat, lon }) {
  const u = new URL(base);
  u.searchParams.set("latitude", lat.toFixed(3));
  u.searchParams.set("longitude", lon.toFixed(3));
  u.searchParams.set("timezone", "auto");
  u.searchParams.set("forecast_days", "1");
  u.searchParams.set("daily", "sunset");
  return u.href;
}

/**
 * @typedef {object} WeatherPort
 * @property {(at: { lat: number, lon: number }, opts?: { tz?: string, days?: number }) => Promise<Hour[]>} hourly
 * @property {(at: { lat: number, lon: number }) => Promise<string|null>} timezoneAt  the IANA zone of a point, or null
 */

/**
 * @param {{ url: string, cache: Cache, fetchImpl?: typeof fetch }} cfg
 * @returns {WeatherPort}
 */
export function createOpenMeteo({ url, cache, fetchImpl }) {
  return {
    async hourly(at, { tz = "auto", days = 7 } = {}) {
      const key = `wx:${at.lat.toFixed(2)},${at.lon.toFixed(2)}:${tz}:${days}`;
      return cached(cache, key, 3600_000, async () => hoursFromOpenMeteo(await fetchJson(forecastUrl(url, at, { tz, days }), { timeoutMs: 10000, retries: 1, fetchImpl }), tz === "auto" ? null : tz));
    },
    async timezoneAt(at) {
      const key = `tz:${at.lat.toFixed(2)},${at.lon.toFixed(2)}`;
      const json = await cached(cache, key, 30 * 24 * 3600_000, async () => {
        const j = await fetchJson(zoneUrl(url, at), { timeoutMs: 8000, retries: 1, fetchImpl });
        return { timezone: typeof j?.timezone === "string" ? j.timezone : null };
      });
      return json?.timezone ?? null;
    },
  };
}
