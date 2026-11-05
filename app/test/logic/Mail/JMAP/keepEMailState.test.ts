import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import type { JMAPFolder } from "../../../../logic/Mail/JMAP/JMAPFolder";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
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

/** The Inbox was synced at state "sje". Since then, "e9" arrived in the Inbox, but no poll or push
 * fetched it yet. Now the user opens the folder "Projects" for the first time. */
function setup() {
  let account = new JMAPAccount();
  account.accountID = "e";
  account.session = { capabilities: {}, accounts: {}, primaryAccounts: {} } as any as TJMAPSession;
  account.storage = new DummyMailStorage();
  account.save = async () => {};
  account.syncState.set("Email", "sje");
  let changesSince: string[] = [];
  account.makeCalls = async (requests: [string, Record<string, any>, string?][]) => requests.map(([method, args, callID]) => {
    let result: Record<string, any>;
    if (method == "Email/changes") {
      changesSince.push(args.sinceState);
      result = { accountId: "e", oldState: args.sinceState, newState: "slm", hasMoreChanges: false, created: ["e9"], updated: [], destroyed: [] };
    } else if (method == "Email/query") {
      result = { accountId: "e", queryState: "slm", canCalculateChanges: true, position: 0, ids: ["e5"], total: 1 };
    } else if (args["#ids"]?.path == "/created") {
      result = { accountId: "e", state: "slm", list: [stalwartEMail("e9", "a")], notFound: [] };
    } else if (args["#ids"]?.path == "/updated") {
      result = { accountId: "e", state: "slm", list: [], notFound: [] };
    } else {
      result = { accountId: "e", state: "slm", list: [stalwartEMail("e5", "k")], notFound: [] };
    }
    return [method, result, callID] as TJMAPMethodResponse;
  });
  let inbox = newFolder(account, "a", 1);
  inbox.messages.addAll(inbox.parseMessageList([stalwartEMail("e1", "a")] as any).newMessages);
  let projects = newFolder(account, "k", 1);
  return { account, inbox, projects, changesSince };
}

function newFolder(account: JMAPAccount, id: string, countTotal: number): JMAPFolder {
  let folder = account.newFolder();
  folder.id = id;
  folder.countTotal = countTotal;
  account.rootFolders.add(folder);
  return folder;
}

test("Listing a folder for the first time keeps the account-wide sync state", async () => {
  let { account, projects } = setup();

  await projects.listMessages();

  expect(projects.messages.contents.map(email => email.jmapID)).toEqual(["e5"]);
  expect(account.syncState.get("Email")).toBe("sje");
});

test("The changes in other folders are still fetched after that", async () => {
  let { account, inbox, projects, changesSince } = setup();
  await projects.listMessages();

  await inbox.listMessages();

  expect(changesSince).toContain("sje");
  expect(inbox.messages.contents.map(email => email.jmapID).sort()).toEqual(["e1", "e9"]);
  expect(account.syncState.get("Email")).toBe("slm");
});
