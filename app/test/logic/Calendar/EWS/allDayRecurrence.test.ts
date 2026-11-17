// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { Calendar } from "../../../../logic/Calendar/Calendar";
import { EWSEvent } from "../../../../logic/Calendar/EWS/EWSEvent";
import { expect, test } from "vitest";

/* Exchange sends the times of an all-day event as the UTC time that would be
 * midnight in the event's time zone, and we convert them to local midnight.
 * The occurrence dates of a recurrence need the same conversion, otherwise
 * they no longer match the recurrence that we generate from the start time,
 * and the sync logged "occurrence date not in recurrence" and dropped the
 * modified occurrence. Happens only when the event has a different time zone
 * than the machine, which is why the tests use New Zealand. */
const kTimezone = "New Zealand Standard Time"; // UTC+13 in March
// Daily, 2024-03-15 to 2024-03-19, with 2024-03-17 moved to 2024-03-18
const kMaster = {
  ItemId: { Id: "master" },
  UID: "series",
  Subject: "Daily all-day event",
  Start: "2024-03-14T11:00:00Z",
  End: "2024-03-15T11:00:00Z",
  IsAllDayEvent: "true",
  StartTimeZoneId: kTimezone,
  Recurrence: {
    DailyRecurrence: { Interval: "1" },
    NumberedRecurrence: { StartDate: "2024-03-15+13:00", NumberOfOccurrences: "5" },
  },
};
const kModifiedOccurrence = {
  ItemId: { Id: "occurrence" },
  UID: "series",
  Subject: "Daily all-day event",
  RecurrenceId: "2024-03-16T11:00:00Z",
  Start: "2024-03-17T11:00:00Z",
  End: "2024-03-18T11:00:00Z",
  IsAllDayEvent: "true",
  StartTimeZoneId: kTimezone,
};

function newMaster(): EWSEvent {
  let calendar = new Calendar();
  calendar.name = "Test";
  let master = new EWSEvent(calendar as any);
  master.fromXML(kMaster);
  return master;
}

test("All-day event times are the local midnight of the event time zone", () => {
  let master = newMaster();
  expect(master.allDay).toBe(true);
  expect(master.startTime.getTime()).toBe(new Date("2024-03-15T00:00:00").getTime());
  expect(master.timezone).toBe(null);
  expect(master.allDayTimezone).toBe("Pacific/Auckland");
});

test("Modified occurrence of an all-day event is found in the recurrence", () => {
  let master = newMaster();
  // What `EWSCalendar.getEvents()` looks up the occurrence by
  let recurrenceStartTime = master.toLocalMidnight(new Date(kModifiedOccurrence.RecurrenceId));
  expect(recurrenceStartTime.getTime()).toBe(new Date("2024-03-17T00:00:00").getTime());
  expect(master.recurrenceRule.getIndexOfOccurrence(recurrenceStartTime)).toBe(2);
  expect(master.getOccurrenceByDate(recurrenceStartTime)).toBeTruthy();
});

test("Modified occurrence of an all-day event replaces its instance", () => {
  let master = newMaster();
  let instance = master.getOccurrenceByDate(master.toLocalMidnight(new Date(kModifiedOccurrence.RecurrenceId)));
  let exception = new EWSEvent(master.calendar, master);
  exception.fromXML(kModifiedOccurrence);
  // Otherwise the master generates an instance for the same occurrence again
  expect(exception.recurrenceStartTime.getTime()).toBe(instance.recurrenceStartTime.getTime());
  expect(exception.startTime.getTime()).toBe(new Date("2024-03-18T00:00:00").getTime());
});
