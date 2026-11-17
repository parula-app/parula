// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
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

const kItemID = "AAMkAGItem=";
const kItem = {
  ItemId: { Id: kItemID },
  Subject: "Planning",
  Start: "2026-07-14T10:00:00Z",
  End: "2026-07-14T11:00:00Z",
  LastModifiedTime: "2026-07-01T08:00:00Z",
};
let calendar: OWACalendar;
let errors: Error[] = [];
let waitingForGetItem: ((result: any) => void)[] = [];

beforeAll(async () => {
  let tempDir = mkdtempSync(path.join(tmpdir(), "owa-calendar-test-"));
  appGlobal.remoteApp = {
    getSQLiteDatabase: (filename: string) =>
      new InProcessSQLiteDatabase(path.join(tempDir, filename)),
    OWA: {},
  } as any;

  let account = new OWAAccount();
  account.name = "Test";
  account.errorCallback = ex => errors.push(ex);
  account.callOWA = async (request: any) => {
    if (request.action == "FindItem") {
      return { RootFolder: { IncludesLastItemInRange: true, IndexedPagingOffset: 1, Items: [kItem] } };
    }
    expect(request.action).toBe("GetItem");
    // The server takes a moment and then answers all the requests that arrived in the meantime,
    // so the sync and the invitation both see the event for the first time
    return new Promise(resolve => {
      waitingForGetItem.push(resolve);
      setTimeout(answerGetItems, 20);
    });
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

function answerGetItems() {
  for (let resolve of waitingForGetItem.splice(0)) {
    resolve({ Items: [kItem] });
  }
}

test("An invitation that Exchange processes during the sync does not add the event a second time", async () => {
  await Promise.all([
    calendar.listEventsSlow(),
    calendar.getEventFromServerByID(kItemID),
  ]);

  expect(errors).toEqual([]);
  expect(calendar.events.filterOnce(event => event.itemID == kItemID).length).toBe(1);
  let rows = await (await getDatabase()).all(sql`SELECT id FROM event WHERE pID = ${kItemID}`) as any[];
  expect(rows.length).toBe(1);
});
