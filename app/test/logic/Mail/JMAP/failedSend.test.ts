import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import type { EMail } from "../../../../logic/Mail/EMail";
import { PersonUID } from "../../../../logic/Abstract/PersonUID";
import type { TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import { expect, test } from "vitest";

appGlobal.remoteApp ??= { kyCreate: () => { throw new Error("The test should not talk to a real server") } } as any;

/** HTTP responses recorded from Stalwart */
const kForbiddenFrom = {
  methodResponses: [["EmailSubmission/set", {
    accountId: "e",
    notCreated: { sendMessage: { type: "forbiddenFrom", description: "Envelope mailFrom does not match identity email address." } },
  }, "c1"]],
  sessionState: "s1",
};
const kDestroyed = {
  methodResponses: [["Email/set", { accountId: "e", oldState: "s0maq", newState: "s0qaq", destroyed: ["luaaaac0"] }, "c1"]],
  sessionState: "s1",
};

test("When the server refuses to send, the uploaded copy is deleted again", async () => {
  let account = new JMAPAccount();
  account.accountID = "e";
  account.emailAddress = "mail-alice@example.com";
  account.session = { apiUrl: "http://jmap.example.com/jmap/", capabilities: {}, accounts: {}, primaryAccounts: {}, state: "s1" } as any as TJMAPSession;
  let errors: Error[] = [];
  account.errorCallback = ex => errors.push(ex);
  let methodCalls: any[] = [];
  account.httpPost = async (url: string, request: any) => {
    methodCalls.push(...request.methodCalls);
    return request.methodCalls[0][0] == "EmailSubmission/set" ? kForbiddenFrom : kDestroyed;
  };
  for (let [id, specialFolder] of [["d", SpecialFolder.Drafts], ["e", SpecialFolder.Sent]] as [string, SpecialFolder][]) {
    let folder = account.newFolder();
    folder.id = id;
    folder.specialFolder = specialFolder;
    folder.addMessage = async (email: EMail) => {
      email.pID = "luaaaac0";
    };
    account.rootFolders.add(folder);
  }
  let identity = account.newIdentity();
  identity.emailAddress = account.emailAddress;
  identity.pID = "b";
  account.identities.add(identity);
  let email = account.newEMailFrom();
  email.identity = identity;
  email.to.add(new PersonUID("mail-bob@example.com", "Bob"));
  email.folder = account.getSpecialFolder(SpecialFolder.Sent);

  await expect(account.send(email)).rejects.toThrow("Envelope mailFrom does not match identity email address");

  let destroyed = methodCalls.filter(call => call[0] == "Email/set").flatMap(call => call[1].destroy ?? []);
  expect(destroyed).toContain("luaaaac0");
  expect(errors).toEqual([]);
});
