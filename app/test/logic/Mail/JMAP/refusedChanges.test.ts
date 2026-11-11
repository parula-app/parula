import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import type { JMAPFolder } from "../../../../logic/Mail/JMAP/JMAPFolder";
import type { TJMAPMethodResponse, TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import { expect, test } from "vitest";

appGlobal.remoteApp ??= { kyCreate: () => null } as any;

function newAccount(response: Record<string, any>) {
  let account = new JMAPAccount();
  account.accountID = "e";
  account.session = { capabilities: {}, accounts: {}, primaryAccounts: {} } as any as TJMAPSession;
  account.makeCalls = async (requests: [string, Record<string, any>, string?][]) =>
    requests.map(([method, args, callID]) => [method, response, callID] as TJMAPMethodResponse);
  let folder = account.newFolder() as JMAPFolder;
  folder.id = "bk";
  folder.name = "Projects";
  folder.myRights = { mayRename: true } as any;
  account.rootFolders.add(folder);
  return folder;
}

test("A flag change that the server refuses gives an error", async () => {
  // Recorded from Stalwart: the email was deleted on another device meanwhile
  let folder = newAccount({ accountId: "e", oldState: "s1qaq", newState: "s1qaq", notUpdated: { eaaaaab: { type: "notFound" } } });
  let email = folder.newEMail();
  email.jmapID = "eaaaaab";

  await expect(email.markRead(true)).rejects.toMatchObject({ type: "notFound" });
});

test("A rename that the server refuses gives an error", async () => {
  // Recorded from Stalwart
  let folder = newAccount({
    accountId: "e", oldState: "s1uaq", newState: "s1uaq",
    notUpdated: { bk: { type: "alreadyExists", description: "A mailbox with name 'DupTestA' already exists.", existingId: "bj" } },
  });

  await expect(folder.rename("DupTestA")).rejects.toThrow("A mailbox with name 'DupTestA' already exists.");
});
