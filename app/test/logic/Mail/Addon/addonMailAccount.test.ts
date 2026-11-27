// app first, to resolve the import cycle around Addons
import { appGlobal } from "../../../../logic/app";
import type { Addon } from "../../../../logic/Addons/Addon";
import { AddonProtocol, addonProtocols } from "../../../../logic/Addons/AddonProtocols";
import type { AccountData, FolderData, MailProtocol, MessageData } from "../../../../logic/Addons/Sandbox/MustangAPI";
import { AddonMailAccount } from "../../../../logic/Mail/Addon/AddonMailAccount";
import type { AddonFolder } from "../../../../logic/Mail/Addon/AddonFolder";
import { newAccountForProtocol, labelForMailProtocol, listMailProtocols } from "../../../../logic/Mail/AccountsList/MailAccounts";
import { SQLMailAccount } from "../../../../logic/Mail/SQL/SQLMailAccount";
import { getDatabase } from "../../../../logic/Mail/SQL/SQLDatabase";
import { getDatabase as getSourceDatabase } from "../../../../logic/Mail/SQL/Source/SQLSourceDatabase";
import { PersonUID } from "../../../../logic/Abstract/PersonUID";
import { newProtocolAddon, ProtocolSandbox, setUpBackend, waitFor } from "./protocolSandbox";
import sql from "../../../../../lib/rs-sqlite";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

// The real sandbox needs a browser
vi.mock("../../../../logic/Addons/AddonSandbox", async () => ({
  AddonSandbox: (await import("./protocolSandbox")).ProtocolSandbox,
}));

/** A mail server, as the addon sees it. Its changes are a log; the sync state is the position in the log. */
class FakeServer {
  folders: FolderData[] = [
    { id: "inbox", name: "Inbox", specialFolder: "inbox" },
    { id: "trash", name: "Trash", specialFolder: "trash" },
  ];
  changes: ({ folderID: string, message: MessageData } | { folderID: string, removed: string })[] = [];
  mimes = new Map<string, Uint8Array>();
  calls: { operation: string, args: any[] }[] = [];
  password = "secret";
  /** Per call of listMessages() */
  chunkSize = 1000;
  /** listMessages() always says that it has more, and doesn't move on */
  isStuck = false;

  addMessages(count: number, folderID = "inbox", first = 0): MessageData[] {
    let messages: MessageData[] = [];
    for (let i = first; i < first + count; i++) {
      let message: MessageData = {
        id: "id" + i,
        messageID: `m${i}@example.com`,
        subject: "Message " + i,
        from: { name: "Alice", emailAddress: "alice@example.com" },
        to: [{ emailAddress: "me@example.com" }],
        sent: Date.UTC(2026, 0, 1) + i * 60000,
        received: Date.UTC(2026, 0, 1) + i * 60000,
        size: 1000,
        isRead: i % 2 == 0,
      };
      this.changes.push({ folderID, message });
      messages.push(message);
    }
    return messages;
  }

  /** The implementation that the addon registers */
  protocol(): MailProtocol {
    let server = this;
    function record(operation: string, args: IArguments) {
      server.calls.push({ operation, args: [...args] });
    }
    return {
      async login(account: AccountData, password: string | null) {
        record("login", arguments);
        if (password != server.password) {
          throw new Error("Wrong password");
        }
      },
      async listFolders() {
        record("listFolders", arguments);
        return server.folders;
      },
      async listMessages(_account: AccountData, folderID: string, syncState: string | null) {
        record("listMessages", arguments);
        if (server.isStuck) {
          return { messages: [], syncState: "stuck", hasMore: true };
        }
        let position = Number(syncState ?? 0);
        let messages: MessageData[] = [];
        let removed: string[] = [];
        for (; position < server.changes.length && messages.length < server.chunkSize; position++) {
          let change = server.changes[position];
          if (change.folderID != folderID) {
            continue;
          }
          if ("removed" in change) {
            removed.push(change.removed);
          } else {
            messages.push(change.message);
          }
        }
        return { messages, removed, syncState: String(position), hasMore: position < server.changes.length };
      },
      async downloadMessages(_account: AccountData, _folderID: string, ids: string[]) {
        record("downloadMessages", arguments);
        return ids.filter(id => server.mimes.has(id)).map(id => ({ id, mime: server.mimes.get(id) }));
      },
      async setFlags() {
        record("setFlags", arguments);
      },
      async moveMessages() {
        record("moveMessages", arguments);
      },
      async copyMessages() {
        record("copyMessages", arguments);
      },
      async deleteMessages() {
        record("deleteMessages", arguments);
      },
      async createFolder(_account: AccountData, parentID: string | null, name: string) {
        record("createFolder", arguments);
        return { id: "new-" + name, name, parentID };
      },
      async renameFolder() {
        record("renameFolder", arguments);
      },
      async deleteFolder() {
        record("deleteFolder", arguments);
      },
      async send() {
        record("send", arguments);
      },
    };
  }

