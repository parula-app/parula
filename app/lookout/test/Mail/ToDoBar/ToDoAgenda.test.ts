import { agendaDays } from "../../../Mail/ToDoBar/ToDoAgenda";
import { expect, test } from "vitest";

function event(start: Date, hours = 1, allDay = false) {
  return { startTime: start, endTime: new Date(start.getTime() + hours * 3600 * 1000), allDay };
}

const from = new Date(2026, 9, 16, 9, 30);

test("Groups the next days' events by day, all-day events first", () => {
  let meeting = event(new Date(2026, 9, 16, 14));
  let holiday = event(new Date(2026, 9, 16), 24, true);
  let lunch = event(new Date(2026, 9, 17, 12));
  let past = event(new Date(2026, 9, 15, 10));
  let later = event(new Date(2026, 9, 30, 10));
  let days = agendaDays([lunch, past, meeting, later, holiday], from);
  expect(days.map(day => day.day.getDate())).toEqual([16, 17]);
  expect(days[0].events).toEqual([holiday, meeting]);
  expect(days[1].events).toEqual([lunch]);
});

test("An event that spans midnight shows on both days", () => {
  let night = event(new Date(2026, 9, 16, 22), 4);
  let days = agendaDays([night], from);
  expect(days.map(day => day.day.getDate())).toEqual([16, 17]);
});

test("Stops after the maximum number of events", () => {
  let events = Array.from({ length: 30 }, (_, i) => event(new Date(2026, 9, 16 + (i % 5), 8 + i % 8)));
  let days = agendaDays(events, from, 7, 10);
  expect(days.reduce((sum, day) => sum + day.events.length, 0)).toBe(10);
});
