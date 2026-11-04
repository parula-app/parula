// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import { Event } from "../../../logic/Calendar/Event";
import { DateNavigatorMonth } from "../../Calendar/DateNavigatorMonth";
import { HourLabel } from "../../Calendar/DayView/HourLabel";
import { expect, test } from "vitest";

function newEvent(start: Date, end: Date, allDay = false): Event {
  let event = new Event();
  event.startTime = start;
  event.endTime = end;
  event.allDay = allDay;
  return event;
}

test("Month grid: 6 weeks from Monday, with the days of the neighbor months", () => {
  let month = new DateNavigatorMonth(new Date(2026, 9, 15));
  expect(month.weeks.length).toBe(6);
  expect(month.weeks[0][0]).toEqual(new Date(2026, 8, 28));
  expect(month.weeks[5][6]).toEqual(new Date(2026, 10, 8));
  expect(month.isInMonth(new Date(2026, 8, 30))).toBe(false);
  expect(month.isInMonth(new Date(2026, 9, 1))).toBe(true);
  expect(month.title("en-US")).toBe("October 2026");
  expect(month.next(1).title("en-US")).toBe("November 2026");
  expect(month.next(-10).title("en-US")).toBe("December 2025");
});

test("Stacked months show the neighbor month's days only at the outer ends", () => {
  let october = new DateNavigatorMonth(new Date(2026, 9, 15));
  let first = october.shownWeeks(true, false);
  expect(first.length).toBe(5);
  expect(first[0][0]).toEqual(new Date(2026, 8, 28));
  expect(first[4]).toEqual([26, 27, 28, 29, 30, 31].map(day => new Date(2026, 9, day)).concat([null]));
  let november = october.next(1).shownWeeks(false, true);
  expect(november.length).toBe(6);
  expect(november[0].slice(0, 6)).toEqual([null, null, null, null, null, null]);
  expect(november[0][6]).toEqual(new Date(2026, 10, 1));
  expect(november[5][6]).toEqual(new Date(2026, 11, 6));
  let single = october.shownWeeks(true, true);
  expect(single.length).toBe(6);
  expect(single.flat().every(Boolean)).toBe(true);
});

test("Weekday labels with 2 letters", () => {
  let month = new DateNavigatorMonth(new Date(2026, 9, 15));
  expect(month.weekdayLabels("en-US")).toEqual(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]);
  expect(month.weekdayLabels("de")).toEqual(["MO", "DI", "MI", "DO", "FR", "SA", "SO"]);
});

test("Days with events, including multi-day and all-day events", () => {
  let month = new DateNavigatorMonth(new Date(2026, 9, 15));
  let events = [
    newEvent(new Date(2026, 9, 15, 9), new Date(2026, 9, 15, 10)),
    newEvent(new Date(2026, 9, 20), new Date(2026, 9, 22), true),
    newEvent(new Date(2026, 9, 25, 22), new Date(2026, 9, 26, 1)),
    newEvent(new Date(2026, 5, 1, 9), new Date(2026, 5, 1, 10)),
    newEvent(new Date(2026, 8, 20), new Date(2026, 8, 29), true),
  ];
  let keys = month.daysWithEvents(events);
  let has = (month: number, day: number) => keys.has(DateNavigatorMonth.dayKey(new Date(2026, month, day)));
  expect(has(9, 15)).toBe(true);
  expect(has(9, 14)).toBe(false);
  expect(has(9, 20)).toBe(true);
  expect(has(9, 21)).toBe(true);
  expect(has(9, 22)).toBe(false);
  expect(has(9, 25)).toBe(true);
  expect(has(9, 26)).toBe(true);
  expect(has(8, 28)).toBe(true);
  expect(has(8, 29)).toBe(false);
  expect(keys.size).toBe(6);
});

test("Hour labels: 12-hour locales without minutes, 24-hour locales with", () => {
  let english = new HourLabel("en-US");
  expect(english.label(8)).toBe("8 AM");
  expect(english.label(12)).toBe("12 PM");
  expect(english.label(0)).toBe("12 AM");
  let german = new HourLabel("de");
  expect(german.label(8)).toBe("08:00");
  expect(german.label(0)).toBe("00:00");
  expect(german.label(17)).toBe("17:00");
});

test("Dragging across days selects at most 14 days, in both directions", () => {
  let start = new Date(2026, 9, 10);
  expect(DateNavigatorMonth.limitRange(start, new Date(2026, 9, 12), 14)).toEqual(new Date(2026, 9, 12));
  expect(DateNavigatorMonth.limitRange(start, new Date(2026, 9, 30), 14)).toEqual(new Date(2026, 9, 23));
  expect(DateNavigatorMonth.limitRange(start, new Date(2026, 8, 1), 14)).toEqual(new Date(2026, 8, 27));
  expect(DateNavigatorMonth.limitRange(start, new Date(2026, 9, 1), 14)).toEqual(new Date(2026, 9, 1));
});
