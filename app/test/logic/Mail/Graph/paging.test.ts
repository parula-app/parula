// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { GraphAccount } from "../../../../logic/Mail/Graph/GraphAccount";
import { GraphFolder } from "../../../../logic/Mail/Graph/GraphFolder";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { expect, test } from "vitest";

test("All pages of the folder list are listed", async () => {
  let server = new FakeGraphServer();
  server.pages = [
    [server.newFolder("f1"), server.newFolder("f2")],
    [server.newFolder("f3")],
    [server.newFolder("f4")],
  ];
  let account = setUpAccount(server);

  await account.listFolders();

  expect(account.rootFolders.contents.map(folder => folder.id).sort()).toEqual(["f1", "f2", "f3", "f4"]);
  expect(server.errors).toEqual([]);
});

test("graphGetAll() returns the delta link of the last page", async () => {
  let server = new FakeGraphServer();
  server.pages = [[{ id: "m1" }], [{ id: "m2" }], [{ id: "m3" }]];
  server.deltaLink = "https://graph.microsoft.com/v1.0/me/delta?token=1";
  let account = setUpAccount(server);

  let results = await account.graphGetAll<any>("mailFolders/folder-1/messages/delta");

  expect(results.map(json => json.id)).toEqual(["m1", "m2", "m3"]);
  expect((results as any).deltaURL).toBe(server.deltaLink);
});

test("graphGetAll() returns the delta link, also when there is only 1 page", async () => {
  let server = new FakeGraphServer();
  server.pages = [[{ id: "m1" }]];
  server.deltaLink = "https://graph.microsoft.com/v1.0/me/delta?token=1";
  let account = setUpAccount(server);

  let results = await account.graphGetAll<any>("mailFolders/folder-1/messages/delta");

  expect((results as any).deltaURL).toBe(server.deltaLink);
});

test("Listing the emails of a folder asks the server only for the header fields", async () => {
  let server = new FakeGraphServer();
  server.pages = [[{ id: "m1", internetMessageId: "<m1@example.com>", subject: "First" }]];
  let account = setUpAccount(server);
  let folder = new GraphFolder(account);
  folder.id = "folder-1";
  folder.name = "Newsletters";
  account.rootFolders.add(folder);

  await folder.listMessages();

  let url = new URL(server.urls[0]);
  let fields = url.searchParams.get("$select")?.split(",");
  expect(fields).toContain("subject");
  expect(fields).not.toContain("body");
});

/** Sends the pages one after the other, each with the link to the next page */
class FakeGraphServer {
  pages: any[][] = [];
  /** Sent with the last page */
  deltaLink: string | null = null;
  urls: string[] = [];
  errors: Error[] = [];

  newFolder(id: string) {
    return { id, displayName: id, totalItemCount: 0, unreadItemCount: 0 };
  }

  get(url: string) {
    this.urls.push(url);
    const kContext = "https://graph.microsoft.com/v1.0/$metadata#users('user-1')/mailFolders";
    if (url.includes("/childFolders")) {
      return { "@odata.context": kContext, value: [] };
    }
    let match = url.match(/[?&]page=(\d+)/);
    let pageNumber = match ? Number(match[1]) : 0;
    let response: any = { "@odata.context": kContext, value: this.pages[pageNumber] ?? [] };
    if (pageNumber + 1 < this.pages.length) {
      response["@odata.nextLink"] = "https://graph.microsoft.com/v1.0/me/next?page=" + (pageNumber + 1);
    } else if (this.deltaLink) {
      response["@odata.deltaLink"] = this.deltaLink;
    }
    return response;
  }
}

function setUpAccount(server: FakeGraphServer): GraphAccount {
  appGlobal.remoteApp = {
    kyCreate: () => ({
      get: (url: string) => server.get(url),
    }),
  };
  let account = new GraphAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.url = "https://graph.microsoft.com";
  account.oAuth2 = {
    isLoggedIn: true,
    authorizationHeader: "Bearer TEST",
  } as any;
  account.storage = new DummyMailStorage();
  account.errorCallback = ex => server.errors.push(ex);
  return account;
}
