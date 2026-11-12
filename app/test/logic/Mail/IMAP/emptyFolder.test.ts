import { appGlobal } from "../../../../logic/app";
import { IMAPAccount } from "../../../../logic/Mail/IMAP/IMAPAccount";
import type { IMAPFolder } from "../../../../logic/Mail/IMAP/IMAPFolder";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { expect, test } from "vitest";

/** The folder was empty in the folder listing at startup, and
 * since then, a server-side filter or another device put emails there. */
test("A folder that was empty at startup lists the emails that arrived since", async () => {
  let server = new FakeIMAPServer();
  server.emails = [server.newEmail(11, "First"), server.newEmail(12, "Second")];
  let folder = setUpFolder(server);
  folder.countTotal = 0;

  let newMessages = await folder.listMessages();

  expect(newMessages.contents.map(email => email.subject).sort()).toEqual(["First", "Second"]);
  expect(folder.messages.length).toBe(2);
  expect(folder.countTotal).toBe(2);
  expect(folder.countUnread).toBe(2);
});

test("Checking for new mail in a folder that was empty at startup finds the emails that arrived since", async () => {
  let server = new FakeIMAPServer();
  server.emails = [server.newEmail(11, "First")];
  let folder = setUpFolder(server);
  folder.countTotal = 0;

  let newMessages = await folder.listNewMessages();

  expect(newMessages.contents.map(email => email.subject)).toEqual(["First"]);
  expect(folder.messages.length).toBe(1);
});

test("A folder that is still empty can be opened", async () => {
  let server = new FakeIMAPServer();
  let folder = setUpFolder(server);
  folder.countTotal = 0;

  let listed = await folder.listMessages();
  let newMessages = await folder.listNewMessages();

  expect(listed.isEmpty).toBe(true);
  expect(newMessages.isEmpty).toBe(true);
});

class FakeIMAPServer {
  emails: any[] = [];

  newEmail(uid: number, subject: string) {
    return {
      uid,
      seq: uid,
      size: 1234,
      flags: new Set<string>(),
      envelope: { messageId: `<${uid}@example.com>`, subject, date: new Date() },
    };
  }

  connection() {
    return {
      id: "test",
      capabilities: new Map(),
      on: () => undefined,
      connect: async () => undefined,
      getMailboxLock: async () => ({ release: () => undefined }),
      status: async (path: string) => ({
        path,
        messages: this.emails.length,
        unseen: this.emails.filter(email => !email.flags.has("\\Seen")).length,
      }),
      search: async () => this.emails.map(email => email.uid),
      fetch: async () => {
        if (!this.emails.length) {
          // Like some servers for `1:*` in an empty folder
          throw new Error("Invalid messageset");
        }
        return this.emails;
      },
    };
  }
}

function setUpFolder(server: FakeIMAPServer): IMAPFolder {
  appGlobal.remoteApp = {
    createIMAPFlowConnection: () => server.connection(),
  } as any;
  let account = new IMAPAccount();
  account.hostname = "imap.example.com";
  account.username = "me@example.com";
  account.password = "secret";
  account.storage = new DummyMailStorage();
  let folder = account.newFolder() as IMAPFolder;
  folder.path = "Newsletters";
  account.rootFolders.add(folder);
  return folder;
}
