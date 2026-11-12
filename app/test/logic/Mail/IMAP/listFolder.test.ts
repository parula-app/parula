import { appGlobal } from "../../../../logic/app";
import { IMAPAccount } from "../../../../logic/Mail/IMAP/IMAPAccount";
import type { IMAPFolder } from "../../../../logic/Mail/IMAP/IMAPFolder";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { expect, test } from "vitest";

/** Serves `UID SEARCH` and `UID FETCH` for `count` emails in the Inbox */
function setUpFolder(count: number) {
  let fetches = 0;
  appGlobal.remoteApp = {
    createIMAPFlowConnection: () => ({
      id: "test",
      on: () => undefined,
      connect: async () => undefined,
      getMailboxLock: async () => ({ release: () => undefined }),
      search: async () => Array.from({ length: count }, (_, i) => i + 1),
      fetch: async (range: { uid: string }) => {
        fetches++;
        return (async function* () {
          for (let uid of range.uid.split(",")) {
            yield { uid: Number(uid), flags: new Set(), envelope: { subject: "Email " + uid } };
          }
        })();
      },
    }),
  } as any;
  let account = new IMAPAccount();
  account.hostname = "imap.example.com";
  account.username = "me@example.com";
  account.password = "secret";
  account.storage = new DummyMailStorage();
  let errors: Error[] = [];
  account.errorCallback = ex => errors.push(ex);
  let inbox = account.newFolder() as IMAPFolder;
  inbox.path = "INBOX";
  account.rootFolders.add(inbox);
  return { account, inbox, errors, fetches: () => fetches };
}

test("The next page is fetched while the last page is still being saved", async () => {
  let { account, inbox, fetches } = setUpFolder(450);
  let fetchesDuringSave: number[] = [];
  account.storage.saveMessages = async () => {
    let fetchesBefore = fetches();
    await new Promise(resolve => setTimeout(resolve, 10));
    fetchesDuringSave.push(fetches() - fetchesBefore);
  };

  await (inbox as any).listAllUnknownMessages();

  expect(fetchesDuringSave).toEqual([1, 1, 0]); // nothing after the last page
  expect(inbox.messages.length).toBe(450);
});

test("An error while saving a page is reported, and the listing goes on", async () => {
  let { account, inbox, errors } = setUpFolder(450);
  let saves = 0;
  account.storage.saveMessages = async () => {
    if (++saves == 1) {
      throw new Error("Disk full");
    }
  };

  await (inbox as any).listAllUnknownMessages();

  expect(errors.map(ex => ex.message)).toEqual(["Disk full"]);
  expect(saves).toBe(3);
  expect(inbox.messages.length).toBe(450);
});
