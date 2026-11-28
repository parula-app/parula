// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { Calendar } from "../../../../logic/Calendar/Calendar";
import type { Event } from "../../../../logic/Calendar/Event";
import { SQLCalendar } from "../../../../logic/Calendar/SQL/SQLCalendar";
import { SQLCalendarStorage } from "../../../../logic/Calendar/SQL/SQLCalendarStorage";
import { SQLEvent } from "../../../../logic/Calendar/SQL/SQLEvent";
import { getDatabase } from "../../../../logic/Calendar/SQL/SQLDatabase";
import { addEventTagTable } from "../../../../logic/Calendar/SQL/SQLEventMigrate";
import { getTagByName } from "../../../../logic/Abstract/Tag";
import { InProcessSQLiteDatabase } from "../../util/inProcessSQLite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, expect, test } from "vitest";
import sql from "../../../../../lib/rs-sqlite";

let calendar: Calendar;

beforeAll(async () => {
  let tempDir = mkdtempSync(path.join(tmpdir(), "calendar-tags-test-"));
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

function newTestEvent(...tagNames: string[]): Event {
  let event = calendar.newEvent();
  event.title = "Planning";
  event.startTime = new Date("2026-07-14T10:00:00Z");
  event.endTime = new Date("2026-07-14T11:00:00Z");
  event.tags.addAll(tagNames.map(name => getTagByName(name)));
  return event;
}

/** What the app does on the next start: read the calendar from the database */
async function readAgain(event: Event): Promise<string[]> {
  let reread = new Calendar();
  reread.dbID = calendar.dbID;
  reread.storage = new SQLCalendarStorage();
  await SQLEvent.readAll(reread);
  let rereadEvent = reread.events.find(other => other.dbID == event.dbID);
  return rereadEvent.tags.contents.map(tag => tag.name);
}

test("The tags of an event are still there after a restart", async () => {
  let event = newTestEvent("Customer", "Travel");

  await event.saveLocally();

  let tagNames = await readAgain(event);
  expect(tagNames).toContain("Customer");
  expect(tagNames).toContain("Travel");
  expect(tagNames.length).toBe(2);
});

test("A removed tag stays removed after a restart", async () => {
  let event = newTestEvent("Customer", "Travel");
  await event.saveLocally();

  event.tags.remove(getTagByName("Travel"));
  await event.saveLocally();

  expect(await readAgain(event)).toEqual(["Customer"]);
});

test("Reading a single event reads its tags", async () => {
  let event = newTestEvent("Customer");
  await event.saveLocally();

  let reread = calendar.newEvent();
  await SQLEvent.read(event.dbID, reread);

  expect(reread.tags.contents.map(tag => tag.name)).toEqual(["Customer"]);
});

test("The migration adds the table for the tags to a database from before tags", async () => {
  let database = await getDatabase();
  await database.execute(sql`DROP TABLE eventTag;`);

  await addEventTagTable(database);

  let event = newTestEvent("Customer");
  await event.saveLocally();
  expect(await readAgain(event)).toEqual(["Customer"]);
});
