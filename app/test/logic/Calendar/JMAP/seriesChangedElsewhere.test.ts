// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { JMAPCalendar } from "../../../../logic/Calendar/JMAP/JMAPCalendar";
import type { JMAPEvent } from "../../../../logic/Calendar/JMAP/JMAPEvent";
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

/** A weekly series as Stalwart returns it: one occurrence moved, one deleted */
function series(recurrenceOverrides: Record<string, any> = {
  "2026-11-09T10:00:00": { start: "2026-11-09T15:00:00", updated: "2026-10-18T02:20:27Z" },
  "2026-11-16T10:00:00": { excluded: true },
}): TJMAPCalendarEvent {
  return {
    "@type": "Event",
    id: "x",
    uid: "1677ae7c-0ec5-4780-9098-4a5efe68fb62",
    title: "Weekly",
    start: "2026-11-02T10:00:00",
    timeZone: "Europe/Berlin",
    duration: "PT1H",
    recurrenceRule: { frequency: "weekly", count: 6 },
    recurrenceOverrides,
    calendarIds: { b: true },
    isDraft: false,
    isOrigin: true,
  } as any as TJMAPCalendarEvent;
}

/** A calendar with the series listed. `changed` is what the server returns on the next change sync. */
async function setup() {
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
  let changed = series();
  account.makeCombinedCall = async (calls: [string, Record<string, any>, string?][]) => {
    if (calls[0][0] == "CalendarEvent/changes") {
      return {
        changes: { accountId: "u", oldState: "s1", newState: "s2", hasMoreChanges: false, created: [], updated: ["x"], destroyed: [] },
        added: { accountId: "u", state: "s2", list: [], notFound: [] },
        changed: { accountId: "u", state: "s2", list: [changed], notFound: [] },
      };
    }
    let { position = 0, limit = Infinity, calculateTotal } = calls[0][1];
    let page = [series()].slice(position, position + limit);
    return {
      list: { accountId: "u", queryState: "s1", canCalculateChanges: true, position, ids: page.map(event => event.id), total: calculateTotal ? 1 : undefined },
      events: { accountId: "u", state: "s1", list: page, notFound: [] },
    };
  };
  await calendar.listEvents();
  let master = calendar.events.find(event => !event.parentEvent) as JMAPEvent;
  expect(master.exceptions.length).toBe(1);
  expect(master.exclusions.length).toBe(1);
  return {
    account, calendar, master,
    changeOnServer: (recurrenceOverrides: Record<string, any>) => { changed = series(recurrenceOverrides); },
  };
}

function occurrenceStarts(calendar: JMAPCalendar): string[] {
  return calendar.eventsWithRecurrences.contents
    .filter(event => event.title == "Weekly")
    .map(event => event.startTime.toISOString())
    .sort();
}

test("A moved and a deleted occurrence that were undone elsewhere are back to normal here", async () => {
  let { account, calendar, master, changeOnServer } = await setup();

  changeOnServer({});
  await account.sync("CalendarEvent", "s2");

  expect(master.exceptions.length).toBe(0);
  expect(master.exclusions.length).toBe(0);
  expect(calendar.events.length).toBe(1);
  expect(occurrenceStarts(calendar)).toEqual([
    "2026-11-02T09:00:00.000Z", "2026-11-09T09:00:00.000Z", "2026-11-16T09:00:00.000Z",
    "2026-11-23T09:00:00.000Z", "2026-11-30T09:00:00.000Z", "2026-12-07T09:00:00.000Z",
  ]);
});

test("A deleted occurrence that was moved elsewhere instead is moved here", async () => {
  let { account, master, changeOnServer } = await setup();

  changeOnServer({
    "2026-11-09T10:00:00": { start: "2026-11-09T15:00:00" },
    "2026-11-16T10:00:00": { start: "2026-11-16T12:00:00" },
  });
  await account.sync("CalendarEvent", "s2");

  expect(master.exclusions.length).toBe(0);
  expect(master.exceptions.contents.map(exception => exception.startTime.toISOString()).sort())
    .toEqual(["2026-11-09T14:00:00.000Z", "2026-11-16T11:00:00.000Z"]);
});

test("Overrides that are still on the server stay", async () => {
  let { account, master } = await setup();

  await account.sync("CalendarEvent", "s2");

  expect(master.exceptions.length).toBe(1);
  expect(master.exclusions.length).toBe(1);
});
