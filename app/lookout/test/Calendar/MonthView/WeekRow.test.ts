// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { Event } from "../../../../logic/Calendar/Event";
import { WeekRowLayout } from "../../../Calendar/MonthView/WeekRow";
import { expect, test } from "vitest";

// Monday 2026-10-12 to Sunday 2026-10-18
const kDays = Array.from({ length: 7 }, (_, i) => new Date(2026, 9, 12 + i));

function at(day: number, hours: number, minutes = 0): Date {
  return new Date(2026, 9, 12 + day, hours, minutes);
}

function newEvent(title: string, start: Date, end: Date, allDay = false): Event {
  let event = new Event();
  event.title = title;
  event.startTime = start;
  event.endTime = end;
  event.allDay = allDay;
  return event;
}

test("All fits: everything is shown, nothing hidden", () => {
  let a = newEvent("A", at(0, 9), at(0, 10));
  let b = newEvent("B", at(0, 11), at(0, 12));
  let layout = new WeekRowLayout([a, b], kDays, 3);
  expect(layout.shown.map(item => item.event.title)).toEqual(["A", "B"]);
  expect(layout.hiddenCounts).toEqual([0, 0, 0, 0, 0, 0, 0]);
});

test("A multi-day bar spans its days, before the timed events", () => {
  let bar = newEvent("Bar", at(1, 0), at(4, 0), true);
  let timed = newEvent("Timed", at(2, 9), at(2, 10));
  let layout = new WeekRowLayout([timed, bar], kDays, 3);
  let barItem = layout.shown.find(item => item.event == bar);
  let timedItem = layout.shown.find(item => item.event == timed);
  expect([barItem.startDay, barItem.endDay, barItem.lane]).toEqual([1, 4, 0]);
  expect(timedItem.lane).toBe(1);
});

test("Overflow: the last line becomes '+N more' on that day only", () => {
  let events = [1, 2, 3, 4].map(i => newEvent("E" + i, at(0, 8 + i), at(0, 9 + i)));
  let tuesday = newEvent("Tuesday", at(1, 9), at(1, 10));
  let layout = new WeekRowLayout([...events, tuesday], kDays, 3);
  expect(layout.shown.map(item => item.event.title)).toEqual(["E1", "E2", "Tuesday"]);
  expect(layout.hiddenCounts).toEqual([2, 0, 0, 0, 0, 0, 0]);
});

test("A bar that doesn't fit on one of its days is hidden on all its days", () => {
  let bar1 = newEvent("Bar 1", at(0, 0), at(3, 0), true);
  let bar2 = newEvent("Bar 2", at(0, 0), at(3, 0), true);
  let bar3 = newEvent("Bar 3", at(1, 0), at(4, 0), true);
  let wednesday = newEvent("Wednesday", at(2, 9), at(2, 10));
  let layout = new WeekRowLayout([bar1, bar2, bar3, wednesday], kDays, 3);
  // Lanes: Bar 1 = 0, Bar 2 = 1, Bar 3 = 2 (Tue-Thu), Wednesday = 3.
  // Wednesday overflows, so it shows only 2 lines plus "+2 more", and Bar 3 is hidden everywhere.
  expect(layout.shown.map(item => item.event.title)).toEqual(["Bar 1", "Bar 2"]);
  expect(layout.hiddenCounts.slice(0, 4)).toEqual([0, 1, 2, 1]);
});

test("At least one line", () => {
  let a = newEvent("A", at(0, 9), at(0, 10));
  let layout = new WeekRowLayout([a], kDays, 0);
  expect(layout.shown.length).toBe(1);
});
