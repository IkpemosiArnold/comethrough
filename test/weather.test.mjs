// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { bestWindow, clockWords, hourCost, hoursFromOpenMeteo, rainMovedIn, ritualWindow, weatherForPlan } from "../src/core/weather.mjs";

/** A Lagos October Saturday: hot midday, a storm at 13:00 to 14:00, a cooler dry evening. */
function forecast(date = "2026-10-24", overrides = {}) {
  const time = [];
  const rain = [];
  const feels = [];
  const uv = [];
  for (let h = 0; h < 24; h++) {
    time.push(`${date}T${String(h).padStart(2, "0")}:00`);
    rain.push(overrides[h]?.rain ?? (h === 13 || h === 14 ? 80 : h >= 10 && h <= 16 ? 30 : 10));
    feels.push(overrides[h]?.feels ?? (h < 7 ? 27 : h < 11 ? 32 : h < 16 ? 38 : h < 19 ? 33 : 29));
    uv.push(h >= 10 && h <= 15 ? 10 : h >= 8 && h <= 17 ? 5 : 0);
  }
  return { hourly: { time, precipitation_probability: rain, apparent_temperature: feels, uv_index: uv, precipitation: rain.map(() => 0) } };
}

test("Open-Meteo hourly arrays become hours, with nulls for gaps", () => {
  const json = forecast();
  json.hourly.uv_index[3] = null;
  const hours = hoursFromOpenMeteo(json);
  assert.equal(hours.length, 24);
  assert.deepEqual(hours[16], { date: "2026-10-24", time: "16:00", rainProb: 30, feelsC: 33, uv: 5, precipMm: 0 });
  assert.equal(hours[3].uv, null);
  assert.deepEqual(hoursFromOpenMeteo({}), []);
});

test("the best afternoon window skips the storm and the worst heat", () => {
  const w = bestWindow(hoursFromOpenMeteo(forecast()), { date: "2026-10-24", from: "12:00", to: "20:00", hours: 3 });
  assert.ok(w);
  assert.equal(w.from, "17:00");
  assert.equal(w.to, "20:00");
  assert.ok(w.ok);
  assert.equal(w.rainProb, 10);
  assert.match(w.reason.text, /^Dry: rain chance 10% at most/);
  assert.ok(w.reason.codes.includes("avoids_rain"));
  assert.ok(w.reason.codes.includes("after_heat"));
  assert.ok(!w.reason.text.includes("—"), "no em dashes");
});

test("a wet day is flagged not ok, and the least wet window still wins", () => {
  const wet = forecast("2026-10-24", Object.fromEntries(Array.from({ length: 24 }, (_, h) => [h, { rain: h === 18 ? 55 : 85 }])));
  const w = bestWindow(hoursFromOpenMeteo(wet), { date: "2026-10-24", from: "15:00", to: "21:00", hours: 1 });
  assert.ok(w && !w.ok);
  assert.equal(w.from, "18:00");
  assert.ok(w.reason.codes.includes("rain"));
});

test("a window narrower than the length asked for shrinks to fit; no forecast means null", () => {
  const hours = hoursFromOpenMeteo(forecast());
  const w = bestWindow(hours, { date: "2026-10-24", from: "18:00", to: "20:00", hours: 3 });
  assert.equal(w?.from, "18:00");
  assert.equal(w?.to, "20:00");
  assert.equal(bestWindow(hours, { date: "2026-11-30" }), null);
});

test("hour cost orders rain over heat over sun", () => {
  const base = { date: "d", time: "12:00", precipMm: 0 };
  assert.ok(hourCost({ ...base, rainProb: 70, feelsC: 29, uv: 0 }) > hourCost({ ...base, rainProb: 0, feelsC: 38, uv: 0 }));
  assert.ok(hourCost({ ...base, rainProb: 0, feelsC: 38, uv: 0 }) > hourCost({ ...base, rainProb: 0, feelsC: 29, uv: 11 }));
});

