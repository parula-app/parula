// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { Calendar } from "../../../../logic/Calendar/Calendar";
import { CalDAVCalendar } from "../../../../logic/Calendar/CalDAV/CalDAVCalendar";
import type { Event } from "../../../../logic/Calendar/Event";
import { Frequency, RecurrenceRule } from "../../../../logic/Calendar/RecurrenceRule";
import { SQLCalendar } from "../../../../logic/Calendar/SQL/SQLCalendar";
import { SQLCalendarStorage } from "../../../../logic/Calendar/SQL/SQLCalendarStorage";
import { getDatabase } from "../../../../logic/Calendar/SQL/SQLDatabase";
import { removeDuplicateEvents } from "../../../../logic/Calendar/SQL/SQLEventMigrate";
import { InProcessSQLiteDatabase } from "../../util/inProcessSQLite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, expect, test } from "vitest";
import sql from "../../../../../lib/rs-sqlite";

let calendar: Calendar;

beforeAll(async () => {
  let tempDir = mkdtempSync(path.join(tmpdir(), "calendar-duplicates-test-"));
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

function newTestEvent(title: string, pID: string | null): Event {
  let event = calendar.newEvent();
  event.title = title;
  event.pID = pID;
  event.startTime = new Date("2026-07-14T10:00:00Z");
  event.endTime = new Date("2026-07-14T11:00:00Z");
  return event;
}

/** A daily series, as the sync saved it, with the server ID of its master */
function newRecurringTestEvent(title: string, pID: string): Event {
  let event = newTestEvent(title, pID);
  event.recurrenceRule = new RecurrenceRule({
    masterDuration: 3600,
    seriesStartTime: event.startTime,
    frequency: Frequency.Daily,
    count: 3,
  });
  return event;
}

/** A modified occurrence of the series, as the sync saved it, with its own server ID */
async function saveTestException(series: Event, pID: string): Promise<Event> {
  let exception = series.instances.getIndex(1);
  exception.pID = pID;
  await exception.saveLocally();
  return exception;
}

test("The same server ID cannot be saved twice in the same calendar", async () => {
  await newTestEvent("Planning", "item-1").saveLocally();

  await expect(newTestEvent("Planning", "item-1").saveLocally()).rejects.toThrow();
});

test("Events that exist only locally have no server ID and may repeat", async () => {
  await newTestEvent("Lunch", null).saveLocally();
  await newTestEvent("Lunch", null).saveLocally();
});

test("The migration removes the events that older versions saved twice", async () => {
  let database = await getDatabase();
  await database.execute(sql`DROP INDEX index_event_pID;`); // as in a DB from before the index
  // 2 syncs at the same time each saved the series and its modified occurrence,
  // and the second sync got to the occurrence first
  let series = newRecurringTestEvent("Standup", "series");
  await series.saveLocally();
  let seriesCopy = newRecurringTestEvent("Standup", "series");
  await seriesCopy.saveLocally();
  await saveTestException(seriesCopy, "occurrence");
  let exception = await saveTestException(series, "occurrence");
  // A new event, saved before the server assigned its ID, then added again by the sync
  let fromServer = newTestEvent("Review", "item-2");
  await fromServer.saveLocally();
  let local = newTestEvent("Review", null);
  local.calUID = fromServer.calUID;
  await local.saveLocally();
  // An event that exists only locally, so there is nothing to remove
  let localOnly = newTestEvent("Lunch", null);
  await localOnly.saveLocally();
  // CalDAV kept the URL in the JSON, where neither the copies nor the index see it
  let davCalendar = new CalDAVCalendar();
  davCalendar.name = "DAV";
  davCalendar.storage = new SQLCalendarStorage();
  await SQLCalendar.save(davCalendar);
  const kURL = "https://dav.example.com/calendars/test/standup.ics";
  let dav = await insertOldCalDAVRow(davCalendar, kURL);
  await insertOldCalDAVRow(davCalendar, kURL);

  database.pragma("foreign_keys = false"); // as `migrate()` runs the migrations
  await removeDuplicateEvents(database);
  database.pragma("foreign_keys = true");

  let rows = await database.all(sql`
    SELECT id FROM event WHERE calendarID = ${calendar.dbID} AND id >= ${series.dbID} ORDER BY id
    `) as any[];
  expect(rows.map(row => row.id)).toEqual([series.dbID, exception.dbID, fromServer.dbID, localOnly.dbID]);
  let davRows = await database.all(sql`
    SELECT id, pID, json FROM event WHERE calendarID = ${davCalendar.dbID}
    `) as any[];
  expect(davRows.map(row => row.id)).toEqual([dav]);
  expect(davRows[0].pID).toBe(kURL);
  expect(JSON.parse(davRows[0].json)).toEqual({ original: "BEGIN:VCALENDAR" });
  // The index is in place afterwards, so the copies cannot come back
  await expect(newTestEvent("Standup", "series").saveLocally()).rejects.toThrow();
});

/** A CalDAV event as the versions before the index saved it: the URL in the JSON, no server ID.
 * @returns the row ID */
async function insertOldCalDAVRow(calendar: Calendar, url: string): Promise<number> {
  let insert = await (await getDatabase()).run(sql`
    INSERT INTO event (calendarID, calUID, title, startTime, endTime, json)
    VALUES (${calendar.dbID}, ${"standup-uid"}, ${"Standup"},
      ${"2026-07-14T10:00:00.000Z"}, ${"2026-07-14T11:00:00.000Z"},
      ${JSON.stringify({ url, original: "BEGIN:VCALENDAR" })})
    `);
  return insert.lastInsertRowid as number;
}
