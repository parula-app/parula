// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { setUpAccount } from "./TestMailAccount";
import { SpecialFolder, type Folder } from "../../../logic/Mail/Folder";
import type { MailAccount } from "../../../logic/Mail/MailAccount";
import { DummyMailStorage } from "../../../logic/Mail/Store/DummyMailStorage";
import { IMAPAccount } from "../../../logic/Mail/IMAP/IMAPAccount";
import type { IMAPFolder } from "../../../logic/Mail/IMAP/IMAPFolder";
import { POP3Account } from "../../../logic/Mail/POP3/POP3Account";
import type { POP3Folder } from "../../../logic/Mail/POP3/POP3Folder";
import { EWSAccount } from "../../../logic/Mail/EWS/EWSAccount";
import { OWAAccount } from "../../../logic/Mail/OWA/OWAAccount";
import type { OWARequest } from "../../../logic/Mail/OWA/Request/OWARequest";
import { GraphAccount } from "../../../logic/Mail/Graph/GraphAccount";
import { JMAPAccount } from "../../../logic/Mail/JMAP/JMAPAccount";
import type { JMAPFolder } from "../../../logic/Mail/JMAP/JMAPFolder";
import { ActiveSyncAccount } from "../../../logic/Mail/ActiveSync/ActiveSyncAccount";
import { expect, test } from "vitest";

/** Remembers under which folder each folder was, when it was saved last */
class RecordingMailStorage extends DummyMailStorage {
  readonly savedParents = new Map<Folder, Folder | null>();
  async saveFolder(folder: Folder): Promise<void> {
    this.savedParents.set(folder, folder.parent);
  }
}

/** Inbox, Sent, Drafts, Projects, Customers/Acme/2025 */
function setUpFolders() {
  let account = setUpAccount();
  let projects = addFolder(account, "Projects");
  let customers = addFolder(account, "Customers");
  let acme = addFolder(account, "Acme", customers);
  let acme2025 = addFolder(account, "2025", acme);
  return { account, projects, customers, acme, acme2025 };
}

function addFolder<T extends Folder>(account: MailAccount, id: string, parent?: Folder): T {
  let folder = account.newFolder() as T;
  folder.id = id;
  folder.name = id;
  folder.parent = parent ?? null;
  (parent?.subFolders ?? account.rootFolders).add(folder);
  return folder;
}

function folderTree(account: MailAccount): string[] {
  return account.getAllFolders().contents.map(folder => folder.fullPath).sort();
}

test("Moving a folder into another folder", async () => {
  let { account, projects, customers, acme } = setUpFolders();

  await projects.moveFolderHere(customers);

  expect(customers.parent).toBe(projects);
  expect(projects.subFolders.contents).toEqual([customers]);
  expect(account.rootFolders.contains(customers)).toBe(false);
  // The subfolders move along
  expect(acme.parent).toBe(customers);
  expect(folderTree(account)).toEqual([
    "Drafts", "Inbox", "Projects", "Projects/Customers", "Projects/Customers/Acme", "Projects/Customers/Acme/2025", "Sent",
  ]);
});

test("Moving a subfolder into another folder", async () => {
  let { account, projects, customers, acme } = setUpFolders();

  await projects.moveFolderHere(acme);

  expect(acme.parent).toBe(projects);
  expect(projects.subFolders.contents).toEqual([acme]);
  expect(customers.subFolders.isEmpty).toBe(true);
  expect(folderTree(account)).toEqual([
    "Customers", "Drafts", "Inbox", "Projects", "Projects/Acme", "Projects/Acme/2025", "Sent",
  ]);
});

test("Moving a folder into a subfolder of a sibling", async () => {
  let { account, projects, acme } = setUpFolders();

  await acme.moveFolderHere(projects);

  expect(projects.parent).toBe(acme);
  expect(folderTree(account)).toEqual([
    "Customers", "Customers/Acme", "Customers/Acme/2025", "Customers/Acme/Projects", "Drafts", "Inbox", "Sent",
  ]);
});

test("Moving a folder whose special use is unset", async () => {
  let { projects, customers } = setUpFolders();
  customers.specialFolder = null;

  await projects.moveFolderHere(customers);

  expect(customers.parent).toBe(projects);
});

test("Special folders cannot be moved", async () => {
  let { account, projects } = setUpFolders();
  let before = folderTree(account);

  await expect(projects.moveFolderHere(account.inbox)).rejects.toThrow();
  await expect(projects.moveFolderHere(account.getSpecialFolder(SpecialFolder.Sent))).rejects.toThrow();

  expect(folderTree(account)).toEqual(before);
});

test("A folder cannot be moved into itself, into its own subfolders, or where it already is", async () => {
  let { account, customers, acme, acme2025 } = setUpFolders();
  let before = folderTree(account);

  await expect(customers.moveFolderHere(customers)).rejects.toThrow();
  await expect(acme.moveFolderHere(customers)).rejects.toThrow();
  await expect(acme2025.moveFolderHere(customers)).rejects.toThrow();
  await expect(customers.moveFolderHere(acme)).rejects.toThrow();

  expect(folderTree(account)).toEqual(before);
});

