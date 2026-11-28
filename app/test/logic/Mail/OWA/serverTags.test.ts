// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import type { OWAEMail } from "../../../../logic/Mail/OWA/OWAEMail";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import type { ExchangeMailAccount } from "../../../../logic/Mail/EWS/ExchangeMailAccount";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { availableTags, Tag } from "../../../../logic/Abstract/Tag";
import { beforeEach, expect, test, vi } from "vitest";

/** An OWA server with a master category list, and one message in the inbox */
class TestOWAAccount extends OWAAccount {
  /** As `GetOwaUserConfiguration` returns it */
  masterList: any[] = [
    { __type: "CategoryType:#Exchange", Name: "Red category", Color: 0, Id: "a1" },
    { __type: "CategoryType:#Exchange", Name: "Customer", Color: 7, Id: "a2" },
    { __type: "CategoryType:#Exchange", Name: "Uncolored", Color: -1, Id: "a3" },
  ];
  readonly calls: { action: string, body: any }[] = [];
  readonly reportedErrors: Error[] = [];

  async callOWAShared(url: string, options: any): Promise<any> {
    let action = options.headers.Action;
    this.calls.push({ action, body: JSON.parse(options.body) });
    if (action == "GetOwaUserConfiguration") {
      return { MasterCategoryList: { MasterList: this.masterList, DefaultList: [] } };
    }
    if (action == "UpdateMasterCategoryList") {
      // The server ignores categories that it already has
      for (let category of JSON.parse(options.body).request.AddCategoryList) {
        if (!this.masterList.some(existing => existing.Name.toLowerCase() == category.Name.toLowerCase())) {
          this.masterList.push(category);
        }
      }
      return { MasterList: this.masterList, WasSuccessful: true };
    }
    if (action == "UpdateItem") {
      return { Items: [{ ItemId: { Id: "item-1" } }] };
    }
    throw new Error("Unexpected OWA call " + action);
  }
}

function newTestAccount(): TestOWAAccount {
  appGlobal.remoteApp = { OWA: {} } as any;
  let account = new TestOWAAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.url = "https://owa.example.com/owa/";
  account.storage = new DummyMailStorage();
  account.contentStorage.clear();
  account.errorCallback = ex => account.reportedErrors.push(ex);
  vi.spyOn(account.tags, "add");
  let inbox = account.newFolder();
  inbox.name = "Inbox";
  inbox.id = "inbox-1";
  inbox.specialFolder = SpecialFolder.Inbox;
  account.rootFolders.add(inbox);
  let email = inbox.newEMail();
  email.itemID = "item-1";
  email.subject = "Message";
  inbox.messages.add(email);
  return account;
}

function newTag(name: string, color: string): Tag {
  let tag = new Tag();
  tag.name = name;
  tag.color = color;
  availableTags.add(tag);
  return tag;
}

// <copied from="../EWS/serverTags.test.ts">
/** Tagging adds the tag to the server in the background */
async function tagsSavedOnServer(account: ExchangeMailAccount) {
  await Promise.allSettled(vi.mocked(account.tags.add).mock.results.map(result => result.value));
}
// </copied>

beforeEach(() => {
  availableTags.clear();
  localStorage.clear();
});

test("The master categories appear as tags, with their colors", async () => {
  let account = newTestAccount();

  await account.tags.load();

  expect(account.calls.map(call => call.action)).toEqual(["GetOwaUserConfiguration"]);
  expect(availableTags.contents.map(tag => [tag.name, tag.color])).toEqual([
    ["Red category", "#D6252E"],
    ["Customer", "#3267B8"],
    ["Uncolored", "#000000"],
  ]);
});

test("A mailbox without master category list is not an error", async () => {
  let account = newTestAccount();
  account.masterList = undefined;

  await account.tags.load();

  expect(availableTags.contents).toEqual([]);
});

test("Tagging a message with a new tag adds it as master category", async () => {
  let account = newTestAccount();
  await account.tags.load();
  let email = account.inbox.messages.first as OWAEMail;
  account.calls.length = 0;

  await email.addTag(newTag("Project", "#4AB63F"));
  await tagsSavedOnServer(account);

  expect(account.calls.map(call => call.action)).toEqual(["UpdateItem", "UpdateMasterCategoryList"]);
  let update = account.calls[1];
  expect(update.body.request.__type).toBe("UpdateMasterCategoryListRequest:#Exchange");
  expect(update.body.request.AddCategoryList).toHaveLength(1);
  expect(update.body.request.AddCategoryList[0]).toMatchObject({ Name: "Project", Color: 4 });
  expect(account.masterList.map(category => category.Name)).toEqual(["Red category", "Customer", "Uncolored", "Project"]);
  expect(account.reportedErrors).toEqual([]);
});

test("Tagging a message with an existing category does not change the master list", async () => {
  let account = newTestAccount();
  await account.tags.load();
  let email = account.inbox.messages.first as OWAEMail;
  account.calls.length = 0;

  await email.addTag(newTag("customer", "#FF0000"));
  await tagsSavedOnServer(account);

  expect(account.calls.map(call => call.action)).toEqual(["UpdateItem"]);
});