  callsOf(operation: string): any[][] {
    return this.calls.filter(call => call.operation == operation).map(call => call.args);
  }
}

beforeAll(() => {
  setUpBackend();
});

let running: Addon[] = [];

afterEach(async () => {
  for (let addon of running) {
    await addon.disable();
    appGlobal.addons.installed.remove(addon);
  }
  running = [];
  appGlobal.emailAccounts.clear();
});

/** A running addon with the protocol "test" of `server` */
async function startAddon(server: FakeServer, name = "Fake Mail"): Promise<Addon> {
  let addon = newProtocolAddon(name, ["test"], mustang => mustang.protocols.register("test", server.protocol()));
  running.push(addon);
  await addon.enable();
  return addon;
}

async function newAccount(addon: Addon, login = true): Promise<AddonMailAccount> {
  let account = newAccountForProtocol(AddonProtocol.accountProtocol(addon.id, "test")) as AddonMailAccount;
  account.name = "Test";
  account.emailAddress = "me@example.com";
  account.username = "me";
  account.password = "secret";
  account.connection.addonName = addon.name;
  await account.save();
  appGlobal.emailAccounts.add(account);
  if (login) {
    await account.login(false);
    await account.listFolders();
  }
  return account;
}

function inboxOf(account: AddonMailAccount): AddonFolder {
  return account.findFolder(folder => folder.id == "inbox") as AddonFolder;
}

async function storedEMails(folder: AddonFolder): Promise<any[]> {
  return await (await getDatabase()).all(sql`SELECT pID, subject FROM email WHERE folderID = ${folder.dbID}`) as any[];
}

describe("Factory", () => {
  test("The account of an addon protocol has a protocol ID like the app's protocols, and different for every addon", async () => {
    let protocols = [
      AddonProtocol.accountProtocol("@a/b__c", "x"),
      AddonProtocol.accountProtocol("@a__b/c", "x"),
      AddonProtocol.accountProtocol("ab", "c-x"),
      AddonProtocol.accountProtocol("ab-c", "x"),
      AddonProtocol.accountProtocol("ab", "C"),
    ];
    expect(new Set(protocols).size).toBe(protocols.length);
    for (let protocol of protocols) {
      expect(protocol).toMatch(/^addon-[a-zA-Z0-9_-]+$/);
      expect(newAccountForProtocol(protocol)).toBeInstanceOf(AddonMailAccount);
    }
  });

  test("The mail protocol list has the protocols of running addons, with their labels", async () => {
    let addon = await startAddon(new FakeServer());
    let protocol = AddonProtocol.accountProtocol(addon.id, "test");
    expect(listMailProtocols()).toContain(protocol);
    expect(labelForMailProtocol(protocol)).toBe("Fake Mail test");

    await addon.disable();
    expect(listMailProtocols()).not.toContain(protocol);
    expect(labelForMailProtocol(protocol)).toBe("Fake Mail test");
  });
});