test("A folder cannot be moved into another account", async () => {
  let { account, customers } = setUpFolders();
  let secondAccount = setUpFolders();
  let before = folderTree(account);

  await expect(secondAccount.projects.moveFolderHere(customers)).rejects.toThrow();

  expect(folderTree(account)).toEqual(before);
  expect(secondAccount.projects.subFolders.isEmpty).toBe(true);
});

// Protocols

/** Inbox, Projects, Customers/Acme */
function setUpProtocolFolders<T extends Folder>(account: MailAccount) {
  account.name = "Test";
  account.emailAddress = "user@example.com";
  let storage = new RecordingMailStorage();
  account.storage = storage;
  let inbox = addFolder<T>(account, "Inbox");
  inbox.specialFolder = SpecialFolder.Inbox;
  let projects = addFolder<T>(account, "Projects");
  let customers = addFolder<T>(account, "Customers");
  let acme = addFolder<T>(account, "Acme", customers);
  // As read from the database
  for (let [i, folder] of account.getAllFolders().contents.entries()) {
    folder.dbID = i + 1;
  }
  return { storage, projects, customers, acme };
}

test("IMAP: Moving a folder renames it on the server, and updates the paths", async () => {
  let renames: any[] = [];
  appGlobal.remoteApp = {
    createIMAPFlowConnection: () => ({
      id: "test",
      on: () => undefined,
      connect: async () => undefined,
      getMailboxLock: async () => ({ release: () => undefined }),
      mailboxRename: async (path: string, newPath: string[]) => {
        renames.push([path, newPath]);
        return { path, newPath: newPath.join("/") };
      },
    }),
  } as any;
  let account = new IMAPAccount();
  account.hostname = "imap.example.com";
  account.username = "me@example.com";
  account.password = "secret";
  account.pathDelimiter = "/";
  let { storage, projects, customers, acme } = setUpProtocolFolders<IMAPFolder>(account);
  acme.path = "Customers/Acme";

  await projects.moveFolderHere(customers);

  expect(renames).toEqual([["Customers", ["Projects", "Customers"]]]);
  expect(customers.parent).toBe(projects);
  expect(customers.path).toBe("Projects/Customers");
  expect(acme.path).toBe("Projects/Customers/Acme");
  expect(storage.savedParents.get(customers)).toBe(projects);
});

test("POP3: Moving a folder updates the paths", async () => {
  appGlobal.remoteApp = { newTCPSocket: () => null } as any;
  let account = new POP3Account();
  let { storage, projects, customers, acme } = setUpProtocolFolders<POP3Folder>(account);
  acme.path = "Customers/Acme";

  await projects.moveFolderHere(customers);

  expect(customers.parent).toBe(projects);
  expect(customers.path).toBe("Projects/Customers");
  expect(acme.path).toBe("Projects/Customers/Acme");
  expect(storage.savedParents.get(customers)).toBe(projects);
});

class TestEWSAccount extends EWSAccount {
  readonly requests: any[] = [];
  async callEWS(request: any): Promise<any> {
    this.requests.push(request);
    return {};
  }
}

test("EWS: Moving a folder moves it on the server, and saves the new parent", async () => {
  let account = new TestEWSAccount();
  let { storage, projects, customers } = setUpProtocolFolders(account);

  await projects.moveFolderHere(customers);

  expect(account.requests.length).toBe(1);
  let request = account.requests[0].m$MoveFolder;
  expect(request.m$ToFolderId.t$FolderId.Id).toBe("Projects");
  expect(request.m$FolderIds.t$FolderId.Id).toBe("Customers");
  expect(customers.parent).toBe(projects);
  expect(storage.savedParents.get(customers)).toBe(projects);
});

class TestOWAAccount extends OWAAccount {
  readonly requests: OWARequest[] = [];
  async callOWA(request: OWARequest): Promise<any> {
    this.requests.push(request);
    return {};
  }
}

test("OWA: Moving a folder moves it on the server, and saves the new parent", async () => {
  appGlobal.remoteApp = { OWA: {} } as any;
  let account = new TestOWAAccount();
  let { storage, projects, customers } = setUpProtocolFolders(account);

  await projects.moveFolderHere(customers);

  expect(account.requests.map(request => request.action)).toEqual(["MoveFolder"]);
  let request = account.requests[0].Body;
  expect(request.ToFolderId.FolderId.Id).toBe("Projects");
  expect(request.FolderIds[0].FolderId.Id).toBe("Customers");
  expect(customers.parent).toBe(projects);
  expect(storage.savedParents.get(customers)).toBe(projects);
});

