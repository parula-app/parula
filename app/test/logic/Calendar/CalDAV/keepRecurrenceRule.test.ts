// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { CalDAVCalendar } from "../../../../logic/Calendar/CalDAV/CalDAVCalendar";
import type { CalDAVEvent } from "../../../../logic/Calendar/CalDAV/CalDAVEvent";
import { AuthMethod } from "../../../../logic/Abstract/Account";
import { Frequency } from "../../../../logic/Calendar/RecurrenceRule";
import { ICalParser } from "../../../../logic/Calendar/ICal/ICalParser";
import { DummyCalendarStorage } from "../../../../logic/Calendar/SQL/DummyCalendarStorage";
import { afterEach, beforeAll, expect, test } from "vitest";

/* Our `RecurrenceRule` knows only FREQ, INTERVAL, COUNT, UNTIL, BYDAY and WKST.
 * Saving a series that another client made must not drop the other parts of its RRULE,
 * e.g. BYMONTHDAY or BYSETPOS, unless the user changed how it repeats. */

const kCalendarURL = "https://dav.example.com/calendars/alice/";

beforeAll(() => {
  appGlobal.remoteApp ??= {
    kyCreate: () => { throw new Error("The test should not talk to a server"); },
  } as any;
});

afterEach(() => {
  appGlobal.calendars.clear();
});

/** A CalDAV calendar with the ics files that we PUT captured */
function setup() {
  let calendar = new CalDAVCalendar();
  calendar.name = "Alice";
  calendar.calendarURL = kCalendarURL;
  calendar.authMethod = AuthMethod.Password;
  calendar.password = "test";
  calendar.storage = new DummyCalendarStorage();
  let saved: string[] = [];
  // `login()` returns early when we already have a client
  calendar.client = {
    updateCalendarObject: async ({ calendarObject }) => {
      saved.push(calendarObject.data);
      return new Response(null, { status: 204 });
    },
  } as any;
  appGlobal.calendars.add(calendar);
  return { calendar, saved };
}

/** A series as another client saved it on the server */
function serverEvent(calendar: CalDAVCalendar, rrule: string): CalDAVEvent {
  let event = calendar.newEvent() as CalDAVEvent;
  let isEvent = event.fromDAVObject({
    url: kCalendarURL + "series.ics",
    etag: '"1"',
    data: [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Example//Other client//EN",
      "BEGIN:VEVENT",
      "UID:series@example.com",
      "DTSTAMP:20261101T090000Z",
      "DTSTART:20261201T090000Z",
      "DTEND:20261201T100000Z",
      "SUMMARY:Review",
      rrule,
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n"),
  });
  expect(isEvent).toBe(true);
  calendar.events.add(event);
  return event;
}

/** The parts of the RRULE of the master in the saved ics, e.g. { FREQ: "MONTHLY", COUNT: "10" } */
function savedRule(ics: string): Record<string, string> {
  let vevents = new ICalParser(ics).containers.vcalendar[0].containers.vevent;
  let line = vevents.find(vevent => !vevent.entries.recurrenceid).entries.rrule[0].line;
  return Object.fromEntries(line.replace(/^RRULE:/i, "").split(";").map(part => part.toUpperCase().split("=")));
}

test("A title change keeps the parts of the rule that we don't support", async () => {
  let { calendar, saved } = setup();
  let event = serverEvent(calendar, "RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15;COUNT=10");
  event.startEditing();
  event.title = "Monthly review";
  await event.save();
  event.finishEditing();

  let rule = savedRule(saved[0]);
  expect(rule.FREQ).toBe("MONTHLY");
  expect(rule.BYMONTHDAY.split(",").sort()).toEqual(["1", "15"]);
  expect(rule.COUNT).toBe("10");
});

test("The last weekday of the month stays the last weekday", async () => {
  let { calendar, saved } = setup();
  let event = serverEvent(calendar, "RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1");
  event.title = "Month end";
  await event.save();

  let rule = savedRule(saved[0]);
  expect(rule.FREQ).toBe("MONTHLY");
  expect(rule.BYDAY.split(",").sort()).toEqual(["FR", "MO", "TH", "TU", "WE"]);
  expect(rule.BYSETPOS).toBe("-1");
  expect(rule.COUNT).toBeUndefined();
  expect(rule.UNTIL).toBeUndefined();
});

test("A new end of the series replaces the old end, and the rest of the rule stays", async () => {
  let { calendar, saved } = setup();
  let event = serverEvent(calendar, "RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15;COUNT=10");
  event.startEditing();
  await event.setRecurrenceCount(4);
  await event.save();
  event.finishEditing();

  let rule = savedRule(saved[0]);
  expect(rule.BYMONTHDAY.split(",").sort()).toEqual(["1", "15"]);
  expect(rule.COUNT).toBe("4");
  expect(rule.UNTIL).toBeUndefined();
});

test("A changed repetition is saved as the user set it", async () => {
  let { calendar, saved } = setup();
  let event = serverEvent(calendar, "RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15;COUNT=10");
  event.startEditing();
  event.newRecurrenceRule(Frequency.Weekly, 1, 0, [2]);
  await event.save();
  event.finishEditing();

  let rule = savedRule(saved[0]);
  expect(rule.FREQ).toBe("WEEKLY");
  expect(rule.BYDAY).toBe("TU");
  expect(rule.BYMONTHDAY).toBeUndefined();
});

test("Removing the repetition removes the rule", async () => {
  let { calendar, saved } = setup();
  let event = serverEvent(calendar, "RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15;COUNT=10");
  event.startEditing();
  event.recurrenceRule = null;
  await event.save();
  event.finishEditing();

  let vevents = new ICalParser(saved[0]).containers.vcalendar[0].containers.vevent;
  expect(vevents.some(vevent => vevent.entries.rrule)).toBe(false);
});
