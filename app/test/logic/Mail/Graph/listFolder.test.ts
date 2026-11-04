// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { GraphAccount } from "../../../../logic/Mail/Graph/GraphAccount";
import { GraphFolder } from "../../../../logic/Mail/Graph/GraphFolder";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { expect, test } from "vitest";

/** The folder was empty in the folder listing at startup, and
 * since then, a server-side rule or another device put emails there. */
test("A folder that was empty at startup lists the emails that arrived since", async () => {
  let server = new FakeGraphServer();
  server.pages = [[server.newEmail("m1", "First"), server.newEmail("m2", "Second")]];
  let folder = setUpFolder(server);
  folder.countTotal = 0;

  let newMessages = await folder.listMessages();

  expect(newMessages.contents.map(email => email.subject).sort()).toEqual(["First", "Second"]);
  expect(server.errors).toEqual([]);
});

test("All pages are listed, also when our count is too low", async () => {
  let server = new FakeGraphServer();
  server.pages = [
    [server.newEmail("m1", "First"), server.newEmail("m2", "Second")],
    [server.newEmail("m3", "Third")],
  ];
  let folder = setUpFolder(server);
  folder.countTotal = 1;

  let newMessages = await folder.listMessages();

  expect(newMessages.contents.map(email => email.subject).sort()).toEqual(["First", "Second", "Third"]);
  expect(server.errors).toEqual([]);
});

test("A server that always sends a next page doesn't keep us busy forever", async () => {
  let server = new FakeGraphServer();
  server.pages = [[server.newEmail("m1", "First")]];
  server.endless = true;
  let folder = setUpFolder(server);

  await folder.listMessages();

  // Each round is one request. Any limit is fine, as long as there is one.
  expect(server.requests).toBeLessThan(100000);
  expect(server.errors.length).toBeGreaterThan(0);
});

class FakeGraphServer {
  pages: any[][] = [];
  /** Sends a new page with the next page link, forever */
  endless = false;
  requests = 0;
  errors: Error[] = [];

  newEmail(id: string, subject: string) {
    return {
      id,
      internetMessageId: `<${id}@example.com>`,
      subject,
      receivedDateTime: new Date().toISOString(),
      isRead: false,
    };
  }

  get(url: string) {
    this.requests++;
    const kContext = "https://graph.microsoft.com/v1.0/$metadata#users('user-1')/mailFolders('folder-1')/messages";
    if (this.endless) {
      return {
        "@odata.context": kContext,
        value: [this.newEmail("e" + this.requests, "Endless")],
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/next?page=" + (this.requests + 1),
      };
    }
    let match = url.match(/[?&]page=(\d+)/);
    let pageNumber = match ? Number(match[1]) : 0;
    let response: any = { "@odata.context": kContext, value: this.pages[pageNumber] ?? [] };
    if (pageNumber + 1 < this.pages.length) {
      response["@odata.nextLink"] = "https://graph.microsoft.com/v1.0/me/next?page=" + (pageNumber + 1);
    }
    return response;
  }
}

function setUpFolder(server: FakeGraphServer): GraphFolder {
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
  let folder = new GraphFolder(account);
  folder.id = "folder-1";
  folder.name = "Newsletters";
  account.rootFolders.add(folder);
  return folder;
}
