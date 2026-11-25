// Runs in plain Node, not happy-dom: a browser's `fetch` refuses cross-origin
// requests and hides `Set-Cookie`, and Wire's whole session rests on the `zuid`
// cookie. Node has everything else this needs — `crypto.randomUUID()`,
// `WebSocket`, `File`, `navigator`.

/**
 * The same story as `endToEnd.test.ts`, but against a **real wire-server**.
 *
 * `endToEnd.test.ts` proves that our layers compose; this proves that what they
 * put on the wire is what the actual backend accepts. Everything above HTTP and
 * the WebSocket is the real client, and everything below it is brig, galley,
 * gundeck, cannon, cargohold and nginz.
 *
 * Skipped unless a backend answers. To run one, see `Protocol/00-Design.md`;
 * in short, start wire-server's services and then:
 *
 *   WIRE_TEST_BACKEND=http://127.0.0.1:8080 yarn test live
 *
 * Every run creates its own users, so it can be repeated against the same
 * backend without cleaning up.
 */
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { Person } from "../../../../logic/Abstract/Person";
import { WireTestBackend, installRealNetwork, isBackendReachable, kBackendURL, type TestUser } from "./liveBackend";
import { MemoryChatStorage } from "./memoryChatStorage";
import { WireAccount } from "../../../../logic/Chat/Wire/WireAccount";
import type { WireChatRoom } from "../../../../logic/Chat/Wire/WireChatRoom";
import type { WireGroupChatRoom } from "../../../../logic/Chat/Wire/WireGroupChatRoom";
import { WireChatMessage } from "../../../../logic/Chat/Wire/WireChatMessage";
import { WirePerson } from "../../../../logic/Chat/Wire/WirePerson";
import { DeliveryStatus } from "../../../../logic/Chat/ChatMessage";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";

appGlobal.me = new Person(); // as `startup.ts` does

const kHaveBackend = await isBackendReachable();
const kRun = kHaveBackend ? test : test.skip;
/** A tag that makes this run's users unique, so runs do not collide */
const kRunID = Math.random().toString(36).slice(2, 10);

let backend: WireTestBackend;
let aliceUser: TestUser, bobUser: TestUser, carolUser: TestUser, daveUser: TestUser;
let alice: WireAccount, bob: WireAccount, carol: WireAccount, dave: WireAccount;
/** Everything that any account reported in the background */
let errors: Error[] = [];
let storages = new Map<WireAccount, MemoryChatStorage>();
let groupRoomID: string;

beforeAll(async () => {
  if (!kHaveBackend) {
    console.warn(`No Wire backend at ${kBackendURL}, skipping the live tests`);
    return;
  }
  installRealNetwork();
  backend = new WireTestBackend();
  await backend.start();

  // Each user owns their own team, because the MLS feature flag lives on the
  // team, and because that makes them strangers who have to connect first.
  aliceUser = await backend.createUser({ name: "Alice", ...credentials("alice") });
  bobUser = await backend.createUser({ name: "Bob", ...credentials("bob") });
  carolUser = await backend.createUser({ name: "Carol", ...credentials("carol") });
  // A peer whose team has no MLS, so a 1:1 with them cannot be MLS
  daveUser = await backend.createUser({
    name: "Dave", ...credentials("dave"), protocols: ["proteus"],
  });
  await backend.enableMLS(aliceUser);
  await backend.enableMLS(bobUser);
  await backend.enableMLS(carolUser);
  // Dave's team keeps the default, which is MLS off
  expect((await backend.getTeamFeature(daveUser, "mls")).status).toBe("disabled");

  await backend.connect(aliceUser, bobUser);
  await backend.connect(aliceUser, carolUser);
  await backend.connect(aliceUser, daveUser);
  await backend.connect(bobUser, carolUser);

  alice = await login(aliceUser);
  bob = await login(bobUser);
  carol = await login(carolUser);
  dave = await login(daveUser);
}, 300000);

afterAll(async () => {
  for (let account of [alice, bob, carol, dave]) {
    await account?.disconnect();
  }
});

beforeEach(() => {
  errors = [];
});

kRun("login registers the device, and MLS in the order the backend demands", async () => {
  expect(alice.isLoggedIn).toBe(true);
  expect(alice.session.userID).toBe(aliceUser.userID);
  expect(alice.session.clientID).toBeTruthy();
  expect(alice.mlsEnabled).toBe(true);
  expect(alice.supportedProtocols).toEqual(["proteus", "mls"]);

  // The backend accepted our key packages, which it only does when
  // `mls_public_keys` reached it before the first of them
  let count = await alice.api.countKeyPackages(alice.session.clientID, 1);
  expect(count).toBeGreaterThan(0);

  // Dave's team has no MLS: he registers his device without any MLS key
  expect(dave.mlsEnabled).toBe(false);
  expect(dave.mls).toBe(null);

  expect(alice.roster.contents.map(person => person.userID).sort())
    .toEqual([bobUser.userID, carolUser.userID, daveUser.userID].sort());
  expect(errorStacks()).toEqual([]);
}, 60000);

