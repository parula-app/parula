// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { newAccountForProtocol } from "../../../../logic/Mail/AccountsList/MailAccounts";
import type { TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import { InProcessSQLiteDatabase } from "../../util/inProcessSQLite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";

const kAccountCapabilities = {
  "urn:ietf:params:jmap:mail": {},
  "urn:ietf:params:jmap:submission": {},
  "urn:ietf:params:jmap:contacts": {},
  "urn:ietf:params:jmap:calendars": {},
};

/** John's own account, and Jane's, which she delegated to him.
 * Neither server sends `principals:owner`, so only `primaryAccounts` names
 * the account that holds the `Principal` objects. */
function newSession(extraCapabilities: Record<string, any>): TJMAPSession {
  return {
    capabilities: {
      "urn:ietf:params:jmap:mail": {},
      "urn:ietf:params:jmap:submission": {},
      "urn:ietf:params:jmap:principals": {},
      ...extraCapabilities,
    },
    primaryAccounts: {
      "urn:ietf:params:jmap:mail": "u1",
      "urn:ietf:params:jmap:submission": "u1",
      "urn:ietf:params:jmap:principals": "u1",
    },
    accounts: {
      u1: {
        name: "john.doe@example.com", isPersonal: true, isReadOnly: false,
        accountCapabilities: kAccountCapabilities,
      },
      // Stalwart lists the capabilities of *our* account for the accounts of
      // other users as well, even for the parts that they did not share with us
      u2: {
        name: "jane.smith@example.com", isPersonal: false, isReadOnly: false,
        accountCapabilities: kAccountCapabilities,
      },
    },
    apiUrl: "http://example.com/jmap/api",
    downloadUrl: "http://example.com/jmap/download",
    uploadUrl: "http://example.com/jmap/upload",
    eventSourceUrl: "http://example.com/jmap/events",
  } as any as TJMAPSession;
}

const kStalwartSession = newSession({ "urn:ietf:params:jmap:mail:share": {} });
/** Cyrus always announces its own core extension */
const kCyrusSession = newSession({ "https://cyrusimap.org/ns/jmap/core": {} });

/** Answers the calls that `login()` makes, like a JMAP server would */
function respond(method: string, args: any): any {
  if (method == "Mailbox/get") {
    return {
      accountId: args.accountId, state: "m1", notFound: [],
      list: [{
        id: args.accountId + "-inbox", name: "Inbox", parentId: null, role: "inbox",
        sortOrder: 0, isSubscribed: true, totalEmails: 0, unreadEmails: 0, myRights: {},
      }],
    };
  }
  if (method.endsWith("/get")) {
    return { accountId: args.accountId, state: "n", list: [], notFound: [] };
  }
  if (method.endsWith("/changes")) {
    return { accountId: args.accountId, oldState: "n", newState: "n", created: [], updated: [], destroyed: [] };
  }
  if (method.endsWith("/query")) {
    return { accountId: args.accountId, queryState: "q1", ids: [], position: 0, total: 0 };
  }
  throw new Error("Test server has no answer for " + method);
}

/** Jane delegated only her mail, so the server refuses everything else,
 * although the session claims that her account offers it */
function sharedWithUs(method: string, accountID: string): boolean {
  return accountID != "u2" ||
    method.startsWith("Mailbox/") || method.startsWith("Email/");
}

let session: TJMAPSession;
let calls: string[];

beforeEach(() => {
  calls = [];
  let tempDir = mkdtempSync(path.join(tmpdir(), "jmap-sharing-test-"));
  appGlobal.remoteApp = {
    getSQLiteDatabase: (filename: string) => new InProcessSQLiteDatabase(path.join(tempDir, filename)),
    getFilesDir: () => tempDir,
    kyCreate: () => null,
  } as any;
  JMAPAccount.prototype.httpGet = async () => session;
  JMAPAccount.prototype.httpPost = async (url: string, request: any) => ({
    methodResponses: request.methodCalls.map(([method, args, callID]) => {
      calls.push(method + " " + args.accountId);
      return sharedWithUs(method, args.accountId)
        ? [method, respond(method, args), callID]
        : ["error", { type: "forbidden", description: "You do not have access to account " + args.accountId }, callID];
    }),
    sessionState: "s1",
  });
  JMAPAccount.prototype.startPushListener = async () => {}; // would open a real HTTP connection
});

afterEach(() => {
  appGlobal.emailAccounts.clear();
});

function newAccount(): JMAPAccount {
  let account = newAccountForProtocol("jmap") as JMAPAccount;
  account.name = "John";
  account.emailAddress = "john.doe@example.com";
  account.username = "john.doe@example.com";
  account.url = "http://example.com/jmap/session";
  account.pollIntervalMinutes = 0; // no timers in tests
  appGlobal.emailAccounts.add(account);
  return account;
}

async function loginToNewAccount(): Promise<JMAPAccount> {
  let account = newAccount();
  await account.loginAndStartup(true);
  return account;
}

function delegatedAccounts(): JMAPAccount[] {
  return appGlobal.emailAccounts.contents
    .filter(acc => acc.emailAddress == "jane.smith@example.com") as JMAPAccount[];
}

test("login() only gets the session; syncOnStartup() lists the folders", async () => {
  session = kStalwartSession;
  let account = newAccount();

  await account.login(true);
  expect(account.isLoggedIn).toBeTruthy();
  expect(calls).toEqual([]);

  await account.syncOnStartup();
  expect(calls).toContain("Mailbox/get u1");
});

test("Two concurrent login() calls get the session once", async () => {
  session = kStalwartSession;
  let sessionGets = 0;
  JMAPAccount.prototype.httpGet = async () => { sessionGets++; return session; };
  let account = newAccount();

  await Promise.all([account.login(true), account.login(true)]);

  expect(sessionGets).toBe(1);
});

test("Two concurrent syncOnStartup() calls run the startup once", async () => {
  session = kStalwartSession;
  let account = newAccount();
  await account.login(true);

  await Promise.all([account.syncOnStartup(), account.syncOnStartup()]);

  expect(calls.filter(call => call == "Mailbox/get u1")).toHaveLength(1);
});

test("Setup adds the account that another user delegated to us", async () => {
  session = kStalwartSession;

  let account = await loginToNewAccount();

  let shared = delegatedAccounts();
  expect(shared.length).toBe(1);
  expect(shared[0].accountID).toBe("u2");
  expect(shared[0].mainAccount).toBe(account);
  expect(shared[0].rootFolders.hasItems).toBe(true);
  // Set up during the account setup, rather than only after the next app start
  expect(calls).toContain("Mailbox/get u2");
  // The parts that she did not share do not abort the setup of the rest
  expect(calls).toContain("AddressBook/get u2");
});

test("Setup adds it also on a server that implements the older `Principal` draft", async () => {
  session = kCyrusSession;

  await loginToNewAccount();

  expect(delegatedAccounts().length).toBe(1);
});

test("The delegated account has a color of its own", async () => {
  session = kStalwartSession;

  let account = await loginToNewAccount();

  expect(delegatedAccounts()[0].color).not.toBe(account.color);
});

test("The delegated account is added only once", async () => {
  session = kStalwartSession;

  let account = await loginToNewAccount();
  await account.loginAndStartup(true);

  expect(delegatedAccounts().length).toBe(1);
});
