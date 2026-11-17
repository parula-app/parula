// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import type { JMAPFolder } from "../../../../logic/Mail/JMAP/JMAPFolder";
import type { JMAPEMail } from "../../../../logic/Mail/JMAP/JMAPEMail";
import type { TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { ArrayColl } from "svelte-collections";
import { expect, test } from "vitest";

/** Small, so that the test needs only a few emails. Stalwart's is 500. */
const kMaxObjectsInSet = 3;

/** A JMAP server that rejects an `Email/set` with too many objects, like Stalwart */
class TestJMAPAccount extends JMAPAccount {
  /** email ID -> the folders that the email is in, on the server */
  readonly mailboxIds = new Map<string, Record<string, boolean>>();
  async makeSingleCall(method: string, args: Record<string, any>): Promise<Record<string, any>> {
    expect(method).toBe("Email/set");
    let ids = Object.keys(args.update);
    if (ids.length > kMaxObjectsInSet) {
      let ex = new Error("The number of ids requested by the client exceeds the maximum number the server is willing to process in a single method call.") as any;
      ex.code = "requestTooLarge";
      throw ex;
    }
    for (let id of ids) {
      this.applyPatch(id, args.update[id]);
    }
    return { updated: Object.fromEntries(ids.map(id => [id, null])) };
  }

  /** Either a whole `mailboxIds`, or patches of it <https://www.rfc-editor.org/rfc/rfc8620#section-5.3> */
  protected applyPatch(id: string, patch: Record<string, any>) {
    let folders = { ...this.mailboxIds.get(id) };
    for (let path in patch) {
      if (path == "mailboxIds") {
        folders = { ...patch[path] };
      } else {
        expect(path.startsWith("mailboxIds/")).toBe(true);
        let folderID = path.substring("mailboxIds/".length);
        if (patch[path]) {
          folders[folderID] = true;
        } else {
          delete folders[folderID];
        }
      }
    }
    this.mailboxIds.set(id, folders);
  }
}

function setUp(emailCount: number) {
  appGlobal.remoteApp = { kyCreate: () => null } as any;
  let account = new TestJMAPAccount();
  account.accountID = "u1";
  account.session = {
    capabilities: {
      "urn:ietf:params:jmap:core": { maxObjectsInSet: kMaxObjectsInSet },
    },
  } as any as TJMAPSession;
  account.storage = new DummyMailStorage();
  let source = addFolder(account, "source");
  let target = addFolder(account, "target");
  (target as any).listChangedMessages = async () => new ArrayColl();
  for (let i = 1; i <= emailCount; i++) {
    let email = source.newEMail() as JMAPEMail;
    email.jmapID = "m" + i;
    source.messages.add(email);
    account.mailboxIds.set(email.jmapID, { source: true });
  }
  return { account, source, target };
}

function addFolder(account: JMAPAccount, id: string): JMAPFolder {
  let folder = account.newFolder() as JMAPFolder;
  folder.id = id;
  folder.name = id;
  account.rootFolders.add(folder);
  return folder;
}

test("Moving more emails than the server takes in one Email/set moves all of them", async () => {
  let { account, source, target } = setUp(7);
  let emails = new ArrayColl(source.messages.contents);

  await target.moveMessagesHere(emails);

  for (let [id, folders] of account.mailboxIds) {
    expect(folders, id).toEqual({ target: true });
  }
  expect(source.messages.length).toBe(0);
});

test("Copying more emails than the server takes in one Email/set copies all of them", async () => {
  let { account, source, target } = setUp(4);
  let emails = new ArrayColl(source.messages.contents);

  await target.copyMessagesHere(emails);

  for (let [id, folders] of account.mailboxIds) {
    expect(folders, id).toEqual({ source: true, target: true });
  }
  expect(source.messages.length).toBe(4);
});