kRun("an MLS group conversation: Alice adds Bob, and both read what the other wrote", async () => {
  let aliceRoom = await alice.createGroupChat("Design team", [person(alice, bobUser.userID)]);
  groupRoomID = aliceRoom.id;

  expect(aliceRoom.isMLS).toBe(true);
  expect(aliceRoom.protocol).toBe("mls");
  expect(aliceRoom.members.contents.map(member => member.userID)).toEqual([bobUser.userID]);

  // Bob heard of the conversation for the first time through the Welcome
  let bobRoom = await waitFor("Bob's room", () => bob.getExistingRoom(groupRoomID));
  expect(bobRoom.isMLS).toBe(true);
  expect(bobRoom.groupID).toBe(aliceRoom.groupID);
  expect(bobRoom.name).toBe("Design team");
  expect(bobRoom.members.contents.map(member => member.userID)).toEqual([aliceUser.userID]);

  await send(aliceRoom, "hello Bob");
  let received = await waitFor("Alice's message", () => incoming(bobRoom, "hello Bob"));
  expect(received).toBeInstanceOf(WireChatMessage);
  expect(received.to).toBe(bobRoom);
  expect((received.from as WirePerson).userID).toBe(aliceUser.userID);
  expect(received.outgoing).toBe(false);
  expect(received.sent.getTime()).toBeGreaterThan(0);

  await send(bobRoom, "hi Alice");
  let reply = await waitFor("Bob's reply", () => incoming(aliceRoom, "hi Alice"));
  expect((reply.from as WirePerson).userID).toBe(bobUser.userID);
  expect(errorStacks()).toEqual([]);
}, 120000);

kRun("a 1:1 with a Proteus-only peer negotiates Proteus and encrypts per device", async () => {
  let davePerson = person(alice, daveUser.userID);
  expect(davePerson.supportedProtocols).toEqual(["proteus"]);
  expect(alice.protocolFor(davePerson)).toBe("proteus");

  let aliceRoom = await alice.getChatWith(davePerson);
  expect(aliceRoom.protocol).toBe("proteus");
  expect(aliceRoom.isMLS).toBe(false);

  await send(aliceRoom, "hello Dave");
  let daveRoom = await waitFor("Dave's room",
    () => dave.getExistingRoom(aliceRoom.id));
  let received = await waitFor("Alice's message", () => incoming(daveRoom, "hello Dave"));
  expect((received.from as WirePerson).userID).toBe(aliceUser.userID);
  // Proteus names the sending device in the event; MLS carries none
  expect(received.senderClientID).toBe(alice.session.clientID);

  await send(daveRoom, "hello back");
  let reply = await waitFor("Dave's reply", () => incoming(aliceRoom, "hello back"));
  expect((reply.from as WirePerson).userID).toBe(daveUser.userID);
  expect(errorStacks()).toEqual([]);
}, 120000);

kRun("an MLS 1:1 uses the conversation the backend mints for the pair", async () => {
  let carolPerson = person(alice, carolUser.userID);
  expect(alice.protocolFor(carolPerson)).toBe("mls");

  let aliceRoom = await alice.getChatWith(carolPerson);
  expect(aliceRoom.isMLS).toBe(true);

  await send(aliceRoom, "hello Carol");
  let carolRoom = await waitFor("Carol's room", () => carol.getExistingRoom(aliceRoom.id));
  let received = await waitFor("Alice's message", () => incoming(carolRoom, "hello Carol"));
  expect((received.from as WirePerson).userID).toBe(aliceUser.userID);

  await send(carolRoom, "hi Alice");
  await waitFor("Carol's reply", () => incoming(aliceRoom, "hi Alice"));
  expect(errorStacks()).toEqual([]);
}, 120000);

kRun("an attachment goes through the asset store encrypted and comes back byte for byte", async () => {
  let aliceRoom = alice.getExistingRoom(groupRoomID);
  let bobRoom = bob.getExistingRoom(groupRoomID);
  let bytes = new Uint8Array(4096);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = (i * 37 + 11) & 0xFF;
  }

  let msg = aliceRoom.newMessage();
  let attachment = msg.newAttachment();
  attachment.fromFile(new File([bytes as unknown as BlobPart], "cat.png", { type: "image/png" }));
  msg.attachments.add(attachment);
  await aliceRoom.sendMessage(msg);
  expect(msg.deliveryStatus).toBe(DeliveryStatus.Server);

  let received = await waitFor("the attachment", () => bobRoom.messages.contents
    .find(each => each instanceof WireChatMessage && !each.outgoing && each.attachments.hasItems)) as WireChatMessage;
  // Both sides know it under the same ID, or no receipt or reaction for it
  // would ever find our copy
  expect(received.id).toBe(msg.id);
  let file = received.attachments.first;
  expect(file.filename).toBe("cat.png");
  expect(file.mimeType).toBe("image/png");
  expect(file.size).toBe(bytes.length);
  expect(file.content).toBe(undefined); // not downloaded yet

  // Downloads it from cargohold and decrypts it
  await file.load();
  expect(new Uint8Array(await file.content.arrayBuffer())).toEqual(bytes);
  expect(errorStacks()).toEqual([]);
}, 120000);

