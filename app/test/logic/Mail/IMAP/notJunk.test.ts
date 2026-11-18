import { appGlobal } from "../../../../logic/app";
import { IMAPAccount } from "../../../../logic/Mail/IMAP/IMAPAccount";
import type { IMAPFolder } from "../../../../logic/Mail/IMAP/IMAPFolder";
import type { IMAPEMail } from "../../../../logic/Mail/IMAP/IMAPEMail";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { expect, test } from "vitest";

/**
 * A fake IMAP server that keeps the keywords of one email
 * @param keywords on the server
 */
function setUpEMail(keywords: string[]) {
  let onServer = new Set(keywords);
  /** All keywords that the app asked the server to remove */
  let removed = new Set<string>();
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
        for (let flag of flags) {
          removed.add(flag);
          for (let kept of onServer) {
            if (kept.toLowerCase() == flag.toLowerCase()) {
              onServer.delete(kept);
            }
          }
        }
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
  email.setFlagsLocal(new Set(keywords));
  return { email, onServer, removed };
}

/** Keywords are case-insensitive, RFC 9051 section 9 */
function has(onServer: Set<string>, keyword: string): boolean {
  return [...onServer].some(flag => flag.toLowerCase() == keyword.toLowerCase());
}

test("Marking an email as not spam tells the server's spam filter", async () => {
  let { email, onServer } = setUpEMail(["$Junk"]);

  await email.markSpam(false);

  expect(has(onServer, "$NotJunk")).toBe(true);
  expect(has(onServer, "$Junk")).toBe(false);
});

test("Marking an email as not spam that isn't spam only adds $NotJunk", async () => {
  let { email, onServer, removed } = setUpEMail([]);

  await email.markSpam(false);

  expect(has(onServer, "$NotJunk")).toBe(true);
  expect(removed.size).toBe(0);
});

test("Marking an email as spam only adds $Junk", async () => {
  let { email, onServer, removed } = setUpEMail([]);

  await email.markSpam(true);

  expect(has(onServer, "$Junk")).toBe(true);
  expect(removed.size).toBe(0);
});

test("Marking an email as not spam removes $Junk, when the server reports it in lowercase", async () => {
  let { email, onServer } = setUpEMail(["$junk"]);

  await email.markSpam(false);

  expect(has(onServer, "$NotJunk")).toBe(true);
  expect(has(onServer, "$Junk")).toBe(false);
});
