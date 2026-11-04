import { appGlobal } from "../../../../logic/app";
import { IMAPAccount } from "../../../../logic/Mail/IMAP/IMAPAccount";
import type { IMAPFolder } from "../../../../logic/Mail/IMAP/IMAPFolder";
import type { IMAPEMail } from "../../../../logic/Mail/IMAP/IMAPEMail";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { expect, test } from "vitest";

/** A fake IMAP server that keeps the keywords of one email */
function setUpEMail(keywords: string[]) {
  let onServer = new Set(keywords);
  appGlobal.remoteApp = {
    createIMAPFlowConnection: () => ({
      id: "test",
      on: () => undefined,
      connect: async () => undefined,
      getMailboxLock: async () => ({ release: () => undefined }),
      messageFlagsAdd: async (uid: number, flags: string[]) => {
        flags.forEach(flag => onServer.add(flag));
        return true;
      },
      messageFlagsRemove: async (uid: number, flags: string[]) => {
        flags.forEach(flag => onServer.delete(flag));
        return true;
      },
    }),
  } as any;
  let account = new IMAPAccount();
  account.hostname = "imap.example.com";
  account.username = "me@example.com";
  account.password = "secret";
  account.storage = new DummyMailStorage();
  let folder = account.newFolder() as IMAPFolder;
  folder.path = "Junk";
  account.rootFolders.add(folder);
  let email = folder.newEMail() as IMAPEMail;
  email.uid = 42;
  folder.messages.add(email);
  return { email, onServer };
}

// IANA "IMAP and JMAP Keywords" registry (RFC 5788): `$Junk` and `$NotJunk` are mutually exclusive.
// Keywords are case-insensitive.
function has(onServer: Set<string>, keyword: string): boolean {
  return [...onServer].some(flag => flag.toLowerCase() == keyword.toLowerCase());
}

test("Marking an email as not spam tells the server's spam filter", async () => {
  let { email, onServer } = setUpEMail(["$Junk"]);

  await email.markSpam(false);

  expect(has(onServer, "$NotJunk")).toBe(true);
  expect(has(onServer, "$Junk")).toBe(false);
});

test("Marking an email as spam removes an earlier not spam", async () => {
  let { email, onServer } = setUpEMail(["$NotJunk"]);

  await email.markSpam(true);

  expect(has(onServer, "$Junk")).toBe(true);
  expect(has(onServer, "$NotJunk")).toBe(false);
});
