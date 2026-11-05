import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { PersonUID } from "../../../../logic/Abstract/PersonUID";
import { InProcessSQLiteDatabase } from "../../util/inProcessSQLite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, expect, test } from "vitest";

/* Bob shared his calendar with Alice, e.g. with "Share calendar" in Outlook,
 * which gives Alice folder permissions on his calendar folder, e.g. Reviewer.
 * Bob did not give her Full Access to his whole mailbox.
 *
 * <https://learn.microsoft.com/en-us/exchange/client-developer/exchange-web-services/delegate-access-and-ews-in-exchange>:
 * Alice gets the ID of Bob's calendar folder with `DistinguishedFolderId` and `Mailbox`,
 * and then the folder and item IDs point to Bob's mailbox.
 * <https://learn.microsoft.com/en-us/previous-versions/office/exchange-server-2010/aa998830(v=exchg.141)>:
 * Logging on to another user's mailbox in Outlook on the web needs Full Access. */

const kAlice = "alice@example.com";
const kBob = "bob@example.com";
/** As the sharing settings check them */
const kSharedFolders = ["msgfolderroot", "inbox", "contacts", "calendar"];

const kBobEvents = [{
  ItemId: { Id: "bob-event-1" },
  Subject: "Dentist",
  Start: "2026-11-10T10:00:00Z",
  End: "2026-11-10T11:00:00Z",
  LastModifiedTime: "2026-11-01T08:00:00Z",
}, {
  ItemId: { Id: "bob-event-2" },
  Subject: "Team meeting",
  Start: "2026-11-11T09:00:00Z",
  End: "2026-11-11T10:00:00Z",
  LastModifiedTime: "2026-11-01T08:00:00Z",
}];

function errorResponse(code: string): any {
  return { ResponseClass: "Error", ResponseCode: code, MessageText: code };
}

/** What Exchange answers, when Alice is logged on */
function serve(action: string, body: any): any {
  switch (action) {
    case "GetFolder":
      return body.FolderIds.map(folderID =>
        folderID.Mailbox?.EmailAddress == kBob && folderID.Id == "calendar"
          ? {
            ResponseClass: "Success",
            Folders: [{
              __type: "CalendarFolder:#Exchange",
              FolderId: { Id: "bob-calendar-id" },
              DisplayName: "Calendar",
              FolderClass: "IPF.Appointment",
              DistinguishedFolderId: "calendar",
            }],
          }
          : errorResponse("ErrorAccessDenied"));
    case "FindItem":
      expect(body.ParentFolderIds[0].Id).toBe("bob-calendar-id");
      return [{
        ResponseClass: "Success",
        RootFolder: { IncludesLastItemInRange: true, IndexedPagingOffset: kBobEvents.length, Items: kBobEvents },
      }];
    case "GetItem":
      return body.ItemIds.map(itemID => ({
        ResponseClass: "Success",
        Items: kBobEvents.filter(event => event.ItemId.Id == itemID.Id),
      }));
  }
  throw new Error("Unexpected request " + action);
}

let account: OWAAccount;
let errors: Error[] = [];

class TestOWAAccount extends OWAAccount {
  constructor() {
    super();
    this.hasLoggedIn = true;
  }
}

beforeAll(() => {
  let tempDir = mkdtempSync(path.join(tmpdir(), "owa-shared-calendar-test-"));
  appGlobal.remoteApp = {
    getSQLiteDatabase: (filename: string) =>
      new InProcessSQLiteDatabase(path.join(tempDir, filename)),
    getFilesDir: async () => tempDir,
    OWA: {},
  } as any;
  account = new TestOWAAccount();
  account.name = "Alice";
  account.username = kAlice;
  account.emailAddress = kAlice;
  account.url = "https://outlook.office365.com/owa/";
  account.authorizationHeader = "Bearer alice-token";
  account.errorCallback = ex => errors.push(ex);

  // Office 365. The server lets Alice log on only to her own mailbox.
  globalThis.fetch = (async (url: string, options: any) => {
    let headers = options.headers;
    let request = JSON.parse(options.body);
    let logon = headers["x-owa-explicitlogonuser"];
    let items = logon && logon != kAlice
      ? [errorResponse("ErrorAccessDenied")]
      : serve(headers.Action, request.Body);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      url,
      headers: { get: () => "application/json; charset=utf-8" },
      text: async () => JSON.stringify({ Body: { ResponseMessages: { Items: items } } }),
    };
  }) as any;
});

test("OWA: Sharing: Add the calendar that a colleague shared with us", async () => {
  let bob = new PersonUID(kBob, "Bob Builder");

  let shared = await account.findSharedFolders(bob, kSharedFolders);
  expect(shared).toEqual(["calendar"]);
  let calendar = await account.addSharedCalendar(bob);

  expect(errors).toEqual([]);
  expect(calendar.events.contents.map(event => event.title).sort()).toEqual(["Dentist", "Team meeting"]);
  expect(appGlobal.calendars.contains(calendar)).toBe(true);
  expect(calendar.dbID).toBeTruthy(); // still there after a restart
});

test("OWA: Open shared calendar: Check only the calendar of the colleague", async () => {
  expect(await account.findSharedFolders(new PersonUID(kBob), ["calendar"])).toEqual(["calendar"]);
  expect(await account.findSharedFolders(new PersonUID("carol@example.com"), ["calendar"])).toEqual([]);
  expect(await account.findSharedFolders(new PersonUID(kBob), ["contacts"])).toEqual([]);
});
