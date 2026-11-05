// @vitest-environment happy-dom
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import { AuthMethod } from "../../../../logic/Abstract/Account";
import { PersonUID } from "../../../../logic/Abstract/PersonUID";
import { expect, test } from "vitest";

/* Bob shared his calendar with Alice, but not his whole mailbox.
 * Lookout's "Open shared calendar" dialog asks only for the calendar. */

/** Exchange prefixes the elements with `m:` and `t:`, but happy-dom's
 * `querySelector()` does not find prefixed elements, unlike Chromium,
 * so these responses use default namespaces. */
function getFolderResponse(responseMessages: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
    <Envelope xmlns="http://schemas.xmlsoap.org/soap/envelope/">
      <Body>
        <GetFolderResponse xmlns="http://schemas.microsoft.com/exchange/services/2006/messages">
          <ResponseMessages>${responseMessages}</ResponseMessages>
        </GetFolderResponse>
      </Body>
    </Envelope>`;
}

const kCalendarShared = `
  <GetFolderResponseMessage ResponseClass="Success">
    <ResponseCode>NoError</ResponseCode>
    <Folders>
      <CalendarFolder xmlns="http://schemas.microsoft.com/exchange/services/2006/types">
        <FolderId Id="bob-calendar-id" ChangeKey="AgAAAA=="/>
        <DistinguishedFolderId>calendar</DistinguishedFolderId>
      </CalendarFolder>
    </Folders>
  </GetFolderResponseMessage>`;

const kAccessDenied = `
  <GetFolderResponseMessage ResponseClass="Error">
    <MessageText>Access is denied. Check credentials and try again.</MessageText>
    <ResponseCode>ErrorAccessDenied</ResponseCode>
    <DescriptiveLinkKey>0</DescriptiveLinkKey>
  </GetFolderResponseMessage>`;

function newTestAccount(responseText: string): EWSAccount {
  appGlobal.remoteApp ??= {} as any;
  let account = new EWSAccount();
  account.name = "Alice";
  account.username = "alice@example.com";
  account.emailAddress = account.username;
  account.url = "https://exchange.example.com/EWS/Exchange.asmx";
  account.authMethod = AuthMethod.Unknown; // no credentials needed
  globalThis.fetch = (async () => ({ status: 200, text: async () => responseText })) as any;
  return account;
}

test("EWS: Open shared calendar: Check only the calendar of the colleague", async () => {
  let bob = new PersonUID("bob@example.com");
  expect(await newTestAccount(getFolderResponse(kCalendarShared)).findSharedFolders(bob, ["calendar"])).toEqual(["calendar"]);
  expect(await newTestAccount(getFolderResponse(kAccessDenied)).findSharedFolders(bob, ["calendar"])).toEqual([]);
});

test("EWS: Sharing: Find the calendar among the folders that a colleague could have shared", async () => {
  let account = newTestAccount(getFolderResponse(kAccessDenied + kAccessDenied + kAccessDenied + kCalendarShared));
  let shared = await account.findSharedFolders(new PersonUID("bob@example.com"), ["msgfolderroot", "inbox", "contacts", "calendar"]);
  expect(shared).toEqual(["calendar"]);
});
