import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import type { TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import { waitFor } from "../../util/waitFor";
import { expect, test } from "vitest";

const kSessionURL = "https://example.com/.well-known/jmap";
const kAPIURL = "https://example.com/jmap/";

/** Session state as returned by Stalwart, before and after another user shared their account with us */
function session(state: string, withSharedAccount: boolean): TJMAPSession {
  let accounts: Record<string, any> = {
    r: { name: "bob@example.com", isPersonal: true, isReadOnly: false, accountCapabilities: { "urn:ietf:params:jmap:mail": {} } },
  };
  if (withSharedAccount) {
    accounts.q = { name: "alice@example.com", isPersonal: false, isReadOnly: false, accountCapabilities: { "urn:ietf:params:jmap:mail": {} } };
  }
  return {
    capabilities: { "urn:ietf:params:jmap:core": {}, "urn:ietf:params:jmap:mail": {} },
    accounts,
    primaryAccounts: { "urn:ietf:params:jmap:mail": "r" },
    username: "bob@example.com",
    apiUrl: kAPIURL,
    downloadUrl: "https://example.com/jmap/download/{accountId}/{blobId}/{name}?accept={type}",
    uploadUrl: "https://example.com/jmap/upload/{accountId}/",
    eventSourceUrl: "https://example.com/jmap/eventsource/?types={types}&closeafter={closeafter}&ping={ping}",
    state: state,
  };
}

/** A server whose session is in state `serverState`, and which counts the session fetches */
function newAccount(serverState: string): { account: JMAPAccount, sessionFetches: () => number } {
  let fetches = 0;
  appGlobal.remoteApp = { kyCreate: () => null } as any;
  let account = new JMAPAccount();
  account.url = kSessionURL;
  account.accountID = "r";
  account.session = session("d1655760", false);
  account.httpGet = async (url: string) => {
    expect(url).toBe(kSessionURL);
    fetches++;
    await new Promise(resolve => setTimeout(resolve, 5));
    return session(serverState, serverState != "d1655760");
  };
  account.httpPost = async (url: string, request: any) => ({
    methodResponses: request.methodCalls.map(([name, args, id]) => [name, args, id]),
    sessionState: serverState,
  });
  return { account, sessionFetches: () => fetches };
}

test("A changed session state fetches the session again", async () => {
  let { account, sessionFetches } = newAccount("45b2a26c");

  await account.makeSingleCall("Core/echo", { hello: true });

  await waitFor(() => account.session.state == "45b2a26c");
  expect(sessionFetches()).toBeGreaterThanOrEqual(1);
  expect(Object.keys(account.session.accounts).sort()).toEqual(["q", "r"]);
});

test("An unchanged session state does not fetch the session", async () => {
  let { account, sessionFetches } = newAccount("d1655760");

  await account.makeSingleCall("Core/echo", { hello: true });
  await new Promise(resolve => setTimeout(resolve, 20));

  expect(sessionFetches()).toBe(0);
});

test("Several responses with the new state fetch the session only once", async () => {
  let { account, sessionFetches } = newAccount("45b2a26c");

  await Promise.all([1, 2, 3].map(i => account.makeSingleCall("Core/echo", { i })));

  await waitFor(() => account.session.state == "45b2a26c");
  expect(sessionFetches()).toBe(1);
});

test("Accounts shared with us get the new session, too", async () => {
  let { account } = newAccount("45b2a26c");
  let sharedAccount = new JMAPAccount();
  sharedAccount.initFromMainAccount(account);
  sharedAccount.accountID = "q";
  sharedAccount.session = account.session;
  sharedAccount.httpPost = account.httpPost;
  appGlobal.emailAccounts.add(account);
  appGlobal.emailAccounts.add(sharedAccount);
  try {
    await sharedAccount.makeSingleCall("Core/echo", { hello: true });

    await waitFor(() => sharedAccount.session.state == "45b2a26c");
    expect(account.session.state).toBe("45b2a26c");
    expect(sharedAccount.session.accounts.q).toBeDefined();
  } finally {
    appGlobal.emailAccounts.remove(sharedAccount);
    appGlobal.emailAccounts.remove(account);
  }
});
