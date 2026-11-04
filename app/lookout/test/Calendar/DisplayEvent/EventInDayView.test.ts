// @vitest-environment happy-dom
import "../../../../logic/app"; // first, to resolve the import cycle around Abstract/Account.ts
import { Calendar } from "../../../../logic/Calendar/Calendar";
import type { Event } from "../../../../logic/Calendar/Event";
import { DummyCalendarStorage } from "../../../../logic/Calendar/SQL/DummyCalendarStorage";
import { DayPreviewLayout } from "../../../Calendar/DisplayEvent/EventInDayView";
import { expect, test } from "vitest";

const calendar = new Calendar();
calendar.storage = new DummyCalendarStorage();

function newEvent(title: string, start: Date, minutes: number): Event {
  let event = calendar.newEvent();
  event.title = title;
  event.startTime = start;
  event.endTime = new Date(start.getTime() + minutes * 60000);
  return event;
}

test("Shows an hour before and after the meeting", () => {
  let meeting = newEvent("Meeting", new Date(2026, 9, 16, 13, 0), 60);
  let layout = new DayPreviewLayout(meeting, [], 36);
  expect(layout.hours).toEqual([12, 13, 14]);
  expect(layout.timedItems).toHaveLength(1);
  expect(layout.timedItems[0].isCurrent).toBe(true);
  expect(layout.timedItems[0].top).toBe(36);
  expect(layout.timedItems[0].height).toBe(36);
});

test("A meeting at midnight shows the first 3 hours", () => {
  let meeting = newEvent("Early", new Date(2026, 9, 16, 0, 0), 30);
  let layout = new DayPreviewLayout(meeting, [], 36);
  expect(layout.hours).toEqual([0, 1, 2]);
});

test("A meeting late in the evening shows the last 3 hours", () => {
  let meeting = newEvent("Late", new Date(2026, 9, 16, 23, 0), 60);
  let layout = new DayPreviewLayout(meeting, [], 36);
  expect(layout.hours).toEqual([21, 22, 23]);
});

test("Overlapping events of the day are side by side, other days are left out", () => {
  let meeting = newEvent("Meeting", new Date(2026, 9, 16, 13, 0), 60);
  let review = newEvent("Review", new Date(2026, 9, 16, 13, 30), 60);
  let morning = newEvent("Morning", new Date(2026, 9, 16, 8, 0), 60);
  let tomorrow = newEvent("Tomorrow", new Date(2026, 9, 17, 13, 0), 60);
  let layout = new DayPreviewLayout(meeting, [review, morning, tomorrow], 36);
  expect(layout.timedItems.map(item => item.event.title)).toEqual(["Meeting", "Review"]);
  expect(layout.timedItems.map(item => item.lanes)).toEqual([2, 2]);
  expect(layout.timedItems[1].top).toBe(54);
});

test("The meeting in the calendar is not shown twice", () => {
  let meeting = newEvent("Meeting", new Date(2026, 9, 16, 13, 0), 60);
  let inCalendar = newEvent("Meeting", new Date(2026, 9, 16, 13, 0), 60);
  inCalendar.calUID = meeting.calUID = "same-uid";
  let layout = new DayPreviewLayout(meeting, [inCalendar], 36);
  expect(layout.timedItems).toHaveLength(1);
  expect(layout.timedItems[0].event).toBe(inCalendar);
  expect(layout.timedItems[0].isCurrent).toBe(true);
});

test("All-day events are in their own list", () => {
  let meeting = newEvent("Offsite", new Date(2026, 9, 16), 24 * 60);
  meeting.allDay = true;
  let layout = new DayPreviewLayout(meeting, [], 36);
  expect(layout.hours).toEqual([]);
  expect(layout.allDayItems.map(item => item.event.title)).toEqual(["Offsite"]);
});
