import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import type { JMAPFolder } from "../../../../logic/Mail/JMAP/JMAPFolder";
import type { JMAPEMail } from "../../../../logic/Mail/JMAP/JMAPEMail";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import type { TJMAPMethodResponse, TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import { ArrayColl } from "svelte-collections";
import { expect, test } from "vitest";

appGlobal.remoteApp ??= { kyCreate: () => null } as any;

/** Answers like Stalwart. `Email/set` fails for the IDs in `refuse`. */
function newAccount(refuse: string[] = []) {
  let account = new JMAPAccount();
  account.accountID = "e";
  account.session = { capabilities: {}, accounts: {}, primaryAccounts: {} } as any as TJMAPSession;
  account.storage = new DummyMailStorage();
  account.contentStorage.clear();
  account.save = async () => {};
  account.makeCalls = async (requests: [string, Record<string, any>, string?][]) => requests.map(([method, args, callID]) => {
    let result: Record<string, any>;
    if (method == "Email/set") {
      let ids = Object.keys(args.update);
      result = {
        accountId: "e", oldState: "spi", newState: "spm",
        updated: Object.fromEntries(ids.filter(id => !refuse.includes(id)).map(id => [id, null])),
        ...(refuse.length ? { notUpdated: Object.fromEntries(refuse.map(id => [id, { type: "forbidden", description: "You are not allowed to remove messages from this mailbox." }])) } : {}),
      };
    } else if (method == "Email/query") {
      let queried = account.rootFolders.find(folder => folder.id == args.filter?.inMailbox);
      // The server has as many emails in the folder as we count
      result = { accountId: "e", queryState: "spm", canCalculateChanges: true, position: 0, ids: [], total: queried?.countTotal ?? 0 };
    } else {
      result = { accountId: "e", state: "spm", list: [], notFound: [] };
    }
    return [method, result, callID] as TJMAPMethodResponse;
  });
  let inbox = newFolder(account, "a", 5);
  let archive = newFolder(account, "k", 3);
  return { account, inbox, archive };
}

function newFolder(account: JMAPAccount, id: string, countTotal: number): JMAPFolder {
  let folder = account.newFolder();
  folder.id = id;
  folder.countTotal = countTotal;
  folder.myRights = { mayDelete: true } as any;
  account.rootFolders.add(folder);
  return folder;
}

function newEMail(folder: JMAPFolder, jmapID: string): JMAPEMail {
  let email = folder.newEMail();
  email.jmapID = jmapID;
  folder.messages.add(email);
  return email;
}

test("Moving an email changes the folder counts by one", async () => {
  let { inbox, archive } = newAccount();
  let email = newEMail(inbox, "eaaaaab");

  await archive.moveMessagesHere(new ArrayColl([email]));

  expect(inbox.countTotal).toBe(4);
  expect(archive.countTotal).toBe(4);
});

test("Copying an email changes the target count by one", async () => {
  let { inbox, archive } = newAccount();
  let email = newEMail(inbox, "eaaaaab");

  await archive.copyMessagesHere(new ArrayColl([email]));

  expect(inbox.countTotal).toBe(5);
  expect(archive.countTotal).toBe(4);
});

test("A move that the server refuses gives an error, and the email stays in its folder", async () => {
  let { inbox, archive } = newAccount(["eaaaaab"]);
  let email = newEMail(inbox, "eaaaaab");

  await expect(archive.moveMessagesHere(new ArrayColl([email]))).rejects.toThrow("not allowed");

  // Still in the Inbox, and the counts didn't change
  expect(inbox.messages.contents).toContain(email);
  expect(inbox.countTotal).toBe(5);
  expect(archive.countTotal).toBe(3);
});
