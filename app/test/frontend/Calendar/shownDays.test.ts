import { ShownDays } from "../../../frontend/Calendar/ShownDays";
import { expect, test } from "vitest";

// Friday, 2026-11-20
const kFriday = new Date(2026, 10, 20, 15, 30);
const kSelected = new Date(2026, 10, 3, 9);

function days(shown: ShownDays): Date[] {
  let days: Date[] = [];
  for (let day = new Date(2026, 9, 1); day < new Date(2027, 0, 1); day.setDate(day.getDate() + 1)) {
    if (shown.contains(day)) {
      days.push(new Date(day));
    }
  }
  return days;
}

test("Day and week views", () => {
  expect(days(new ShownDays(1, kFriday, kSelected))).toEqual([new Date(2026, 10, 20)]);
  let workWeek = days(new ShownDays(5, kFriday, kSelected));
  expect(workWeek.length).toBe(5);
  expect(workWeek[0]).toEqual(new Date(2026, 10, 16));
  let week = days(new ShownDays(7, kFriday, kSelected));
  expect(week.length).toBe(7);
  expect(week[6]).toEqual(new Date(2026, 10, 22));
  expect(new ShownDays(7, kFriday, kSelected).date).toBe(kFriday);
});

test("Day/Month view: The selected day and the next", () => {
  let shown = new ShownDays(2, kFriday, kSelected);
  expect(days(shown)).toEqual([new Date(2026, 10, 3), new Date(2026, 10, 4)]);
  expect(shown.date).toBe(kSelected);
});

test("Month view: 5 weeks, from the week with the 1st, and the mini month shows that month", () => {
  let shown = new ShownDays(31, kFriday, kSelected);
  let month = days(shown);
  expect(month.length).toBe(35);
  expect(month[0]).toEqual(new Date(2026, 9, 26));
  expect(month[34]).toEqual(new Date(2026, 10, 29));
  expect(shown.date.getMonth()).toBe(10);
  // The month view changes its start to a day in the first week
  expect(new ShownDays(31, new Date(2026, 9, 30), kSelected).date.getMonth()).toBe(10);
});

test("4 weeks view: 4 weeks from the week of the start date", () => {
  let fourWeeks = days(new ShownDays(28, kFriday, kSelected));
  expect(fourWeeks.length).toBe(28);
  expect(fourWeeks[0]).toEqual(new Date(2026, 10, 16));
});

test("List view: No days", () => {
  expect(days(new ShownDays(0, kFriday, kSelected))).toEqual([]);
});
