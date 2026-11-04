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

/** An event as Stalwart returns it, created in the calendar "b" by another client */
function newEventInEmpty(): TJMAPCalendarEvent {
  return {
    "@type": "Event",
    id: "x",
    uid: "7d3ebdd6-f85b-411d-9c60-268d5dff3bba",
    title: "In Empty",
    start: "2026-11-21T10:00:00",
    timeZone: "Europe/Berlin",
    duration: "PT1H",
    updated: "2026-10-18T02:20:27Z",
    calendarIds: { b: true },
    isDraft: false,
    isOrigin: true,
  } as any as TJMAPCalendarEvent;
}

function newCalendar(account: JMAPAccount, jmapID: string): JMAPCalendar {
  let calendar = new JMAPCalendar();
  calendar.initFromMainAccount(account);
  calendar.jmapID = jmapID;
  calendar.storage = new DummyCalendarStorage();
  calendar.readEventsFromDB = async () => {};
  calendar.errorCallback = ex => { throw ex; };
  return calendar;
}

/** An account with an empty calendar, both listed before. The server answers like Stalwart. */
function setup() {
  let account = new JMAPAccount();
  account.accountID = "w";
  account.save = async () => {};
  account.login = async () => {};
  account.syncState.set("CalendarEvent", "s1");
  let empty = newCalendar(account, "b");
  empty.syncState = "s1"; // listed: there was nothing in it
  let methodsCalled: string[] = [];
  account.makeCombinedCall = async (calls: [string, Record<string, any>, string?][]) => {
    methodsCalled.push(calls[0][0]);
    if (calls[0][0] == "CalendarEvent/changes") {
      return {
        changes: { accountId: "w", oldState: "s1", newState: "s2", hasMoreChanges: false, created: ["x"], updated: [], destroyed: [] },
        added: { accountId: "w", state: "s2", list: [newEventInEmpty()], notFound: [] },
        changed: { accountId: "w", state: "s2", list: [], notFound: [] },
      };
    }
    return {
      list: { accountId: "w", queryState: "s2", canCalculateChanges: true, position: 0, ids: ["x"] },
      events: { accountId: "w", state: "s2", list: [newEventInEmpty()], notFound: [] },
    };
  };
  appGlobal.calendars.add(empty);
  return { account, empty, methodsCalled };
}

test("An event added elsewhere to an empty calendar shows up on the next change sync", async () => {
  let { account, empty } = setup();

  await account.sync("CalendarEvent", "s2"); // what a push does

  expect(empty.events.contents.map(e => e.title)).toContain("In Empty");
});

test("An empty calendar that was listed before gets only the changes", async () => {
  let { empty, methodsCalled } = setup();

  await empty.listEvents();

  // Not listed again completely, which would also skip changes in the other calendars
  expect(methodsCalled).not.toContain("CalendarEvent/query");
  expect(empty.events.contents.map(e => e.title)).toContain("In Empty");
});

test("A calendar that was never listed is listed completely", async () => {
  let { account, methodsCalled } = setup();
  let unlisted = newCalendar(account, "b");
  account.syncState.delete("CalendarEvent");

  await unlisted.listEvents();

  expect(methodsCalled).toContain("CalendarEvent/query");
  expect(unlisted.events.contents.map(e => e.title)).toContain("In Empty");

  // Now it counts as listed: the next time only the changes
  methodsCalled.length = 0;
  await unlisted.listEvents();
  expect(methodsCalled).not.toContain("CalendarEvent/query");
});
