// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { GraphAccount } from "../../../../logic/Mail/Graph/GraphAccount";
import { expect, test } from "vitest";

const kFolders = [{ id: "inbox-1" }, { id: "sent-1" }, { id: "drafts-1" }];

/** A server whose mailbox has the folders `kFolders`, and that follows `$top` */
function newAccount(): GraphAccount {
  appGlobal.remoteApp = {
    kyCreate: () => ({
      get: async (url: string) => ({
        "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#users('user-1')/mailFolders",
        value: kFolders.slice(0, Number(new URL(url).searchParams.get("$top") ?? kFolders.length)),
      }),
    }),
  };
  let account = new GraphAccount();
  account.name = "Test";
  account.url = "https://graph.microsoft.com";
  account.oAuth2 = { isLoggedIn: true, authorizationHeader: "Bearer TEST", logout: async () => {} } as any;
  return account;
}

test("graphGet1() returns the one result", async () => {
  let account = newAccount();

  let folder = await account.graphGet1<any>("mailFolders", { $top: 1 });

  expect(folder.id).toBe("inbox-1");
});

test("graphGet1() refuses more than one result", async () => {
  let account = newAccount();

  await expect(account.graphGet1("mailFolders")).rejects.toThrow();
});

test("Checking the login works with a mailbox that has several folders", async () => {
  let account = newAccount();

  await account.verifyLogin();
});
