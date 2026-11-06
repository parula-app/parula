// @vitest-environment happy-dom
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import type { EWSCalendar } from "../../../../logic/Calendar/EWS/EWSCalendar";
import { EWSCalendarShortcut } from "../../../../logic/Calendar/EWS/EWSCalendarShortcut";
import { MAPIAddressBookEntryID, MAPIStoreEntryID } from "../../../../logic/Mail/EWS/MAPIEntryID";
import { newCalendarForProtocol } from "../../../../logic/Calendar/AccountsList/Calendars";
import { AuthMethod } from "../../../../logic/Abstract/Account";
import { errorsForServer } from "../../../../logic/util/error";
import { expect, test, vi } from "vitest";

/* Outlook (classic and new) and Outlook on the web save the calendars of
 * other users that the user opened as navigation shortcuts, which are
 * hidden (associated) items in the folder "Common Views" in the user's own
 * mailbox, so they show up on every computer.
 * [MS-OXOCFG] 2.2.9, and Exchange's own `CalendarGroupEntry`. */

const kBobDN = "/o=Example/ou=Exchange Administrative Group (FYDIBOHF23SPDLT)/cn=Recipients/cn=bob";
const kCarolDN = "/o=Example/ou=Exchange Administrative Group (FYDIBOHF23SPDLT)/cn=Recipients/cn=carol";
const kDaveDN = "/o=Example/ou=Exchange Administrative Group (FYDIBOHF23SPDLT)/cn=Recipients/cn=dave";

function hexToBytes(hex: string): number[] {
  return hex.match(/../g).map(byte => parseInt(byte, 16));
}

function asciiz(text: string): number[] {
  return [...Array.from(text, char => char.charCodeAt(0)), 0];
}

function base64(bytes: number[]): string {
  return Buffer.from(bytes).toString("base64");
}

/** [MS-OXCDATA] 2.2.5.2 Address Book EntryID of a user */
function addressBookEntryID(legacyDN: string): string {
  return base64([
    0, 0, 0, 0, // Flags
    ...hexToBytes("DCA740C8C042101AB4B908002B2FE182"), // Provider UID
    1, 0, 0, 0, // Version
    0, 0, 0, 0, // Type: local mail user
    ...asciiz(legacyDN),
  ]);
}

/** [MS-OXCDATA] 2.2.4.3 Store Object EntryID of a mailbox, as Exchange writes it */
function storeEntryID(server: string, legacyDN: string): string {
  return base64([
    0, 0, 0, 0, // Flags
    ...hexToBytes("38A1BB1005E5101AA1BB08002B2A56C2"), // Provider UID
    0, // Version
    0, // Flag
    ...asciiz("EMSMDB.DLL"), 0, 0, 0, // DLL file name, padded to 14 bytes
    0, 0, 0, 0, // Wrapped flags
    ...hexToBytes("1B55FA20AA6611CD9BC800AA002FC45A"), // Wrapped provider UID: private store
    0x0C, 0, 0, 0, // Wrapped type
    ...asciiz(server),
    ...asciiz(legacyDN),
  ]);
}

/** A folder EntryID, as far as we care: opaque bytes */
const kCarolProjectsEntryID = [0, 0, 0, 0, ...hexToBytes("A1B2C3D4E5F60718293A4B5C6D7E8F90"), 1, 0, ...hexToBytes("00112233445566778899AABBCCDDEEFF"), 0, 0, 0, 0, 0, 0x2A, 0, 0];
const kCarolProjectsHex = kCarolProjectsEntryID.map(byte => byte.toString(16).padStart(2, "0")).join("").toUpperCase();

interface Link {
  subject: string;
  type: number;
  section: number;
  addressBookEntryID?: string;
  storeEntryID?: string;
  entryID?: number[];
  itemClass?: string;
}

