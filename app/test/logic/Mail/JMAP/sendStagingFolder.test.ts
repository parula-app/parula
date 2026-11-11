import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import type { EMail } from "../../../../logic/Mail/EMail";
import { PersonUID } from "../../../../logic/Abstract/PersonUID";
import type { TJMAPMethodResponse, TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import { expect, test } from "vitest";

appGlobal.remoteApp ??= { kyCreate: () => null } as any;

/** In the order in which Stalwart listed them in one `Mailbox/get`. It varies between calls. */
function newAccount(folders: [string, SpecialFolder][]) {
  let account = new JMAPAccount();
  account.accountID = "e";
  account.emailAddress = "mail-alice@example.com";
  account.session = { capabilities: {}, accounts: {}, primaryAccounts: {} } as any as TJMAPSession;
  // Responses recorded from Stalwart
  account.makeCalls = async () => [
    ["EmailSubmission/set", {
      accountId: "e", newState: "sqeaq",
      created: { sendMessage: { id: "f", sendAt: "2026-10-17T15:59:02Z", undoStatus: "pending" } },
    }, "c1"],
    ["Email/set", { accountId: "e", oldState: "sqaaq", newState: "sqiaq", updated: { gmaaaabt: null } }, "c1"],
  ] as TJMAPMethodResponse[];
  let uploadedTo: string[] = [];
  for (let [id, specialFolder] of folders) {
    let folder = account.newFolder();
    folder.id = id;
    folder.specialFolder = specialFolder;
    folder.addMessage = async (email: EMail) => {
      uploadedTo.push(folder.id);
      email.pID = "gmaaaabt";
    };
    account.rootFolders.add(folder);
  }
  let identity = account.newIdentity();
  identity.emailAddress = account.emailAddress;
  identity.pID = "a";
  account.identities.add(identity);
  let email = account.newEMailFrom();
  email.identity = identity;
  email.to.add(new PersonUID("mail-bob@example.com", "Bob"));
  email.folder = account.getSpecialFolder(SpecialFolder.Sent);
  return { account, email, uploadedTo };
}

test("The email to send is uploaded to Drafts, not to the first folder", async () => {
  let { account, email, uploadedTo } = newAccount([
    ["b", SpecialFolder.Trash], ["e", SpecialFolder.Sent], ["c", SpecialFolder.Spam],
    ["a", SpecialFolder.Inbox], ["d", SpecialFolder.Drafts],
  ]);

  await account.send(email);

  expect(uploadedTo).toEqual(["d"]);
});

test("Without a Drafts folder, the email to send is uploaded to Sent", async () => {
  let { account, email, uploadedTo } = newAccount([
    ["b", SpecialFolder.Trash], ["a", SpecialFolder.Inbox], ["e", SpecialFolder.Sent],
  ]);

  await account.send(email);

  expect(uploadedTo.length).toBe(1);
  expect(["b", "a"]).not.toContain(uploadedTo[0]); // Not into Trash, nor into the Inbox as new mail
});
