import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import type { JMAPFolder } from "../../../../logic/Mail/JMAP/JMAPFolder";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import type { TJMAPMethodResponse, TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import { expect, test } from "vitest";

appGlobal.remoteApp ??= { kyCreate: () => null } as any;

function stalwartEMail(id: string, mailboxID: string) {
  return {
    id, blobId: "blob" + id, threadId: "t" + id, mailboxIds: { [mailboxID]: true }, keywords: {}, size: 260,
    receivedAt: "2026-10-17T15:52:44Z", messageId: [id + "@example.org"], subject: "Email " + id,
    from: [{ name: "Outside", email: "outside@example.org" }], to: [{ name: null, email: "mail-alice@example.com" }],
  };
}

test("An email that another device deleted from the Inbox disappears here", async () => {
  let account = new JMAPAccount();
  account.accountID = "e";
  account.session = { capabilities: {}, accounts: {}, primaryAccounts: {} } as any as TJMAPSession;
  account.storage = new DummyMailStorage();
  account.contentStorage.clear();
  account.save = async () => {};
  account.syncState.set("Email", "sje");
  // Stalwart's answer when only "e2" was destroyed
  account.makeCalls = async (requests: [string, Record<string, any>, string?][]) => requests.map(([method, args, callID]) =>
    [method, method == "Email/changes"
      ? { accountId: "e", oldState: "sje", newState: "sjf", hasMoreChanges: false, created: [], updated: [], destroyed: ["e2"] }
      : { accountId: "e", state: "sjf", list: [], notFound: [] },
    callID] as TJMAPMethodResponse);
  let inbox = account.newFolder() as JMAPFolder;
  inbox.id = "a";
  inbox.specialFolder = SpecialFolder.Inbox;
  inbox.countTotal = 2;
  account.rootFolders.add(inbox);
  inbox.messages.addAll(inbox.parseMessageList([stalwartEMail("e1", "a"), stalwartEMail("e2", "a")] as any).newMessages);

  await inbox.listMessages();

  expect(inbox.messages.contents.map(email => email.jmapID)).toEqual(["e1"]);
  expect(account.syncState.get("Email")).toBe("sjf");
});
