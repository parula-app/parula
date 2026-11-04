// app first, to resolve the import cycle around Addons
import { appGlobal } from "../../../../logic/app";
import type { Addon } from "../../../../logic/Addons/Addon";
import { AddonProtocol } from "../../../../logic/Addons/AddonProtocols";
import type { ChatMessageData, ChatProtocol, RoomData } from "../../../../logic/Addons/Sandbox/MustangAPI";
import { AddonChatAccount } from "../../../../logic/Chat/Addon/AddonChatAccount";
import type { AddonChatRoom } from "../../../../logic/Chat/Addon/AddonChatRoom";
import { newChatAccountForProtocol } from "../../../../logic/Chat/AccountsList/ChatAccounts";
import { SQLChatAccount } from "../../../../logic/Chat/SQL/SQLChatAccount";
import { getDatabase } from "../../../../logic/Chat/SQL/SQLDatabase";
import { ChatMessage } from "../../../../logic/Chat/ChatMessage";
import { Group } from "../../../../logic/Abstract/Group";
import { ChangeLog, FakeProtocolServer, newProtocolAddon, ProtocolSandbox, setUpBackend, waitFor } from "../../Mail/Addon/protocolSandbox";
import sql from "../../../../../lib/rs-sqlite";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

// The real sandbox needs a browser
vi.mock("../../../../logic/Addons/AddonSandbox", async () => ({
  AddonSandbox: (await import("../../Mail/Addon/protocolSandbox")).ProtocolSandbox,
}));

/** A chat server, as the addon sees it */
class FakeChatServer extends FakeProtocolServer {
  rooms: RoomData[] = [
    { id: "r-alice", members: [{ id: "alice", name: "Alice" }] },
    { id: "r-team", name: "Team", isGroup: true, members: [{ id: "alice", name: "Alice" }, { id: "bob", name: "Bob" }] },
  ];
  messages = new ChangeLog<ChatMessageData>();

  addMessages(count: number, roomID = "r-team", first = 0): ChatMessageData[] {
    let messages: ChatMessageData[] = [];
    for (let i = first; i < first + count; i++) {
      messages.push(this.messages.add({
        id: "m" + i,
        from: i % 2 ? "alice" : "bob",
        text: "Message " + i,
        sent: Date.UTC(2026, 0, 1) + i * 60000,
      }, roomID));
    }
    return messages;
  }

  chatProtocol(): ChatProtocol {
    return this.protocol({
      listRooms: async () => this.rooms,
      listMessages: async (_account, roomID, syncState) => this.messages.list("messages", syncState, roomID),
      sendMessage: async (_account, roomID) => "sent-" + this.callsOf("sendMessage").length,
    } as Partial<ChatProtocol>) as ChatProtocol;
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
  appGlobal.chatAccounts.clear();
});

async function startAddon(server: FakeChatServer, name = "Fake Chat"): Promise<Addon> {
  let addon = newProtocolAddon(name, ["test"], mustang => mustang.protocols.register("test", server.chatProtocol()), "chat");
  running.push(addon);
  await addon.enable();
  return addon;
}

async function newAccount(addon: Addon): Promise<AddonChatAccount> {
  let account = newChatAccountForProtocol(AddonProtocol.accountProtocol(addon.id, "test")) as AddonChatAccount;
  account.name = "Test";
  account.username = "me";
  account.password = "secret";
  await account.save();
  appGlobal.chatAccounts.add(account);
  await account.login(false);
  return account;
}

function roomOf(account: AddonChatAccount, id: string): AddonChatRoom {
  return account.getRoomByID(id);
}

async function storedMessages(room: AddonChatRoom): Promise<any[]> {
  return await (await getDatabase()).all(sql`SELECT idStr, plaintext FROM message WHERE chatID = ${room.dbID}`) as any[];
}

