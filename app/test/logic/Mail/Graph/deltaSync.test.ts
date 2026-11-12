// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { GraphAccount } from "../../../../logic/Mail/Graph/GraphAccount";
import { GraphFolder } from "../../../../logic/Mail/Graph/GraphFolder";
import type { GraphEMail } from "../../../../logic/Mail/Graph/GraphEMail";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { expect, test } from "vitest";

test("A poll gets only the changes since the last listing", async () => {
  let server = new FakeGraphMailbox();
  server.add("m1", "First");
  server.add("m2", "Second");
  server.add("m3", "Third");
  server.pageSize = 2;
  let folder = setUpFolder(server);
  await folder.listMessages();
  expect(subjects(folder.messages.contents)).toEqual(["First", "Second", "Third"]);

  server.add("m4", "Fourth");
  server.requests = [];
  let newMessages = await folder.listMessages();

  expect(subjects(newMessages.contents)).toEqual(["Fourth"]);
  expect(subjects(folder.messages.contents)).toEqual(["First", "Fourth", "Second", "Third"]);
  expect(newMessages.first.isNewArrived).toBe(true);
  expect(server.requests.length).toBe(1);
  expect(server.errors).toEqual([]);
});

test("An email that was deleted or moved in another app disappears at the next poll", async () => {
  let server = new FakeGraphMailbox();
  server.add("m1", "First");
  server.add("m2", "Second");
  let folder = setUpFolder(server);
  await folder.listMessages();

  server.remove("m1");
  await folder.listMessages();

  expect(subjects(folder.messages.contents)).toEqual(["Second"]);
  expect(server.errors).toEqual([]);
});

test("An email that was changed in another app is updated, not added again", async () => {
  let server = new FakeGraphMailbox();
  server.add("m1", "First");
  server.add("m2", "Second");
  let folder = setUpFolder(server);
  await folder.listMessages();
  expect(folder.messages.contents.find(email => email.pID == "m1").isRead).toBe(false);

  server.update("m1", { isRead: true });
  let newMessages = await folder.listMessages();

  expect(newMessages.isEmpty).toBe(true);
  expect(subjects(folder.messages.contents)).toEqual(["First", "Second"]);
  expect(folder.messages.contents.find(email => email.pID == "m1").isRead).toBe(true);
  expect(server.errors).toEqual([]);
});

test("When the server no longer knows our delta link, the folder is listed again", async () => {
  let server = new FakeGraphMailbox();
  server.add("m1", "First");
  let folder = setUpFolder(server);
  await folder.listMessages();

  server.forgetDeltaLinks();
  server.add("m2", "Second");
  await folder.listMessages();

  expect(subjects(folder.messages.contents)).toEqual(["First", "Second"]);
  expect(server.errors).toEqual([]);

  // And the next poll works with the new delta link
  server.add("m3", "Third");
  let newMessages = await folder.listMessages();
  expect(subjects(newMessages.contents)).toEqual(["Third"]);
});

function subjects(emails: GraphEMail[]): string[] {
  return emails.map(email => email.subject).sort();
}

/** A folder on a Graph server, with the delta function.
 * <https://learn.microsoft.com/en-us/graph/delta-query-messages> */
class FakeGraphMailbox {
  messages = new Map<string, any>();
  /** Message IDs, in the order in which they were added, changed or removed */
  changes: string[] = [];
  /** The delta links up to this one no longer work */
  forgottenDeltaToken = -1;
  pageSize = 1000;
  requests: string[] = [];
  errors: Error[] = [];

  add(id: string, subject: string) {
    this.messages.set(id, {
      id,
      internetMessageId: `<${id}@example.com>`,
      subject,
      receivedDateTime: new Date().toISOString(),
      isRead: false,
    });
    this.changes.push(id);
  }

  update(id: string, properties: any) {
    Object.assign(this.messages.get(id), properties);
    this.changes.push(id);
  }

  remove(id: string) {
    this.messages.delete(id);
    this.changes.push(id);
  }

  forgetDeltaLinks() {
    this.forgottenDeltaToken = this.changes.length;
  }

  get(url: string) {
    this.requests.push(url);
    expect(url).toContain("/messages/delta");
    let params = new URL(url).searchParams;
    let deltaToken = params.get("$deltatoken");
    let skip = Number(params.get("$skiptoken") ?? 0);
    if (!deltaToken && !skip) { // The next and delta links include it
      expect(params.get("$select")).toContain("subject");
    }
    let ids: string[];
    if (deltaToken) {
      if (Number(deltaToken) <= this.forgottenDeltaToken) {
        throw Object.assign(new Error("HTTP GET failed with 410 Gone"), { name: "HTTPError", httpCode: 410 });
      }
      ids = [...new Set(this.changes.slice(Number(deltaToken)))];
    } else {
      ids = [...this.messages.keys()];
    }
    let response: any = {
      "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#Collection(message)",
      value: ids.slice(skip, skip + this.pageSize).map(id =>
        this.messages.get(id) ?? { id, "@removed": { reason: "deleted" } }),
    };
    let link = "https://graph.microsoft.com/v1.0/me/mailFolders('folder-1')/messages/delta?";
    if (skip + this.pageSize < ids.length) {
      response["@odata.nextLink"] = link + (deltaToken ? `$deltatoken=${deltaToken}&` : "") + "$skiptoken=" + (skip + this.pageSize);
    } else {
      response["@odata.deltaLink"] = link + "$deltatoken=" + this.changes.length;
    }
    return response;
  }
}

function setUpFolder(server: FakeGraphMailbox): GraphFolder {
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
  folder.name = "Inbox";
  account.rootFolders.add(folder);
  return folder;
}
