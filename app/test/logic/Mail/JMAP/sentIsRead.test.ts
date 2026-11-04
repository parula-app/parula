import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { JMAPEMail } from "../../../../logic/Mail/JMAP/JMAPEMail";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import type { EMail } from "../../../../logic/Mail/EMail";
import { PersonUID } from "../../../../logic/Abstract/PersonUID";
import type { TJMAPMethodResponse, TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import { expect, test } from "vitest";

appGlobal.remoteApp ??= { kyCreate: () => null } as any;

test("The sent email is stored as read", async () => {
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
  let uploadedKeywords: Record<string, boolean>;
  for (let [id, specialFolder] of [["d", SpecialFolder.Drafts], ["e", SpecialFolder.Sent]] as [string, SpecialFolder][]) {
    let folder = account.newFolder();
    folder.id = id;
    folder.specialFolder = specialFolder;
    // What `addMessageFromMIME()` imports
    folder.addMessage = async (email: EMail) => {
      uploadedKeywords = JMAPEMail.getJMAPFlags(email);
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

  await account.send(email);

  expect(uploadedKeywords["$seen"]).toBe(true);
});
