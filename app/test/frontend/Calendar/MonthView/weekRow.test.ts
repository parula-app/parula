// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { Event } from "../../../../logic/Calendar/Event";
import { layoutDayRow, WeekRowLayout } from "../../../../frontend/Calendar/MonthView/WeekRow";
import { expect, test } from "vitest";

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

function weekDays(): Date[] {
  return [0, 1, 2, 3, 4, 5, 6].map(i => at(i, 0));
}

test("A 3 day all-day event is one block spanning 3 days", () => {
  let event = newEvent("Trip", at(0, 0), at(3, 0), true);
  let layout = layoutDayRow([event], weekDays());
  expect(layout).toEqual({
    events: [{ event, startDay: 0, endDay: 3, lane: 0, continuesBefore: false, continuesAfter: false }],
    lanes: 1,
  });
});

test("An event longer than the shown days is cut at both ends", () => {
  let event = newEvent("Vacation", at(-3, 0), at(10, 0), true);
  let layout = layoutDayRow([event], weekDays());
  expect(layout.events[0]).toMatchObject({ startDay: 0, endDay: 7, continuesBefore: true, continuesAfter: true });
});

test("A timed event over midnight spans both days", () => {
  let layout = layoutDayRow([newEvent("Night", at(0, 22), at(1, 2))], weekDays());
  expect(layout.events[0]).toMatchObject({ startDay: 0, endDay: 2 });
});

test("Events outside the shown days are left out", () => {
  let layout = layoutDayRow([newEvent("Later", at(8, 10), at(8, 11))], weekDays());
  expect(layout).toEqual({ events: [], lanes: 0 });
});

test("Multi-day events are packed into as few lanes as possible", () => {
  let a = newEvent("A", at(0, 0), at(3, 0), true); // Mon-Wed
  let b = newEvent("B", at(1, 0), at(2, 0), true); // Tue
  let c = newEvent("C", at(3, 0), at(4, 0), true); // Thu
  let d = newEvent("D", at(2, 0), at(5, 0), true); // Wed-Fri
  let layout = layoutDayRow([c, d, b, a], weekDays());
  let lanes = Object.fromEntries(layout.events.map(item => [item.event.title, item.lane]));
  expect(lanes).toEqual({ A: 0, B: 1, D: 1, C: 0 });
  expect(layout.lanes).toBe(2);
});

test("Within a day, all-day events come first, then the others by time", () => {
  let afternoon = newEvent("Afternoon", at(0, 14), at(0, 15));
  let morning = newEvent("Morning", at(0, 9), at(0, 10));
  let holiday = newEvent("Holiday", at(0, 0), at(1, 0), true);
  let layout = layoutDayRow([afternoon, morning, holiday], weekDays());
  expect(layout.events.map(item => [item.event.title, item.lane])).toEqual([
    ["Holiday", 0],
    ["Morning", 1],
    ["Afternoon", 2],
  ]);
});

// 96 rows for 8:00 to 20:00 are 8 rows per hour, and 1 line (4 rows) is 30 minutes
const kRows = 96;

function rowsOf(layout: WeekRowLayout, title: string, day = 0): number[] {
  let item = layout.events.find(item => item.event.title == title && item.startDay == day)!;
  return [item.startRow, item.endRow];
}

test("Events are placed at their time, with 8:00 at the top and 20:00 at the bottom", () => {
  let events = [newEvent("Morning", at(0, 9), at(0, 10)), newEvent("Afternoon", at(0, 14), at(0, 17))];
  let layout = new WeekRowLayout(events, weekDays(), kRows);
  expect(rowsOf(layout, "Morning")).toEqual([8, 16]);
  expect(rowsOf(layout, "Afternoon")).toEqual([48, 72]);
});

test("A short event is still 1 line high", () => {
  let layout = new WeekRowLayout([newEvent("Short", at(0, 9), at(0, 9, 10))], weekDays(), kRows);
  expect(rowsOf(layout, "Short")).toEqual([8, 12]);
});

test("Events before 8:00 are at the top, and events after 20:00 at the bottom", () => {
  let events = [newEvent("Early", at(0, 6), at(0, 7)), newEvent("Late", at(0, 21), at(0, 22))];
  let layout = new WeekRowLayout(events, weekDays(), kRows);
  expect(rowsOf(layout, "Early")).toEqual([0, 4]);
  expect(rowsOf(layout, "Late")).toEqual([92, 96]);
});