kRun("a restart picks the MLS group up where it left off", async () => {
  let saved = await close(bob);
  bob = await start(saved);
  expect(bob.isLoggedIn).toBe(true);

  let aliceRoom = alice.getExistingRoom(groupRoomID);
  let bobRoom = await waitFor("Bob's restored room", () => bob.getExistingRoom(groupRoomID));
  expect(bobRoom.isMLS).toBe(true);

  await send(aliceRoom, "still there?");
  let received = await waitFor("the message after the restart",
    () => incoming(bobRoom, "still there?"));
  expect((received.from as WirePerson).userID).toBe(aliceUser.userID);
  expect(errorStacks()).toEqual([]);
}, 180000);

kRun("a removed member cannot read what is said afterwards", async () => {
  let aliceRoom = alice.getExistingRoom(groupRoomID) as WireGroupChatRoom;
  let carolPerson = person(alice, carolUser.userID);
  await aliceRoom.addMembers([carolPerson]);
  let carolRoom = await waitFor("Carol's room", () => carol.getExistingRoom(groupRoomID));
  await send(aliceRoom, "welcome Carol");
  await waitFor("Carol reads along", () => incoming(carolRoom, "welcome Carol"));

  await aliceRoom.removeMembers([carolPerson]);
  await send(aliceRoom, "after Carol left");
  let bobRoom = bob.getExistingRoom(groupRoomID);
  await waitFor("Bob still reads along", () => incoming(bobRoom, "after Carol left"));
  expect(incoming(carolRoom, "after Carol left")).toBeUndefined();
  expect(errorStacks()).toEqual([]);
}, 180000);

///////////////////////////////////////////////////////////
// Helpers

function credentials(who: string): { email: string, password: string } {
  return {
    email: `${who}-${kRunID}@example.com`,
    password: `${who}-password-${kRunID}`,
  };
}

async function login(user: TestUser): Promise<WireAccount> {
  let account = new WireAccount();
  let storage = new MemoryChatStorage();
  storages.set(account, storage);
  account.storage = storage;
  account.url = kBackendURL;
  account.username = user.email;
  account.password = user.password;
  account.errorCallback = ex => errors.push(ex);
  await account.login(true);
  return account;
}

/** Closes the app. What is left is what a restart would find on disk.
 *
 * Through JSON, because that is what `SQLAccount.save()` does with it: anything
 * in there that JSON cannot carry - a `Uint8Array`, a `Map`, a `Date` - would
 * come back as something else, and handing the object straight back would hide
 * that. */
async function close(account: WireAccount): Promise<SavedAccount> {
  let saved = {
    config: JSON.parse(JSON.stringify(account.toConfigJSON())),
    storage: storages.get(account),
  };
  await account.disconnect();
  return saved;
}

/** Starts the app again, on nothing but what `close()` left. There is no
 * password in the config, so the login is the stored cookie. */
async function start(saved: SavedAccount): Promise<WireAccount> {
  let account = new WireAccount();
  account.storage = saved.storage;
  account.errorCallback = ex => errors.push(ex);
  account.fromConfigJSON(saved.config);
  saved.storage.restoreInto(account);
  storages.set(account, saved.storage);
  await account.login(false);
  return account;
}

async function send(room: WireChatRoom, text: string): Promise<WireChatMessage> {
  let msg = room.newMessage();
  msg.text = text;
  await room.sendMessage(msg);
  return msg;
}

function errorStacks(): string[] {
  return errors.map(ex => ex.stack ?? String(ex));
}

function person(account: WireAccount, userID: string): WirePerson {
  return account.getWirePerson({ id: userID, domain: backend.domain });
}

/** A message that arrived from somebody else, by its text */
function incoming(room: WireChatRoom, text: string): WireChatMessage | undefined {
  return room.messages.contents.find(each =>
    each instanceof WireChatMessage && !each.outgoing && each.text == text) as WireChatMessage;
}

/** The event stream is asynchronous, so give it a moment to arrive.
 * @throws with what we were waiting for, which is the useful half of a timeout */
async function waitFor<T>(what: string, get: () => T | null | undefined | false,
  timeoutMS = 30000): Promise<T> {
  let until = Date.now() + timeoutMS;
  do {
    let value = get();
    if (value) {
      return value;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  } while (Date.now() < until);
  throw new Error(`Timed out waiting for ${what}`);
}

/** What the app has on disk while it is not running */
interface SavedAccount {
  config: any;
  storage: MemoryChatStorage;
}
