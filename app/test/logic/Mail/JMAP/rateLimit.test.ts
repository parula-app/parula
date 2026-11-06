import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { waitTime } from "../../../../logic/util/util";
import { expect, test } from "vitest";

const kURL = "https://example.com/jmap/";
/** How long the server tells us to wait */
const kRetryAfterSec = 1;

/** An `HTTPFetchError` as it arrives from the backend: scalar properties only */
function httpError(httpCode: number, retryAfterSeconds?: number): Error {
  let ex = new Error(`HTTP POST <${kURL}> failed with ${httpCode}`);
  Object.assign(ex, { name: "HTTPError", httpCode, retryAfterSeconds });
  return ex;
}

function newAccount(failWith: Error): JMAPAccount {
  appGlobal.remoteApp = {
    kyCreate: () => ({ post: async () => { throw failWith } }),
  } as any;
  return new JMAPAccount();
}

test("The server's Retry-After delays our next request", async () => {
  let account = newAccount(httpError(429, kRetryAfterSec));

  let startTime = Date.now();
  await expect(account.httpPost(kURL, {})).rejects.toThrow();
  await expect(account.httpPost(kURL, {})).rejects.toThrow();

  expect(Date.now() - startTime).toBeGreaterThanOrEqual(kRetryAfterSec * 1000 * waitTime.factor); // the app waits less in tests
});

test("A normal error does not slow the next request down", async () => {
  let account = newAccount(httpError(404));

  let startTime = Date.now();
  await expect(account.httpPost(kURL, {})).rejects.toThrow();
  await expect(account.httpPost(kURL, {})).rejects.toThrow();

  expect(Date.now() - startTime).toBeLessThan(kRetryAfterSec * 1000 * waitTime.factor); // the app waits less in tests
});