describe("Sync", () => {
  test("Syncs 10,000 messages in chunks of at most 1,000, and stores them", async () => {
    let server = new FakeServer();
    server.addMessages(10000);
    let account = await newAccount(await startAddon(server));
    let inbox = inboxOf(account);

    let start = performance.now();
    let newMessages = await inbox.listMessages();
    let ms = performance.now() - start;
    console.log(`Synced 10,000 messages from an addon in ${Math.round(ms)} ms`);

    expect(newMessages.length).toBe(10000);
    expect(inbox.messages.length).toBe(10000);
    expect(inbox.countTotal).toBe(10000);
    expect(inbox.countUnread).toBe(5000);
    let calls = server.callsOf("listMessages");
    expect(calls.length).toBeGreaterThanOrEqual(10);
    expect(calls[0][2]).toBeNull();
    expect((await storedEMails(inbox)).length).toBe(10000);
    expect(inbox.syncState).toBe("10000");
    expect(ms).toBeLessThan(60000);
  }, 120000);

  test("The next sync continues at the stored sync state, with new, changed and removed messages", async () => {
    let server = new FakeServer();
    server.addMessages(3);
    let account = await newAccount(await startAddon(server));
    let inbox = inboxOf(account);
    await inbox.listMessages();
    let syncState = inbox.syncState;
    let restarted = newAccountForProtocol(account.protocol);
    restarted.dbID = account.dbID;
    await restarted.storage.readFolderHierarchy(restarted);
    expect(restarted.findFolder(folder => folder.id == "inbox").syncState).toBe(syncState);

    server.addMessages(1, "inbox", 3);
    server.changes.push({ folderID: "inbox", message: { ...server.changes[0]["message"], isRead: false, isStarred: true } });
    server.changes.push({ folderID: "inbox", removed: "id1" });
    let newMessages = await inbox.listMessages();

    expect(server.callsOf("listMessages").at(-1)[2]).toBe(syncState);
    expect(newMessages.contents.map(email => email.pID)).toEqual(["id3"]);
    expect(newMessages.first.isNewArrived).toBe(true);
    let changed = inbox.messages.find(email => email.pID == "id0");
    expect(changed.isRead).toBe(false);
    expect(changed.isStarred).toBe(true);
    expect(inbox.messages.find(email => email.pID == "id1")).toBeUndefined();
    expect((await storedEMails(inbox)).map(row => row.pID).sort()).toEqual(["id0", "id2", "id3"]);
  });

  test("A sync stops when the addon keeps saying that it has more, without progress", async () => {
    let server = new FakeServer();
    server.isStuck = true;
    let account = await newAccount(await startAddon(server));
    let errors: Error[] = [];
    account.errorCallback = ex => errors.push(ex);

    await inboxOf(account).listMessages();

    expect(errors.some(ex => ex.message.includes("keeps reporting more"))).toBe(true);
    expect(server.callsOf("listMessages").length).toBeLessThan(5);
  });
});

