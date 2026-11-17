import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import type { JMAPFolder } from "../../../../logic/Mail/JMAP/JMAPFolder";
import type { TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { expect, test } from "vitest";

const kSessionURL = "https://example.com/.well-known/jmap";

/** Stalwart's session for core-alice, shortened */
function session(): TJMAPSession {
  return {
    capabilities: { "urn:ietf:params:jmap:core": { maxConcurrentRequests: 4 }, "urn:ietf:params:jmap:mail": {} },
    accounts: { q: { name: "core-alice@example.com", isPersonal: true, isReadOnly: false, accountCapabilities: { "urn:ietf:params:jmap:mail": {} } } },
    primaryAccounts: { "urn:ietf:params:jmap:mail": "q" },
    username: "core-alice@example.com",
    apiUrl: "https://example.com/jmap/",
    downloadUrl: "https://example.com/jmap/download/{accountId}/{blobId}/{name}?accept={type}",
    uploadUrl: "https://example.com/jmap/upload/{accountId}/",
    eventSourceUrl: "https://example.com/jmap/eventsource/?types={types}&closeafter={closeafter}&ping={ping}",
    state: "d1655760",
  };
}

/** A logged-in account, which counts the session fetches (= logins) and API calls */
async function newAccount() {
  let counts = { sessionFetches: 0, apiCalls: 0 };
  appGlobal.remoteApp = {
    kyCreate: () => ({
      get: async () => {
        counts.sessionFetches++;
        return session();
      },
      post: async (url: string, options: any) => {
        counts.apiCalls++;
        return {
          methodResponses: options.json.methodCalls.map(([name, , id]) => [name, { accountId: "q", state: "s1", list: [], notFound: [] }, id]),
          sessionState: "d1655760",
        };
      },
    }),
  } as any;
  let account = new JMAPAccount();
  account.url = kSessionURL;
  account.storage = new DummyMailStorage();
  await account.login(false);
  return { account, counts };
}

test("After disconnect(), a call that was still pending does not log in again", async () => {
  let { account, counts } = await newAccount();
  expect(counts.sessionFetches).toBe(1);

  await account.disconnect();
  await expect(account.makeSingleCall("Mailbox/get", { accountId: "q" })).rejects.toThrow("Please login");

  expect(counts.sessionFetches).toBe(1);
  expect(counts.apiCalls).toBe(0);
  expect(account.isLoggedIn).toBeFalsy();
});

test("After disconnect(), listing a folder does not log in again", async () => {
  let { account, counts } = await newAccount();
  let folder = account.newFolder() as JMAPFolder;
  folder.id = "a";
  account.rootFolders.add(folder);

  await account.disconnect();
  await expect(folder.listMessages()).rejects.toThrow("Please login");

  expect(counts.sessionFetches).toBe(1);
  expect(account.isLoggedIn).toBeFalsy();
});

test("After disconnect(), an account shared with us does not log its main account in again", async () => {
  let { account, counts } = await newAccount();
  let sharedAccount = new JMAPAccount();
  sharedAccount.initFromMainAccount(account);
  sharedAccount.accountID = "r";
  sharedAccount.session = account.session;

  await account.disconnect();
  await expect(sharedAccount.makeSingleCall("Mailbox/get", { accountId: "r" })).rejects.toThrow("Please login");

  expect(counts.sessionFetches).toBe(1);
  expect(account.isLoggedIn).toBeFalsy();
});

test("After disconnect(), the user logs in again explicitly, and then calls work", async () => {
  let { account, counts } = await newAccount();
  await account.disconnect();

  await account.login(true);
  await account.makeSingleCall("Mailbox/get", { accountId: "q" });

  expect(counts.sessionFetches).toBe(2);
  expect(counts.apiCalls).toBe(1);
  expect(account.isLoggedIn).toBeTruthy();
});

test("Without disconnect(), e.g. when the app started offline, a call logs in", async () => {
  let { account, counts } = await newAccount();
  account.session = null; // The login at startup failed

  await account.makeSingleCall("Mailbox/get", { accountId: "q" });

  expect(counts.sessionFetches).toBe(2);
  expect(counts.apiCalls).toBe(1);
});