/** A Graph server with a folder tree, which can move folders */
class TestGraphAccount extends GraphAccount {
  /** folder ID -> parent folder ID */
  readonly serverParents = new Map<string, string | null>();
  async graphGetAll<T>(urlPath: string): Promise<T[]> {
    let parentID = urlPath == "mailFolders" ? null : urlPath.split("/")[1];
    return [...this.serverParents.entries()]
      .filter(([, serverParentID]) => serverParentID == parentID)
      .map(([id]) => ({
        id,
        displayName: id,
        wellKnownName: id == "Inbox" ? "inbox" : undefined,
        totalItemCount: 0,
        unreadItemCount: 0,
      })) as T[];
  }
  async graphPost(urlPath: string, json: any): Promise<any> {
    let [, id, action] = urlPath.split("/");
    expect(action).toBe("move");
    this.serverParents.set(id, json.destinationId);
    return {};
  }
}

test("Graph: Moving a folder moves it on the server, and saves the new parent", async () => {
  appGlobal.remoteApp = { kyCreate: () => null } as any;
  let account = new TestGraphAccount();
  let { storage, projects, customers, acme } = setUpProtocolFolders(account);
  account.serverParents.set("Inbox", null);
  account.serverParents.set("Projects", null);
  account.serverParents.set("Customers", null);
  account.serverParents.set("Acme", "Customers");

  await projects.moveFolderHere(customers);

  expect(account.serverParents.get("Customers")).toBe("Projects");
  expect(customers.parent).toBe(projects);
  expect(acme.parent).toBe(customers);
  expect(folderTree(account)).toEqual(["Inbox", "Projects", "Projects/Customers", "Projects/Customers/Acme"]);
  expect(storage.savedParents.get(customers)).toBe(projects);
});

/** A JMAP server with a folder tree, which can move folders, or refuses to */
class TestJMAPAccount extends JMAPAccount {
  /** folder ID -> parent folder ID */
  readonly serverParents = new Map<string, string | null>();
  refuseUpdates = false;
  async makeSingleCall(method: string, args: Record<string, any>): Promise<Record<string, any>> {
    if (method == "Mailbox/get") {
      return {
        list: [...this.serverParents.entries()].map(([id, parentId], sortOrder) => ({
          id,
          name: id,
          parentId,
          role: id == "Inbox" ? "inbox" : null,
          sortOrder,
          myRights: { mayCreateChild: true, mayRename: true },
          totalEmails: 0,
          unreadEmails: 0,
        })),
      };
    }
    expect(method).toBe("Mailbox/set");
    let ids = Object.keys(args.update);
    if (this.refuseUpdates) {
      return { notUpdated: Object.fromEntries(ids.map(id =>
        [id, { type: "invalidProperties", description: "The server does not allow this" }])) };
    }
    for (let id of ids) {
      this.serverParents.set(id, args.update[id].parentId);
    }
    return { updated: Object.fromEntries(ids.map(id => [id, null])) };
  }
}

function setUpJMAPAccount() {
  appGlobal.remoteApp = { kyCreate: () => null } as any;
  let account = new TestJMAPAccount();
  let folders = setUpProtocolFolders<JMAPFolder>(account);
  for (let folder of account.getAllFolders()) {
    (folder as JMAPFolder).myRights = { mayCreateChild: true, mayRename: true } as JMAPFolder["myRights"];
  }
  account.serverParents.set("Inbox", null);
  account.serverParents.set("Projects", null);
  account.serverParents.set("Customers", null);
  account.serverParents.set("Acme", "Customers");
  return { account, ...folders };
}

test("JMAP: Moving a folder moves it on the server, and saves the new parent", async () => {
  let { account, storage, projects, customers, acme } = setUpJMAPAccount();

  await projects.moveFolderHere(customers);

  expect(account.serverParents.get("Customers")).toBe("Projects");
  expect(customers.parent).toBe(projects);
  expect(acme.parent).toBe(customers);
  expect(folderTree(account)).toEqual(["Inbox", "Projects", "Projects/Customers", "Projects/Customers/Acme"]);
  expect(storage.savedParents.get(customers)).toBe(projects);
});

test("JMAP: If the server refuses to move the folder, the user sees an error", async () => {
  let { account, storage, projects, customers } = setUpJMAPAccount();
  account.refuseUpdates = true;

  await expect(projects.moveFolderHere(customers)).rejects.toThrow("The server does not allow this");

  expect(account.serverParents.get("Customers")).toBeNull();
  expect(storage.savedParents.has(customers)).toBe(false);
});

class TestActiveSyncAccount extends ActiveSyncAccount {
  readonly requests: any[] = [];
  async queuedRequest(command: string, request: any): Promise<any> {
    this.requests.push({ command, ...request });
    // The server doesn't report our own change back to us in the FolderSync
    return {};
  }
}

test("ActiveSync: Moving a folder moves it on the server, and saves the new parent", async () => {
  let account = new TestActiveSyncAccount();
  let { storage, projects, customers } = setUpProtocolFolders(account);

  await projects.moveFolderHere(customers);

  expect(account.requests[0]).toEqual({
    command: "FolderUpdate",
    ServerId: "Customers",
    ParentId: "Projects",
    DisplayName: "Customers",
  });
  expect(customers.parent).toBe(projects);
  expect(storage.savedParents.get(customers)).toBe(projects);
});