describe("Checks of the data from the addon", () => {
  test("Bad dates, huge strings, HTML and control characters in names, and wrong types don't reach the app as they are", async () => {
    let server = new FakeServer();
    server.folders.push({ id: "evil", name: "<img src=x onerror=alert(1)>‮gnp.exe\u0007", specialFolder: "bogus" as any, countTotal: NaN, countUnread: -5 });
    let [good] = server.addMessages(1);
    server.changes.push({ folderID: "inbox", message: {
      id: "bad-dates", subject: "x".repeat(2000000), sent: "not a date", received: 1e20,
      from: { name: "Mallory ‮evil‬ <b>bold</b>", emailAddress: "javascript:alert(1)" },
      to: "me@example.com" as any, size: -1, isRead: "yes" as any,
    } });
    server.changes.push({ folderID: "inbox", message: { id: { x: 1 } as any, subject: "Wrong type of ID" } });
    server.changes.push({ folderID: "inbox", message: { id: "number-subject", subject: 42 as any } });
    let account = await newAccount(await startAddon(server));
    let inbox = inboxOf(account);

    await inbox.listMessages();

    let evil = account.findFolder(folder => folder.id == "evil");
    expect(evil.name).toBe("<img src=x onerror=alert(1)> gnp.exe");
    expect(evil.specialFolder).toBe("normal");
    expect(Number.isSafeInteger(evil.countTotal) && evil.countTotal >= 0).toBe(true);
    expect(evil.countUnread).toBeGreaterThanOrEqual(0);
    expect(inbox.messages.find(email => email.pID == good.id).subject).toBe(good.subject);
    let bad = inbox.messages.find(email => email.pID == "bad-dates");
    expect(bad.subject.length).toBeLessThanOrEqual(10000);
    expect(isNaN(bad.sent.getTime())).toBe(false);
    expect(isNaN(bad.received.getTime())).toBe(false);
    expect(bad.from.name).not.toMatch(/[‪-‮]/);
    expect(bad.from.emailAddress).not.toContain("javascript");
    expect(bad.to.isEmpty).toBe(true);
    expect(bad.size).toBeNull();
    expect(bad.isRead).toBe(false);
    expect(inbox.messages.find(email => email.subject == "Wrong type of ID")).toBeUndefined();
    expect(inbox.messages.find(email => email.pID == "number-subject").subject).toBe("");
    expect(account.dataErrors.hasItems).toBe(true);
  });

  test("Too many messages per call, too many folders, or a sync state over 10 KB are refused", async () => {
    let server = new FakeServer();
    server.chunkSize = 1001;
    server.addMessages(1001);
    let account = await newAccount(await startAddon(server));
    await expect(inboxOf(account).listMessages()).rejects.toThrow(/more than 1000/);
    expect(inboxOf(account).messages.isEmpty).toBe(true);

    let protocol = server.protocol();
    protocol.listMessages = async () => ({ messages: [], syncState: "s".repeat(10 * 1024 + 1) });
    protocol.listFolders = async () => Array.from({ length: 10001 }, (_, i) => ({ id: "f" + i, name: "F" + i }));
    let addon = newProtocolAddon("Big state", ["test"], mustang => mustang.protocols.register("test", protocol));
    running.push(addon);
    await addon.enable();
    let bigState = await newAccount(addon, false);
    await bigState.login(false);
    await expect(bigState.listFolders()).rejects.toThrow(/more than 10000/);
    let folder = bigState.newFolder();
    folder.id = folder.name = "Inbox";
    bigState.rootFolders.add(folder);
    await expect(folder.listMessages()).rejects.toThrow(/10 KB/);
  });

  test("A message over 50 MB is refused, a normal one is parsed and stored", async () => {
    let server = new FakeServer();
    server.addMessages(2);
    server.mimes.set("id0", new TextEncoder().encode("Subject: Hello from MIME\r\nFrom: alice@example.com\r\n\r\nThe text"));
    server.mimes.set("id1", new Uint8Array(50 * 1024 * 1024 + 1));
    let account = await newAccount(await startAddon(server));
    let inbox = inboxOf(account);
    await inbox.listMessages();

    let downloaded = await inbox.downloadMessages(inbox.messages);

    expect(downloaded.contents.map(email => email.pID)).toEqual(["id0"]);
    let email = downloaded.first;
    expect(email.downloadComplete).toBe(true);
    expect(email.text).toContain("The text");
    expect(inbox.messages.find(email => email.pID == "id1").downloadComplete).toBe(false);
    expect(account.dataErrors.some(ex => ex.message.includes("50 MB"))).toBe(true);
    let mimeRows = await (await getSourceDatabase()).all(sql`SELECT emailID FROM emailMIME`) as any[];
    expect(mimeRows.length).toBe(1);
  });
});

