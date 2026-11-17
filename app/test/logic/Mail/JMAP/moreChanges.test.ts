import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import type { JMAPFolder } from "../../../../logic/Mail/JMAP/JMAPFolder";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import type { TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import { expect, test } from "vitest";

appGlobal.remoteApp ??= { kyCreate: () => null } as any;

/** More rounds than any real sync needs. A client that goes on longer is stuck. */
const kSaneMaxRounds = 10000;

function stalwartEMail(id: string) {
  return {
    id, blobId: "blob" + id, threadId: "t" + id, mailboxIds: { a: true }, keywords: {}, size: 260,
    receivedAt: "2026-10-17T15:52:44Z", messageId: [id + "@example.org"], subject: "Email " + id,
    from: [{ name: "Outside", email: "outside@example.org" }], to: [{ name: null, email: "loops-alice@example.com" }],
  };
}

/** The server's answer to `Email/changes` since a state */
type TServe = (sinceState: string) => { newState: string, hasMoreChanges: boolean, created: string[] };

/** An account whose Inbox was listed before, with the email "e0", at the state "s0" */
function setup(serve: TServe) {
  let account = new JMAPAccount();
  account.accountID = "e";
  account.session = { capabilities: {}, accounts: {}, primaryAccounts: {} } as any as TJMAPSession;
  account.storage = new DummyMailStorage();
  account.contentStorage.clear();
  account.save = async () => {};
  let errors: Error[] = [];
  account.errorCallback = ex => errors.push(ex);
  account.syncState.set("Email", "s0");
  let calls = 0;
  account.makeCombinedCall = async (requests: [string, Record<string, any>, string?][]) => {
    calls++;
    let sinceState = requests[0][1].sinceState;
    let { newState, hasMoreChanges, created } = serve(sinceState);
    return {
      changes: { accountId: "e", oldState: sinceState, newState, hasMoreChanges, created, updated: [], destroyed: [] },
      added: { accountId: "e", state: newState, list: created.map(id => stalwartEMail(id)), notFound: [] },
      changed: { accountId: "e", state: newState, list: [], notFound: [] },
    };
  };
  let inbox = account.newFolder() as JMAPFolder;
  inbox.id = "a";
  inbox.specialFolder = SpecialFolder.Inbox;
  inbox.countTotal = 1;
  account.rootFolders.add(inbox);
  inbox.messages.addAll(inbox.parseMessageList([stalwartEMail("e0")] as any).newMessages);
  return { account, inbox, errors, calls: () => calls };
}

/** `count` emails arrived since "s0", and the server reports at most `perCall` changes per call.
 * The state "s<n>" is after the first n of them. */
function arrivedInSteps(count: number, perCall: number): TServe {
  return sinceState => {
    let from = parseInt(sinceState.substring(1));
    let to = Math.min(from + perCall, count);
    return {
      newState: "s" + to,
      hasMoreChanges: to < count,
      created: Array.from({ length: to - from }, (_, i) => "e" + (from + i + 1)),
    };
  };
}

test("All new emails show up when the server reports the changes in several steps", async () => {
  let { account, inbox, errors } = setup(arrivedInSteps(7, 3));

  let newMessages = await inbox.listMessages();

  let expected = ["e0", "e1", "e2", "e3", "e4", "e5", "e6", "e7"];
  expect(inbox.messages.contents.map(email => email.jmapID).sort()).toEqual(expected);
  expect(newMessages.contents.map(email => email.jmapID).sort()).toEqual(expected.slice(1));
  expect(account.syncState.get("Email")).toBe("s7");
  expect(errors).toEqual([]);
});

test("The sync stops when the server keeps reporting more changes, but no new state", async () => {
  let { inbox, errors, calls } = setup(() => ({ newState: "s1", hasMoreChanges: true, created: ["e1"] }));

  await inbox.listMessages();

  expect(calls()).toBeLessThan(10);
  expect(errors.length).toBe(1);
  expect(inbox.messages.contents.map(email => email.jmapID).sort()).toEqual(["e0", "e1"]);
});

test("The sync stops after a maximum number of rounds, when the server always reports more changes", async () => {
  let { inbox, errors, calls } = setup(arrivedInSteps(Infinity, 1));

  await inbox.listMessages();

  expect(calls()).toBeLessThanOrEqual(kSaneMaxRounds);
  expect(errors.length).toBe(1);
});
