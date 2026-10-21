// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { bestWindow, clipToSocial as coreClip, clockWords, hourCost, hoursFromOpenMeteo, rainMovedIn, ritualWindow as coreRitual, socialWindow as coreSocial, weatherForPlan as coreForPlan } from "../src/core/weather.mjs";
// Lagos's social hours live in the Lagos city pack; these tests pass them in.
import { SOCIAL_HOURS } from "../src/packs/lagos/index.mjs";
const ritualWindow = (/** @type {any[]} */ hours, /** @type {any} */ slot) => coreRitual(hours, slot, SOCIAL_HOURS);
const socialWindow = (/** @type {string} */ date, o = {}) => coreSocial(date, { social: SOCIAL_HOURS, ...o });
const weatherForPlan = (/** @type {any[]} */ h, /** @type {any} */ p, /** @type {number} */ n) => coreForPlan(h, { tz: "Africa/Lagos", ...p }, n);
const clipToSocial = (/** @type {string} */ date, /** @type {any} */ want, o = {}) => coreClip(date, want, { social: SOCIAL_HOURS, ...o });

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

test("the ritual's rain path stays inside social hours: dry keeps the window; wet moves within 11 am to 6:30 pm, then the next weekend day, then skips", () => {
  const slot = { date: "2026-10-24", from: "15:00", to: "19:00", hours: 3 };
  const dry = ritualWindow(days(["2026-10-24"], () => 10), slot);
  assert.equal(dry?.rainPlan, null);
  assert.deepEqual(dry?.window, { from: "15:00", to: "18:00" });

  // a dry morning and a wet afternoon: the morning is NOT used (never an 8 am plan)
  const sat = { 8: 24, 9: 34, 10: 45, 11: 58, 12: 71, 13: 82, 14: 90, 15: 95, 16: 94, 17: 85, 18: 69, 19: 53, 20: 35 };
  const skip = ritualWindow(days(["2026-10-24", "2026-10-25"], (d, h) => /** @type {any} */ (sat)[h] ?? 60), slot);
  assert.equal(skip?.rainPlan?.kind, "skip");
  assert.equal(skip?.rainPlan?.note, "Rain all afternoon on Saturday (up to 95% between 11 am and 6:30 pm), and Sunday looks no better. The sloth is skipping this one. If it clears up, anyone can still add a plan.");
  assert.equal(skip?.rainPlan?.wanted.rainProb, 95);

  // a dry late morning: moved, but only as early as 11 am
  const lateMorning = ritualWindow(days(["2026-10-24", "2026-10-25"], (d, h) => (h < 14 ? 15 : 80)), slot);
  assert.equal(lateMorning?.rainPlan?.kind, "moved");
  assert.deepEqual(lateMorning?.window, { from: "11:00", to: "14:00" });
  assert.match(lateMorning?.rainPlan?.note || "", /so the sloth moved it to 11 am to 2 pm, the driest stretch that day/);

  const sunday = ritualWindow(days(["2026-10-24", "2026-10-25"], (d) => (d === "2026-10-24" ? 80 : 15)), slot);
  assert.equal(sunday?.rainPlan?.kind, "next_day");
  assert.equal(sunday?.date, "2026-10-25");
  assert.match(sunday?.rainPlan?.note || "", /on Saturday, so the sloth moved it to Sunday, 3 pm to 6 pm \(rain chance up to 15%\)/);

  // a Sunday slot never moves into Monday
  const sundaySlot = { date: "2026-10-25", from: "15:00", to: "19:00", hours: 3 };
  const noMonday = ritualWindow(days(["2026-10-25", "2026-10-26"], (d) => (d === "2026-10-25" ? 80 : 5)), sundaySlot);
  assert.equal(noMonday?.rainPlan?.kind, "skip");
  assert.match(noMonday?.rainPlan?.note || "", /^Rain all afternoon on Sunday \(up to 80% between 11 am and 6:30 pm\)\. The sloth is skipping this one\./);

  const patchy = ritualWindow(days(["2026-10-24", "2026-10-25"], (d, h) => (h % 2 ? 20 : 70)), slot);
  assert.equal(patchy?.rainPlan?.kind, "skip");
  assert.match(patchy?.rainPlan?.note || "", /^No dry two hours this afternoon on Saturday/);

  for (const r of [skip, lateMorning, sunday, noMonday, patchy]) {
    assert.ok(!/[\u2014\u2013]/.test(r?.rainPlan?.note || ""), "no dashes");
    const h = Number(r?.window.from.slice(0, 2));
    assert.ok(h >= 11 && h <= 18, `window starts in social hours: ${r?.window.from}`);
  }

  assert.equal(ritualWindow(days(["2026-10-30"], () => 10), slot), null, "beyond the forecast");
  assert.deepEqual(["08:00", "12:00", "15:30", "00:00"].map(clockWords), ["8 am", "12 pm", "3:30 pm", "12 am"]);
});

test("social hours: weekend outdoor 11:00 to 18:30, weekday evenings 17:30 to 21:00 under a roof", () => {
  assert.deepEqual(socialWindow("2026-10-24"), { from: "11:00", to: "18:30" });
  assert.deepEqual(socialWindow("2026-10-23", { outdoor: false }), { from: "17:30", to: "21:00" });
  assert.deepEqual(socialWindow("2026-10-23"), { from: "17:30", to: "18:30" }, "a weekday outdoor plan gets only the light part of the evening");
  assert.deepEqual(clipToSocial("2026-10-24", { from: "15:00", to: "19:00" }), { from: "15:00", to: "18:30" });
  assert.deepEqual(clipToSocial("2026-10-24", { from: "07:00", to: "10:00" }), { from: "11:00", to: "18:30" }, "a crew that said 7 am still gets a social hour");
  assert.deepEqual(SOCIAL_HOURS.weekendOutdoor, { from: "11:00", to: "18:30" });
});
