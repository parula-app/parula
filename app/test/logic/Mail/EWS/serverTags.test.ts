// @vitest-environment happy-dom
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import { EWSItemError } from "../../../../logic/Mail/EWS/EWSError";
import type { EWSFolder } from "../../../../logic/Mail/EWS/EWSFolder";
import type { EWSEMail } from "../../../../logic/Mail/EWS/EWSEMail";
import { ExchangeTags } from "../../../../logic/Mail/EWS/ExchangeTags";
import type { ExchangeMailAccount } from "../../../../logic/Mail/EWS/ExchangeMailAccount";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { availableTags, getTagByName, Tag } from "../../../../logic/Abstract/Tag";
import { beforeEach, expect, test, vi } from "vitest";

/** As Outlook writes it, see MS-OXOCFG 4.1.3. With an attribute that we don't know. */
const kCategoryListXML = `<?xml version="1.0"?>
<categories default="Red Category" lastSavedSession="5" lastSavedTime="2007-12-28T03:01:50.429" xmlns="CategoryList.xsd">
  <category name="Red Category" color="0" keyboardShortcut="0" usageCount="7" lastTimeUsed="2007-11-28T20:05:04.703" lastSessionUsed="3" guid="{2B7FC69C-7046-44A2-8FF3-007D7467DC82}" renameOnFirstUse="1"/>
  <category name="Projekt Größe" color="7" keyboardShortcut="0" usageCount="6" lastTimeUsed="2007-12-28T03:00:07.102" lastSessionUsed="5" guid="{33A1EAE3-8E5E-4912-9580-69FC764FEA35}" futureAttribute="keep me"/>
  <category name="Uncolored" color="-1" keyboardShortcut="0" usageCount="0" lastTimeUsed="2007-12-28T03:00:07.102" lastSessionUsed="5" guid="{58AB8B90-BB05-428A-B8D2-F1C93968C144}"/>
</categories>`;

/** An Exchange server with a category list, and 2 messages in the inbox */
class TestEWSAccount extends EWSAccount {
  /** null = The user has no category list yet */
  categoryListXML: string | null = kCategoryListXML;
  readonly serverCalls: string[] = [];
  readonly reportedErrors: Error[] = [];

  async callEWS(request: any): Promise<any> {
    let operation = Object.keys(request)[0].replace("m$", "");
    this.serverCalls.push(operation);
    if (request.m$GetUserConfiguration) {
      expect(request.m$GetUserConfiguration.m$UserConfigurationName.Name).toBe("CategoryList");
      expect(request.m$GetUserConfiguration.m$UserConfigurationName.t$DistinguishedFolderId.Id).toBe("calendar");
      if (this.categoryListXML == null) {
        throw notFound(request);
      }
      return {
        ResponseClass: "Success",
        UserConfiguration: {
          UserConfigurationName: { Name: "CategoryList" },
          XmlData: utf8ToBase64(this.categoryListXML),
        },
      };
    }
    if (request.m$UpdateUserConfiguration) {
      if (this.categoryListXML == null) {
        throw notFound(request);
      }
      this.categoryListXML = savedXML(request.m$UpdateUserConfiguration);
      return { ResponseClass: "Success" };
    }
    if (request.m$CreateUserConfiguration) {
      this.categoryListXML = savedXML(request.m$CreateUserConfiguration);
      return { ResponseClass: "Success" };
    }
    if (request.m$UpdateItem) {
      return { Items: { Message: { ItemId: { Id: "item-1" } } } };
    }
    throw new Error("Unexpected EWS call " + JSON.stringify(request));
  }
}

function notFound(request: any) {
  return new EWSItemError({
    ResponseClass: "Error",
    ResponseCode: "ErrorItemNotFound",
    MessageText: "The specified object was not found in the store.",
  }, request);
}

function savedXML(request: any): string {
  let config = request.m$UserConfiguration;
  expect(config.t$UserConfigurationName.Name).toBe("CategoryList");
  expect(config.t$UserConfigurationName.t$DistinguishedFolderId.Id).toBe("calendar");
  return new TextDecoder().decode(Uint8Array.from(atob(config.t$XmlData), char => char.charCodeAt(0)));
}

