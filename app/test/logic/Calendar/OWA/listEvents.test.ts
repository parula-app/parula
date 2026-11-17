import { OWACalendar } from "../../../../logic/Calendar/OWA/OWACalendar";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { SQLCalendar } from "../../../../logic/Calendar/SQL/SQLCalendar";
import { SQLCalendarStorage } from "../../../../logic/Calendar/SQL/SQLCalendarStorage";
import { getDatabase } from "../../../../logic/Calendar/SQL/SQLDatabase";
import { InProcessSQLiteDatabase } from "../../util/inProcessSQLite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, expect, test } from "vitest";
import sql from "../../../../../lib/rs-sqlite";
import { appGlobal } from "../../../../logic/app";

const kEventCount = 5;
let serverItems = [];
for (let i = 0; i < kEventCount; i++) {
  serverItems.push({
    ItemId: { Id: `AAMkAGItem${i}=` },
    Subject: `Planning ${i}`,
    Start: "2026-07-14T10:00:00Z",
    End: "2026-07-14T11:00:00Z",
    LastModifiedTime: "2026-07-01T08:00:00Z",
  });
}
let calendar: OWACalendar;
let errors: Error[] = [];

beforeAll(async () => {
  let tempDir = mkdtempSync(path.join(tmpdir(), "owa-calendar-list-test-"));
  appGlobal.remoteApp = {
    getSQLiteDatabase: (filename: string) =>
      new InProcessSQLiteDatabase(path.join(tempDir, filename)),
    getFilesDir: async () => tempDir, // for `deleteLocally()`
    OWA: {},
  } as any;

  let account = new OWAAccount();
  account.name = "Test";
  account.errorCallback = ex => errors.push(ex);
  account.callOWA = async (request: any) => {
    if (request.action == "FindItem") {
      return { RootFolder: { IncludesLastItemInRange: true, IndexedPagingOffset: serverItems.length, Items: serverItems } };
    }
    expect(request.action).toBe("GetItem");
    return { Items: serverItems };
  };
  calendar = new OWACalendar();
  calendar.name = "Test";
  calendar.folderID = "calendar-folder";
  calendar.mainAccount = account;
  calendar.errorCallback = ex => errors.push(ex);
  calendar.storage = new SQLCalendarStorage();
  await SQLCalendar.save(calendar);
  appGlobal.calendars.add(calendar);
});

async function eventsInDB(): Promise<string[]> {
  let rows = await (await getDatabase()).all(sql`
    SELECT title FROM event WHERE calendarID = ${calendar.dbID}
    `) as any[];
  return rows.map(row => row.title);
}

test("Events deleted on the server are deleted locally, all of them", async () => {
  await calendar.listEventsSlow();
  expect(errors).toEqual([]);
  expect(calendar.events.length).toBe(kEventCount);
  expect((await eventsInDB()).length).toBe(kEventCount);

  serverItems = []; // the user deleted them all, e.g. in Outlook
  await calendar.listEventsSlow();

  expect(errors).toEqual([]);
  expect(calendar.events.contents).toEqual([]);
  // The ones left behind would come back on the next start.
  expect(await eventsInDB()).toEqual([]);
});
