// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import type { EWSFolder } from "../../../../logic/Mail/EWS/EWSFolder";
import type { EWSEMail } from "../../../../logic/Mail/EWS/EWSEMail";
import { EWSItemError } from "../../../../logic/Mail/EWS/EWSError";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { expect, test } from "vitest";

appGlobal.remoteApp ??= {} as any;

/** An Exchange server whose folder has "item-1" and "item-3".
 * "item-2" was deleted there while our sync state was too old, or lost. */
class TestEWSAccount extends EWSAccount {
  onServer = ["item-1", "item-3"];
  /** A sync state that the server no longer accepts */
  expiredSyncState = "sync-old";

  async callEWS(request: any): Promise<any> {
    if (request.m$SyncFolderItems) {
      let syncState = request.m$SyncFolderItems.m$SyncState;
      if (syncState == this.expiredSyncState) {
        throw new EWSItemError({ ResponseClass: "Error", ResponseCode: "ErrorInvalidSyncStateData", MessageText: "Synchronization state data is corrupt or otherwise invalid." }, request);
      }
      if (syncState) {
        // Nothing changed since then
        return { SyncState: "sync-3", IncludesLastItemInRange: "true", Changes: {} };
      }
      // Without a sync state, the server lists every email of the folder as created
      return {
        SyncState: "sync-2",
        IncludesLastItemInRange: "true",
        Changes: { Create: this.onServer.map(id => ({ Message: { ItemId: { Id: id }, IsRead: "true" } })) },
      };
    }
    throw new Error("Unexpected EWS call " + JSON.stringify(request));
  }
}

function setUpFolder(syncState: string, localIDs = ["item-1", "item-2", "item-3"]): { account: TestEWSAccount, folder: EWSFolder } {
  let account = new TestEWSAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.name = "Inbox";
  folder.id = "inbox-1";
  folder.syncState = syncState;
  account.rootFolders.add(folder);
  for (let id of localIDs) {
    let email = folder.newEMail() as EWSEMail;
    email.itemID = id;
    folder.messages.add(email);
  }
  return { account, folder };
}

function itemIDs(folder: EWSFolder): string[] {
  return folder.messages.contents.map(email => (email as EWSEMail).itemID).sort();
}

test("When the server no longer accepts our sync state, emails deleted meanwhile are removed here", async () => {
  let { folder } = setUpFolder("sync-old");

  await folder.listMessages();

  expect(itemIDs(folder)).toEqual(["item-1", "item-3"]);
});

test("When several emails were deleted meanwhile, all of them are removed here", async () => {
  // 3 of 4 emails gone: at least 2 of them are next to each other in the folder, in any sort order
  let { account, folder } = setUpFolder("sync-old", ["item-1", "item-2", "item-3", "item-4"]);
  account.onServer = ["item-1"];

  await folder.listMessages();

  expect(itemIDs(folder)).toEqual(["item-1"]);
});

test("A full resync removes the emails that are no longer on the server", async () => {
  let { folder } = setUpFolder("sync-1");

  await folder.fullResync();

  expect(itemIDs(folder)).toEqual(["item-1", "item-3"]);
});

test("A sync with a sync state keeps the emails that it doesn't mention", async () => {
  let { folder } = setUpFolder("sync-1");

  await folder.listMessages();

  expect(itemIDs(folder)).toEqual(["item-1", "item-2", "item-3"]);
});
