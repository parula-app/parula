import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import type { OWAEMail } from "../../../../logic/Mail/OWA/OWAEMail";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { InProcessSQLiteDatabase } from "../../util/inProcessSQLite";
import { ArrayColl } from "svelte-collections";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, expect, test, vi } from "vitest";

/* Alice opened Bob's calendar in Outlook on the web, with
 * "Add calendar" | "Add from directory", before she set up her account here.
 * `calendarShortcuts.test.ts` tests how we read Outlook's calendar list. */

class TestOWAAccount extends OWAAccount {
  readonly requests: any[] = [];
  readonly errors: Error[] = [];
  /** The server has no calendar list */
  failCalendarList = false;

  async callOWA(request: any): Promise<any> {
    this.requests.push(request);
    switch (request.action) {
      case "GetPeopleFilters":
        return [{ FolderId: { Id: "alice-contacts-id" }, DisplayName: "Contacts", IsReadOnly: false }];
      case "GetCalendarFolders":
        if (this.failCalendarList) {
          throw new Error("The server does not know GetCalendarFolders");
        }
        return {
          CalendarGroups: [{
            GroupName: "People's Calendars",
            Calendars: [{
              __type: "LinkedCalendarEntry:#Exchange",
              CalendarName: "Bob Builder",
              OwnerEmailAddress: "bob@example.com",
              IsGeneralScheduleCalendar: true,
              IsOwnerEmailAddressInvalid: false,
            }],
          }],
        };
      case "GetFolder":
        return {
          Folders: [{
            FolderId: { Id: "bob-calendar-id" },
            DisplayName: "Calendar",
            FolderClass: "IPF.Appointment",
            DistinguishedFolderId: "calendar",
          }],
        };
      case "FindItem": // the events of a calendar
        return { RootFolder: { IncludesLastItemInRange: true, Items: [] } };
      case "FindPeople": // the contacts of an address book, and the owner of a calendar in the directory
        return { ResultSet: [] };
      case "SubscribeToNotification":
        return {};
    }
    throw new Error("Unexpected request " + request.action);
  }

  /** The mail folders are not part of this test */
  async listFolders() {
    if (this.rootFolders.isEmpty) {
      addInbox(this);
    }
  }

  listenForNotifications() {
  }
}

function addInbox(account: OWAAccount) {
  let inbox = account.newFolder();
  inbox.id = "alice-inbox-id";
  inbox.name = "Inbox";
  inbox.specialFolder = SpecialFolder.Inbox;
  inbox.getNewMessages = async () => new ArrayColl<OWAEMail>();
  account.rootFolders.add(inbox);
}

function newTestAccount(): TestOWAAccount {
  let account = new TestOWAAccount();
  account.name = "Alice";
  account.username = "alice@example.com";
  account.emailAddress = account.username;
  account.url = "https://exchange.example.com/owa/";
  account.errorCallback = ex => account.errors.push(ex);
  appGlobal.emailAccounts.add(account);
  return account;
}

function calendarsOfBob() {
  return appGlobal.calendars.contents.filter(calendar => calendar.username == "bob@example.com");
}

beforeAll(() => {
  let tempDir = mkdtempSync(path.join(tmpdir(), "owa-shared-calendars-setup-test-"));
  appGlobal.remoteApp = {
    getSQLiteDatabase: (filename: string) =>
      new InProcessSQLiteDatabase(path.join(tempDir, filename)),
    getFilesDir: async () => tempDir,
    OWA: {},
  } as any;
});

afterEach(() => {
  appGlobal.emailAccounts.clear();
  appGlobal.calendars.clear();
  appGlobal.addressbooks.clear();
  appGlobal.searchOnlyAddressbooks.clear();
});

test("OWA: After setup, the calendars of colleagues that the user opened in Outlook on the web are there", async () => {
  let account = newTestAccount();

  await account.syncOnStartup();

  let [bob] = calendarsOfBob();
  expect(bob?.mainAccount).toBe(account);
  expect(bob.dbID).toBeTruthy(); // still there after a restart
  // It starts like the other calendars of the account
  await vi.waitFor(() => expect(account.requests.some(request =>
    request.action == "FindItem" && request.Body.ParentFolderIds[0].Id == "bob-calendar-id")).toBe(true));
  expect(account.errors).toEqual([]);
});

test("OWA: At a later start, a colleague's calendar that the user removed here stays removed", async () => {
  let account = newTestAccount();
  addInbox(account); // read from the database at app start

  await account.syncOnStartup();

  expect(calendarsOfBob()).toEqual([]);
});

test("OWA: A server without the calendar list of Outlook on the web still starts", async () => {
  let account = newTestAccount();
  account.failCalendarList = true;

  await account.syncOnStartup();

  expect(calendarsOfBob()).toEqual([]);
  expect(account.errors.length).toBe(1);
  expect(account.requests.some(request => request.action == "SubscribeToNotification")).toBe(true);
});
