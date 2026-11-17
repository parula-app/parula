// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { Event } from "../../../../logic/Calendar/Event";
import { layoutTimeColumn, kRowsPerHour } from "../../../../frontend/Calendar/DayView/DayColumn";
import { expect, test } from "vitest";

/** Monday */
const kDay = new Date(2026, 8, 7);

function at(dayOffset: number, hours: number, minutes = 0): Date {
  return new Date(2026, 8, 7 + dayOffset, hours, minutes);
}

function newEvent(title: string, start: Date, end: Date, allDay = false): Event {
  let event = new Event();
  event.title = title;
  event.startTime = start;
  event.endTime = end;
  event.allDay = allDay;
  return event;
}

test("A 5 hour event is one block spanning 5 hours", () => {
  let event = newEvent("Long", at(0, 10), at(0, 15));
  let layout = layoutTimeColumn([event], kDay);
  expect(layout).toEqual([{
    event,
    startRow: 10 * kRowsPerHour,
    endRow: 15 * kRowsPerHour,
    lane: 0,
    lanes: 1,
    continuesBefore: false,
    continuesAfter: false,
  }]);
});

test("Times snap to 5 minutes, outwards", () => {
  let layout = layoutTimeColumn([newEvent("Odd", at(0, 10, 7), at(0, 10, 52))], kDay);
  expect(layout[0].startRow).toBe(10 * kRowsPerHour + 1); // 10:05
  expect(layout[0].endRow).toBe(10 * kRowsPerHour + 11); // 10:55
});

test("An event without duration still gets one row", () => {
  let layout = layoutTimeColumn([newEvent("Reminder", at(0, 10), at(0, 10))], kDay);
  expect(layout[0].endRow - layout[0].startRow).toBe(1);
});

test("Overlapping events share the width, and keep it for their whole duration", () => {
  let a = newEvent("A", at(0, 9), at(0, 11));
  let b = newEvent("B", at(0, 10), at(0, 12));
  let c = newEvent("C", at(0, 11, 30), at(0, 13));
  let d = newEvent("D", at(0, 14), at(0, 15));
  let layout = layoutTimeColumn([d, c, b, a], kDay);
  let byTitle = Object.fromEntries(layout.map(item => [item.event.title, item]));
  expect(byTitle.A).toMatchObject({ lane: 0, lanes: 2 });
  expect(byTitle.B).toMatchObject({ lane: 1, lanes: 2 });
  // C starts after A ended, so it takes A's lane, but still overlaps B
  expect(byTitle.C).toMatchObject({ lane: 0, lanes: 2 });
  // D overlaps nothing, so it gets the full width
  expect(byTitle.D).toMatchObject({ lane: 0, lanes: 1 });
});

test("Back-to-back events don't overlap", () => {
  let layout = layoutTimeColumn([
    newEvent("First", at(0, 9), at(0, 10)),
    newEvent("Second", at(0, 10), at(0, 11)),
  ], kDay);
  expect(layout.map(item => item.lanes)).toEqual([1, 1]);
});

test("An event over midnight is split into one block per day", () => {
  let event = newEvent("Night", at(0, 22), at(1, 2));
  let monday = layoutTimeColumn([event], at(0, 0));
  let tuesday = layoutTimeColumn([event], at(1, 0));
  expect(monday[0]).toMatchObject({ startRow: 22 * kRowsPerHour, endRow: 24 * kRowsPerHour, continuesBefore: false, continuesAfter: true });
  expect(tuesday[0]).toMatchObject({ startRow: 0, endRow: 2 * kRowsPerHour, continuesBefore: true, continuesAfter: false });
});

test("An event ending at midnight is not shown on the next day", () => {
  let event = newEvent("Evening", at(0, 20), at(1, 0));
  expect(layoutTimeColumn([event], at(0, 0))[0].endRow).toBe(24 * kRowsPerHour);
  expect(layoutTimeColumn([event], at(1, 0))).toEqual([]);
});

test("Rows count from the first shown hour", () => {
  let event = newEvent("Early", at(0, 7), at(0, 9));
  let layout = layoutTimeColumn([event], kDay, 8, 18);
  expect(layout[0]).toMatchObject({ startRow: 0, endRow: kRowsPerHour, continuesBefore: true });
});
