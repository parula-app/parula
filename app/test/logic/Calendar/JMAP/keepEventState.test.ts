// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { JMAPCalendar } from "../../../../logic/Calendar/JMAP/JMAPCalendar";
import type { TJMAPCalendarEvent } from "../../../../logic/Calendar/JMAP/TJSCalendar";
import { DummyCalendarStorage } from "../../../../logic/Calendar/SQL/DummyCalendarStorage";
import { afterEach, beforeAll, expect, test } from "vitest";

beforeAll(() => {
  appGlobal.remoteApp ??= {
    kyCreate: () => { throw new Error("The test should not talk to a real server"); },
  } as any;
});

afterEach(() => {
  appGlobal.calendars.clear();
});

function serverEvent(id: string, calendarID: string): TJMAPCalendarEvent {
  return {
    "@type": "Event", id, uid: "uid-" + id, title: "Event " + id,
    start: "2026-11-21T10:00:00", timeZone: "Europe/Berlin", duration: "PT1H",
    calendarIds: { [calendarID]: true }, isDraft: false, isOrigin: true,
  } as any as TJMAPCalendarEvent;
}

test("Listing a calendar for the first time keeps the account's state, so the changes in the other calendars still come", async () => {
  // The CalendarEvent state is the same for all calendars of the account (RFC 8620 5.1).
  // Our calendar "b" was synced at state "s1". Then an event was added to "b" on the server (state "s2"),
  // and a newly shared calendar "c" is listed now, at state "s2".
  let account = new JMAPAccount();
  account.accountID = "u";
  account.save = async () => {};
  account.syncState.set("CalendarEvent", "s1");
  let calls: string[] = [];
  account.makeCombinedCall = async (methodCalls: [string, Record<string, any>, string?][]) => {
    calls.push(methodCalls[0][0] + " " + (methodCalls[0][1].sinceState ?? methodCalls[0][1].filter?.inCalendar));
    if (methodCalls[0][0] == "CalendarEvent/changes") {
      return {
        changes: { accountId: "u", oldState: "s1", newState: "s2", hasMoreChanges: false, created: ["x"], updated: [], destroyed: [] },
        added: { accountId: "u", state: "s2", list: [serverEvent("x", "b")], notFound: [] },
        changed: { accountId: "u", state: "s2", list: [], notFound: [] },
      };
    }
    let { position = 0, limit = Infinity, calculateTotal } = methodCalls[0][1];
    let page = [serverEvent("y", "c")].slice(position, position + limit);
    return {
      list: { accountId: "u", queryState: "q", canCalculateChanges: true, position, ids: page.map(event => event.id), total: calculateTotal ? 1 : undefined },
      events: { accountId: "u", state: "s2", list: page, notFound: [] },
    };
  };
  let calendars = ["b", "c"].map(jmapID => {
    let calendar = new JMAPCalendar();
    calendar.initFromMainAccount(account);
    calendar.jmapID = jmapID;
    calendar.storage = new DummyCalendarStorage();
    calendar.readEventsFromDB = async () => {};
    calendar.save = async () => {};
    calendar.errorCallback = ex => { throw ex; };
    appGlobal.calendars.add(calendar);
    return calendar;
  });
  let [ours, shared] = calendars;
  // listed before
  ours.events.add(ours.newEvent());
  ours.syncState = "s1";

  await (shared as any).listAllEvents();

  await account.sync("CalendarEvent", "s2"); // what the push does
  expect(ours.events.contents.map(event => event.title)).toContain("Event x");
});
