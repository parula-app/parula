import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import type { JMAPFolder } from "../../../../logic/Mail/JMAP/JMAPFolder";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import type { EMail } from "../../../../logic/Mail/EMail";
import { PersonUID } from "../../../../logic/Abstract/PersonUID";
import type { TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import { expect, test } from "vitest";

appGlobal.remoteApp ??= { kyCreate: () => { throw new Error("The test should not talk to a real server") } } as any;

/** Stalwart's folder IDs */
const kFolderIDs = {
  [SpecialFolder.Inbox]: "a",
  [SpecialFolder.Drafts]: "d",
  [SpecialFolder.Sent]: "e",
};

/** HTTP response bodies recorded from Stalwart for `EmailSubmission/set` with `onSuccessUpdateEmail`.
 * The implicit `Email/set` comes after it, with the same call ID (RFC 8621 section 7.5). */
const kSent = {
  methodResponses: [
    ["EmailSubmission/set", {
      accountId: "e", newState: "s2aaq",
      created: { sendMessage: { id: "j", sendAt: "2026-10-18T01:22:36Z", undoStatus: "pending" } },
    }, "c1"],
    ["Email/set", { accountId: "e", oldState: "s92aq", newState: "s2eaq", updated: { laaaaacy: null } }, "c1"],
  ],
  sessionState: "s1",
};
const kSentButNotMoved = {
  methodResponses: [
    ["EmailSubmission/set", {
      accountId: "e", newState: "s2maq",
      created: { sendMessage: { id: "k", sendAt: "2026-10-18T01:22:36Z", undoStatus: "pending" } },
    }, "c1"],
    ["Email/set", {
      accountId: "e", oldState: "s2iaq", newState: "s2iaq",
      notUpdated: { laaaaacy: { type: "invalidProperties", description: "mailboxId zzzz does not exist.", properties: ["mailboxIds"] } },
    }, "c1"],
  ],
  sessionState: "s1",
};
const kNotSent = {
  methodResponses: [
    ["EmailSubmission/set", {
      accountId: "e", newState: "s2maq",
      notCreated: { sendMessage: { type: "forbiddenFrom", description: "You are not allowed to send from this address." } },
    }, "c1"],
  ],
  sessionState: "s1",
};

/** Goes through the real `makeCalls()`, only the HTTP POST is replaced */
function newAccount(httpResponse: Record<string, any>) {
  let account = new JMAPAccount();
  account.accountID = "e";
  account.emailAddress = "mail-alice@example.com";
  account.session = { apiUrl: "http://jmap.example.com/jmap/", capabilities: {}, accounts: {}, primaryAccounts: {}, state: "s1" } as any as TJMAPSession;
  let errors: Error[] = [];
  account.errorCallback = ex => errors.push(ex);
  let requests: Record<string, any>[] = [];
  account.httpPost = async (url: string, request: any) => {
    requests.push(request);
    return httpResponse;
  };
  for (let specialFolder of [SpecialFolder.Inbox, SpecialFolder.Drafts, SpecialFolder.Sent]) {
    let folder = account.newFolder();
    folder.id = kFolderIDs[specialFolder];
    folder.specialFolder = specialFolder;
    folder.addMessage = async (email: EMail) => {
      email.pID = "laaaaacy";
    };
    account.rootFolders.add(folder);
  }
  let identity = account.newIdentity();
  identity.emailAddress = account.emailAddress;
  identity.pID = "a";
  account.identities.add(identity);
  return { account, requests, errors };
}

function newEMail(account: JMAPAccount): EMail {
  let email = account.newEMailFrom();
  email.identity = account.identities.first;
  email.to.add(new PersonUID("mail-bob@example.com", "Bob"));
  email.folder = account.getSpecialFolder(SpecialFolder.Sent) as JMAPFolder;
  return email;
}

function onSuccessUpdateEmail(requests: Record<string, any>[]): Record<string, any> {
  let call = requests[0].methodCalls.find(call => call[0] == "EmailSubmission/set");
  return call[1].onSuccessUpdateEmail["#sendMessage"];
}

test("After sending, the email is only in the Sent folder", async () => {
  let { account, requests, errors } = newAccount(kSent);

  await account.send(newEMail(account));

  let update = onSuccessUpdateEmail(requests);
  // RFC 8621 section 4.1.1: All values in `mailboxIds` MUST be `true`
  expect(update.mailboxIds).toEqual({ e: true });
  expect(update["keywords/$draft"]).toBe(null);
  expect(errors).toEqual([]);
});

test("When the email can't be moved to Sent, the user hears about it, but sending succeeds", async () => {
  let { account, errors } = newAccount(kSentButNotMoved);

  await account.send(newEMail(account));

  expect(errors.length).toBe(1);
  expect(errors[0].message).toContain("mailboxId zzzz does not exist");
});

test("When the server refuses to send, sending fails", async () => {
  let { account, errors } = newAccount(kNotSent);

  await expect(account.send(newEMail(account))).rejects.toThrow("You are not allowed to send from this address");
  expect(errors).toEqual([]);
});
