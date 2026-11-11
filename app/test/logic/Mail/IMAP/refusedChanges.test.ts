import { appGlobal } from "../../../../logic/app";
import { IMAPAccount } from "../../../../logic/Mail/IMAP/IMAPAccount";
import type { IMAPFolder } from "../../../../logic/Mail/IMAP/IMAPFolder";
import type { IMAPEMail } from "../../../../logic/Mail/IMAP/IMAPEMail";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { expect, test } from "vitest";

/** A fake IMAP connection. Like ImapFlow, `messageFlagsAdd()` and `messageFlagsRemove()`
 * return `false` instead of throwing, when the server refuses the `STORE`, e.g. in a
 * folder that is shared with us read-only, and when the folder can't store the keyword. */
function setUpEMail(storeSucceeds: boolean): IMAPEMail {
  appGlobal.remoteApp = {
    createIMAPFlowConnection: () => ({
      id: "test",
      on: () => undefined,
      connect: async () => undefined,
      getMailboxLock: async () => ({ release: () => undefined }),
      messageFlagsAdd: async () => storeSucceeds,
      messageFlagsRemove: async () => storeSucceeds,
    }),
  } as any;
  let account = new IMAPAccount();
  account.hostname = "imap.example.com";
  account.username = "me@example.com";
  account.password = "secret";
  account.storage = new DummyMailStorage();
  let folder = account.newFolder() as IMAPFolder;
  folder.path = "Shared/Team";
  account.rootFolders.add(folder);
  let email = folder.newEMail() as IMAPEMail;
  email.uid = 42;
  folder.messages.add(email);
  return email;
}

test("Marking an email as read gives an error when the server refuses it", async () => {
  let email = setUpEMail(false);

  await expect(email.markRead(true)).rejects.toThrow();
});

test("Marking all emails as read gives an error when the server refuses it", async () => {
  let email = setUpEMail(false);

  await expect(email.folder.markAllRead()).rejects.toThrow();
});

test("A keyword that the folder can't store stays a local change, without an error", async () => {
  // Exchange: PERMANENTFLAGS has no `\*`, so ImapFlow doesn't even send the `STORE`
  let email = setUpEMail(false);

  await email.markForwarded();

  expect(email.isForwarded).toBe(true);
});

test("Marking an email as read works when the server accepts it", async () => {
  let email = setUpEMail(true);

  await email.markRead(true);
  await email.folder.markAllRead();

  expect(email.isRead).toBe(true);
});
