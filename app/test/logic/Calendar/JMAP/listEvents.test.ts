// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { JMAPCalendar } from "../../../../logic/Calendar/JMAP/JMAPCalendar";
import type { TJMAPCalendarEvent } from "../../../../logic/Calendar/JMAP/TJSCalendar";
import { DummyCalendarStorage } from "../../../../logic/Calendar/SQL/DummyCalendarStorage";
import { beforeAll, expect, test } from "vitest";

beforeAll(() => {
  appGlobal.remoteApp ??= {
    kyCreate: () => { throw new Error("The test should not talk to a real server"); },
  } as any;
});

/** Enough events on the server to need several pages */
const kEventCount = 500;
/** What the server allows per page, where a test makes it cap ours */
const kServerMaxLimit = 50;

/**
 * The number of calls that lists `kEventCount` events, at `pageSize` per call.
 * The last page is short and ends the listing, unless the count divides evenly,
 * and then it takes one more call to see that nothing is left.
 */
function callsNeeded(pageSize: number): number {
  return Math.floor(kEventCount / pageSize) + 1;
}

/** Events on the server, `event0` being the oldest and `event<count - 1>` the latest */
function serverEvents(count: number): TJMAPCalendarEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    id: "event" + i,
    uid: "uid" + i,
    title: "Event " + i,
    description: "Agenda " + i,
    start: new Date(Date.UTC(2026, 0, 1 + i, 10)).toISOString().replace(".000", ""),
    duration: "PT1H",
  }) as any as TJMAPCalendarEvent);
}

/**
 * A JMAP calendar whose server calls are answered from `events`.
 * @param serverMaxLimit The limit that the server enforces, if it caps ours.
 *   RFC 8620 section 5.5 allows this, and then reports the limit that it used.
 */
function setup(events: TJMAPCalendarEvent[], serverMaxLimit?: number) {
  let account = new JMAPAccount();
  account.accountID = "jmapAccount";
  let calendar = new JMAPCalendar();
  calendar.initFromMainAccount(account);
  calendar.jmapID = "calendarID";
  calendar.storage = new DummyCalendarStorage();
  calendar.errorCallback = ex => { throw ex; };

  let requestedLimits: number[] = [];
  account.makeCombinedCall = async (calls: [string, Record<string, any>, string?][]) => {
    let query = calls[0][1];
    requestedLimits.push(query.limit);
    let sorted = query.sort[0].isAscending === false
      ? [...events].reverse()
      : events;
    let served = serverMaxLimit ? Math.min(query.limit, serverMaxLimit) : query.limit;
    let page = sorted.slice(query.position, query.position + served);
    return {
      list: {
        accountId: account.accountID,
        queryState: "queryState",
        ids: page.map(event => event.id),
        position: query.position,
        limit: serverMaxLimit, // undefined when the server used our limit
        canCalculateChanges: true,
      },
      events: {
        accountId: account.accountID,
        state: "eventState",
        list: page,
        notFound: [],
      },
    };
  };
  return { calendar, requestedLimits };
}

test("All events are listed, in as many calls as there are pages", async () => {
  let { calendar, requestedLimits } = setup(serverEvents(kEventCount));

  await (calendar as any).listAllEvents();

  expect(calendar.events.length).toBe(kEventCount);
  // No page fetched twice, and no trailing empty one
  expect(requestedLimits.length).toBeLessThanOrEqual(callsNeeded(requestedLimits[0]));
});

test("The latest events are listed first", async () => {
  let { calendar } = setup(serverEvents(kEventCount));

  await (calendar as any).listAllEvents();

  // The listing must start at the latest events, so that the calendar shows the
  // upcoming meetings even while the rest of it is still running.
  expect(calendar.events.first.calUID).toBe(`uid${kEventCount - 1}`);
  expect(calendar.events.get(kEventCount / 2).calUID).toBe(`uid${kEventCount / 2 - 1}`);
  expect(calendar.events.last.calUID).toBe("uid0");
});

test("A server that enforces a smaller limit does not cut the listing short", async () => {
  // #1: We used to treat the short page as "that was the last one" and stop
  // after 50 of 500 events, losing everything at the end of the list.
  let { calendar, requestedLimits } = setup(serverEvents(kEventCount), kServerMaxLimit);

  await (calendar as any).listAllEvents();

  expect(calendar.events.length).toBe(kEventCount);
  expect(calendar.events.last.calUID).toBe("uid0"); // down to the oldest one
  expect(requestedLimits.length)
    .toBeLessThanOrEqual(callsNeeded(Math.min(requestedLimits[0], kServerMaxLimit)));
});

test("A calendar that fits in one page needs only one call", async () => {
  let { calendar, requestedLimits } = setup(serverEvents(7));

  await (calendar as any).listAllEvents();

  expect(calendar.events.length).toBe(7);
  expect(requestedLimits.length).toBe(1);
});

test("An event without a description is not dropped", async () => {
  // RFC 8984 section 4.2.2: `description` defaults to "", so servers may leave it
  // out. We used to throw while parsing it, and silently drop the whole event.
  let events = serverEvents(2);
  delete (events[0] as any).description;
  let { calendar } = setup(events);

  await (calendar as any).listAllEvents();

  expect(calendar.events.length).toBe(2);
  expect(calendar.events.find(event => event.calUID == "uid0").descriptionText).toBe("");
});

test("An empty calendar needs only one call", async () => {
  let { calendar, requestedLimits } = setup(serverEvents(0));

  await (calendar as any).listAllEvents();

  expect(calendar.events.length).toBe(0);
  expect(requestedLimits.length).toBe(1);
});

/** A buggy or hostile server, which always returns a full page of 1 event */
function setupEndless(samePage: boolean) {
  let { calendar } = setup([]);
  let errors: Error[] = [];
  calendar.errorCallback = ex => errors.push(ex);
  let queries = 0;
  calendar.account.makeCombinedCall = async (calls: [string, Record<string, any>, string?][]) => {
    queries++;
    let [event] = serverEvents(1);
    if (!samePage) {
      event.id = "event" + queries;
    }
    return {
      list: { accountId: "jmapAccount", queryState: "queryState", ids: [event.id], position: 0, limit: 1, canCalculateChanges: true },
      events: { accountId: "jmapAccount", state: "eventState", list: [event], notFound: [] },
    };
  };
  return { calendar, errors, queries: () => queries };
}

test("Listing stops when the server returns the same page again", async () => {
  let { calendar, errors, queries } = setupEndless(true);

  await (calendar as any).listAllEvents();

  expect(queries()).toBeLessThan(10);
  expect(errors.length).toBe(1);
  expect(calendar.events.length).toBe(1);
});

test("Listing stops after a maximum number of rounds, when the server always returns more", async () => {
  let { calendar, errors, queries } = setupEndless(false);

  await (calendar as any).listAllEvents();

  expect(queries()).toBeLessThanOrEqual(10000); // More than any real calendar needs
  expect(errors.length).toBe(1);
});
