// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { GraphAccount } from "../../../../logic/Mail/Graph/GraphAccount";
import { expect, test } from "vitest";

/** Microsoft Graph, Outlook service limits: "Four concurrent requests" per app and mailbox
 * <https://learn.microsoft.com/en-us/graph/throttling-limits#outlook-service-limits> */
const kServerMaxConcurrent = 4;

/** A Graph server that answers each request after a while, and counts how many run at the same time */
class FakeGraphServer {
  running = 0;
  maxRunning = 0;
  answered = 0;
  rejected = 0;

  async answer(): Promise<any> {
    this.running++;
    this.maxRunning = Math.max(this.maxRunning, this.running);
    try {
      if (this.running > kServerMaxConcurrent) {
        this.rejected++;
        let ex = new Error("HTTP GET failed with 429 Too Many Requests") as any;
        ex.name = "HTTPError";
        ex.httpCode = 429;
        throw ex;
      }
      await new Promise(resolve => setTimeout(resolve, 20));
      this.answered++;
      return { value: [] };
    } finally {
      this.running--;
    }
  }
}

function setupAccount(server: FakeGraphServer): GraphAccount {
  let ky = {};
  for (let method of ["get", "post", "patch", "delete"]) {
    ky[method] = () => server.answer();
  }
  appGlobal.remoteApp = { kyCreate: () => ky } as any;
  let account = new GraphAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.url = "https://graph.microsoft.com";
  account.oAuth2 = {
    isLoggedIn: true,
    authorizationHeader: "Bearer TEST",
  } as any;
  return account;
}

test("Many requests at once, e.g. downloads of two folders, stay within the server's limit and all succeed", async () => {
  let server = new FakeGraphServer();
  let account = setupAccount(server);

  let requests = [];
  for (let i = 0; i < 12; i++) {
    requests.push(account.graphCall("messages/msg-" + i + "/$value"));
  }
  let results = await Promise.allSettled(requests);

  expect(results.filter(result => result.status == "rejected")).toEqual([]);
  expect(server.answered).toBe(12);
  expect(server.rejected).toBe(0);
  expect(server.maxRunning).toBeLessThanOrEqual(kServerMaxConcurrent);
});
