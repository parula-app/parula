// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import { appGlobal } from "../../../logic/app";
import { Calendar } from "../../../logic/Calendar/Calendar";
import { MailAccount } from "../../../logic/Mail/MailAccount";
import CalendarList from "../../../frontend/Calendar/CalendarList.svelte";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, expect, test } from "vitest";

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
  calendarList = mount(CalendarList, { target: document.body });
  flushSync();

  let lines = [...document.querySelector(".calendars").children].map(line =>
    line.classList.contains("group-label") ? "group" : line.querySelector(".name").textContent);
  expect(lines).toEqual(["group", "Work", "group", "Alex"]);
});
