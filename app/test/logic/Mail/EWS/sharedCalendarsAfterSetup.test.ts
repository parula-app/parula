import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import type { EWSEMail } from "../../../../logic/Mail/EWS/EWSEMail";
import { EWSCalendarShortcut } from "../../../../logic/Calendar/EWS/EWSCalendarShortcut";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { InProcessSQLiteDatabase } from "../../util/inProcessSQLite";
import { ArrayColl } from "svelte-collections";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, expect, test, vi } from "vitest";

/* Alice opened Bob's calendar in Outlook before she set up her account here.
 * `calendarShortcuts.test.ts` tests how we read Outlook's navigation shortcuts. */

class TestEWSAccount extends EWSAccount {
  readonly requests: any[] = [];
  readonly errors: Error[] = [];

  async callEWS(request: any): Promise<any> {
    this.requests.push(request);
    if (request.m$SyncFolderItems) { // the events of a calendar
      return { IncludesLastItemInRange: "true", SyncState: "sync-state", Changes: {} };
    }
    throw new Error("Unexpected request " + Object.keys(request)[0]);
  }

  /** The mail folders are not part of this test */
  async listFolders() {
    if (this.rootFolders.isEmpty) {
      addInbox(this);
    }
  }

  async subscribeToNotifications() {
  }

  async subscribeToNotificationsForSubaccount() {
  }
}

function addInbox(account: EWSAccount) {
  let inbox = account.newFolder();
  inbox.id = "alice-inbox-id";
  inbox.name = "Inbox";
  inbox.specialFolder = SpecialFolder.Inbox;
  inbox.getNewMessages = async () => new ArrayColl<EWSEMail>();
  account.rootFolders.add(inbox);
}

function newTestAccount(): TestEWSAccount {
  let account = new TestEWSAccount();
  account.name = "Alice";
  account.username = "alice@example.com";
  account.emailAddress = account.username;
  account.url = "https://exchange.example.com/EWS/Exchange.asmx";
  account.errorCallback = ex => account.errors.push(ex);
  appGlobal.emailAccounts.add(account);
  return account;
}

/** Bob's calendar, as `EWSCalendarShortcut` finds it in Alice's navigation shortcuts */
function outlookCalendars(failure?: Error) {
  return vi.spyOn(EWSCalendarShortcut, "listCalendars").mockImplementation(async (account: EWSAccount) => {
    if (failure) {
      throw failure;
    }
    let folder = { FolderId: { Id: "bob-calendar-id" }, DisplayName: "Calendar", FolderClass: "IPF.Appointment", DistinguishedFolderId: "calendar" };
    return [account.createCalendarAccount(folder, { name: "Bob Builder", username: "bob@example.com", color: "#008000" })];
  });
}

function calendarsOfBob() {
  return appGlobal.calendars.contents.filter(calendar => calendar.username == "bob@example.com");
}

beforeAll(() => {
  let tempDir = mkdtempSync(path.join(tmpdir(), "ews-shared-calendars-setup-test-"));
  appGlobal.remoteApp = {
    getSQLiteDatabase: (filename: string) =>
      new InProcessSQLiteDatabase(path.join(tempDir, filename)),
    getFilesDir: async () => tempDir,
  } as any;
});

afterEach(() => {
  vi.restoreAllMocks();
  appGlobal.emailAccounts.clear();
  appGlobal.calendars.clear();
  appGlobal.searchOnlyAddressbooks.clear();
});

test("EWS: After setup, the calendars of colleagues that the user opened in Outlook are there", async () => {
  outlookCalendars();
  let account = newTestAccount();

  await account.syncOnStartup();

  let [bob] = calendarsOfBob();
  expect(bob?.mainAccount).toBe(account);
  expect(bob.dbID).toBeTruthy(); // still there after a restart
  // It starts like the other calendars of the account
  await vi.waitFor(() => expect(account.requests.some(request =>
    request.m$SyncFolderItems?.m$SyncFolderId.t$FolderId.Id == "bob-calendar-id")).toBe(true));
  expect(account.errors).toEqual([]);
});

test("EWS: At a later start, a colleague's calendar that the user removed here stays removed", async () => {
  outlookCalendars();
  let account = newTestAccount();
  addInbox(account); // read from the database at app start

  await account.syncOnStartup();

  expect(calendarsOfBob()).toEqual([]);
});

test("EWS: When Outlook's calendar list fails, the account still starts", async () => {
  outlookCalendars(new Error("Common Views not readable"));
  let account = newTestAccount();
  let subscribe = vi.spyOn(account, "subscribeToNotifications");

  await account.syncOnStartup();

  expect(calendarsOfBob()).toEqual([]);
  expect(account.errors.length).toBe(1);
  expect(subscribe).toHaveBeenCalled();
});
