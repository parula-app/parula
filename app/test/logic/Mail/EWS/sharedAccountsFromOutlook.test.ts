// @vitest-environment happy-dom
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import { AuthMethod } from "../../../../logic/Abstract/Account";
import { expect, test } from "vitest";

/** What Outlook on the web and the new Outlook for Windows save in the
 * `OWA.OtherMailbox` user configuration, when the user adds a shared mailbox
 * with "Add shared folder or mailbox". Classic Outlook does not read it. */
const kOtherMailboxXML = `<OtherMailbox>` +
  `<entry displayName="Bob Builder" rootFolderId="" principalSMTPAddress="bob@example.com"></entry>` +
  `<entry displayName="Jürgen Müller" rootFolderId="" principalSMTPAddress="Juergen@Example.com"></entry>` +
  `</OtherMailbox>`;

function base64(text: string): string {
  return Buffer.from(text, "utf-8").toString("base64");
}

/** Exchange prefixes the elements with `m:` and `t:`, but happy-dom's
 * `querySelector()` does not find prefixed elements, unlike Chromium,
 * so these responses use default namespaces. */
function userConfigurationResponse(xmlData: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
    <Envelope xmlns="http://schemas.xmlsoap.org/soap/envelope/">
      <Body>
        <GetUserConfigurationResponse xmlns="http://schemas.microsoft.com/exchange/services/2006/messages">
          <ResponseMessages>
            <GetUserConfigurationResponseMessage ResponseClass="Success">
              <ResponseCode>NoError</ResponseCode>
              <UserConfiguration>
                <UserConfigurationName Name="OWA.OtherMailbox" xmlns="http://schemas.microsoft.com/exchange/services/2006/types">
                  <FolderId Id="root-folder-id" ChangeKey="AQAAAA=="/>
                </UserConfigurationName>
                <XmlData xmlns="http://schemas.microsoft.com/exchange/services/2006/types">${xmlData}</XmlData>
              </UserConfiguration>
            </GetUserConfigurationResponseMessage>
          </ResponseMessages>
        </GetUserConfigurationResponse>
      </Body>
    </Envelope>`;
}

/** Outlook on the web creates the user configuration only when the user adds the first account */
const kNotFoundResponse = `<?xml version="1.0" encoding="utf-8"?>
  <Envelope xmlns="http://schemas.xmlsoap.org/soap/envelope/">
    <Body>
      <GetUserConfigurationResponse xmlns="http://schemas.microsoft.com/exchange/services/2006/messages">
        <ResponseMessages>
          <GetUserConfigurationResponseMessage ResponseClass="Error">
            <MessageText>The specified object was not found in the store.</MessageText>
            <ResponseCode>ErrorItemNotFound</ResponseCode>
            <DescriptiveLinkKey>0</DescriptiveLinkKey>
          </GetUserConfigurationResponseMessage>
        </ResponseMessages>
      </GetUserConfigurationResponse>
    </Body>
  </Envelope>`;

/** Answers every EWS request with `responseText` and remembers the request */
function newTestAccount(responseText: string): { account: EWSAccount, requests: string[] } {
  let account = new EWSAccount();
  account.name = "Alice";
  account.username = "alice@example.com";
  account.emailAddress = account.username;
  account.url = "https://exchange.example.com/EWS/Exchange.asmx";
  account.authMethod = AuthMethod.Unknown; // no credentials needed
  let requests: string[] = [];
  globalThis.fetch = (async (_url: string, options: any) => {
    requests.push(options.body);
    return { status: 200, text: async () => responseText };
  }) as any;
  return { account, requests };
}

test("EWS: Offer the accounts that the user added in Outlook on the web", async () => {
  let { account, requests } = newTestAccount(userConfigurationResponse(base64(kOtherMailboxXML)));

  let persons = await account.availableSharedAccounts();

  expect(persons.contents.map(person => person.emailAddress)).toEqual(["bob@example.com", "juergen@example.com"]);
  expect(persons.contents.map(person => person.name)).toEqual(["Bob Builder", "Jürgen Müller"]);
  expect(requests.length).toBe(1);
  let request = new DOMParser().parseFromString(requests[0], "text/xml");
  let name = request.getElementsByTagName("m:UserConfigurationName")[0];
  expect(name.getAttribute("Name")).toBe("OWA.OtherMailbox");
  // The non-IPM root, not `msgfolderroot`
  expect(name.getElementsByTagName("t:DistinguishedFolderId")[0].getAttribute("Id")).toBe("root");
  expect(request.getElementsByTagName("m:UserConfigurationProperties")[0].textContent).toBe("XmlData");
});

test("EWS: Don't offer an account that we already added", async () => {
  let { account } = newTestAccount(userConfigurationResponse(base64(kOtherMailboxXML)));
  let bob = new EWSAccount();
  bob.initFromMainAccount(account);
  bob.username = "bob@example.com";
  bob.emailAddress = bob.username;
  appGlobal.emailAccounts.addAll([account, bob]);

  try {
    let persons = await account.availableSharedAccounts();

    expect(persons.contents.map(person => person.emailAddress)).toEqual(["juergen@example.com"]);
  } finally {
    appGlobal.emailAccounts.removeAll([account, bob]);
  }
});

test("EWS: The user never added an account in Outlook on the web", async () => {
  let { account } = newTestAccount(kNotFoundResponse);

  let persons = await account.availableSharedAccounts();

  expect(persons.length).toBe(0);
});

test("EWS: Skip broken and duplicate entries", async () => {
  let { account } = newTestAccount(userConfigurationResponse(base64(`<OtherMailbox>` +
    `<entry displayName="No address" rootFolderId=""></entry>` +
    `<entry displayName="Broken" principalSMTPAddress="not an address"></entry>` +
    `<entry principalSMTPAddress="bob@example.com"></entry>` +
    `<entry displayName="Bob again" principalSMTPAddress="BOB@example.com"></entry>` +
    `</OtherMailbox>`)));

  let persons = await account.availableSharedAccounts();

  expect(persons.length).toBe(1);
  expect(persons.first.emailAddress).toBe("bob@example.com");
  expect(persons.first.name).toBeUndefined();
});

test("EWS: A single account", async () => {
  let { account } = newTestAccount(userConfigurationResponse(base64(
    `<OtherMailbox><entry displayName="Bob Builder" rootFolderId="" principalSMTPAddress="bob@example.com"/></OtherMailbox>`)));

  let persons = await account.availableSharedAccounts();

  expect(persons.contents.map(person => person.emailAddress)).toEqual(["bob@example.com"]);
});

test("EWS: Empty or unexpected configuration", async () => {
  for (let xml of ["", "<OtherMailbox/>", `<SomethingElse><entry principalSMTPAddress="bob@example.com"/></SomethingElse>`, "not XML"]) {
    let { account } = newTestAccount(userConfigurationResponse(base64(xml)));

    let persons = await account.availableSharedAccounts();

    expect(persons.length).toBe(0);
  }
});

test("EWS: An account shared with us does not offer further accounts", async () => {
  let { account, requests } = newTestAccount(userConfigurationResponse(base64(kOtherMailboxXML)));
  let bob = new EWSAccount();
  bob.initFromMainAccount(account);
  bob.username = "bob@example.com";

  let persons = await bob.availableSharedAccounts();

  expect(persons.length).toBe(0);
  expect(requests.length).toBe(0);
});
