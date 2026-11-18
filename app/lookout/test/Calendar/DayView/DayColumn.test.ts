// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { Event } from "../../../../logic/Calendar/Event";
import { TimeColumnLayout } from "../../../Calendar/DayView/DayColumn";
import { expect, test } from "vitest";

const kDay = new Date(2026, 9, 15);

function at(dayOffset: number, hours: number, minutes = 0): Date {
  return new Date(2026, 9, 15 + dayOffset, hours, minutes);
}

function newEvent(title: string, start: Date, end: Date): Event {
  let event = new Event();
  event.title = title;
  event.startTime = start;
  event.endTime = end;
  return event;
}

function layout(events: Event[], minMinutes = 30) {
  return new TimeColumnLayout(events, kDay, minMinutes).items;
}

test("An event is placed at its minutes of the day", () => {
  let event = newEvent("Meeting", at(0, 9, 30), at(0, 11));
  expect(layout([event])).toEqual([{
    event,
    startMinute: 9 * 60 + 30,
    endMinute: 11 * 60,
    lane: 0,
    lanes: 1,
    continuesBefore: false,
    continuesAfter: false,
  }]);
});

test("Events of other days are left out", () => {
  let yesterday = newEvent("Yesterday", at(-1, 9), at(-1, 10));
  let tomorrow = newEvent("Tomorrow", at(1, 0), at(1, 1));
  let endsAtMidnight = newEvent("Ends at 0:00", at(-1, 22), at(0, 0));
  expect(layout([yesterday, tomorrow, endsAtMidnight])).toEqual([]);
});

test("A short event gets the height of one time slot", () => {
  let short = newEvent("15 min", at(0, 9), at(0, 9, 15));
  expect(layout([short], 30)[0].endMinute).toBe(9 * 60 + 30);
  expect(layout([short], 10)[0].endMinute).toBe(9 * 60 + 15);
});

test("A short event late in the day stays inside the day", () => {
  let late = newEvent("Late", at(0, 23, 50), at(0, 23, 55));
  let item = layout([late], 30)[0];
  expect(item.startMinute).toBe(23 * 60 + 30);
  expect(item.endMinute).toBe(24 * 60);
});

test("Short events that look overlapping get separate lanes", () => {
  let first = newEvent("First", at(0, 9), at(0, 9, 10));
  let second = newEvent("Second", at(0, 9, 15), at(0, 9, 25));
  let items = layout([first, second], 30);
  expect(items.map(item => [item.event.title, item.lane, item.lanes])).toEqual([
    ["First", 0, 2],
    ["Second", 1, 2],
  ]);
});

test("Events crossing midnight are cut at the day boundaries", () => {
  let night = newEvent("Night", at(-1, 22), at(0, 2));
  let evening = newEvent("Evening", at(0, 22), at(1, 2));
  let items = layout([night, evening]);
  expect(items[0]).toMatchObject({ event: night, startMinute: 0, endMinute: 120, continuesBefore: true, continuesAfter: false });
  expect(items[1]).toMatchObject({ event: evening, startMinute: 22 * 60, endMinute: 24 * 60, continuesBefore: false, continuesAfter: true });
});

test("An event that ends at midnight reaches the end of the day", () => {
  let event = newEvent("Until midnight", at(0, 22), at(1, 0));
  expect(layout([event])[0]).toMatchObject({ endMinute: 24 * 60, continuesAfter: false });
});

test("Overlapping events share the width, the next cluster starts fresh", () => {
  let a = newEvent("A", at(0, 9), at(0, 11));
  let b = newEvent("B", at(0, 10), at(0, 12));
  let c = newEvent("C", at(0, 11), at(0, 12));
  let d = newEvent("D", at(0, 14), at(0, 15));
  let items = layout([d, c, b, a]);
  let byTitle = Object.fromEntries(items.map(item => [item.event.title, [item.lane, item.lanes]]));
  expect(byTitle).toEqual({
    A: [0, 2],
    B: [1, 2],
    C: [0, 2],
    D: [0, 1],
  });
});

test("Adjacent events don't overlap", () => {
  let a = newEvent("A", at(0, 9), at(0, 10));
  let b = newEvent("B", at(0, 10), at(0, 11));
  expect(layout([a, b]).map(item => item.lanes)).toEqual([1, 1]);
});
