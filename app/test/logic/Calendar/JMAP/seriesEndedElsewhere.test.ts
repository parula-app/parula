// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { JMAPCalendar } from "../../../../logic/Calendar/JMAP/JMAPCalendar";
import { RecurrenceCase } from "../../../../logic/Calendar/Event";
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

/** A weekly series as Stalwart returns it, and the same event after its repetition was removed elsewhere */
function serverEvent(recurring: boolean): TJMAPCalendarEvent {
  return {
    "@type": "Event",
    id: "x",
    uid: "1677ae7c-0ec5-4780-9098-4a5efe68fb62",
    title: "Weekly",
    start: "2026-11-02T10:00:00",
    timeZone: "Europe/Berlin",
    duration: "PT1H",
    sequence: 0,
    updated: "2026-10-18T02:48:40Z",
    ...(recurring ? { recurrenceRule: { frequency: "weekly", count: 5 } } : {}),
    calendarIds: { b: true },
    isDraft: false,
    isOrigin: true,
  } as any as TJMAPCalendarEvent;
}

test("A series whose repetition was removed elsewhere is a single event here", async () => {
  let account = new JMAPAccount();
  account.accountID = "u";
  account.save = async () => {};
  account.login = async () => {};
  let calendar = new JMAPCalendar();
  calendar.initFromMainAccount(account);
  calendar.jmapID = "b";
  calendar.storage = new DummyCalendarStorage();
  calendar.readEventsFromDB = async () => {};
  calendar.save = async () => {};
  calendar.errorCallback = ex => { throw ex; };
  appGlobal.calendars.add(calendar);
  account.makeCombinedCall = async (calls: [string, Record<string, any>, string?][]) => {
    if (calls[0][0] == "CalendarEvent/changes") {
      return {
        changes: { accountId: "u", oldState: "s1", newState: "s2", hasMoreChanges: false, created: [], updated: ["x"], destroyed: [] },
        added: { accountId: "u", state: "s2", list: [], notFound: [] },
        changed: { accountId: "u", state: "s2", list: [serverEvent(false)], notFound: [] },
      };
    }
    let { position = 0, limit = Infinity, calculateTotal } = calls[0][1];
    let page = [serverEvent(true)].slice(position, position + limit);
    return {
      list: { accountId: "u", queryState: "s1", canCalculateChanges: true, position, ids: page.map(event => event.id), total: calculateTotal ? 1 : undefined },
      events: { accountId: "u", state: "s1", list: page, notFound: [] },
    };
  };
  await calendar.listEvents();
  let event = calendar.events.first;
  expect(event.recurrenceCase).toBe(RecurrenceCase.Master);

  await account.sync("CalendarEvent", "s2"); // what a push does

  expect(event.recurrenceRule).toBeNull();
  expect(event.recurrenceCase).toBe(RecurrenceCase.Normal);
  expect(calendar.eventsWithRecurrences.contents.map(e => e.startTime.toISOString())).toEqual(["2026-11-02T09:00:00.000Z"]);
});
