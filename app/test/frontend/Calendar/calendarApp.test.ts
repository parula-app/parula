// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import CalendarApp from "../../../frontend/Calendar/CalendarApp.svelte";
import { isCalendarListOpen, selectedDate, startDate, type DateInterval } from "../../../frontend/Calendar/selected";
import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
import { flushSync, mount, unmount } from "svelte";
import { get } from "svelte/store";
import { afterEach, beforeAll, expect, test } from "vitest";

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollTo ??= () => {};
});

const dateInterval = getLocalStorage<DateInterval>("calendar.view", 2);

let app: Record<string, any> | null = null;

afterEach(() => {
  unmount(app);
  app = null;
  document.body.innerHTML = "";
  isCalendarListOpen.set(false);
});

function mountApp(view: DateInterval, start: Date, withCalendarList = false) {
  dateInterval.value = view;
  startDate.set(start);
  selectedDate.set(start);
  isCalendarListOpen.set(withCalendarList);
  app = mount(CalendarApp, { target: document.body });
  flushSync();
}

function header(): string {
  return document.querySelector(".date-range").textContent;
}

function isPickerOpen(): boolean {
  return !!document.querySelector(".month-year-picker");
}

function click(button: Element) {
  (button as HTMLElement).click();
  flushSync();
}

function year(year: number): Element {
  return [...document.querySelectorAll("button.year")].find(button => button.textContent.includes(String(year)));
}

function miniMonthDay(dayOfMonth: number): Element {
  return [...document.querySelectorAll(".date-navigator .day:not(.other-month)")]
    .find(day => day.textContent.trim() == String(dayOfMonth));
}

function miniMonthShownDays(): string[] {
  return [...document.querySelectorAll(".date-navigator .day.in-range")].map(day => day.textContent.trim());
}

function weekViewDays(): string[] {
  return [...document.querySelectorAll(".week-view .day-header .date")].map(day => day.textContent.trim());
}

function monthViewDays(): number {
  return document.querySelectorAll(".month-view .day-cell").length;
}

test("Week view: A year keeps the dropdown open, a month closes it, and the header shows the chosen month", () => {
  // Sunday, Nov 1. Its week is mostly in October, so the header shows October.
  mountApp(7, new Date(2026, 10, 1));
  expect(header()).toContain("October");
  expect(header()).toContain("2026");

  click(document.querySelector(".date-range"));
  expect(isPickerOpen()).toBe(true);

  // Oct 1, 2027 is a Friday, so its week is mostly in September
  click(year(2027));
  expect(header()).toContain("October");
  expect(header()).toContain("2027");
  expect(isPickerOpen()).toBe(true);

  let march = document.querySelectorAll("button.month")[2];
  click(march);
  expect(header()).toContain("March");
  expect(header()).toContain("2027");
  expect(isPickerOpen()).toBe(false);
});

test("Month view: All weeks of the month, also a 6th week", () => {
  // November 2026 starts on a Sunday and ends on a Monday
  mountApp(31, new Date(2026, 10, 18));
  expect(header()).toContain("November");
  expect(monthViewDays()).toBe(42);
  click(document.querySelector(".month-view .next-button"));
  expect(header()).toContain("December");
  expect(monthViewDays()).toBe(35);
});

test("Mini month: Shows the days of the view, and a click on a day shows its week", () => {
  mountApp(7, new Date(2026, 10, 18), true);
  expect(miniMonthShownDays()).toEqual(["16", "17", "18", "19", "20", "21", "22"]);
  click(miniMonthDay(4));
  expect(get(startDate).toDateString()).toBe(new Date(2026, 10, 4).toDateString());
  expect(get(selectedDate).toDateString()).toBe(new Date(2026, 10, 4).toDateString());
  expect(weekViewDays()).toEqual(["2", "3", "4", "5", "6", "7", "8"]);
  expect(miniMonthShownDays()).toEqual(["2", "3", "4", "5", "6", "7", "8"]);
});

test("Mini month: The month and year dropdown shows the same day in the chosen month", () => {
  mountApp(1, new Date(2026, 10, 18), true);
  click(document.querySelector(".date-navigator .title"));
  click(document.querySelectorAll("button.month")[2]);
  expect(get(startDate).toDateString()).toBe(new Date(2026, 2, 18).toDateString());
  expect(document.querySelector(".date-navigator .title").textContent).toContain("March");
  expect(weekViewDays()).toEqual(["18"]);
  expect(miniMonthShownDays()).toEqual(["18"]);
});

test("Mini month: Follows the month view", () => {
  mountApp(31, new Date(2026, 10, 18), true);
  expect(miniMonthShownDays().length).toBe(42);
  click(document.querySelector(".month-view .next-button"));
  expect(document.querySelector(".date-navigator .title").textContent).toContain("December");
  expect(miniMonthShownDays().length).toBe(35);
});
