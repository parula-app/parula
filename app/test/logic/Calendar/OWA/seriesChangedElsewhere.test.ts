// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { Calendar } from "../../../../logic/Calendar/Calendar";
import { OWAEvent } from "../../../../logic/Calendar/OWA/OWAEvent";
import { DummyCalendarStorage } from "../../../../logic/Calendar/SQL/DummyCalendarStorage";
import { expect, test } from "vitest";

/* When the organizer changes a series, Exchange drops its modified and deleted
 * occurrences. The master then comes without them, and the modified occurrences
 * are not items of the folder, so nothing else tells us that they are gone. */

// Weekly, 5 times from 2026-11-02 10:00 UTC
const kMaster = {
  ItemId: { Id: "master" },
  UID: "series",
  Subject: "Weekly",
  Start: "2026-11-02T10:00:00Z",
  End: "2026-11-02T11:00:00Z",
  StartTimeZoneId: "UTC",
  Recurrence: {
    __type: "RecurrenceType:#Exchange",
    RecurrencePattern: { __type: "WeeklyRecurrence:#Exchange", Interval: 1, DaysOfWeek: "Monday" },
    RecurrenceRange: { __type: "NumberedRecurrence:#Exchange", StartDate: "2026-11-02Z", NumberOfOccurrences: 5 },
  },
};
// The occurrence of 2026-11-09 moved to 15:00, the one of 2026-11-16 deleted
const kMasterWithOverrides = {
  ...kMaster,
  ModifiedOccurrences: [
    { ItemId: { Id: "occurrence" }, Start: "2026-11-09T15:00:00Z", End: "2026-11-09T16:00:00Z", OriginalStart: "2026-11-09T10:00:00Z" },
  ],
  DeletedOccurrences: [
    { Start: "2026-11-16T10:00:00Z" },
  ],
};
const kModifiedOccurrence = {
  ItemId: { Id: "occurrence" },
  UID: "series",
  Subject: "Weekly",
  RecurrenceId: "2026-11-09T10:00:00Z",
  Start: "2026-11-09T15:00:00Z",
  End: "2026-11-09T16:00:00Z",
  StartTimeZoneId: "UTC",
};

/** The master with the moved and the deleted occurrence, as `OWACalendar.getEvents()` reads them */
async function setup() {
  let calendar = new Calendar();
  calendar.name = "Test";
  calendar.storage = new DummyCalendarStorage();
  calendar.errorCallback = ex => { throw ex; };
  calendar.newEvent = (parentEvent?: OWAEvent) => new OWAEvent(calendar as any, parentEvent);
  let master = new OWAEvent(calendar as any);
  master.fromJSON(kMasterWithOverrides);
  await master.saveLocally();
  calendar.events.add(master);
  let occurrence = master.getOccurrenceByDate(new Date(kModifiedOccurrence.RecurrenceId)) as OWAEvent;
  occurrence.fromJSON(kModifiedOccurrence);
  await occurrence.saveLocally();
  expect(master.exceptions.length).toBe(1);
  expect(master.exclusions.length).toBe(1);
  return { calendar, master };
}

function occurrenceStarts(master: OWAEvent): string[] {
  return [...master.instances, ...master.exceptions].map(event => event.startTime.toISOString()).sort();
}

test("Modified and deleted occurrences that the server dropped are back to normal", async () => {
  let { calendar, master } = await setup();

  master.fromJSON(kMaster);
  await master.saveLocally();

  expect(master.exceptions.length).toBe(0);
  expect(master.exclusions.length).toBe(0);
  expect(calendar.events.contents).toEqual([master]);
  expect(occurrenceStarts(master)).toEqual([
    "2026-11-02T10:00:00.000Z", "2026-11-09T10:00:00.000Z", "2026-11-16T10:00:00.000Z",
    "2026-11-23T10:00:00.000Z", "2026-11-30T10:00:00.000Z",
  ]);
});

test("Modified and deleted occurrences that are still on the server stay", async () => {
  let { master } = await setup();
  let exception = master.exceptions.first;

  master.fromJSON(kMasterWithOverrides);
  await master.saveLocally();

  expect(master.exceptions.contents).toEqual([exception]);
  expect(master.exclusions.contents.map(exclusion => exclusion.toISOString())).toEqual(["2026-11-16T10:00:00.000Z"]);
});