describe("Round trip", () => {
  test("Lists the rooms, syncs the messages in chunks, stores them, and continues at the stored sync state", async () => {
    let server = new FakeChatServer();
    server.addMessages(2500);
    server.addMessages(1, "r-alice");
    let account = await newAccount(await startAddon(server));
    expect(account).toBeInstanceOf(AddonChatAccount);

    await account.syncOnStartup();

    let team = roomOf(account, "r-team");
    expect(team.contact).toBeInstanceOf(Group);
    expect(team.name).toBe("Team");
    expect(team.members.contents.map(person => person.chatID)).toEqual(["alice", "bob"]);
    let alice = roomOf(account, "r-alice");
    expect(alice.contact).toBe(account.getPersonUID("alice"));
    expect(alice.name).toBe("Alice");
    expect(team.messages.length).toBe(2500);
    expect(server.callsOf("listMessages").filter(args => args[1] == "r-team").length).toBe(3);
    let message = team.messages.find(message => message.id == "m1") as ChatMessage;
    expect(message.text).toBe("Message 1");
    expect(message.from.chatID).toBe("alice");
    expect(message.contact).toBe(message.from);
    expect(team.lastMessage.id).toBe("m2499");
    expect((await storedMessages(team)).length).toBe(2500);

    // Restart
    let accounts = await SQLChatAccount.readAll();
    let restarted = accounts.find(loaded => loaded.id == account.id) as AddonChatAccount;
    expect(restarted).toBeInstanceOf(AddonChatAccount);
    appGlobal.chatAccounts.remove(account);
    appGlobal.chatAccounts.add(restarted);
    await restarted.readFromDB();
    let reloaded = roomOf(restarted, "r-team");
    expect(reloaded.syncState).toBe(team.syncState);
    server.calls = [];
    server.addMessages(1, "r-team", 2500);
    server.messages.add({ id: "m0", from: "bob", text: "Changed" }, "r-team");
    server.messages.remove("m1", "r-team");

    await restarted.login(false);
    await reloaded.listMessages();

    expect(server.callsOf("listMessages")[0][2]).toBe(team.syncState);
    expect(reloaded.messages.length).toBe(2500);
    expect((reloaded.messages.find(message => message.id == "m0") as ChatMessage).text).toBe("Changed");
    expect(reloaded.messages.find(message => message.id == "m1")).toBeUndefined();
    expect(reloaded.messages.find(message => message.id == "m2500")).toBeTruthy();
    let stored = await storedMessages(reloaded);
    expect(stored.length).toBe(2500);
    expect(stored.find(row => row.idStr == "m0").plaintext).toBe("Changed");
  }, 60000);

  test("Sending gives the message to the addon, and stores it with the server's ID", async () => {
    let server = new FakeChatServer();
    let account = await newAccount(await startAddon(server));
    await account.listRooms();
    let room = roomOf(account, "r-alice");
    let message = room.newMessage();
    message.text = "Hello Alice";
    message.outgoing = true;
    message.sent = new Date();

    await room.sendMessage(message);

    let [accountData, roomID, sent] = server.callsOf("sendMessage")[0];
    expect(accountData.id).toBe(account.id);
    expect(roomID).toBe("r-alice");
    expect(sent.text).toBe("Hello Alice");
    expect(message.id).toBe("sent-1");
    expect(room.messages.contains(message)).toBe(true);
    expect((await storedMessages(room)).map(row => row.idStr)).toEqual(["sent-1"]);

    let file = room.newMessage();
    file.attachments.add(file.newAttachment());
    await expect(room.sendMessage(file)).rejects.toThrow(/files/);
  });

  test("Rooms that the addon no longer lists are removed", async () => {
    let server = new FakeChatServer();
    let account = await newAccount(await startAddon(server));
    await account.listRooms();
    server.rooms = server.rooms.filter(room => room.id != "r-team");

    await account.listRooms();

    expect(account.rooms.contents.map(room => room.id)).toEqual(["r-alice"]);
    let rows = await (await getDatabase()).all(sql`SELECT idStr FROM chatRoom WHERE accountID = ${account.dbID}`) as any[];
    expect(rows.map(row => row.idStr)).toEqual(["r-alice"]);
  });

  test("New messages from the addon sync that room of its own account; an unknown room is listed first", async () => {
    let server = new FakeChatServer();
    let addon = await startAddon(server);
    let account = await newAccount(addon);
    await account.syncOnStartup();
    let otherAddon = await startAddon(new FakeChatServer(), "Other Chat");
    let sandboxOf = (addon: Addon) => addon.sandbox as any as ProtocolSandbox;
    let team = roomOf(account, "r-team");

    server.addMessages(1);
    sandboxOf(otherAddon).logic.mustang.protocols.newMessages(account.id, "r-team");
    await sandboxOf(otherAddon).logic.roundTrip();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(team.messages.isEmpty).toBe(true);

    sandboxOf(addon).logic.mustang.protocols.newMessages(account.id, "r-team");
    await waitFor(() => team.messages.length == 1);

    server.rooms.push({ id: "r-new", members: [{ id: "carol", name: "Carol" }] });
    server.addMessages(1, "r-new", 100);
    sandboxOf(addon).logic.mustang.protocols.newMessages(account.id, "r-new");
    await waitFor(() => roomOf(account, "r-new")?.messages.length == 1);
  });
});

