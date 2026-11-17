// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { Event } from "../../../../logic/Calendar/Event";
import { ScheduleLayout } from "../../../Calendar/ScheduleView/ScheduleLayout";
import { expect, test } from "vitest";

function newEvent(start: Date, end: Date): Event {
  let event = new Event();
  event.title = "Meeting";
  event.startTime = start;
  event.endTime = end;
  return event;
}

const kOneDay = [ new Date(2026, 9, 15) ];
const kTwoDays = [ new Date(2026, 9, 15), new Date(2026, 9, 16) ];

test("Events are placed by their minutes since the start of the first day", () => {
  let event = newEvent(new Date(2026, 9, 15, 9, 30), new Date(2026, 9, 15, 10, 15));
  let layout = new ScheduleLayout([ event ], kOneDay);
  expect(layout.items.length).toBe(1);
  expect(layout.items[0].startMinute).toBe(9 * 60 + 30);
  expect(layout.items[0].endMinute).toBe(10 * 60 + 15);
  expect(layout.laneCount).toBe(1);
});

test("Overlapping events get separate lanes, later ones reuse free lanes", () => {
  let a = newEvent(new Date(2026, 9, 15, 9), new Date(2026, 9, 15, 11));
  let b = newEvent(new Date(2026, 9, 15, 10), new Date(2026, 9, 15, 12));
  let c = newEvent(new Date(2026, 9, 15, 11), new Date(2026, 9, 15, 13));
  let layout = new ScheduleLayout([ c, b, a ], kOneDay);
  let laneOf = (event: Event) => layout.items.find(item => item.event == event).lane;
  expect(laneOf(a)).toBe(0);
  expect(laneOf(b)).toBe(1);
  expect(laneOf(c)).toBe(0);
  expect(layout.laneCount).toBe(2);
});

test("Events outside the days are left out, events across the edges are cut", () => {
  let before = newEvent(new Date(2026, 9, 14, 9), new Date(2026, 9, 14, 10));
  let after = newEvent(new Date(2026, 9, 17, 9), new Date(2026, 9, 17, 10));
  let overnight = newEvent(new Date(2026, 9, 14, 22), new Date(2026, 9, 15, 2));
  let layout = new ScheduleLayout([ before, after, overnight ], kTwoDays);
  expect(layout.items.length).toBe(1);
  expect(layout.items[0].startMinute).toBe(0);
  expect(layout.items[0].endMinute).toBe(120);
  expect(layout.items[0].continuesBefore).toBe(true);
  expect(layout.items[0].continuesAfter).toBe(false);
});

test("The second day starts after 24 hours, and times map back", () => {
  let layout = new ScheduleLayout([], kTwoDays);
  expect(layout.totalMinutes).toBe(2 * 24 * 60);
  expect(layout.minuteOf(new Date(2026, 9, 16, 8))).toBe(24 * 60 + 8 * 60);
  expect(layout.timeAt(24 * 60 + 8 * 60)).toEqual(new Date(2026, 9, 16, 8));
  expect(layout.timeAt(30)).toEqual(new Date(2026, 9, 15, 0, 30));
});

test("All-day events fill their whole day", () => {
  let allDay = newEvent(new Date(2026, 9, 16), new Date(2026, 9, 17));
  allDay.allDay = true;
  let layout = new ScheduleLayout([ allDay ], kTwoDays);
  expect(layout.items[0].startMinute).toBe(24 * 60);
  expect(layout.items[0].endMinute).toBe(48 * 60);
});