/** As EWS returns the item, after `XML2JSON()` */
function linkItem(link: Link): any {
  let properties: any[] = [
    { ExtendedFieldURI: { PropertyTag: "0x6849", PropertyType: "Integer" }, Value: String(link.type) },
    { ExtendedFieldURI: { PropertyTag: "0x6852", PropertyType: "Integer" }, Value: String(link.section) },
  ];
  if (link.addressBookEntryID) {
    properties.push({ ExtendedFieldURI: { PropertyTag: "0x6854", PropertyType: "Binary" }, Value: link.addressBookEntryID });
  }
  if (link.storeEntryID) {
    properties.push({ ExtendedFieldURI: { PropertyTag: "0x684E", PropertyType: "Binary" }, Value: link.storeEntryID });
  }
  if (link.entryID) {
    properties.push({ ExtendedFieldURI: { PropertyTag: "0x684C", PropertyType: "Binary" }, Value: base64(link.entryID) });
  }
  return {
    ItemId: { Id: "link-" + link.subject },
    Subject: link.subject,
    ItemClass: link.itemClass ?? "IPM.Microsoft.WunderBar.Link",
    ExtendedProperty: properties,
  };
}

/** Bob's default calendar, as Outlook adds it with "Open Shared Calendar" */
const kBobLink: Link = { subject: "Bob Builder", type: 2, section: 3, addressBookEntryID: addressBookEntryID(kBobDN) };
/** Another calendar of Carol, not her default calendar */
const kCarolLink: Link = { subject: "Carol: Projects", type: 2, section: 3, storeEntryID: storeEntryID("EXCH01", kCarolDN), entryID: kCarolProjectsEntryID };
/** Dave left the company */
const kDaveLink: Link = { subject: "Dave", type: 2, section: 3, addressBookEntryID: addressBookEntryID(kDaveDN) };
/** Our own calendar */
const kOwnCalendarLink: Link = { subject: "Calendar", type: 0, section: 3, entryID: [1, 2, 3, 4] };
/** A calendar group header, e.g. "Shared Calendars" */
const kGroupHeaderLink: Link = { subject: "Shared Calendars", type: 4, section: 3 };
/** A mail folder in the Favorites */
const kMailFavoriteLink: Link = { subject: "Inbox", type: 0, section: 1, entryID: [5, 6, 7, 8] };
/** A shared contacts folder */
const kContactsLink: Link = { subject: "Bob's Contacts", type: 2, section: 4, addressBookEntryID: addressBookEntryID(kBobDN) };

test("Owner of the shortcut, from the address book EntryID", () => {
  expect(new MAPIAddressBookEntryID(addressBookEntryID(kBobDN)).legacyDN).toBe(kBobDN);
  expect(new MAPIAddressBookEntryID(storeEntryID("EXCH01", kBobDN)).legacyDN).toBe(null);
  expect(new MAPIAddressBookEntryID(base64([0, 0, 0])).legacyDN).toBe(null);
  expect(new MAPIAddressBookEntryID(null).legacyDN).toBe(null);
});

test("Owner of the shortcut, from the store EntryID", () => {
  expect(new MAPIStoreEntryID(storeEntryID("EXCH01", kCarolDN)).mailboxDN).toBe(kCarolDN);
  expect(new MAPIStoreEntryID(addressBookEntryID(kCarolDN)).mailboxDN).toBe(null);
  expect(new MAPIStoreEntryID(base64(new Array(70).fill(0))).mailboxDN).toBe(null);
  expect(new MAPIStoreEntryID(undefined).mailboxDN).toBe(null);
});

test("Default calendar of another user", () => {
  let shortcut = new EWSCalendarShortcut(new EWSAccount(), linkItem(kBobLink));

  expect(shortcut.isCalendarOfOtherUser).toBe(true);
  expect(shortcut.ownerLegacyDN).toBe(kBobDN);
  // Outlook saves only the owner, which means: the owner's default calendar
  expect(shortcut.hasFolder).toBe(false);
  expect(shortcut.folderEntryID.bytes.length).toBe(0);
});

test("Other calendar of another user", () => {
  let shortcut = new EWSCalendarShortcut(new EWSAccount(), linkItem(kCarolLink));

  expect(shortcut.isCalendarOfOtherUser).toBe(true);
  expect(shortcut.ownerLegacyDN).toBe(kCarolDN);
  expect(shortcut.hasFolder).toBe(true);
  expect(shortcut.folderEntryID.hex).toBe(kCarolProjectsHex);
});

