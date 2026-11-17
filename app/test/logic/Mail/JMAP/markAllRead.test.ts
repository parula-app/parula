import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import type { JMAPFolder } from "../../../../logic/Mail/JMAP/JMAPFolder";
import type { TJMAPMethodResponse, TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import { expect, test } from "vitest";

appGlobal.remoteApp ??= { kyCreate: () => null } as any;

/** A server with the unread emails `unread` in folder "a", answering like Stalwart */
function newFolder(unread: string[], maxObjectsInSet: number, failOn?: string) {
  let account = new JMAPAccount();
  account.accountID = "e";
  account.session = {
    capabilities: { "urn:ietf:params:jmap:core": { maxObjectsInSet } },
    accounts: {}, primaryAccounts: {},
  } as any as TJMAPSession;
  let seen = new Set<string>();
  let sets: Record<string, any>[] = [];
  account.makeCalls = async (requests: [string, Record<string, any>, string?][]) => {
    let [method, args, callID] = requests[0];
    if (method == "Email/query") {
      expect(args.filter).toEqual({ inMailbox: "a", notKeyword: "$seen" });
      let ids = unread.filter(id => !seen.has(id)).slice(0, args.limit);
      return [[method, { accountId: "e", queryState: "sqa", canCalculateChanges: true, position: 0, ids }, callID]] as TJMAPMethodResponse[];
    }
    sets.push(args.update);
    let updated: Record<string, null> = {};
    let notUpdated: Record<string, any> = {};
    for (let id in args.update) {
      if (id == failOn) {
        notUpdated[id] = { type: "forbidden", description: "You are not allowed to modify this message." };
        continue;
      }
      seen.add(id);
      updated[id] = null;
    }
    return [[method, { accountId: "e", oldState: "sqa", newState: "sqe", updated, ...(failOn ? { notUpdated } : {}) }, callID]] as TJMAPMethodResponse[];
  };
  let folder = account.newFolder();
  folder.id = "a";
  account.rootFolders.add(folder);
  return { folder: folder as JMAPFolder, seen, sets };
}

test("Mark all as read sets $seen on all unread emails of the folder on the server", async () => {
  let { folder, seen, sets } = newFolder(["e1", "e2", "e3"], 2);

  await folder.markAllRead();

  expect([...seen].sort()).toEqual(["e1", "e2", "e3"]);
  expect(sets).toEqual([
    { e1: { "keywords/$seen": true }, e2: { "keywords/$seen": true } },
    { e3: { "keywords/$seen": true } },
  ]);
  expect(folder.countUnread).toBe(0);
});

test("Mark all as read in a folder without unread emails does nothing on the server", async () => {
  let { folder, sets } = newFolder([], 500);

  await folder.markAllRead();

  expect(sets).toEqual([]);
});

test("Mark all as read reports when the server refuses", async () => {
  let { folder } = newFolder(["e1", "e2"], 500, "e2");

  await expect(folder.markAllRead()).rejects.toThrow("not allowed");
});

/** A buggy or hostile server: `Email/query` returns unread emails forever */
function newEndlessFolder(maxObjectsInSet: number, sameIDs: boolean) {
  let account = new JMAPAccount();
  account.accountID = "e";
  account.session = {
    capabilities: { "urn:ietf:params:jmap:core": { maxObjectsInSet } },
    accounts: {}, primaryAccounts: {},
  } as any as TJMAPSession;
  let errors: Error[] = [];
  account.errorCallback = ex => errors.push(ex);
  let queries = 0;
  account.makeCalls = async (requests: [string, Record<string, any>, string?][]) => {
    let [method, args, callID] = requests[0];
    if (method == "Email/query") {
      queries++;
      let ids = sameIDs ? ["e1", "e2"] : ["e" + queries];
      return [[method, { accountId: "e", queryState: "sqa", canCalculateChanges: true, position: 0, ids }, callID]] as TJMAPMethodResponse[];
    }
    let updated = Object.fromEntries(Object.keys(args.update).map(id => [id, null]));
    return [[method, { accountId: "e", oldState: "sqa", newState: "sqe", updated }, callID]] as TJMAPMethodResponse[];
  };
  let folder = account.newFolder();
  folder.id = "a";
  account.rootFolders.add(folder);
  return { folder: folder as JMAPFolder, errors, queries: () => queries };
}

test("Mark all as read stops when the server returns the same unread emails again", async () => {
  let { folder, errors, queries } = newEndlessFolder(500, true);

  await folder.markAllRead();

  expect(queries()).toBe(2);
  expect(errors.length).toBe(1);
});

test("Mark all as read stops after a maximum number of rounds, when the server always returns more", async () => {
  // 1,000,000 emails at most, 250,000 per round
  let { folder, errors, queries } = newEndlessFolder(250000, false);

  await folder.markAllRead();

  expect(queries()).toBe(4);
  expect(errors.length).toBe(1);
});
