import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { PersonUID } from "../../../../logic/Abstract/PersonUID";
import { beforeAll, expect, test } from "vitest";

/* Bob shared his calendar with Alice, but not his whole mailbox.
 * Lookout's "Open shared calendar" dialog asks only for the calendar. */

const kBob = "bob@example.com";

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
  }
  throw new Error("Unexpected request " + action);
}

let account: OWAAccount;

class TestOWAAccount extends OWAAccount {
  constructor() {
    super();
    this.hasLoggedIn = true;
  }
}

beforeAll(() => {
  appGlobal.remoteApp ??= { OWA: {} } as any; // `OWAAccount` needs the backend only for the login
  account = new TestOWAAccount();
  account.name = "Alice";
  account.username = "alice@example.com";
  account.emailAddress = account.username;
  account.url = "https://outlook.office365.com/owa/";
  account.authorizationHeader = "Bearer alice-token";

  globalThis.fetch = (async (url: string, options: any) => ({
    ok: true,
    status: 200,
    statusText: "OK",
    url,
    headers: { get: () => "application/json; charset=utf-8" },
    text: async () => JSON.stringify({ Body: { ResponseMessages: { Items: serve(options.headers.Action, JSON.parse(options.body).Body) } } }),
  })) as any;
});

test("OWA: Open shared calendar: Check only the calendar of the colleague", async () => {
  expect(await account.findSharedFolders(new PersonUID(kBob), ["calendar"])).toEqual(["calendar"]);
  expect(await account.findSharedFolders(new PersonUID("carol@example.com"), ["calendar"])).toEqual([]);
  expect(await account.findSharedFolders(new PersonUID(kBob), ["contacts"])).toEqual([]);
});

test("OWA: Sharing: Find the calendar among the folders that a colleague could have shared", async () => {
  let shared = await account.findSharedFolders(new PersonUID(kBob), ["msgfolderroot", "inbox", "contacts", "calendar"]);
  expect(shared).toEqual(["calendar"]);
});