test("the weather watch: a plan's own hours, and when rain moves in", () => {
  const hours = hoursFromOpenMeteo(forecast());
  const now = Date.parse("2026-10-22T10:00:00Z");
  const evening = weatherForPlan(hours, { start: "2026-10-24T17:00:00+01:00", end: "2026-10-24T20:00:00+01:00" }, now);
  assert.equal(evening?.ok, true);
  assert.equal(evening?.summary, "Dry, feels like 33 C");
  const lunch = weatherForPlan(hours, { start: "2026-10-24T12:30:00+01:00", end: "2026-10-24T15:00:00+01:00" }, now);
  assert.equal(lunch?.ok, false);
  assert.equal(lunch?.rainProb, 80);
  assert.match(lunch?.summary || "", /^Rain likely \(80%\)/);
  assert.ok(rainMovedIn(evening, lunch));
  assert.ok(!rainMovedIn(lunch, lunch), "only the change is news");
  assert.equal(weatherForPlan(hours, { start: "2026-12-24T17:00:00+01:00", end: "2026-12-24T20:00:00+01:00" }, now), null);
});

/** Hours for several days from a rain rule (date, hour) => %. */
function days(dates, rain) {
  return dates.flatMap((date) => Array.from({ length: 24 }, (_, h) => ({ date, time: `${String(h).padStart(2, "0")}:00`, rainProb: rain(date, h), feelsC: 32, uv: 3, precipMm: 0 })));
}

test("the ritual's rain path: dry keeps the window; wet moves it, then tries the next day, then says so", () => {
  const slot = { date: "2026-10-24", from: "15:00", to: "19:00", hours: 3 };
  const dry = ritualWindow(days(["2026-10-24"], () => 10), slot);
  assert.equal(dry?.rainPlan, null);
  assert.deepEqual(dry?.window, { from: "15:00", to: "18:00" });

  // the live forecast of 21 Oct 2026 for Saturday 24 Oct: storms from midday, a drier morning
  const sat = { 8: 24, 9: 34, 10: 45, 11: 58, 12: 71, 13: 82, 14: 90, 15: 95, 16: 94, 17: 85, 18: 69, 19: 53, 20: 35 };
  const moved = ritualWindow(days(["2026-10-24", "2026-10-25"], (d, h) => /** @type {any} */ (sat)[h] ?? 60), slot);
  assert.equal(moved?.rainPlan?.kind, "moved");
  assert.equal(moved?.date, "2026-10-24");
  assert.deepEqual(moved?.window, { from: "08:00", to: "10:00" }, "a two-hour dry morning beats a wet afternoon");
  assert.equal(moved?.rainPlan?.note, "Rain is likely from 3 pm to 7 pm (up to 95%), so the sloth moved it to 8 am to 10 am, the driest stretch that day (rain chance up to 34%). Forecasts change; the sloth checks again before then.");
  assert.equal(moved?.rainPlan?.wanted.rainProb, 95);

  const sunday = ritualWindow(days(["2026-10-24", "2026-10-25"], (d) => (d === "2026-10-24" ? 80 : 15)), slot);
  assert.equal(sunday?.rainPlan?.kind, "next_day");
  assert.equal(sunday?.date, "2026-10-25");
  assert.match(sunday?.rainPlan?.note || "", /on Saturday, so the sloth moved it to Sunday, 3 pm to 6 pm \(rain chance up to 15%\)/);

  const wet = ritualWindow(days(["2026-10-24", "2026-10-25"], () => 85), slot);
  assert.equal(wet?.rainPlan?.kind, "wet");
  assert.equal(wet?.date, "2026-10-24");
  assert.deepEqual(wet?.window, { from: "15:00", to: "18:00" });
  assert.match(wet?.rainPlan?.note || "", /^No dry stretch this weekend: the driest few hours on Saturday still have a 85% chance of rain\. Bring an umbrella, or move it somewhere with a roof/);
  for (const r of [moved, sunday, wet]) assert.ok(!/[—–]/.test(r?.rainPlan?.note || ""), "no dashes");

  assert.equal(ritualWindow(days(["2026-10-30"], () => 10), slot), null, "beyond the forecast");
  assert.deepEqual(["08:00", "12:00", "15:30", "00:00"].map(clockWords), ["8 am", "12 pm", "3:30 pm", "12 am"]);
});
