// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { CalDAVCalendar } from "../../../../logic/Calendar/CalDAV/CalDAVCalendar";
import type { CalDAVEvent } from "../../../../logic/Calendar/CalDAV/CalDAVEvent";
import { DummyCalendarStorage } from "../../../../logic/Calendar/SQL/DummyCalendarStorage";
import { afterEach, expect, test } from "vitest";

/* A moved occurrence is an extra VEVENT with RECURRENCE-ID, a deleted one an EXDATE
 * of the master. When another client undoes them, or the organizer changes the
 * series, they are no longer in the ics, and must go here, too. */

const kCalendarURL = "https://dav.example.com/calendars/alice/";

afterEach(() => {
  appGlobal.calendars.clear();
});

const kMaster = [
  "BEGIN:VEVENT",
  "UID:series@example.com",
  "DTSTAMP:20261101T090000Z",
  "DTSTART:20261102T100000Z",
  "DTEND:20261102T110000Z",
  "SUMMARY:Weekly",
  "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=5",
];
// The occurrence of 2026-11-09 moved to 15:00, the one of 2026-11-16 deleted
const kMovedOccurrence = [
  "BEGIN:VEVENT",
  "UID:series@example.com",
  "DTSTAMP:20261101T090000Z",
  "RECURRENCE-ID:20261109T100000Z",
  "DTSTART:20261109T150000Z",
  "DTEND:20261109T160000Z",
  "SUMMARY:Weekly",
  "END:VEVENT",
];

function ics(vevents: string[]): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Example//Other client//EN", ...vevents, "END:VCALENDAR", ""].join("\r\n");
}
const kWithOverrides = ics([...kMaster, "EXDATE:20261116T100000Z", "END:VEVENT", ...kMovedOccurrence]);
const kWithoutOverrides = ics([...kMaster, "END:VEVENT"]);

/** What `CalDAVCalendar` does with an ics from the server */
async function read(event: CalDAVEvent, data: string) {
  event.fromDAVObject({ url: kCalendarURL + "series.ics", etag: '"1"', data });
  await event.saveLocally();
  await event.updateExceptions();
}

async function setup() {
  let calendar = new CalDAVCalendar();
  calendar.name = "Alice";
  calendar.calendarURL = kCalendarURL;
  calendar.storage = new DummyCalendarStorage();
  calendar.errorCallback = ex => { throw ex; };
  appGlobal.calendars.add(calendar);
  let master = calendar.newEvent();
  calendar.events.add(master);
  await read(master, kWithOverrides);
  expect(master.exceptions.length).toBe(1);
  expect(master.exclusions.length).toBe(1);
  return { calendar, master };
}

test("A moved and a deleted occurrence that are no longer on the server are back to normal", async () => {
  let { calendar, master } = await setup();

  await read(master, kWithoutOverrides);

  expect(master.exceptions.length).toBe(0);
  expect(master.exclusions.length).toBe(0);
  expect(calendar.events.contents).toEqual([master]);
  expect(master.instances.contents.map(event => event.startTime.toISOString()).sort()).toEqual([
    "2026-11-02T10:00:00.000Z", "2026-11-09T10:00:00.000Z", "2026-11-16T10:00:00.000Z",
    "2026-11-23T10:00:00.000Z", "2026-11-30T10:00:00.000Z",
  ]);
});

test("A moved and a deleted occurrence that are still on the server stay", async () => {
  let { master } = await setup();
  let exception = master.exceptions.first;

  await read(master, kWithOverrides);

  expect(master.exceptions.contents).toEqual([exception]);
  expect(exception.startTime.toISOString()).toBe("2026-11-09T15:00:00.000Z");
  expect(master.exclusions.contents.map(exclusion => exclusion.toISOString())).toEqual(["2026-11-16T10:00:00.000Z"]);
});
