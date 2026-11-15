// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import { appGlobal } from "../../../logic/app";
import { Calendar } from "../../../logic/Calendar/Calendar";
import { MailAccount } from "../../../logic/Mail/MailAccount";
import CalendarList from "../../../frontend/Calendar/CalendarList.svelte";
import { selectedDate, startDate } from "../../../frontend/Calendar/selected";
import { flushSync, mount, unmount } from "svelte";
import { get } from "svelte/store";
import { afterEach, beforeAll, expect, test } from "vitest";

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

let calendarList: Record<string, any> | null = null;

afterEach(() => {
  unmount(calendarList);
  calendarList = null;
  document.body.innerHTML = "";
  appGlobal.calendars.clear();
});

function newCalendar(name: string, username: string, mainAccount: MailAccount): Calendar {
  let calendar = new Calendar();
  calendar.name = name;
  calendar.username = username;
  calendar.mainAccount = mainAccount;
  appGlobal.calendars.add(calendar);
  return calendar;
}

test("My calendars and the calendars of other people are in separate groups", () => {
  let account = new MailAccount();
  account.username = "me@example.com";
  newCalendar("Alex", "alex@example.com", account);
  newCalendar("Work", "me@example.com", account);
  calendarList = mount(CalendarList, { target: document.body, props: { dateInterval: 7 } });
  flushSync();

  let lines = [...document.querySelector(".calendars").children].map(line =>
    line.classList.contains("group-label") ? "group" : line.querySelector(".name").textContent);
  expect(lines).toEqual(["group", "Work", "group", "Alex"]);
});

function mountList(dateInterval: number, start: Date) {
  startDate.set(start);
  selectedDate.set(new Date(start));
  calendarList = mount(CalendarList, { target: document.body, props: { dateInterval } });
  flushSync();
}

function click(button: Element) {
  (button as HTMLElement).click();
  flushSync();
}

function miniMonthDay(dayOfMonth: number): Element {
  return [...document.querySelectorAll(".date-navigator .day:not(.other-month)")]
    .find(day => day.textContent.trim() == String(dayOfMonth));
}

function shownDays(): string[] {
  return [...document.querySelectorAll(".date-navigator .day.in-range")].map(day => day.textContent.trim());
}

test("Mini month: A click on a day shows its week in the week view", () => {
  mountList(7, new Date(2026, 10, 18));
  expect(shownDays()).toEqual(["16", "17", "18", "19", "20", "21", "22"]);
  click(miniMonthDay(4));
  expect(get(startDate).toDateString()).toBe(new Date(2026, 10, 4).toDateString());
  expect(get(selectedDate).toDateString()).toBe(new Date(2026, 10, 4).toDateString());
  expect(shownDays()).toEqual(["2", "3", "4", "5", "6", "7", "8"]);
});

test("Mini month: The month and year dropdown shows the same day in the chosen month", () => {
  mountList(1, new Date(2026, 10, 18));
  click(document.querySelector(".date-navigator .title"));
  click(document.querySelectorAll("button.month")[2]);
  expect(get(startDate).toDateString()).toBe(new Date(2026, 2, 18).toDateString());
  expect(document.querySelector(".date-navigator .title").textContent).toContain("March");
  expect(shownDays()).toEqual(["18"]);
});

test("Mini month: Shows the month of the month view, not the month of its first day", () => {
  // The month view changes its start date to a day in the first week, here Oct 30 for November
  mountList(31, new Date(2026, 9, 30));
  expect(document.querySelector(".date-navigator .title").textContent).toContain("November");
  expect(shownDays().length).toBe(35);
});