test("Events that overlap in time are side by side, like in the week view", () => {
  let events = [newEvent("Meeting", at(0, 10), at(0, 11)), newEvent("Workshop", at(0, 9), at(0, 12))];
  let layout = new WeekRowLayout(events, weekDays(), kRows);
  expect(layout.events.map(item => [item.event.title, item.startRow, item.endRow, item.lane, item.lanes])).toEqual([
    ["Workshop", 8, 32, 0, 2],
    ["Meeting", 16, 24, 1, 2],
  ]);
});

test("Event boxes don't overlap: An event right after a short event comes after its box", () => {
  let events = [newEvent("First", at(0, 9), at(0, 9, 10)), newEvent("Second", at(0, 9, 10), at(0, 9, 20))];
  let layout = new WeekRowLayout(events, weekDays(), kRows);
  expect(layout.events.map(item => [item.event.title, item.startRow, item.endRow, item.lane, item.lanes])).toEqual([
    ["First", 8, 12, 0, 1],
    ["Second", 12, 16, 0, 1],
  ]);
});

test("Event boxes don't overlap: Side by side, only the boxes in the same lane are moved", () => {
  let events = [newEvent("Workshop", at(0, 9), at(0, 12)), newEvent("First", at(0, 9), at(0, 9, 10)), newEvent("Second", at(0, 9, 10), at(0, 9, 20))];
  let layout = new WeekRowLayout(events, weekDays(), kRows);
  expect(layout.events.map(item => [item.event.title, item.startRow, item.endRow, item.lane, item.lanes])).toEqual([
    ["Workshop", 8, 32, 0, 2],
    ["First", 8, 12, 1, 2],
    ["Second", 12, 16, 1, 2],
  ]);
});

test("Several events after 20:00 are stacked upwards from the bottom", () => {
  let events = [21, 22, 23].map(hour => newEvent(`At ${hour}`, at(0, hour), at(0, hour, 30)));
  let layout = new WeekRowLayout(events, weekDays(), kRows);
  expect(rowsOf(layout, "At 21")).toEqual([84, 88]);
  expect(rowsOf(layout, "At 22")).toEqual([88, 92]);
  expect(rowsOf(layout, "At 23")).toEqual([92, 96]);
});

test("An event gets shorter to make room for the event boxes after it", () => {
  let events = [newEvent("Evening", at(0, 18), at(0, 20)), newEvent("Night", at(0, 21), at(0, 22))];
  let layout = new WeekRowLayout(events, weekDays(), kRows);
  expect(rowsOf(layout, "Evening")).toEqual([80, 92]);
  expect(rowsOf(layout, "Night")).toEqual([92, 96]);
});

test("A timed event over midnight is one bar over its days, 1 line high at its start time", () => {
  let event = newEvent("Night", at(0, 22), at(1, 2));
  let conference = newEvent("Conference", at(2, 9), at(4, 17));
  let layout = new WeekRowLayout([event, conference], weekDays(), kRows);
  expect(layout.events).toEqual([
    { event: conference, startDay: 2, endDay: 5, startRow: 8, endRow: 12, lane: 0, lanes: 1, continuesBefore: false, continuesAfter: false },
    { event, startDay: 0, endDay: 2, startRow: 92, endRow: 96, lane: 0, lanes: 1, continuesBefore: false, continuesAfter: false },
  ]);
});

test("Events above a bar on any of its days push it down on all its days, and the events below it come after it", () => {
  let conference = newEvent("Conference", at(0, 9), at(2, 17));
  let breakfast = newEvent("Breakfast", at(1, 8), at(1, 9, 30));
  let meeting = newEvent("Meeting", at(2, 9), at(2, 10));
  let layout = new WeekRowLayout([conference, breakfast, meeting], weekDays(), kRows);
  expect(layout.events.map(item => [item.event.title, item.startDay, item.endDay, item.startRow, item.endRow])).toEqual([
    ["Breakfast", 1, 2, 0, 12],
    ["Conference", 0, 3, 12, 16],
    ["Meeting", 2, 3, 16, 20],
  ]);
});

test("All-day events are bars at the top, and the timed events come after them", () => {
  let trip = newEvent("Trip", at(0, 0), at(3, 0), true);
  let breakfast = newEvent("Breakfast", at(0, 8), at(0, 9));
  let lunch = newEvent("Lunch", at(1, 12), at(1, 13));
  let layout = new WeekRowLayout([lunch, breakfast, trip], weekDays(), kRows);
  expect(layout.events[0]).toEqual({ event: trip, startDay: 0, endDay: 3, startRow: 0, endRow: 4, lane: 0, lanes: 1, continuesBefore: false, continuesAfter: false });
  expect(rowsOf(layout, "Breakfast")).toEqual([4, 8]);
  expect(rowsOf(layout, "Lunch", 1)).toEqual([32, 40]);
});