test("Ignore shortcuts that are not calendars of other users", () => {
  let isCalendarOfOtherUser = (item: any) => new EWSCalendarShortcut(new EWSAccount(), item).isCalendarOfOtherUser;
  expect(isCalendarOfOtherUser(linkItem(kOwnCalendarLink))).toBe(false);
  expect(isCalendarOfOtherUser(linkItem(kGroupHeaderLink))).toBe(false);
  expect(isCalendarOfOtherUser(linkItem(kMailFavoriteLink))).toBe(false);
  expect(isCalendarOfOtherUser(linkItem(kContactsLink))).toBe(false);
  expect(isCalendarOfOtherUser(linkItem({ ...kBobLink, itemClass: "IPM.Microsoft.WunderBar.SFInfo" }))).toBe(false);
  // Another calendar needs the folder
  expect(isCalendarOfOtherUser(linkItem({ ...kCarolLink, entryID: undefined }))).toBe(false);
  expect(isCalendarOfOtherUser(linkItem({ ...kCarolLink, storeEntryID: base64([1, 2, 3]) }))).toBe(false);
  expect(isCalendarOfOtherUser(null)).toBe(false);
});

/* The EWS server */

/** Exchange prefixes the elements with `m:` and `t:`, but happy-dom's
 * `querySelector()` does not find prefixed elements, unlike Chromium,
 * so these responses use default namespaces. */
