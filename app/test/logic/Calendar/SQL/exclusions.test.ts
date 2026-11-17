// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { Calendar } from "../../../../logic/Calendar/Calendar";
import type { Event } from "../../../../logic/Calendar/Event";
import { Frequency, RecurrenceRule } from "../../../../logic/Calendar/RecurrenceRule";
import { SQLCalendar } from "../../../../logic/Calendar/SQL/SQLCalendar";
import { SQLCalendarStorage } from "../../../../logic/Calendar/SQL/SQLCalendarStorage";
import { SQLEvent } from "../../../../logic/Calendar/SQL/SQLEvent";
import { InProcessSQLiteDatabase } from "../../util/inProcessSQLite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, expect, test } from "vitest";

let calendar: Calendar;

beforeAll(async () => {
  let tempDir = mkdtempSync(path.join(tmpdir(), "calendar-exclusions-test-"));
  appGlobal.remoteApp = {
    getSQLiteDatabase: (filename: string) =>
      new InProcessSQLiteDatabase(path.join(tempDir, filename)),
  } as any;

  calendar = new Calendar();
  calendar.name = "Test";
  calendar.storage = new SQLCalendarStorage();
  await SQLCalendar.save(calendar);
  appGlobal.calendars.add(calendar);
});

/** A daily series of 3, of which the 2nd occurrence was deleted */
function newSeriesWithExclusion(): Event {
  let event = calendar.newEvent();
  event.title = "Standup";
  event.startTime = new Date("2026-07-14T10:00:00Z");
  event.endTime = new Date("2026-07-14T11:00:00Z");
  event.recurrenceRule = new RecurrenceRule({
    masterDuration: 3600,
    seriesStartTime: event.startTime,
    frequency: Frequency.Daily,
    count: 3,
  });
  event.exclusions.add(new Date("2026-07-15T10:00:00Z"));
  return event;
}

/** What the app does on the next start: read the calendar from the database */
async function readCalendarAgain(): Promise<Calendar> {
  let reread = new Calendar();
  reread.dbID = calendar.dbID;
  reread.storage = new SQLCalendarStorage();
  reread.errorCallback = ex => reread.errors.add(ex);
  await SQLEvent.readAll(reread);
  return reread;
}

test("An exclusion at a time when the series does not happen is not saved", async () => {
  let event = newSeriesWithExclusion();
  event.exclusions.add(new Date("2026-07-15T10:30:00Z"));

  await event.saveLocally();

  let reread = await readCalendarAgain();
  expect(reread.errors.contents).toEqual([]);
});

test("The deleted occurrence stays deleted after a restart", async () => {
  let event = newSeriesWithExclusion();

  await event.saveLocally();

  let reread = await readCalendarAgain();
  let series = reread.events.find(other => other.dbID == event.dbID);
  expect(series.exclusions.contents).toEqual([new Date("2026-07-15T10:00:00Z")]);
});
