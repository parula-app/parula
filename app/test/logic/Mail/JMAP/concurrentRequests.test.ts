import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import type { TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import { expect, test } from "vitest";

/** Stalwart's default is 4. It answers one request too many with HTTP 400 `maxConcurrentRequests`,
 * and counts API calls, downloads and uploads together, per user.
 * Here a different value than our default, to see that we use what the server says. */
const kServerMax = 3;
const kSessionURL = "https://example.com/.well-known/jmap";
const kAPIURL = "https://example.com/jmap/";
const kDownloadURL = "https://example.com/jmap/download/u1/b1/email";
const kUploadURL = "https://example.com/jmap/upload/u1/";

/** A server whose requests take a moment, and which counts how many run at once */
function stubServer(counter: { running: number, max: number }) {
  let handle = async (url: string) => {
    if (url == kSessionURL) {
      return session();
    }
    counter.max = Math.max(counter.max, ++counter.running);
    await new Promise(resolve => setTimeout(resolve, 2));
    counter.running--;
    return {};
  };
  appGlobal.remoteApp = {
    kyCreate: () => ({ get: handle, post: handle }),
  } as any;
}

function session(): TJMAPSession {
  return {
    capabilities: {
      "urn:ietf:params:jmap:core": { maxConcurrentRequests: kServerMax },
      "urn:ietf:params:jmap:mail": {},
    },
    accounts: { u1: { name: "me@example.com", isPersonal: true, isReadOnly: false, accountCapabilities: {} } },
    primaryAccounts: { "urn:ietf:params:jmap:mail": "u1" },
    username: "me@example.com",
    apiUrl: kAPIURL,
    downloadUrl: "https://example.com/jmap/download/{accountId}/{blobId}/{name}?accept={type}",
    uploadUrl: "https://example.com/jmap/upload/{accountId}/",
    eventSourceUrl: "https://example.com/jmap/eventsource/?types={types}&closeafter={closeafter}&ping={ping}",
    state: "s1",
  };
}

async function newAccount(): Promise<JMAPAccount> {
  let account = new JMAPAccount();
  account.url = kSessionURL;
  await account.getSession();
  return account;
}

/** API calls, downloads and uploads of `account`, all at once */
function manyRequests(account: JMAPAccount, count: number): Promise<any>[] {
  let requests: Promise<any>[] = [];
  for (let i = 0; i < count; i++) {
    requests.push(account.httpPost(kAPIURL, { methodCalls: [] }));
    requests.push(account.httpGet(kDownloadURL));
    requests.push(account.httpPostBinary(kUploadURL, new Uint8Array(1)));
  }
  return requests;
}

test("API calls, downloads and uploads together stay within the server's maxConcurrentRequests", async () => {
  let counter = { running: 0, max: 0 };
  stubServer(counter);
  let account = await newAccount();

  let results = await Promise.all(manyRequests(account, 5));

  expect(results.length).toBe(15);
  expect(counter.max).toBe(kServerMax);
});

test("Requests for an account shared with us count towards the same limit", async () => {
  let counter = { running: 0, max: 0 };
  stubServer(counter);
  let account = await newAccount();
  let sharedAccount = new JMAPAccount();
  sharedAccount.initFromMainAccount(account);
  sharedAccount.accountID = "u2";
  sharedAccount.session = account.session;

  await Promise.all([
    ...manyRequests(account, 3),
    ...manyRequests(sharedAccount, 3),
  ]);

  expect(counter.max).toBe(kServerMax);
});

test("A failed request lets the next one run", async () => {
  let started = 0;
  stubServer({ running: 0, max: 0 });
  let account = await newAccount();
  appGlobal.remoteApp = {
    kyCreate: () => ({ post: async () => {
      started++;
      throw Object.assign(new Error("HTTP POST failed with 500"), { name: "HTTPError", httpCode: 500 });
    } }),
  } as any;

  for (let i = 0; i < kServerMax + 2; i++) {
    await expect(account.httpPost(kAPIURL, {})).rejects.toThrow();
  }

  expect(started).toBe(kServerMax + 2);
});