describe("Runtime", () => {
  test("An account is offline while the addon is disabled, and connects again when it's enabled", async () => {
    let server = new FakeServer();
    let addon = await startAddon(server);
    let account = await newAccount(addon);
    expect(account.isLoggedIn).toBe(true);

    await addon.disable();
    expect(account.isLoggedIn).toBe(false);
    expect(account.fatalError.message).toContain(addon.name);
    expect(account.rootFolders.hasItems).toBe(true);
    await expect(account.login(false)).rejects.toThrow(addon.name);

    server.calls = [];
    await addon.enable();
    await waitFor(() => account.isLoggedIn);
    expect(server.callsOf("login").length).toBe(1);
    expect(account.fatalError).toBeNull();
  });

  test("At app start, the account waits until its addon has started", async () => {
    let server = new FakeServer();
    let addon = newProtocolAddon("Slow start", ["test"], mustang => mustang.protocols.register("test", server.protocol()));
    running.push(addon);
    let account = await newAccount(addon, false);
    addon.isEnabled = true;

    let login = account.login(false);
    await addon.startup();
    await login;

    expect(account.isLoggedIn).toBe(true);
  });

  test("The password goes only to the login() of the addon that has the protocol", async () => {
    let owner = new FakeServer();
    let other = new FakeServer();
    let ownerAddon = await startAddon(owner, "Owner Mail");
    await startAddon(other, "Other Mail");
    let account = await newAccount(ownerAddon);
    account.password = "secret";
    await inboxOf(account).listMessages();

    expect(other.calls).toEqual([]);
    expect(owner.callsOf("login")[0][1]).toBe("secret");
    let otherCalls = owner.calls.filter(call => call.operation != "login");
    expect(otherCalls.length).toBeGreaterThan(0);
    expect(JSON.stringify(otherCalls)).not.toContain("secret");
  });

  test("Uninstalling the addon keeps the account, its folders and messages, offline", async () => {
    let server = new FakeServer();
    server.addMessages(3);
    let addon = await startAddon(server, "Gone Mail");
    let account = await newAccount(addon);
    await inboxOf(account).listMessages();

    await addon.uninstall();
    running = running.filter(running => running != addon);
    let accounts = await SQLMailAccount.readAll();

    let loaded = accounts.find(loaded => loaded.id == account.id) as AddonMailAccount;
    expect(loaded).toBeInstanceOf(AddonMailAccount);
    expect(loaded.password).toBe("secret");
    await loaded.readFromDB();
    let inbox = inboxOf(loaded);
    expect(inbox).toBeTruthy();
    expect((await storedEMails(inbox)).length).toBe(3);
    await expect(loaded.login(false)).rejects.toThrow("Gone Mail");
    expect(loaded.isLoggedIn).toBe(false);
  });

  test("New messages from the addon reach only its own account, and sync that folder", async () => {
    let server = new FakeServer();
    let addon = await startAddon(server);
    let account = await newAccount(addon);
    let inbox = inboxOf(account);
    await inbox.listMessages();
    let otherServer = new FakeServer();
    let otherAddon = await startAddon(otherServer, "Other");
    let sandboxOf = (addon: Addon) => addon.sandbox as any as ProtocolSandbox;

    server.addMessages(1);
    sandboxOf(otherAddon).logic.mustang.protocols.newMessages(account.id, "inbox");
    await sandboxOf(otherAddon).logic.roundTrip();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(inbox.messages.isEmpty).toBe(true);

    sandboxOf(addon).logic.mustang.protocols.newMessages(account.id, "inbox");
    await waitFor(() => inbox.messages.length == 1);
  });
});

