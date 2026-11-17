// @vitest-environment happy-dom
import { getListDateString, getFullDateString } from "../../../Mail/3pane/MessageDates";
import { getDateTimeLocale } from "../../../../l10n/l10n";
import { expect, test } from "vitest";

// Wednesday, 2026-10-14, 15:00 local time
const now = new Date(2026, 9, 14, 15, 0, 0);

function format(date: Date, options: Intl.DateTimeFormatOptions): string {
  return date.toLocaleString(getDateTimeLocale(), options);
}

test("Today: only the time", () => {
  let date = new Date(2026, 9, 14, 9, 5);
  expect(getListDateString(date, now)).toBe(format(date, { hour: "numeric", minute: "2-digit" }));
});

test("Last 6 days: weekday and time", () => {
  let date = new Date(2026, 9, 9, 14, 30);
  expect(getListDateString(date, now)).toBe(format(date, { weekday: "short", hour: "numeric", minute: "2-digit" }));
});

test("This year: weekday and date, without time", () => {
  let date = new Date(2026, 8, 10, 14, 30);
  expect(getListDateString(date, now)).toBe(format(date, { weekday: "short", month: "numeric", day: "numeric" }));
});

test("Older: full date", () => {
  let date = new Date(2024, 8, 7, 14, 30);
  expect(getListDateString(date, now)).toBe(format(date, { year: "numeric", month: "numeric", day: "numeric" }));
});

test("Future dates are not shown as time of today", () => {
  let date = new Date(2026, 9, 15, 9, 0);
  expect(getListDateString(date, now)).toBe(format(date, { weekday: "short", month: "numeric", day: "numeric" }));
});

test("No date", () => {
  expect(getListDateString(null, now)).toBe("");
  expect(getFullDateString(null)).toBe("");
});
