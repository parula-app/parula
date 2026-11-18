// @vitest-environment happy-dom
import "../../../../logic/app"; // first, to resolve the import cycle around Abstract/Account.ts
import { Calendar } from "../../../../logic/Calendar/Calendar";
import type { Event } from "../../../../logic/Calendar/Event";
import { DummyCalendarStorage } from "../../../../logic/Calendar/SQL/DummyCalendarStorage";
import { EventTimeEditor } from "../../../Calendar/EditEvent/EventTimeEditor";
import { expectDaylightSavingTime } from "../../../../test/logic/Calendar/timeZone";
import { expect, test } from "vitest";

// A time zone with daylight saving time, which changes on 2026-03-29 and 2026-10-25
test("The time zone has daylight saving time", () => {
  expectDaylightSavingTime();
});

function newEvent(start = new Date(2026, 9, 15, 10, 0), minutes = 30): Event {
  let calendar = new Calendar();
  calendar.storage = new DummyCalendarStorage();
  let event = calendar.newEvent();
  event.title = "Planning";
  event.startTime = start;
  event.endTime = new Date(start.getTime() + minutes * 60000);
  event.startEditing();
  return event;
}

test("Changing the start keeps the duration", () => {
  let event = newEvent();
  let editor = new EventTimeEditor(event);
  editor.setStart(new Date(2026, 9, 15, 14, 0));
  expect(event.endTime).toEqual(new Date(2026, 9, 15, 14, 30));
  editor.setStartDate(new Date(2026, 9, 20));
  expect(event.startTime).toEqual(new Date(2026, 9, 20, 14, 0));
  expect(event.endTime).toEqual(new Date(2026, 9, 20, 14, 30));
});

test("An end before the start becomes one hour after the start", () => {
  let event = newEvent();
  let editor = new EventTimeEditor(event);
  editor.setEnd(new Date(2026, 9, 15, 9, 0));
  expect(event.endTime).toEqual(new Date(2026, 9, 15, 11, 0));
});

test("An end at the start is an appointment of 0 minutes, but an all-day event keeps one day", () => {
  let event = newEvent();
  let editor = new EventTimeEditor(event);
  editor.setEnd(new Date(2026, 9, 15, 10, 0));
  expect(event.endTime).toEqual(new Date(2026, 9, 15, 10, 0));
  expect(event.duration).toBe(0);

  editor.setAllDay(true);
  editor.setEndDate(new Date(2026, 9, 14));
  expect(event.startTime).toEqual(new Date(2026, 9, 15));
  expect(event.endTime).toEqual(new Date(2026, 9, 16));
});

test("The end date keeps the end time", () => {
  let event = newEvent();
  let editor = new EventTimeEditor(event);
  editor.setEndDate(new Date(2026, 9, 17));
  expect(event.endTime).toEqual(new Date(2026, 9, 17, 10, 30));
});

test("All day: whole days with the next midnight as end, and back to the times before", () => {
  let event = newEvent();
  let editor = new EventTimeEditor(event);
  editor.setAllDay(true);
  expect(event.allDay).toBe(true);
  expect(event.startTime).toEqual(new Date(2026, 9, 15));
  expect(event.endTime).toEqual(new Date(2026, 9, 16));
  expect(EventTimeEditor.lastDay(event)).toEqual(new Date(2026, 9, 15));

  editor.setEndDate(new Date(2026, 9, 17));
  expect(event.endTime).toEqual(new Date(2026, 9, 18));
  expect(EventTimeEditor.lastDay(event)).toEqual(new Date(2026, 9, 17));

  editor.setTimed();
  expect(event.allDay).toBe(false);
  expect(event.startTime).toEqual(new Date(2026, 9, 15, 10, 0));
  expect(event.endTime).toEqual(new Date(2026, 9, 17, 10, 30));
});

test("An all-day event that was never timed gets the working hours start", () => {
  let event = newEvent(new Date(2026, 9, 15), 24 * 60);
  event.allDay = true;
  let editor = new EventTimeEditor(event);
  editor.setTimed();
  expect(event.allDay).toBe(false);
  expect(event.startTime).toEqual(new Date(2026, 9, 15, 8, 0));
  expect(event.endTime.getTime()).toBeGreaterThan(event.startTime.getTime());
});

test("Dragging the start keeps the end, but not past it", () => {
  let event = newEvent();
  let editor = new EventTimeEditor(event);
  editor.setStartKeepingEnd(new Date(2026, 9, 15, 9, 0));
  expect(event.startTime).toEqual(new Date(2026, 9, 15, 9, 0));
  expect(event.endTime).toEqual(new Date(2026, 9, 15, 10, 30));
  editor.setStartKeepingEnd(new Date(2026, 9, 15, 11, 0));
  expect(event.startTime).toEqual(new Date(2026, 9, 15, 9, 0));
});

test("Moving keeps the duration, and all-day events stay whole days", () => {
  let event = newEvent();
  let editor = new EventTimeEditor(event);
  editor.moveTo(new Date(2026, 9, 16, 15, 30));
  expect(event.startTime).toEqual(new Date(2026, 9, 16, 15, 30));
  expect(event.endTime).toEqual(new Date(2026, 9, 16, 16, 0));

  editor.setAllDay(true);
  editor.moveTo(new Date(2026, 9, 20, 13, 0));
  expect(event.startTime).toEqual(new Date(2026, 9, 20));
  expect(event.endTime).toEqual(new Date(2026, 9, 21));
});

test("A new start date across the change to summer time keeps the time of day and the length", () => {
  let event = newEvent(new Date(2026, 2, 28, 10, 0), 60);
  let editor = new EventTimeEditor(event);
  editor.setStartDate(new Date(2026, 2, 30));
  expect(event.startTime).toEqual(new Date(2026, 2, 30, 10, 0));
  expect(event.endTime).toEqual(new Date(2026, 2, 30, 11, 0));

  let allDay = newEvent(new Date(2026, 2, 27), 2 * 24 * 60);
  allDay.allDay = true;
  new EventTimeEditor(allDay).setStartDate(new Date(2026, 2, 28));
  expect(allDay.startTime).toEqual(new Date(2026, 2, 28));
  expect(allDay.endTime).toEqual(new Date(2026, 2, 30));
  expect(EventTimeEditor.lastDay(allDay)).toEqual(new Date(2026, 2, 29));
});