function envelope(operation: string, message: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
    <Envelope xmlns="http://schemas.xmlsoap.org/soap/envelope/">
      <Body>
        <${operation}Response xmlns="http://schemas.microsoft.com/exchange/services/2006/messages">
          <ResponseMessages>
            ${message}
          </ResponseMessages>
        </${operation}Response>
      </Body>
    </Envelope>`;
}

function success(operation: string, content: string): string {
  return envelope(operation, `
    <${operation}ResponseMessage ResponseClass="Success">
      <ResponseCode>NoError</ResponseCode>
      ${content}
    </${operation}ResponseMessage>`);
}

function error(operation: string, code: string): string {
  return envelope(operation, `
    <${operation}ResponseMessage ResponseClass="Error">
      <MessageText>${code}</MessageText>
      <ResponseCode>${code}</ResponseCode>
    </${operation}ResponseMessage>`);
}

const kTypes = `xmlns="http://schemas.microsoft.com/exchange/services/2006/types"`;

function linkXML(link: Link): string {
  let item = linkItem(link);
  return `<Message ${kTypes}>
    <ItemId Id="${item.ItemId.Id}"/>
    <Subject>${item.Subject}</Subject>
    <ItemClass>${item.ItemClass}</ItemClass>
    ${item.ExtendedProperty.map(property => `<ExtendedProperty>
      <ExtendedFieldURI PropertyTag="${property.ExtendedFieldURI.PropertyTag}" PropertyType="${property.ExtendedFieldURI.PropertyType}"/>
      <Value>${property.Value}</Value>
    </ExtendedProperty>`).join("")}
  </Message>`;
}

function calendarFolderXML(id: string, displayName: string, distinguishedFolderID?: string): string {
  return `<Folders><CalendarFolder ${kTypes}>
    <FolderId Id="${id}" ChangeKey="AgAAAA=="/>
    <DisplayName>${displayName}</DisplayName>
    <FolderClass>IPF.Appointment</FolderClass>
    ${distinguishedFolderID ? `<DistinguishedFolderId>${distinguishedFolderID}</DistinguishedFolderId>` : ""}
  </CalendarFolder></Folders>`;
}

const kPersons: Record<string, { name: string, emailAddress: string }> = {
  [kBobDN]: { name: "Bob Builder", emailAddress: "bob@example.com" },
  [kCarolDN]: { name: "Carol Singer", emailAddress: "carol@example.com" },
};

/** Answers like Exchange, and remembers the requests */
class TestServer {
  readonly requests: Document[] = [];
  links: Link[] = [kGroupHeaderLink, kOwnCalendarLink, kBobLink, kCarolLink, kDaveLink, kMailFavoriteLink, kContactsLink, kBobLink];
  haveCommonViews = true;
  /** Error code for Bob's calendar, e.g. when he stopped sharing it */
  bobCalendarError: string | null = null;

  respond(body: string): string {
    let request = new DOMParser().parseFromString(body, "text/xml");
    this.requests.push(request);
    let element = (name: string) => request.getElementsByTagName(name)[0];
    if (element("m:FindFolder")) {
      let parent = element("t:DistinguishedFolderId").getAttribute("Id");
      if (parent == "msgfolderroot") { // our own folders
        return success("FindFolder", `<RootFolder TotalItemsInView="0" IncludesLastItemInRange="true"><Folders ${kTypes}/></RootFolder>`);
      }
      expect(parent).toBe("root");
      return success("FindFolder", `<RootFolder TotalItemsInView="3" IncludesLastItemInRange="true"><Folders ${kTypes}>
        <Folder><FolderId Id="finder-id"/><DisplayName>Finder</DisplayName></Folder>
        ${this.haveCommonViews ? `<Folder><FolderId Id="common-views-id"/><DisplayName>Common Views</DisplayName></Folder>` : ""}
        <SearchFolder><FolderId Id="search-id"/><DisplayName>Reminders</DisplayName></SearchFolder>
      </Folders></RootFolder>`);
    }
    if (element("m:FindItem")) {
      expect(element("m:FindItem").getAttribute("Traversal")).toBe("Associated");
      expect(element("t:FolderId").getAttribute("Id")).toBe("common-views-id");
      return success("FindItem", `<RootFolder TotalItemsInView="${this.links.length}" IncludesLastItemInRange="true"><Items ${kTypes}>
        ${this.links.map(linkXML).join("")}
      </Items></RootFolder>`);
    }
    if (element("m:ResolveNames")) {
      let person = kPersons[element("m:UnresolvedEntry").textContent];
      if (!person) {
        return error("ResolveNames", "ErrorNameResolutionNoResults");
      }
      return success("ResolveNames", `<ResolutionSet TotalItemsInView="1" IncludesLastItemInRange="true"><Resolution ${kTypes}>
        <Mailbox><Name>${person.name}</Name><EmailAddress>${person.emailAddress}</EmailAddress><RoutingType>SMTP</RoutingType><MailboxType>Mailbox</MailboxType></Mailbox>
      </Resolution></ResolutionSet>`);
    }
    if (element("m:ConvertId")) {
      let alternateID = element("t:AlternateId");
      expect(element("m:ConvertId").getAttribute("DestinationFormat")).toBe("EwsId");
      expect(alternateID.getAttribute("Format")).toBe("HexEntryId");
      expect(alternateID.getAttribute("Id")).toBe(kCarolProjectsHex);
      expect(alternateID.getAttribute("Mailbox")).toBe("carol@example.com");
      return success("ConvertId", `<AlternateId ${kTypes} Format="EwsId" Id="carol-projects-id" Mailbox="carol@example.com"/>`);
    }
    if (element("m:GetFolder")) {
      let folderID = element("t:FolderId");
      if (folderID) {
        expect(folderID.getAttribute("Id")).toBe("carol-projects-id");
        return success("GetFolder", calendarFolderXML("carol-projects-id", "Projects"));
      }
      expect(element("t:DistinguishedFolderId").getAttribute("Id")).toBe("calendar");
      let mailbox = element("t:EmailAddress").textContent;
      expect(mailbox).toBe("bob@example.com");
      if (this.bobCalendarError) {
        return error("GetFolder", this.bobCalendarError);
      }
      return success("GetFolder", calendarFolderXML("bob-calendar-id", "Calendar", "calendar"));
    }
    throw new Error("Unexpected request " + body);
  }
}

function newTestAccount(): { account: EWSAccount, server: TestServer } {
  let account = new EWSAccount();
  account.name = "Alice";
  account.username = "alice@example.com";
  account.emailAddress = account.username;
  account.url = "https://exchange.example.com/EWS/Exchange.asmx";
  account.authMethod = AuthMethod.Unknown; // no credentials needed
  let server = new TestServer();
  globalThis.fetch = (async (_url: string, options: any) => {
    let responseText = server.respond(options.body);
    return { status: 200, text: async () => responseText };
  }) as any;
  return { account, server };
}

test("EWS: Offer the calendars of other users that the user opened in Outlook", async () => {
  let { account, server } = newTestAccount();

  let calendars = (await account.listPossibleSubAccounts()).contents as EWSCalendar[];

  expect(calendars.map(calendar => calendar.name)).toEqual(["Bob Builder Calendar", "Carol Singer Projects"]);
  let [bob, carol] = calendars;
  expect(bob.protocol).toBe("calendar-ews");
  expect(bob.username).toBe("bob@example.com");
  expect(bob.folderID).toBe("bob-calendar-id");
  expect(bob.useForInvitations).toBe(true);
  expect(bob.mainAccount).toBe(account);
  expect(carol.username).toBe("carol@example.com");
  expect(carol.folderID).toBe("carol-projects-id");
  expect(carol.useForInvitations).toBe(false);
  // Bob's calendar is in the list twice, but we look it up only once
  let resolved = server.requests
    .map(request => request.getElementsByTagName("m:UnresolvedEntry")[0]?.textContent)
    .filter(Boolean);
  expect(resolved).toEqual([kBobDN, kCarolDN, kDaveDN, kBobDN]);
});

test("EWS: Don't offer a calendar that we already added", async () => {
  let { account } = newTestAccount();
  let bobCalendar = newCalendarForProtocol("calendar-ews") as EWSCalendar;
  bobCalendar.initFromMainAccount(account);
  bobCalendar.username = "bob@example.com";
  bobCalendar.folderID = "bob-calendar-id";
  appGlobal.calendars.add(bobCalendar);

  try {
    let calendars = (await account.listPossibleSubAccounts()).contents as EWSCalendar[];

    expect(calendars.map(calendar => calendar.folderID)).toEqual(["carol-projects-id"]);
  } finally {
    appGlobal.calendars.remove(bobCalendar);
  }
});

test("EWS: Skip a calendar that is not shared with us anymore", async () => {
  let { account, server } = newTestAccount();
  server.bobCalendarError = "ErrorAccessDenied";
  let consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

  try {
    let calendars = (await account.listPossibleSubAccounts()).contents as EWSCalendar[];

    expect(calendars.map(calendar => calendar.folderID)).toEqual(["carol-projects-id"]);
    expect(consoleError).not.toHaveBeenCalled();
    expect(account.dataErrors.isEmpty).toBe(true);
  } finally {
    consoleError.mockRestore();
  }
});

test("EWS: Report an unexpected error as data error of the account, but still offer the other calendars", async () => {
  let { account, server } = newTestAccount();
  server.bobCalendarError = "ErrorInternalServerError";
  errorsForServer.clear();
  let consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

  let calendars = (await account.listPossibleSubAccounts()).contents as EWSCalendar[];

  expect(calendars.map(calendar => calendar.folderID)).toEqual(["carol-projects-id"]);
  // Bob's shortcut is in the list twice, so his calendar fails twice
  let dataErrors = account.dataErrors.contents;
  expect(dataErrors.length).toBe(2);
  expect(dataErrors.every(ex => ex.message.includes("ErrorInternalServerError"))).toBe(true);
  expect(errorsForServer.contents).toEqual(dataErrors);
  // Not in the errors that the account list shows
  expect(account.errors.isEmpty).toBe(true);
  consoleError.mockRestore();
});

test("EWS: The user never opened a calendar of another user", async () => {
  let { account, server } = newTestAccount();
  server.links = [kGroupHeaderLink, kOwnCalendarLink, kMailFavoriteLink];

  let calendars = await account.listPossibleSubAccounts();

  expect(calendars.length).toBe(0);
});

test("EWS: The mailbox has no Common Views folder", async () => {
  let { account, server } = newTestAccount();
  server.haveCommonViews = false;

  let calendars = await account.listPossibleSubAccounts();

  expect(calendars.length).toBe(0);
  expect(server.requests.some(request => request.getElementsByTagName("m:FindItem").length)).toBe(false);
});