describe("Checks of the data from the addon", () => {
  test("Control characters, wrong types and huge texts don't reach the app as they are", async () => {
    let server = new FakeChatServer();
    server.rooms.push({ id: "r-evil", name: "Evil‮gnp.exe\u0007", isGroup: true, members: [{ id: "mallory", name: "Mallory ‮evil‬" }, { id: { x: 1 } as any }] });
    server.rooms.push({ id: "r-nobody", members: [] });
    server.rooms.push({ id: 42 as any, name: "Wrong type of ID" });
    server.messages.add({ id: "huge", text: "x".repeat(2 * 1024 * 1024), sent: "not a date", received: 1e20, isRead: "yes" as any }, "r-evil");
    server.messages.add({ id: "number", text: 42 as any }, "r-evil");
    server.messages.add({ id: { x: 1 } as any, text: "Wrong type of ID" }, "r-evil");
    let account = await newAccount(await startAddon(server));

    await account.syncOnStartup();

    let evil = roomOf(account, "r-evil");
    expect(evil.name).toBe("Evil gnp.exe");
    expect(evil.members.contents.map(person => person.name)).toEqual(["Mallory  evil"]);
    expect(roomOf(account, "r-nobody")).toBeUndefined();
    expect(account.rooms.contents.some(room => room.name == "Wrong type of ID")).toBe(false);
    let huge = evil.messages.find(message => message.id == "huge") as ChatMessage;
    expect(huge.text.length).toBeLessThanOrEqual(1024 * 1024);
    expect(isNaN(huge.sent.getTime())).toBe(false);
    expect(isNaN(huge.received.getTime())).toBe(false);
    expect(huge.isRead).toBe(false);
    expect((evil.messages.find(message => message.id == "number") as ChatMessage).text).toBe("");
    expect(evil.messages.length).toBe(2);
    expect(account.dataErrors.hasItems).toBe(true);
  });

  test("Too many messages per call or rooms, a sync state over 10 KB, and a sync without progress are stopped", async () => {
    let server = new FakeChatServer();
    server.messages.chunkSize = 1001;
    server.addMessages(1001);
    let account = await newAccount(await startAddon(server));
    await account.listRooms();
    await expect(roomOf(account, "r-team").listMessages()).rejects.toThrow(/more than 1000/);
    expect(roomOf(account, "r-team").messages.isEmpty).toBe(true);

    server.rooms = Array.from({ length: 10001 }, (_, i) => ({ id: "r" + i, members: [{ id: "p" + i }] }));
    await expect(account.listRooms()).rejects.toThrow(/more than 10000/);

    server.rooms = [{ id: "r-big", members: [{ id: "alice" }] }];
    let protocol = server.chatProtocol();
    protocol.listMessages = async () => ({ messages: [], syncState: "s".repeat(10 * 1024 + 1) });
    let addon = newProtocolAddon("Big state", ["test"], mustang => mustang.protocols.register("test", protocol), "chat");
    running.push(addon);
    await addon.enable();
    let bigState = await newAccount(addon);
    await bigState.listRooms();
    await expect(roomOf(bigState, "r-big").listMessages()).rejects.toThrow(/10 KB/);

    server.messages.isStuck = true;
    let errors: Error[] = [];
    account.errorCallback = ex => errors.push(ex);
    server.rooms = [{ id: "r-alice", members: [{ id: "alice" }] }];
    await account.listRooms();
    server.calls = [];
    await roomOf(account, "r-alice").listMessages();
    expect(errors.some(ex => ex.message.includes("keeps reporting more"))).toBe(true);
    expect(server.callsOf("listMessages").length).toBeLessThan(5);
  });
});
