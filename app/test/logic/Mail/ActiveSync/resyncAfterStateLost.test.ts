// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { ActiveSyncAccount } from "../../../../logic/Mail/ActiveSync/ActiveSyncAccount";
import type { ActiveSyncFolder } from "../../../../logic/Mail/ActiveSync/ActiveSyncFolder";
import type { ActiveSyncEMail } from "../../../../logic/Mail/ActiveSync/ActiveSyncEMail";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { expect, test } from "vitest";

/** An ActiveSync server whose folder has "1:1" and "1:3".
 * "1:2" was deleted there while our sync key was no longer valid. */
function setUpFolder(syncKey: string): ActiveSyncFolder {
  let account = new ActiveSyncAccount();
  account.name = "Test";
  account.storage = new DummyMailStorage();
  account.addPingable = () => undefined;
  account.callEAS = async (command: string, request: any) => {
    expect(command).toBe("Sync");
    let collection = request.Collections.Collection;
    if (collection.SyncKey == "old") {
      // MS-ASCMD 2.2.3.177.16: Status 3 = Invalid synchronization key
      return { Collections: { Collection: { Status: "3", SyncKey: "0", CollectionId: collection.CollectionId } } };
    }
    if (collection.SyncKey == "0") {
      return { Collections: { Collection: { Status: "1", SyncKey: "1", CollectionId: collection.CollectionId } } };
    }
    if (collection.SyncKey == "1") {
      // The first sync after SyncKey 0 sends every email of the folder as added
      return { Collections: { Collection: {
        Status: "1", SyncKey: "2", CollectionId: collection.CollectionId,
        Commands: { Add: ["1:1", "1:3"].map(id => ({ ServerId: id, ApplicationData: { Read: "1" } })) },
      } } };
    }
    // Nothing changed since then
    return { Collections: { Collection: { Status: "1", SyncKey: "3", CollectionId: collection.CollectionId } } };
  };
  let folder = account.newFolder() as ActiveSyncFolder;
  folder.name = "Inbox";
  folder.id = "inbox-1";
  folder.syncState = syncKey;
  account.rootFolders.add(folder);
  for (let id of ["1:1", "1:2", "1:3"]) {
    let email = folder.newEMail() as ActiveSyncEMail;
    email.serverID = id;
    folder.messages.add(email);
  }
  return folder;
}

function serverIDs(folder: ActiveSyncFolder): string[] {
  return folder.messages.contents.map(email => (email as ActiveSyncEMail).serverID).sort();
}

test("After the server rejected our sync key, the next sync removes the emails deleted meanwhile", async () => {
  let folder = setUpFolder("old");
  await expect(folder.listMessages()).rejects.toThrow();

  await folder.listMessages();

  expect(serverIDs(folder)).toEqual(["1:1", "1:3"]);
});

test("A full resync removes the emails that are no longer on the server", async () => {
  let folder = setUpFolder("2");

  await folder.fullResync();

  expect(serverIDs(folder)).toEqual(["1:1", "1:3"]);
});

test("A sync with a sync key keeps the emails that it doesn't mention", async () => {
  let folder = setUpFolder("2");

  await folder.listMessages();

  expect(serverIDs(folder)).toEqual(["1:1", "1:2", "1:3"]);
});
