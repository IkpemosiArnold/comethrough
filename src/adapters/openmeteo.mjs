// @ts-check
// Hourly forecasts from Open-Meteo (free for non-commercial use, CC BY 4.0; attribution in
// CREDITS.md and the UI). Hours come back in the plan's zone, so "16:00" is Lagos time.
// Cached for an hour per ~1 km cell.

import { hoursFromOpenMeteo } from "../core/weather.mjs";
import { cached, fetchJson } from "./http.mjs";

/** @typedef {import("./http.mjs").Cache} Cache */
/** @typedef {import("../core/weather.mjs").Hour} Hour */

export const HOURLY = ["precipitation_probability", "apparent_temperature", "uv_index", "precipitation", "temperature_2m"];

/** The forecast URL for a point. */
export function forecastUrl(base, { lat, lon }, { tz = "Africa/Lagos", days = 7 } = {}) {
  const u = new URL(base);
  u.searchParams.set("latitude", lat.toFixed(3));
  u.searchParams.set("longitude", lon.toFixed(3));
  u.searchParams.set("hourly", HOURLY.join(","));
  u.searchParams.set("timezone", tz);
  u.searchParams.set("forecast_days", String(Math.min(16, Math.max(1, days))));
  return u.href;
}

/**
 * @param {{ url: string, cache: Cache, fetchImpl?: typeof fetch }} cfg
 * @returns {{ hourly(at: { lat: number, lon: number }, opts?: { tz?: string, days?: number }): Promise<Hour[]> }}
 */
export function createOpenMeteo({ url, cache, fetchImpl }) {
  return {
    async hourly(at, { tz = "Africa/Lagos", days = 7 } = {}) {
      const key = `wx:${at.lat.toFixed(2)},${at.lon.toFixed(2)}:${tz}:${days}`;
      return cached(cache, key, 3600_000, async () => hoursFromOpenMeteo(await fetchJson(forecastUrl(url, at, { tz, days }), { timeoutMs: 10000, retries: 1, fetchImpl })));
    },
  };
}