test("When all events fit, nothing is hidden", () => {
  let events = [newEvent("A", at(0, 9), at(0, 10)), newEvent("B", at(0, 11), at(0, 12))];
  let layout = new WeekRowLayout(events, weekDays(), 8);
  expect(layout.events.map(item => item.event.title)).toEqual(["A", "B"]);
  expect(layout.hiddenEvents.every(hidden => hidden.length == 0)).toBe(true);
});

test("A day with too many events hides the rest, to make room for the '+N more'", () => {
  let monday = [9, 10, 11, 12].map(hour => newEvent(`Mon ${hour}`, at(0, hour), at(0, hour, 30)));
  let tuesday = [9, 10, 11].map(hour => newEvent(`Tue ${hour}`, at(1, hour), at(1, hour, 30)));
  // 3 lines
  let layout = new WeekRowLayout([...monday, ...tuesday], weekDays(), 12);
  // Monday: 2 events, and the 3rd line is for "+2"
  expect(layout.hiddenEvents[0].map(event => event.title)).toEqual(["Mon 11", "Mon 12"]);
  expect(rowsOf(layout, "Mon 10")).toEqual([4, 8]);
  // Tuesday fits into 3 lines, so it uses the 3rd line for its event
  expect(layout.hiddenEvents[1]).toEqual([]);
  expect(layout.events.map(item => item.event.title)).toEqual(["Mon 9", "Tue 9", "Mon 10", "Tue 10", "Tue 11"]);
});

test("Events side by side need only 1 line", () => {
  let events = ["A", "B", "C"].map(title => newEvent(title, at(0, 9), at(0, 10)));
  let layout = new WeekRowLayout([...events, newEvent("D", at(0, 15), at(0, 16))], weekDays(), 8);
  expect(layout.hiddenEvents[0]).toEqual([]);
  expect(layout.events.map(item => [item.event.title, item.startRow, item.endRow, item.lane, item.lanes])).toEqual([
    ["A", 0, 4, 0, 3],
    ["B", 0, 4, 1, 3],
    ["C", 0, 4, 2, 3],
    ["D", 4, 8, 0, 1],
  ]);
});

test("A multi-day event in the last line is hidden on all its days, if one of its days overflows", () => {
  let a = newEvent("A", at(0, 0), at(2, 0), true); // Mon-Tue, lane 0
  let b = newEvent("B", at(0, 0), at(2, 0), true); // Mon-Tue, lane 1
  let late = newEvent("Late", at(1, 0), at(3, 0), true); // Tue-Wed, lane 2
  let wednesday = [9, 10, 11].map(hour => newEvent(`Wed ${hour}`, at(2, hour), at(2, hour, 30)));
  // 3 lines
  let layout = new WeekRowLayout([a, b, late, ...wednesday], weekDays(), 12);
  expect(layout.hiddenEvents[0]).toEqual([]);
  // Tuesday itself has room, but "Late" can't be cut in half
  expect(layout.hiddenEvents[1].map(event => event.title)).toEqual(["Late"]);
  expect(layout.hiddenEvents[2].map(event => event.title)).toEqual(["Late", "Wed 11"]);
  expect(layout.events.map(item => item.event.title)).toEqual(["A", "B", "Wed 9", "Wed 10"]);
});

test("A bar over midnight that doesn't fit on one of its days is hidden on all its days", () => {
  let monday = [9, 10, 11].map(hour => newEvent(`Mon ${hour}`, at(0, hour), at(0, hour, 30)));
  let night = newEvent("Night", at(0, 22), at(1, 2));
  // 3 lines
  let layout = new WeekRowLayout([...monday, night], weekDays(), 12);
  expect(layout.hiddenEvents[0].map(event => event.title)).toEqual(["Mon 11", "Night"]);
  expect(layout.hiddenEvents[1].map(event => event.title)).toEqual(["Night"]);
  expect(layout.events.map(item => item.event.title)).toEqual(["Mon 9", "Mon 10"]);
});

test("With room for only 1 line, all events of an overflowing day are hidden", () => {
  let events = [newEvent("A", at(0, 9), at(0, 10)), newEvent("B", at(0, 11), at(0, 12)), newEvent("C", at(1, 9), at(1, 10))];
  let layout = new WeekRowLayout(events, weekDays(), 4);
  expect(layout.hiddenEvents[0].map(event => event.title)).toEqual(["A", "B"]);
  expect(layout.events.map(item => item.event.title)).toEqual(["C"]);
});
