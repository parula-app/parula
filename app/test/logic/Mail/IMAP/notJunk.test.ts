import { appGlobal } from "../../../../logic/app";
import { IMAPAccount } from "../../../../logic/Mail/IMAP/IMAPAccount";
import type { IMAPFolder } from "../../../../logic/Mail/IMAP/IMAPFolder";
import type { IMAPEMail } from "../../../../logic/Mail/IMAP/IMAPEMail";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { expect, test } from "vitest";

/**
 * A fake IMAP server that keeps the keywords of one email
 * @param keywords on the server
 * @param fetched The app got the email with its flags from the server in this session.
 *   false = the app knows the email only from its local database.
 */
function setUpEMail(keywords: string[], fetched = true) {
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
  if (fetched) {
    email.setFlagsLocal(new Set(keywords));
  } else {
    // The local database keeps only whether the email is spam
    email.isSpam = has(onServer, "$Junk");
  }
  return { email, onServer, removed };
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

test("Marking an email as not spam that has neither keyword only adds $NotJunk", async () => {
  let { email, onServer, removed } = setUpEMail([]);

  await email.markSpam(false);

  expect(has(onServer, "$NotJunk")).toBe(true);
  expect(has(onServer, "$Junk")).toBe(false);
  expect(removed.size).toBe(0);
});

test("Marking an email as spam that has neither keyword only adds $Junk", async () => {
  let { email, onServer, removed } = setUpEMail([]);

  await email.markSpam(true);

  expect(has(onServer, "$Junk")).toBe(true);
  expect(has(onServer, "$NotJunk")).toBe(false);
  expect(removed.size).toBe(0);
});

test("Marking an email as not spam removes $Junk, when the app knows the email only from its database", async () => {
  let { email, onServer } = setUpEMail(["$Junk"], false);

  await email.markSpam(false);

  expect(has(onServer, "$NotJunk")).toBe(true);
  expect(has(onServer, "$Junk")).toBe(false);
});

test("Marking an email as spam removes $NotJunk, when the app knows the email only from its database", async () => {
  let { email, onServer } = setUpEMail(["$NotJunk"], false);

  await email.markSpam(true);

  expect(has(onServer, "$Junk")).toBe(true);
  expect(has(onServer, "$NotJunk")).toBe(false);
});

test("Marking an email as not spam and then as spam again leaves only $Junk", async () => {
  let { email, onServer } = setUpEMail(["$Junk"]);

  await email.markSpam(false);
  await email.markSpam(true);

  expect(has(onServer, "$Junk")).toBe(true);
  expect(has(onServer, "$NotJunk")).toBe(false);
});

// RFC 9051 section 9: keywords are case-insensitive, and a server may report them in any case
test("Marking an email as not spam removes $Junk, when the server reports it in lowercase", async () => {
  let { email, onServer } = setUpEMail(["$junk"]);

  await email.markSpam(false);

  expect(has(onServer, "$NotJunk")).toBe(true);
  expect(has(onServer, "$Junk")).toBe(false);
});

test("Marking an email as spam removes $NotJunk, when the server reports it in lowercase", async () => {
  let { email, onServer } = setUpEMail(["$notjunk"]);

  await email.markSpam(true);

  expect(has(onServer, "$Junk")).toBe(true);
  expect(has(onServer, "$NotJunk")).toBe(false);
});
