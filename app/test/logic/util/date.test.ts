// @vitest-environment happy-dom
import { changeMonth, getDayStart, getFormattedDateString, getTimeString, getTimeStringWithoutAMPM, getWeekStart } from "../../../logic/util/date";
import { saveDateTimeLocale } from "../../../l10n/l10n";
import { afterEach, expect, test } from "vitest";

const time = new Date(2026, 9, 29, 15, 5);

afterEach(() => {
  saveDateTimeLocale("");
});

test("Time without AM/PM leaves out only the AM/PM part", () => {
  for (let locale of ["en-US", "es-US", "ko-KR"]) {
    saveDateTimeLocale(locale);
    let ampm = new Intl.DateTimeFormat(locale, { hour: "numeric", hour12: true })
      .formatToParts(time)
      .find(part => part.type == "dayPeriod")
      .value;
    let withoutAMPM = getTimeStringWithoutAMPM(time);
    expect(getTimeString(time)).toContain(ampm);
    expect(withoutAMPM).not.toContain(ampm);
    expect(getTimeString(time)).toContain(withoutAMPM);
    expect(withoutAMPM).toContain("05");
    expect(withoutAMPM).toBe(withoutAMPM.trim());
  }
});

test("Time without AM/PM is the normal time in 24-hour locales", () => {
  for (let locale of ["de-DE", "en-GB"]) {
    saveDateTimeLocale(locale);
    expect(getTimeStringWithoutAMPM(time)).toBe(getTimeString(time));
  }
});

test("Day start is midnight of the same day, and the week starts on Monday", () => {
  let dayStart = getDayStart(time);
  expect(dayStart).toEqual(new Date(2026, 9, 29));
  expect(time.getTime()).toBe(new Date(2026, 9, 29, 15, 5).getTime());
  // Sunday belongs to the week before
  expect(getWeekStart(new Date(2026, 10, 1, 12, 0))).toEqual(new Date(2026, 9, 26));
});

test("Changing the month keeps the day and the time, or takes the last day of a shorter month", () => {
  expect(changeMonth(time, new Date(2028, 2, 1))).toEqual(new Date(2028, 2, 29, 15, 5));
  expect(changeMonth(time, new Date(2025, 11, 1))).toEqual(new Date(2025, 11, 29, 15, 5));
  let lastOfJanuary = new Date(2027, 0, 31, 9, 30);
  expect(changeMonth(lastOfJanuary, new Date(2027, 1, 1))).toEqual(new Date(2027, 1, 28, 9, 30));
  expect(changeMonth(lastOfJanuary, new Date(2028, 1, 1))).toEqual(new Date(2028, 1, 29, 9, 30));
  expect(changeMonth(lastOfJanuary, new Date(2027, 3, 1))).toEqual(new Date(2027, 3, 30, 9, 30));
  expect(lastOfJanuary).toEqual(new Date(2027, 0, 31, 9, 30));
});

test("Latin dates have Latin month and weekday names", () => {
  saveDateTimeLocale("la");
  let date = getFormattedDateString(time, { weekday: "long", day: "numeric", month: "long" });
  expect(date).toContain("Iovis");
  expect(date).toContain("Octobris");
  expect(date).not.toContain("Thursday");
  expect(getTimeString(time)).toContain("15");
  expect(getTimeString(time)).not.toContain("PM");
  let format = new Intl.DateTimeFormat("la", { weekday: "long" }).format;
  expect([time].map(format)[0]).toContain("Iovis");

  let range = new Intl.DateTimeFormat("la", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })
    .formatRange(time, new Date(2026, 10, 2, 9, 0));
  expect(range).toContain("Iovis");
  expect(range).toContain("Lunae");
  expect(range).toContain("Novembris");
  expect(range).not.toContain(" at ");
});

test("Klingon dates have Klingon month and weekday names", () => {
  saveDateTimeLocale("tlh");
  let date = getFormattedDateString(time, { weekday: "long", day: "numeric", month: "long" });
  expect(date).toContain("loghjaj");
  expect(date).toContain("jar wa'maH");
  expect(date).not.toContain("Thursday");
  expect(date).not.toContain("October");

  saveDateTimeLocale("tlh-Piqd");
  expect(getFormattedDateString(time, { weekday: "long" })).toBe("\uF8D9\uF8DD\uF8D5\uF8D8\uF8D0\uF8D8"); // loghjaj
});
