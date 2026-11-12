// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { GraphAccount } from "../../../../logic/Mail/Graph/GraphAccount";
import { expect, test } from "vitest";

/** An `HTTPFetchError` as it arrives from the backend: scalar properties only */
function httpError(httpCode: number): Error {
  let ex = new Error(`HTTP GET <https://graph.microsoft.com/v1.0/me/mailFolders> failed with ${httpCode}`);
  Object.assign(ex, { name: "HTTPError", httpCode });
  return ex;
}

function newAccount(failWith: Error): GraphAccount {
  appGlobal.remoteApp = {
    kyCreate: () => ({ get: async () => { throw failWith } }),
  };
  let account = new GraphAccount();
  account.name = "Test";
  account.url = "https://graph.microsoft.com";
  account.oAuth2 = { isLoggedIn: true, authorizationHeader: "Bearer TEST" } as any;
  return account;
}

test("A login that the server refused is a login error", async () => {
  let account = newAccount(httpError(401));

  let ex = await account.graphGet("mailFolders").catch(ex => ex);

  expect(ex.authFail).toBe(true);
  expect(ex.isUserError).toBe(true);
});

test("Other HTTP errors are no login errors, and keep their message", async () => {
  let account = newAccount(httpError(404));

  let ex = await account.graphGet("mailFolders").catch(ex => ex);

  expect(ex.authFail).toBeFalsy();
  expect(ex.message).toContain("404");
});
