import { CalendarRange } from "../../../frontend/Calendar/CalendarRange";
import { expect, test } from "vitest";

// Thursday, 2026-10-15
const kThursday = new Date(2026, 9, 15, 14, 30);

function days(range: CalendarRange): string[] {
  return range.days.map(day => `${day.getMonth() + 1}/${day.getDate()}`);
}

test("Day view shows the day, from 0:00", () => {
  let range = new CalendarRange("day", kThursday);
  expect(days(range)).toEqual(["10/15"]);
  expect(range.start).toEqual(new Date(2026, 9, 15));
  expect(range.end).toEqual(new Date(2026, 9, 16));
});

test("Day view with several days, e.g. Next 7 Days, starts at the day", () => {
  let range = new CalendarRange("day", kThursday, 7);
  expect(days(range)).toEqual(["10/15", "10/16", "10/17", "10/18", "10/19", "10/20", "10/21"]);
});

test("Day count is limited to 1 to 10", () => {
  expect(new CalendarRange("day", kThursday, 0).days.length).toBe(1);
  expect(new CalendarRange("day", kThursday, 25).days.length).toBe(10);
});

test("Work week is Monday to Friday of the week", () => {
  expect(days(new CalendarRange("workweek", kThursday))).toEqual(["10/12", "10/13", "10/14", "10/15", "10/16"]);
});

test("Work week on a Sunday shows the week before", () => {
  let sunday = new Date(2026, 9, 18);
  expect(days(new CalendarRange("workweek", sunday))).toEqual(["10/12", "10/13", "10/14", "10/15", "10/16"]);
});

test("Week is Monday to Sunday", () => {
  let range = new CalendarRange("week", kThursday);
  expect(days(range)).toEqual(["10/12", "10/13", "10/14", "10/15", "10/16", "10/17", "10/18"]);
  expect(range.end).toEqual(new Date(2026, 9, 19));
});

test("4 weeks from the Monday of the week", () => {
  let range = new CalendarRange("4weeks", kThursday);
  expect(range.days.length).toBe(28);
  expect(range.start).toEqual(new Date(2026, 9, 12));
  expect(range.end).toEqual(new Date(2026, 10, 9));
  expect(new CalendarRange("4weeks", kThursday).step(kThursday, 1)).toEqual(new Date(2026, 10, 12));
});

test("Month view shows whole weeks around the month", () => {
  let range = new CalendarRange("month", kThursday);
  expect(range.days.length).toBe(35);
  expect(days(range)[0]).toBe("9/28");
  expect(days(range)[34]).toBe("11/1");
  expect(range.weeks.length).toBe(5);
  expect(range.weeks.every(week => week.length == 7)).toBe(true);
  expect(range.isInMonth(new Date(2026, 8, 30))).toBe(false);
  expect(range.isInMonth(new Date(2026, 9, 31))).toBe(true);
});

test("Month with 6 weeks", () => {
  // August 2026 starts on a Saturday and ends on a Monday
  let range = new CalendarRange("month", new Date(2026, 7, 10));
  expect(range.weeks.length).toBe(6);
  expect(days(range)[0]).toBe("7/27");
});

test("February that fills exactly 4 weeks", () => {
  // February 2027 starts on a Monday
  let range = new CalendarRange("month", new Date(2027, 1, 14));
  expect(range.weeks.length).toBe(4);
});

test("Month across the change to daylight saving time", () => {
  let range = new CalendarRange("month", new Date(2026, 2, 15));
  for (let day of range.days) {
    expect(day.getHours()).toBe(0);
  }
  expect(new Set(days(range)).size).toBe(range.days.length);
});

test("Contains", () => {
  let range = new CalendarRange("workweek", kThursday);
  expect(range.contains(new Date(2026, 9, 12))).toBe(true);
  expect(range.contains(new Date(2026, 9, 16, 23, 59))).toBe(true);
  expect(range.contains(new Date(2026, 9, 17))).toBe(false);
  expect(range.contains(new Date(2026, 9, 11, 23, 59))).toBe(false);
});

test("The middle of the shown days is in the month that covers most of them", () => {
  // The week of Sunday, Nov 1 is mostly in October
  expect(new CalendarRange("week", new Date(2026, 10, 1)).middle).toEqual(new Date(2026, 9, 29));
  expect(new CalendarRange("month", new Date(2026, 10, 18)).middle.getMonth()).toBe(10);
});

test("Titles like Outlook", () => {
  expect(new CalendarRange("day", kThursday).title("en-US")).toBe("Thursday, October 15, 2026");
  expect(new CalendarRange("workweek", kThursday).title("en-US")).toMatch(/^October 12\s–\s16, 2026$/);
  expect(new CalendarRange("week", new Date(2026, 8, 30)).title("en-US")).toMatch(/^September 28\s–\sOctober 4, 2026$/);
  expect(new CalendarRange("week", new Date(2026, 11, 30)).title("en-US")).toMatch(/^December 28, 2026\s–\sJanuary 3, 2027$/);
  expect(new CalendarRange("month", kThursday).title("en-US")).toBe("October 2026");
  expect(new CalendarRange("month", kThursday).title("de")).toBe("Oktober 2026");
});

test("Step to the next and previous period", () => {
  expect(new CalendarRange("day", kThursday).step(kThursday, 1)).toEqual(new Date(2026, 9, 16));
  expect(new CalendarRange("day", kThursday, 3).step(kThursday, -1)).toEqual(new Date(2026, 9, 12));
  expect(new CalendarRange("workweek", kThursday).step(kThursday, 1)).toEqual(new Date(2026, 9, 22));
  expect(new CalendarRange("week", kThursday).step(kThursday, -1)).toEqual(new Date(2026, 9, 8));
  let endOfJanuary = new Date(2026, 0, 31);
  expect(new CalendarRange("month", endOfJanuary).step(endOfJanuary, 1)).toEqual(new Date(2026, 1, 1));
  expect(new CalendarRange("month", endOfJanuary).step(endOfJanuary, -1)).toEqual(new Date(2025, 11, 1));
});

test("Start and end of the week, Monday to Sunday", () => {
  expect(CalendarRange.weekEdge(kThursday, false)).toEqual(new Date(2026, 9, 12));
  expect(CalendarRange.weekEdge(kThursday, true)).toEqual(new Date(2026, 9, 18));
  // Sunday belongs to the week before
  expect(CalendarRange.weekEdge(new Date(2026, 9, 18, 9), false)).toEqual(new Date(2026, 9, 12));
  expect(CalendarRange.weekEdge(new Date(2026, 10, 1), true)).toEqual(new Date(2026, 10, 1));
});

test("Day/Month shows the selected day and the next day, also across the month end", () => {
  let range = new CalendarRange("dual", kThursday, 5);
  expect(days(range)).toEqual(["10/15", "10/16"]);
  expect(range.start).toEqual(new Date(2026, 9, 15));
  expect(range.end).toEqual(new Date(2026, 9, 17));
  expect(days(new CalendarRange("dual", new Date(2026, 9, 31)))).toEqual(["10/31", "11/1"]);
  expect(range.title("en-US")).toMatch(/^October 15\s–\s16, 2026$/);
});

test("Day/Month steps one day, like the classic dual view", () => {
  expect(new CalendarRange("dual", kThursday).step(kThursday, 1)).toEqual(new Date(2026, 9, 16));
  expect(new CalendarRange("dual", new Date(2026, 10, 1)).step(new Date(2026, 10, 1), -1)).toEqual(new Date(2026, 9, 31));
});
