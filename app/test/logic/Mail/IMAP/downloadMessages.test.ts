import { appGlobal } from "../../../../logic/app";
import { IMAPAccount } from "../../../../logic/Mail/IMAP/IMAPAccount";
import type { IMAPFolder } from "../../../../logic/Mail/IMAP/IMAPFolder";
import type { IMAPEMail } from "../../../../logic/Mail/IMAP/IMAPEMail";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { ArrayColl } from "svelte-collections";
import { expect, test } from "vitest";

const kUID = 42;

test("A mail that the server dropped between listing and download is skipped", async () => {
  let folder = setUpFolder({
    uid: kUID,
    seq: 1,
    size: 1234,
    flags: new Set<string>(),
    envelope: { messageId: "<test@example.com>", subject: "Test", date: new Date() },
    // The server deleted the mail meanwhile, so it returns no `source`
  });
  let errors: Error[] = [];
  folder.account.errorCallback = ex => errors.push(ex);
  let email = folder.newEMail();
  email.uid = kUID;
  folder.messages.add(email);

  let downloaded = await folder.downloadMessages(new ArrayColl([email]));

  expect(errors).toEqual([]);
  expect(downloaded.isEmpty).toBe(true);
  expect(email.downloadComplete).toBe(false);
});

function setUpFolder(...msgInfos: any[]): IMAPFolder {
  appGlobal.remoteApp = {
    createIMAPFlowConnection: () => ({
      id: "test",
      on: () => undefined,
      connect: async () => undefined,
      getMailboxLock: async () => ({ release: () => undefined }),
      fetch: async () => msgInfos,
    }),
  } as any;
  let account = new IMAPAccount();
  account.hostname = "imap.example.com";
  account.username = "me@example.com";
  account.password = "secret";
  account.storage = new DummyMailStorage();
  let folder = account.newFolder() as IMAPFolder;
  folder.path = "INBOX";
  account.rootFolders.add(folder);
  return folder;
}
