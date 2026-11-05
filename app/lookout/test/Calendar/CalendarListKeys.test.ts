// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import { appGlobal } from "../../../logic/app";
import { Calendar } from "../../../logic/Calendar/Calendar";
import { MailAccount } from "../../../logic/Mail/MailAccount";
import { selectedCalendar } from "../../../frontend/Calendar/selected";
import CalendarList from "../../Calendar/CalendarList.svelte";
import { flushSync, mount, unmount } from "svelte";
import { get } from "svelte/store";
import { afterEach, beforeAll, beforeEach, expect, test } from "vitest";

let app: Record<string, any> | null = null;

beforeAll(() => {
  // happy-dom has no layout
  Element.prototype.scrollIntoView ??= () => {};
});

function newCalendar(name: string, username: string = null, mainAccount: MailAccount = null): Calendar {
  let calendar = new Calendar();
  calendar.name = name;
  calendar.id = name;
  calendar.username = username;
  calendar.mainAccount = mainAccount;
  return calendar;
}

/** "My Calendars" with "Work" and "Birthdays", "Shared Calendars" with "Alex" */
beforeEach(() => {
  localStorage.clear();
  let me = new MailAccount();
  me.username = "me@example.com";
  appGlobal.calendars.replaceAll([
    newCalendar("Work", "me@example.com", me),
    newCalendar("Birthdays"),
    newCalendar("Alex", "alex@example.com", me),
  ]);
  selectedCalendar.set(appGlobal.calendars.first);
  let target = document.createElement("div");
  document.body.append(target);
  app = mount(CalendarList, { target });
  flushSync();
});

afterEach(() => {
  unmount(app);
  app = null;
  document.body.innerHTML = "";
  appGlobal.calendars.clear();
  localStorage.clear();
});

/** The names of the calendars, in the order shown */
function shownNames(): string[] {
  return [...document.querySelectorAll(".calendar-item .name")].map(name => name.textContent.trim());
}

/** Presses the key on the name of the selected calendar, which has the focus after a click */
function press(key: string): boolean {
  let event = new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true });
  document.querySelector(".calendar-item.selected .name").dispatchEvent(event);
  flushSync();
  return event.defaultPrevented;
}

test("Arrow keys, Home and End select the calendars as shown, across groups", () => {
  let shown = shownNames();
  expect(shown).toEqual(["Work", "Birthdays", "Alex"]);
  expect(press("ArrowDown")).toBe(true);
  expect(get(selectedCalendar).name).toBe("Birthdays");
  press("ArrowDown");
  expect(get(selectedCalendar).name).toBe("Alex");
  expect(press("ArrowDown")).toBe(true);
  expect(get(selectedCalendar).name).toBe("Alex");
  expect(press("Home")).toBe(true);
  expect(get(selectedCalendar).name).toBe("Work");
  expect(press("End")).toBe(true);
  expect(get(selectedCalendar).name).toBe("Alex");
  press("ArrowUp");
  expect(get(selectedCalendar).name).toBe("Birthdays");
});
