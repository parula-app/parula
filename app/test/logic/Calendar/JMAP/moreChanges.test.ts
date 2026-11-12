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

/** More rounds than any real sync needs. A client that goes on longer is stuck. */
const kSaneMaxRounds = 10000;

/** An event as Stalwart returns it, created in the calendar "b" by another client */
function stalwartEvent(id: string): TJMAPCalendarEvent {
  return {
    "@type": "Event",
    id,
    uid: "7d3ebdd6-f85b-411d-9c60-" + id.padStart(12, "0"),
    title: "Event " + id,
    start: "2026-11-21T10:00:00",
    timeZone: "Europe/Berlin",
    duration: "PT1H",
    updated: "2026-10-18T02:20:27Z",
    calendarIds: { b: true },
    isDraft: false,
    isOrigin: true,
  } as any as TJMAPCalendarEvent;
}

/** The server's answer to `CalendarEvent/changes` since a state */
type TServe = (sinceState: string) => { newState: string, hasMoreChanges: boolean, created: string[] };

/** An account with a calendar that was listed before, at the state "s0" */
function setup(serve: TServe) {
  let account = new JMAPAccount();
  account.accountID = "w";
  account.save = async () => {};
  account.login = async () => {};
  let errors: Error[] = [];
  account.errorCallback = ex => errors.push(ex);
  account.syncState.set("CalendarEvent", "s0");
  let calendar = new JMAPCalendar();
  calendar.initFromMainAccount(account);
  calendar.jmapID = "b";
  calendar.storage = new DummyCalendarStorage();
  calendar.readEventsFromDB = async () => {};
  calendar.errorCallback = ex => errors.push(ex);
  calendar.syncState = "s0";
  let calls = 0;
  account.makeCombinedCall = async (requests: [string, Record<string, any>, string?][]) => {
    calls++;
    let sinceState = requests[0][1].sinceState;
    let { newState, hasMoreChanges, created } = serve(sinceState);
    return {
      changes: { accountId: "w", oldState: sinceState, newState, hasMoreChanges, created, updated: [], destroyed: [] },
      added: { accountId: "w", state: newState, list: created.map(id => stalwartEvent(id)), notFound: [] },
      changed: { accountId: "w", state: newState, list: [], notFound: [] },
    };
  };
  appGlobal.calendars.add(calendar);
  return { account, calendar, errors, calls: () => calls };
}

/** `count` events were added since "s0", and the server reports at most `perCall` changes per call.
 * The state "s<n>" is after the first n of them. */
function addedInSteps(count: number, perCall: number): TServe {
  return sinceState => {
    let from = parseInt(sinceState.substring(1));
    let to = Math.min(from + perCall, count);
    return {
      newState: "s" + to,
      hasMoreChanges: to < count,
      created: Array.from({ length: to - from }, (_, i) => String(from + i + 1)),
    };
  };
}

test("All new events show up when the server reports the changes in several steps", async () => {
  let { account, calendar, errors } = setup(addedInSteps(7, 3));

  await calendar.listEvents();

  expect(calendar.events.contents.map(event => event.title).sort())
    .toEqual(["1", "2", "3", "4", "5", "6", "7"].map(id => "Event " + id));
  expect(account.syncState.get("CalendarEvent")).toBe("s7");
  expect(errors).toEqual([]);
});

test("The sync stops when the server keeps reporting more changes, but no new state", async () => {
  let { account, calendar, errors, calls } = setup(() => ({ newState: "s1", hasMoreChanges: true, created: ["1"] }));

  await account.sync("CalendarEvent", "s2"); // what a push does

  expect(calls()).toBeLessThan(10);
  expect(errors.length).toBe(1);
  expect(calendar.events.contents.map(event => event.title)).toEqual(["Event 1"]);
});

test("The sync stops after a maximum number of rounds, when the server always reports more changes", async () => {
  let { account, errors, calls } = setup(addedInSteps(Infinity, 1));

  await account.sync("CalendarEvent", "s2");

  expect(calls()).toBeLessThanOrEqual(kSaneMaxRounds);
  expect(errors.length).toBe(1);
});
