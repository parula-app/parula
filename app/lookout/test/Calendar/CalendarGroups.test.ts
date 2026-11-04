import { CalendarGroups } from "../../Calendar/CalendarGroups";
import type { Calendar } from "../../../logic/Calendar/Calendar";
import { expect, test } from "vitest";

// CalendarGroups needs only `username` and `mainAccount`, so plain objects stand in for accounts
function account(username: string | null, mainAccount: any = null): any {
  return { username, mainAccount };
}

function calendar(name: string, username: string | null, mainAccount: any = null): Calendar {
  return { name, username, mainAccount } as Calendar;
}

test("Calendars of my own accounts are mine", () => {
  let mine = account("me@example.com");
  expect(CalendarGroups.isShared(calendar("Calendar", "me@example.com", mine))).toBe(false);
  expect(CalendarGroups.isShared(calendar("Birthdays", "ME@example.com", mine))).toBe(false);
});

test("Local calendars and calendars without user name are mine", () => {
  expect(CalendarGroups.isShared(calendar("Local", null))).toBe(false);
  expect(CalendarGroups.isShared(calendar("CalDAV", "me", account(null)))).toBe(false);
});

test("Calendars of colleagues, opened via my account, are shared", () => {
  let mine = account("me@example.com");
  expect(CalendarGroups.isShared(calendar("Alex Calendar", "alex@example.com", mine))).toBe(true);
});

test("Calendars of shared accounts below my account are shared", () => {
  let mine = account("me@example.com");
  let sharedAccount = account("team@example.com", mine);
  expect(CalendarGroups.isShared(calendar("Team Calendar", "team@example.com", sharedAccount))).toBe(true);
});

test("Groups: My Calendars first, Shared Calendars only when there are some", () => {
  let mine = account("me@example.com");
  let own = calendar("Calendar", "me@example.com", mine);
  let shared = calendar("Alex", "alex@example.com", mine);
  let groups = new CalendarGroups([shared, own]).groups;
  expect(groups.map(group => [group.id, group.calendars.map(cal => cal.name)])).toEqual([
    ["mine", ["Calendar"]],
    ["shared", ["Alex"]],
  ]);
  expect(new CalendarGroups([own]).groups.map(group => group.id)).toEqual(["mine"]);
  expect(new CalendarGroups([]).groups.map(group => group.id)).toEqual(["mine"]);
});

test("Move Up and Move Down change the order within a group", () => {
  let mine = account("me@example.com");
  let work = { ...calendar("Work", "me@example.com", mine), id: "work" } as Calendar;
  let home = { ...calendar("Home", "me@example.com", mine), id: "home" } as Calendar;
  let alex = { ...calendar("Alex", "alex@example.com", mine), id: "alex" } as Calendar;
  let groups = new CalendarGroups([work, home, alex]);
  expect(groups.groups[0].calendars).toEqual([work, home]);
  expect(groups.canMove(work, -1)).toBe(false);
  expect(groups.canMove(home, 1)).toBe(false);
  expect(groups.canMove(alex, -1)).toBe(false);
  let order = groups.orderAfterMove(home, -1);
  expect(order).toEqual(["home", "work", "alex"]);
  expect(new CalendarGroups([work, home, alex], order).groups[0].calendars).toEqual([home, work]);
  expect(new CalendarGroups([alex, work, home], ["home"]).groups[0].calendars).toEqual([home, work]);
});
