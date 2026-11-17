// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { CalDAVCalendar } from "../../../../logic/Calendar/CalDAV/CalDAVCalendar";
import type { CalDAVEvent } from "../../../../logic/Calendar/CalDAV/CalDAVEvent";
import { AuthMethod } from "../../../../logic/Abstract/Account";
import { SQLCalendar } from "../../../../logic/Calendar/SQL/SQLCalendar";
import { SQLCalendarStorage } from "../../../../logic/Calendar/SQL/SQLCalendarStorage";
import { SQLEvent } from "../../../../logic/Calendar/SQL/SQLEvent";
import { InProcessSQLiteDatabase } from "../../util/inProcessSQLite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, expect, test } from "vitest";

const kCalendarURL = "https://dav.example.com/calendars/test/";
let calendar: CalDAVCalendar;

beforeAll(async () => {
  let tempDir = mkdtempSync(path.join(tmpdir(), "caldav-calendar-test-"));
  appGlobal.remoteApp = {
    getSQLiteDatabase: (filename: string) =>
      new InProcessSQLiteDatabase(path.join(tempDir, filename)),
  } as any;

  calendar = new CalDAVCalendar();
  calendar.name = "Test";
  calendar.calendarURL = kCalendarURL;
  calendar.authMethod = AuthMethod.Password;
  calendar.password = "test";
  // `login()` returns early when we already have a client
  calendar.client = {
    createCalendarObject: async () => ({ ok: true }),
  } as any;
  calendar.storage = new SQLCalendarStorage();
  await SQLCalendar.save(calendar);
  appGlobal.calendars.add(calendar);
});

test("The URL that a new event got on the server is saved to the DB", async () => {
  let event = calendar.newEvent();
  event.title = "Planning";
  event.startTime = new Date("2026-07-14T10:00:00Z");
  event.endTime = new Date("2026-07-14T11:00:00Z");
  await event.save();
  expect(event.url).toBe(kCalendarURL + event.calUID + ".ics");

  // Read back, as on the next app start. Without the URL, the next sync
  // would not recognize the event and would add it a second time.
  let readEvent = calendar.newEvent() as CalDAVEvent;
  await SQLEvent.read(event.dbID, readEvent);
  expect(readEvent.url).toBe(event.url);
});

test("The URL is the server ID of the event, so it cannot be saved twice", async () => {
  let event = calendar.newEvent() as CalDAVEvent;
  event.title = "Standup";
  event.startTime = new Date("2026-07-14T10:00:00Z");
  event.endTime = new Date("2026-07-14T11:00:00Z");
  event.url = kCalendarURL + "standup.ics";
  await event.saveLocally();
  expect(event.pID).toBe(event.url);

  let copy = calendar.newEvent() as CalDAVEvent;
  copy.title = "Standup";
  copy.startTime = event.startTime;
  copy.endTime = event.endTime;
  copy.url = event.url;
  await expect(copy.saveLocally()).rejects.toThrow();
});