function utf8ToBase64(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

/** @param mainAccount for a shared mailbox */
function newTestAccount(mainAccount?: TestEWSAccount): TestEWSAccount {
  let account = new TestEWSAccount();
  if (mainAccount) {
    account.initFromMainAccount(mainAccount);
  }
  account.name = "Test";
  account.emailAddress = "user@example.com";
  vi.spyOn(account.tags, "add");
  account.storage = new DummyMailStorage();
  account.contentStorage.clear();
  account.errorCallback = ex => account.reportedErrors.push(ex);
  let inbox = account.newFolder();
  inbox.name = "Inbox";
  inbox.id = "inbox-1";
  inbox.specialFolder = SpecialFolder.Inbox;
  account.rootFolders.add(inbox);
  for (let i = 1; i <= 2; i++) {
    let email = inbox.newEMail();
    email.itemID = "item-" + i;
    email.subject = "Message " + i;
    inbox.messages.add(email);
  }
  return account;
}

function newTag(name: string, color: string): Tag {
  let tag = new Tag();
  tag.name = name;
  tag.color = color;
  availableTags.add(tag);
  return tag;
}

// <copied to="../OWA/serverTags.test.ts, ../Graph/serverTags.test.ts">
/** Tagging adds the tag to the server in the background */
async function tagsSavedOnServer(account: ExchangeMailAccount) {
  await Promise.allSettled(vi.mocked(account.tags.add).mock.results.map(result => result.value));
}
// </copied>

function parseXML(xml: string): Document {
  return new DOMParser().parseFromString(xml, "text/xml");
}

/** The `<category>` elements on the server */
function tagsOnServer(account: TestEWSAccount) {
  return Array.from(parseXML(account.categoryListXML).getElementsByTagName("category"), category => ({
    name: category.getAttribute("name"),
    color: Number(category.getAttribute("color")),
  }));
}

beforeEach(() => {
  availableTags.clear();
  localStorage.clear();
});

test("The categories of the server appear as tags, with their colors", async () => {
  let account = newTestAccount();

  await account.tags.load();

  expect(availableTags.contents.map(tag => [tag.name, tag.color])).toEqual([
    ["Red Category", "#D6252E"],
    ["Projekt Größe", "#3267B8"],
    ["Uncolored", "#000000"],
  ]);
  expect(JSON.parse(localStorage.getItem("tags")).map((tag: any) => tag.name))
    .toEqual(["Red Category", "Projekt Größe", "Uncolored"]);
});

test("A tag that a message already brought along gets the color of the category", async () => {
  let account = newTestAccount();
  // As `EWSEMail.fromXML()` does for the categories of a message, before we read the category list
  let tag = getTagByName("Projekt Größe");

  await account.tags.load();

  expect(tag.color).toBe("#3267B8");
  expect(availableTags.contents.filter(t => t.name == "Projekt Größe")).toEqual([tag]);
});

test("A user without category list on the server is not an error", async () => {
  let account = newTestAccount();
  account.categoryListXML = null;

  await account.tags.load();

  expect(availableTags.contents).toEqual([]);
});

test("Tagging a message with a new tag adds it as category to the server", async () => {
  let account = newTestAccount();
  await account.tags.load();
  let email = account.inbox.messages.first as EWSEMail;
  let tag = newTag("Customer", "#4AB63F");
  account.serverCalls.length = 0;

  await email.addTag(tag);
  await tagsSavedOnServer(account);

  expect(account.serverCalls).toEqual(["UpdateItem", "GetUserConfiguration", "UpdateUserConfiguration"]);
  expect(tagsOnServer(account)).toEqual([
    { name: "Red Category", color: 0 },
    { name: "Projekt Größe", color: 7 },
    { name: "Uncolored", color: -1 },
    { name: "Customer", color: 4 },
  ]);
  // MS-OXOCFG 3.1.4.2.3: Keep the attributes that we don't know
  expect(account.categoryListXML).toContain(`futureAttribute="keep me"`);
  expect(account.categoryListXML).toContain(`renameOnFirstUse="1"`);
  let xml = parseXML(account.categoryListXML);
  expect(xml.documentElement.namespaceURI).toBe("CategoryList.xsd");
  let category = xml.querySelector(`[name="Customer"]`);
  expect(category.getAttribute("guid")).toMatch(/^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/);
  expect(category.getAttribute("keyboardShortcut")).toBe("0");
  expect(category.getAttribute("lastTimeUsed")).toBeTruthy();
  expect(account.reportedErrors).toEqual([]);
});

test("Tagging a message with an existing category does not change the category list", async () => {
  let account = newTestAccount();
  await account.tags.load();
  let email = account.inbox.messages.first as EWSEMail;
  account.serverCalls.length = 0;

  await email.addTag(getTagByName("Projekt Größe"));
  // Exchange compares the category names case-insensitive
  await email.addTag(newTag("red category", "#FF0000"));
  await tagsSavedOnServer(account);

  expect(account.serverCalls).toEqual(["UpdateItem", "UpdateItem"]);
});

test("A category that somebody else added meanwhile is not added twice", async () => {
  let account = newTestAccount();
  await account.tags.load();
  account.categoryListXML = kCategoryListXML.replace(`</categories>`,
    `<category name="Customer" color="9" keyboardShortcut="0" lastTimeUsed="2026-01-01T00:00:00.000" lastSessionUsed="0" guid="{11111111-2222-3333-4444-555555555555}"/></categories>`);
  let email = account.inbox.messages.first as EWSEMail;
  account.serverCalls.length = 0;

  await email.addTag(newTag("Customer", "#4AB63F"));
  await tagsSavedOnServer(account);

  expect(account.serverCalls).toEqual(["UpdateItem", "GetUserConfiguration"]);
  expect(tagsOnServer(account).filter(tag => tag.name == "Customer")).toEqual([
    { name: "Customer", color: 9 },
  ]);
});

test("Tagging creates the category list, if the user has none yet", async () => {
  let account = newTestAccount();
  account.categoryListXML = null;
  await account.tags.load();
  let email = account.inbox.messages.first as EWSEMail;
  account.serverCalls.length = 0;

  await email.addTag(newTag("Customer", "#108310"));
  await tagsSavedOnServer(account);

  expect(account.serverCalls).toEqual(["UpdateItem", "GetUserConfiguration", "UpdateUserConfiguration", "CreateUserConfiguration"]);
  expect(tagsOnServer(account)).toEqual([{ name: "Customer", color: 19 }]);
  let root = parseXML(account.categoryListXML).documentElement;
  expect(root.namespaceURI).toBe("CategoryList.xsd");
  expect(root.getAttribute("default")).toBe("Customer");
  expect(root.getAttribute("lastSavedTime")).toBeTruthy();
});

test("Tagging several messages at once adds the category only once", async () => {
  let account = newTestAccount();
  await account.tags.load();
  let tag = newTag("Customer", "#4AB63F");
  account.serverCalls.length = 0;

  await Promise.all(account.inbox.messages.contents.map(email => email.addTag(tag)));
  await tagsSavedOnServer(account);

  expect(account.serverCalls.filter(call => call == "UpdateUserConfiguration")).toHaveLength(1);
  expect(tagsOnServer(account).filter(tag => tag.name == "Customer")).toHaveLength(1);
});

test("A failure to save the category does not fail the tagging", async () => {
  let account = newTestAccount();
  await account.tags.load();
  let email = account.inbox.messages.first as EWSEMail;
  let tag = newTag("Customer", "#4AB63F");
  let callEWS = account.callEWS.bind(account);
  account.callEWS = async (request: any) => {
    if (request.m$UpdateUserConfiguration) {
      throw new EWSItemError({
        ResponseClass: "Error",
        ResponseCode: "ErrorAccessDenied",
        MessageText: "Access is denied.",
      }, request);
    }
    return await callEWS(request);
  };

  await email.addTag(tag);

  expect(email.tags.contents).toEqual([tag]);
  await tagsSavedOnServer(account);
  expect(account.reportedErrors.map(ex => ex.message)).toEqual(["Access is denied."]);
});

test("Tagging does not wait until the category is saved", async () => {
  let account = newTestAccount();
  await account.tags.load();
  let email = account.inbox.messages.first as EWSEMail;
  let tag = newTag("Customer", "#4AB63F");
  let resumeServer: () => void;
  let serverPaused = new Promise<void>(resolve => resumeServer = resolve);
  let callEWS = account.callEWS.bind(account);
  account.callEWS = async (request: any) => {
    if (request.m$GetUserConfiguration) {
      await serverPaused;
    }
    return await callEWS(request);
  };

  await email.addTag(tag);

  expect(email.tags.contents).toEqual([tag]);
  expect(account.serverCalls).not.toContain("UpdateUserConfiguration");
  resumeServer();
  await tagsSavedOnServer(account);
  expect(account.serverCalls).toContain("UpdateUserConfiguration");
});

test("Tag colors map to the nearest category color", () => {
  let tags = newTestAccount().tags;
  ExchangeTags.kColors.forEach((hex, index) => {
    expect(tags.colorToServer(hex)).toBe(index);
    expect(tags.colorToServer(hex.toLowerCase())).toBe(index);
  });
  expect(tags.colorToServer("#FF0000")).toBe(0); // Red
  expect(tags.colorToServer("#0000FF")).toBe(7); // Blue
  expect(tags.colorToServer("#000000")).toBe(14); // Black
  expect(tags.colorToServer("red")).toBe(-1); // No color
  expect(tags.colorToServer("#12345G")).toBe(-1);
  expect(tags.colorToServer(undefined)).toBe(-1);
});

test("A tag with a comma is not added as category, because Exchange does not allow that", async () => {
  let account = newTestAccount();
  await account.tags.load();
  let email = account.inbox.messages.first as EWSEMail;
  account.serverCalls.length = 0;

  await email.addTag(newTag("Smith, John", "#4AB63F"));
  await tagsSavedOnServer(account);

  expect(account.serverCalls).toEqual(["UpdateItem"]);
});

test("Tagging a message in a shared mailbox adds the category to the list of our own account", async () => {
  let account = newTestAccount();
  let sharedMailbox = newTestAccount(account);
  // Shared mailboxes use the category list of the main account
  sharedMailbox.categoryListXML = null;
  await account.tags.load();
  await sharedMailbox.tags.load();
  let email = sharedMailbox.inbox.messages.first as EWSEMail;
  account.serverCalls.length = 0;

  await email.addTag(newTag("Customer", "#4AB63F"));
  await tagsSavedOnServer(sharedMailbox);
  await tagsSavedOnServer(account);

  expect(sharedMailbox.serverCalls).toEqual(["UpdateItem"]);
  expect(account.serverCalls).toEqual(["GetUserConfiguration", "UpdateUserConfiguration"]);
  expect(tagsOnServer(account).map(tag => tag.name)).toContain("Customer");
  expect(account.reportedErrors).toEqual([]);
});
