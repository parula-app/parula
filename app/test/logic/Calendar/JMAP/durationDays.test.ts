// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { JMAPCalendar } from "../../../../logic/Calendar/JMAP/JMAPCalendar";
import type { TJMAPCalendarEvent } from "../../../../logic/Calendar/JMAP/TJSCalendar";
import { JSCalendarEvent } from "../../../../logic/Calendar/JMAP/JSCalendarEvent";
import { DummyCalendarStorage } from "../../../../logic/Calendar/SQL/DummyCalendarStorage";
import { applyPatch } from "./applyPatch";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

/* A JSCalendar duration in days means calendar days in the event's time zone
 * (draft-ietf-calext-jscalendarbis §1.5.6). In Europe/Berlin, the clocks go back
 * on 2026-10-25, so that day has 25 hours. Floating events use the local time zone. */
beforeAll(() => {
  appGlobal.remoteApp ??= {
    kyCreate: () => { throw new Error("The test should not talk to a real server"); },
  } as any;
  vi.stubEnv("TZ", "Europe/Berlin");
});
afterAll(() => {
  vi.unstubAllEnvs();
});

function serverEvent(duration: string, timeZone: string | undefined = "Europe/Berlin"): TJMAPCalendarEvent {
  return {
    "@type": "Event", id: "eventID", uid: "uid", title: "Conference",
    start: "2026-10-24T10:00:00", duration, ...(timeZone ? { timeZone } : {}),
    calendarIds: { calendarID: true },
  } as any as TJMAPCalendarEvent;
}

/** The end of an event in Europe/Berlin (the time zone of these tests), as JSCalendar defines it:
 * the days of the duration are calendar days, the hours, minutes and seconds absolute time. */
function endPerSpec(start: Date, duration: string): Date {
  let match = duration.match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  expect(match, "JSCalendar duration " + duration).toBeTruthy();
  let [, weeks, days, hours, minutes, seconds] = match.map(part => Number(part || 0));
  let end = new Date(start);
  end.setDate(end.getDate() + weeks * 7 + days);
  return new Date(end.getTime() + (hours * 3600 + minutes * 60 + seconds) * 1000);
}

function setup(events: TJMAPCalendarEvent[]) {
  let account = new JMAPAccount();
  account.accountID = "jmapAccount";
  let calendar = new JMAPCalendar();
  calendar.initFromMainAccount(account);
  calendar.jmapID = "calendarID";
  calendar.storage = new DummyCalendarStorage();
  calendar.errorCallback = ex => { throw ex; };
  account.makeCombinedCall = async (calls: [string, Record<string, any>, string?][]) => {
    let { position = 0, limit = Infinity, calculateTotal } = calls[0][1];
    let page = events.slice(position, position + limit);
    return {
      list: { accountId: "jmapAccount", queryState: "s", ids: page.map(event => event.id), position, total: calculateTotal ? events.length : undefined, canCalculateChanges: true },
      events: { accountId: "jmapAccount", state: "s", list: page, notFound: [] },
    };
  };
  let sent: Record<string, any>[] = [];
  account.makeSingleCall = async (method: string, args: Record<string, any>) => {
    sent.push(args);
    return args.create
      ? { created: { [Object.keys(args.create)[0]]: { id: "newEventID" } } }
      : { updated: { [Object.keys(args.update)[0]]: null } };
  };
  return { calendar, sent };
}

async function listEvent(json: TJMAPCalendarEvent) {
  let { calendar, sent } = setup([json]);
  await (calendar as any).listAllEvents();
  return { event: calendar.events.first, calendar, sent };
}

test("2 days over the night when the clocks go back end at the same time of day", async () => {
  let { event } = await listEvent(serverEvent("P2D"));
  expect(event.startTime.toISOString()).toBe("2026-10-24T08:00:00.000Z");
  expect(event.endTime.toISOString()).toBe("2026-10-26T09:00:00.000Z");
});

test("Days and hours", async () => {
  let { event } = await listEvent(serverEvent("P1DT2H"));
  expect(event.endTime.toISOString()).toBe("2026-10-25T11:00:00.000Z");
});

test("Weeks are calendar days, too", async () => {
  let { event } = await listEvent(serverEvent("P1W"));
  // Saturday 10:00, 169 hours after the start
  expect(event.endTime.toISOString()).toBe("2026-10-31T09:00:00.000Z");
});

test("Hours without days are exact over the night when the clocks go back", async () => {
  let { event } = await listEvent(serverEvent("PT24H"));
  // Sunday 9:00, not 10:00
  expect(event.endTime.toISOString()).toBe("2026-10-25T08:00:00.000Z");
});

test("A negative duration ends before the start", () => {
  // Friday 10:00, on a day without clock change
  expect(JSCalendarEvent.toEndTime(serverEvent("-P1D")).toISOString()).toBe("2026-10-23T08:00:00.000Z");
});

test("A floating event takes the days in the local time zone", async () => {
  let { event } = await listEvent(serverEvent("P2D", undefined));
  expect(event.startTime.getTime()).toBe(new Date(2026, 9, 24, 10).getTime());
  expect(event.endTime.getTime()).toBe(new Date(2026, 9, 26, 10).getTime());
});

test("An unchanged duration in days keeps its end on the server", async () => {
  let { event, sent } = await listEvent(serverEvent("P2D"));
  event.title = "Conference 2026";
  await event.save();
  let stored = applyPatch(serverEvent("P2D"), sent[0].update.eventID);
  expect(endPerSpec(new Date("2026-10-24T08:00:00Z"), stored.duration).toISOString()).toBe("2026-10-26T09:00:00.000Z");
});

test("An event of exactly 24 hours over the night when the clocks go back keeps its end on the server", async () => {
  let { calendar, sent } = setup([]);
  let event = calendar.newEvent();
  event.title = "24 hours";
  event.timezone = "Europe/Berlin";
  event.startTime = new Date("2026-10-24T08:00:00Z");
  event.endTime = new Date("2026-10-25T08:00:00Z");
  calendar.events.add(event);
  await event.save();
  // Not "P1D", which is 25 hours that day
  expect(endPerSpec(event.startTime, sent[0].create[event.id].duration).toISOString()).toBe("2026-10-25T08:00:00.000Z");
});

test("An event of exactly 24 hours on a day without clock change keeps its end on the server", async () => {
  let { calendar, sent } = setup([]);
  let event = calendar.newEvent();
  event.title = "24 hours";
  event.timezone = "Europe/Berlin";
  event.startTime = new Date("2026-10-20T08:00:00Z");
  event.endTime = new Date("2026-10-21T08:00:00Z");
  calendar.events.add(event);
  await event.save();
  expect(endPerSpec(event.startTime, sent[0].create[event.id].duration).toISOString()).toBe("2026-10-21T08:00:00.000Z");
});

test("A changed end over the night when the clocks go back is saved with the right end", async () => {
  let { event, sent } = await listEvent(serverEvent("P2D"));
  event.endTime = new Date("2026-10-26T08:00:00Z"); // Monday 9:00, 48 hours after the start
  await event.save();
  let stored = applyPatch(serverEvent("P2D"), sent[0].update.eventID);
  expect(endPerSpec(new Date("2026-10-24T08:00:00Z"), stored.duration).toISOString()).toBe("2026-10-26T08:00:00.000Z");
});
