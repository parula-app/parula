import { expect } from "vitest";

export function setup() {
  // Calendar tests need a time zone with daylight saving time, which changes on 2026-03-29 and 2026-10-25.
  // It's set here, before the test workers start, because worker threads can't change the time zone.
  process.env.TZ = "Europe/Berlin";
}

/** Checks that the time zone changes the clocks on 2026-03-29 and 2026-10-25, as `setup()` wants */
export function expectDaylightSavingTime() {
  const kHour = 60 * 60 * 1000;
  expect(new Date(2026, 2, 30).getTime() - new Date(2026, 2, 29).getTime()).toBe(23 * kHour);
  expect(new Date(2026, 9, 26).getTime() - new Date(2026, 9, 25).getTime()).toBe(25 * kHour);
}
