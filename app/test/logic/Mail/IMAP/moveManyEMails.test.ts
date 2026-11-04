import { appGlobal } from "../../../../logic/app";
import { IMAPAccount } from "../../../../logic/Mail/IMAP/IMAPAccount";
import type { IMAPFolder } from "../../../../logic/Mail/IMAP/IMAPFolder";
import type { IMAPEMail } from "../../../../logic/Mail/IMAP/IMAPEMail";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { ArrayColl } from "svelte-collections";
import { expect, test } from "vitest";

/** RFC 7162 section 4: Clients SHOULD limit their command lines to about 8192 octets.
 * Stalwart, for example, rejects an argument longer than 8000 bytes. */
const kMaxArgumentLength = 8000;

/** The UID sets of the `MOVE` and `COPY` commands that the server got */
let movedUIDSets: string[] = [];
let copiedUIDSets: string[] = [];

function setUpAccount(): IMAPAccount {
  movedUIDSets = [];
  copiedUIDSets = [];
  appGlobal.remoteApp = {
    createIMAPFlowConnection: () => ({
      id: "test",
      on: () => undefined,
      connect: async () => undefined,
      getMailboxLock: async () => ({ release: () => undefined }),
      messageMove: async (uids: string) => {
        movedUIDSets.push(uids);
        return {};
      },
      messageCopy: async (uids: string) => {
        copiedUIDSets.push(uids);
        return {};
      },
    }),
  } as any;
  let account = new IMAPAccount();
  account.hostname = "imap.example.com";
  account.username = "me@example.com";
  account.password = "secret";
  account.storage = new DummyMailStorage();
  return account;
}

function newFolder(account: IMAPAccount, path: string): IMAPFolder {
  let folder = account.newFolder() as IMAPFolder;
  folder.path = path;
  account.rootFolders.add(folder);
  return folder;
}

/** Large UIDs, like in a folder that has received mail for years */
function newEMails(folder: IMAPFolder, count: number): ArrayColl<IMAPEMail> {
  let emails = new ArrayColl<IMAPEMail>();
  for (let i = 0; i < count; i++) {
    let email = folder.newEMail();
    email.uid = 4000000000 + 2 * i;
    emails.add(email);
  }
  folder.messages.addAll(emails);
  return emails;
}

/** All UIDs in these IMAP sequence sets, e.g. "3,5:7" → 3, 5, 6, 7 */
function uidsIn(uidSets: string[]): number[] {
  return uidSets.flatMap(set => set.split(",")).flatMap(part => {
    let [first, last] = part.split(":").map(uid => Number(uid));
    last ??= first;
    return Array.from({ length: last - first + 1 }, (_, i) => first + i);
  });
}

test("Moving 2000 emails sends every email to the server, in commands that the server accepts", async () => {
  let account = setUpAccount();
  let source = newFolder(account, "INBOX");
  let target = newFolder(account, "Archive");
  let emails = newEMails(source, 2000);

  await target.moveMessagesHere(new ArrayColl(emails.contents));

  expect(new Set(uidsIn(movedUIDSets))).toEqual(new Set(emails.contents.map(email => email.uid)));
  expect(uidsIn(movedUIDSets).length).toBe(2000);
  for (let uidSet of movedUIDSets) {
    expect(uidSet.length).toBeLessThan(kMaxArgumentLength);
  }
  expect(source.messages.length).toBe(0);
});

test("Copying 2000 emails sends every email to the server, in commands that the server accepts", async () => {
  let account = setUpAccount();
  let source = newFolder(account, "INBOX");
  let target = newFolder(account, "Archive");
  let emails = newEMails(source, 2000);

  await target.copyMessagesHere(new ArrayColl(emails.contents));

  expect(new Set(uidsIn(copiedUIDSets))).toEqual(new Set(emails.contents.map(email => email.uid)));
  expect(uidsIn(copiedUIDSets).length).toBe(2000);
  for (let uidSet of copiedUIDSets) {
    expect(uidSet.length).toBeLessThan(kMaxArgumentLength);
  }
  expect(source.messages.length).toBe(2000);
});
