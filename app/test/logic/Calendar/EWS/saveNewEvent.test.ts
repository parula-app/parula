// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { EWSCalendar } from "../../../../logic/Calendar/EWS/EWSCalendar";
import type { EWSEvent } from "../../../../logic/Calendar/EWS/EWSEvent";
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import { SQLCalendar } from "../../../../logic/Calendar/SQL/SQLCalendar";
import { SQLCalendarStorage } from "../../../../logic/Calendar/SQL/SQLCalendarStorage";
import { SQLEvent } from "../../../../logic/Calendar/SQL/SQLEvent";
import { InProcessSQLiteDatabase } from "../../util/inProcessSQLite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, expect, test } from "vitest";

const kItemID = "AAMkAGItem=";
let calendar: EWSCalendar;

beforeAll(async () => {
  let tempDir = mkdtempSync(path.join(tmpdir(), "ews-calendar-test-"));
  appGlobal.remoteApp = {
    getSQLiteDatabase: (filename: string) =>
      new InProcessSQLiteDatabase(path.join(tempDir, filename)),
  } as any;

  let account = new EWSAccount();
  account.name = "Test";
  account.callEWS = async (request: any) => {
    expect(request.m$CreateItem).toBeTruthy(); // no other server call expected
    return { Items: { CalendarItem: { ItemId: { Id: kItemID } } } };
  };
  calendar = new EWSCalendar();
  calendar.name = "Test";
  calendar.folderID = "calendar-folder";
  calendar.mainAccount = account;
  calendar.storage = new SQLCalendarStorage();
  await SQLCalendar.save(calendar);
  appGlobal.calendars.add(calendar);
});

test("The item ID that the server assigned to a new event is saved to the DB", async () => {
  let event = calendar.newEvent() as EWSEvent;
  event.title = "Planning";
  event.startTime = new Date("2026-07-14T10:00:00Z");
  event.endTime = new Date("2026-07-14T11:00:00Z");
  await event.save();
  expect(event.itemID).toBe(kItemID);

  // Read back, as on the next app start. Without the item ID, the next sync
  // would not recognize the event and would add it a second time.
  let readEvent = calendar.newEvent() as EWSEvent;
  await SQLEvent.read(event.dbID, readEvent);
  expect(readEvent.itemID).toBe(kItemID);
});
