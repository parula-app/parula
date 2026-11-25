import { appGlobal } from "../../../../logic/app";
import { IMAPAccount } from "../../../../logic/Mail/IMAP/IMAPAccount";
import type { IMAPFolder } from "../../../../logic/Mail/IMAP/IMAPFolder";
import type { IMAPEMail } from "../../../../logic/Mail/IMAP/IMAPEMail";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { ArrayColl } from "svelte-collections";
import { expect, test } from "vitest";

/** A fake IMAP server. Like ImapFlow, `messageMove()` and `messageCopy()`
 * return `false` when the server refuses, instead of throwing. */
function setUpAccount(options: { hasMove: boolean, refuse: boolean }) {
  let server = {
    moved: [] as string[],
    copied: [] as string[],
    deleted: [] as string[],
  };
  appGlobal.remoteApp = {
    createIMAPFlowConnection: () => ({
      id: "test",
      on: () => undefined,
      connect: async () => undefined,
      getMailboxLock: async () => ({ release: () => undefined }),
      capabilities: new Map(options.hasMove ? [["MOVE", true]] : []),
      messageMove: async (ids: string) => {
        if (options.refuse) {
          return false;
        }
        server.moved.push(ids);
        return { path: "INBOX", destination: "Archive" };
      },
      messageCopy: async (ids: string) => {
        if (options.refuse) {
          return false;
        }
        server.copied.push(ids);
        return { path: "INBOX", destination: "Archive" };
      },
      messageDelete: async (ids: string) => {
        server.deleted.push(ids);
        return true;
      },
    }),
  } as any;
  let account = new IMAPAccount();
  account.hostname = "imap.example.com";
  account.username = "me@example.com";
  account.password = "secret";
  account.storage = new DummyMailStorage();
  let inbox = newFolder(account, "INBOX", 5);
  let archive = newFolder(account, "Archive", 3);
  let email = inbox.newEMail() as IMAPEMail;
  email.uid = 42;
  inbox.messages.add(email);
  return { inbox, archive, email, server };
}

function newFolder(account: IMAPAccount, path: string, countTotal: number): IMAPFolder {
  let folder = account.newFolder() as IMAPFolder;
  folder.path = path;
  folder.name = path;
  folder.countTotal = countTotal;
  account.rootFolders.add(folder);
  return folder;
}

test("A move that the server refuses gives an error, and the email stays in its folder", async () => {
  let { inbox, archive, email, server } = setUpAccount({ hasMove: true, refuse: true });

  await expect(archive.moveMessagesHere(new ArrayColl([email]))).rejects.toThrow();

  expect(inbox.messages.contents).toContain(email);
  expect(inbox.countTotal).toBe(5);
  expect(archive.countTotal).toBe(3);
  expect(server.deleted).toEqual([]);
});

test("A copy that the server refuses gives an error, and the counts stay", async () => {
  let { inbox, archive, email } = setUpAccount({ hasMove: true, refuse: true });

  await expect(archive.copyMessagesHere(new ArrayColl([email]))).rejects.toThrow();

  expect(inbox.messages.contents).toContain(email);
  expect(inbox.countTotal).toBe(5);
  expect(archive.countTotal).toBe(3);
});

test("A move moves the email", async () => {
  let { inbox, archive, email, server } = setUpAccount({ hasMove: true, refuse: false });

  await archive.moveMessagesHere(new ArrayColl([email]));

  expect(server.moved).toEqual(["42"]);
  expect(inbox.messages.contents).not.toContain(email);
  expect(inbox.countTotal).toBe(4);
  expect(archive.countTotal).toBe(4);
});

test("Without the MOVE extension, a move copies the email and then deletes it", async () => {
  let { inbox, archive, email, server } = setUpAccount({ hasMove: false, refuse: false });

  await archive.moveMessagesHere(new ArrayColl([email]));

  expect(server.copied).toEqual(["42"]);
  expect(server.deleted).toEqual(["42"]);
  expect(inbox.countTotal).toBe(4);
  expect(archive.countTotal).toBe(4);
});

test("Without the MOVE extension, a move whose copy the server refuses deletes nothing", async () => {
  let { inbox, archive, email, server } = setUpAccount({ hasMove: false, refuse: true });

  await expect(archive.moveMessagesHere(new ArrayColl([email]))).rejects.toThrow();

  expect(server.deleted).toEqual([]);
  expect(inbox.messages.contents).toContain(email);
  expect(inbox.countTotal).toBe(5);
  expect(archive.countTotal).toBe(3);
});