describe("Operations", () => {
  test("Flags, move, delete, folders and send go to the addon", async () => {
    let server = new FakeServer();
    server.addMessages(3);
    let account = await newAccount(await startAddon(server));
    let inbox = inboxOf(account);
    let trash = account.findFolder(folder => folder.id == "trash") as AddonFolder;
    await inbox.listMessages();
    let [first, second] = inbox.messages.contents;

    await first.markRead(false);
    expect(server.callsOf("setFlags").at(-1).slice(1)).toEqual(["inbox", [first.pID], { isRead: false }]);
    await first.markStarred();
    expect(server.callsOf("setFlags").at(-1)[3]).toEqual({ isStarred: true });

    await second.deleteMessage();
    expect(server.callsOf("moveMessages").at(-1).slice(1)).toEqual(["inbox", [second.pID], "trash"]);

    let third = inbox.messages.find(email => email != first);
    await inbox.copyMessagesHere(new (third.attachments.constructor as any)([third]));
    expect(server.callsOf("copyMessages").length).toBe(1);

    let sub = await inbox.createSubFolder("Sub");
    expect(server.callsOf("createFolder").at(-1).slice(1)).toEqual(["inbox", "Sub"]);
    expect(sub.id).toBe("new-Sub");
    expect(sub.parent).toBe(inbox);
    await sub.rename("Renamed");
    expect(server.callsOf("renameFolder").at(-1).slice(1)).toEqual(["new-Sub", "Renamed"]);
    await sub.deleteIt();
    expect(server.callsOf("deleteFolder").at(-1).slice(1)).toEqual(["new-Sub"]);
    let top = await account.createToplevelFolder("Top");
    expect(server.callsOf("createFolder").at(-1).slice(1)).toEqual([null, "Top"]);
    expect(account.rootFolders.contains(top)).toBe(true);

    let mail = account.newEMailFrom();
    mail.subject = "Hi";
    mail.text = "Hello";
    mail.to.add(new PersonUID("you@example.com", "You"));
    mail.cc.add(new PersonUID("cc@example.com", "Cc"));
    mail.bcc.add(new PersonUID("hidden@example.com", "Hidden"));
    await account.send(mail);
    let [, mime, from, recipients] = server.callsOf("send").at(-1);
    expect(mime).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(mime)).toContain("Subject: Hi");
    expect(from).toBe("me@example.com");
    expect([...recipients].sort()).toEqual(["cc@example.com", "hidden@example.com", "you@example.com"]);
    expect(trash).toBeTruthy();
  });
});

describe("Setup", () => {
  async function setupFrame(addon: Addon) {
    let sandbox = addon.sandbox as any as ProtocolSandbox;
    let { bridge, client } = await sandbox.connect();
    return { protocol: addonProtocols.find(protocol => protocol.addon == addon), bridge, client };
  }

  test("What the setup UI sends is checked, and the account takes the last valid values", async () => {
    let addon = await startAddon(new FakeServer());
    let { protocol, bridge, client } = await setupFrame(addon);
    let send = async (account: any) => {
      client.mustang.protocols.setupAccount(account);
      await client.roundTrip();
    };

    await send({ name: "Work‮", username: "me", password: "pw", serverURL: "https://mail.example.com", extra: { region: "eu" } });
    let setup = protocol.protocols.setupOf(bridge);
    expect(setup).toEqual({ name: "Work", username: "me", password: "pw", serverURL: "https://mail.example.com", extra: { region: "eu" } });

    for (let bad of [
      { name: "Work", username: "me", serverURL: "http://mail.example.com" },
      { name: "Work", username: "me", serverURL: "javascript:alert(1)" },
      { name: "Work", username: "" },
      { name: "Work", username: 5 },
      { name: "Work", username: "me", extra: "x".repeat(11 * 1024) },
      "not an object",
    ]) {
      await send(bad);
      expect(protocol.protocols.setupOf(bridge)).toBe(setup);
    }

    let account = newAccountForProtocol(protocol.protocol) as AddonMailAccount;
    account.password = "typed before";
    account.connection.fromAddonSetup({ ...setup, password: null });
    expect(account.name).toBe("Work");
    expect(account.username).toBe("me");
    expect(account.password).toBe("typed before");
    expect(account.url).toBe("https://mail.example.com");
    expect(account.connection.extra).toEqual({ region: "eu" });
    expect(account.connection.addonName).toBe(addon.name);
  });

  test("Only the main code registers protocols, and only those of its manifest", async () => {
    let addon = await startAddon(new FakeServer());
    let { client } = await setupFrame(addon);
    let sandbox = addon.sandbox as any as ProtocolSandbox;
    let count = addonProtocols.length;

    client.mustang.protocols.register("test", {} as any);
    sandbox.logic.mustang.protocols.register("not-in-manifest", {} as any);
    await client.roundTrip();
    await sandbox.logic.roundTrip();

    expect(addonProtocols.length).toBe(count);
  });
});
