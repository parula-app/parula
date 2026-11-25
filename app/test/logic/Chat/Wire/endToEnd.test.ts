// @vitest-environment happy-dom
// happy-dom gives us `navigator`, `window`, `document` and `crypto.randomUUID()`.

/** Two, three and four complete `WireAccount`s talking to each other through an
 * in-process Wire backend.
 *
 * Nothing is faked above the HTTP and WebSocket boundary: this is the real
 * `WireSession`, `WireAPI`, `WireMLSService`, `MLSClient`/`MLSGroup`,
 * `ProteusService`, `WireMedia`, `WireChatRoom`, `WireChatMessage` and the real
 * `GenericMessage` codec. What every other test in this directory proves in
 * isolation, this one proves composed: that a message Alice types comes out of
 * Bob's room as the same text, over both encryptions, across a restart, and
 * that a member we removed cannot follow along.
 *
 * @see `wireBackendFake.ts` for what the backend enforces.
 */

// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { Person } from "../../../../logic/Abstract/Person";
import { WireBackendFake, type FakeNotification, type FakeUser } from "./wireBackendFake";
import { WireAccount } from "../../../../logic/Chat/Wire/WireAccount";
import type { WireChatRoom } from "../../../../logic/Chat/Wire/WireChatRoom";
import type { WireGroupChatRoom } from "../../../../logic/Chat/Wire/WireGroupChatRoom";
import { WireChatMessage } from "../../../../logic/Chat/Wire/WireChatMessage";
import { WirePerson } from "../../../../logic/Chat/Wire/WirePerson";
import { MLSMessage } from "../../../../logic/Chat/MLS/Messages/MLSMessage";
import { base64Decode } from "../../../../logic/Chat/Signal/Crypto/primitives";
import { MemoryChatStorage } from "./memoryChatStorage";
import { DeliveryStatus } from "../../../../logic/Chat/ChatMessage";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";

appGlobal.me = new Person(); // as `startup.ts` does

const kAliceID = "11111111-1111-4111-8111-111111111111";
const kBobID = "22222222-2222-4222-8222-222222222222";
const kCarolID = "33333333-3333-4333-8333-333333333333";
const kDaveID = "44444444-4444-4444-8444-444444444444";
const kBobClientID = "b0b0000000000002";

let backend: WireBackendFake;
let alice: WireAccount;
let bob: WireAccount;
let carol: WireAccount;
let dave: WireAccount;
/** Everything that any account reported in the background */
let errors: Error[] = [];
let storages = new Map<WireAccount, MemoryChatStorage>();
/** The MLS group conversation that the first test creates */
let groupRoomID: string;
/** The Proteus 1:1 between Alice and Dave */
let daveRoomID: string;

beforeAll(async () => {
  backend = new WireBackendFake();
  backend.install();
  let aliceUser = backend.addUser({
    id: kAliceID, clientID: "a11ce00000000001",
    name: "Alice", email: "alice@example.com", password: "alice-password",
  });
  let bobUser = backend.addUser({
    id: kBobID, clientID: kBobClientID,
    name: "Bob", email: "bob@example.com", password: "bob-password",
  });
  let carolUser = backend.addUser({
    id: kCarolID, clientID: "ca40100000000003",
    name: "Carol", email: "carol@example.com", password: "carol-password",
  });
  // A peer whose devices speak only Proteus, so a 1:1 with them cannot be MLS
  let daveUser = backend.addUser({
    id: kDaveID, clientID: "da7e000000000004",
    name: "Dave", email: "dave@example.com", password: "dave-password",
    protocols: ["proteus"], mls: false,
  });
  backend.connect(aliceUser, bobUser);
  backend.connect(aliceUser, carolUser);
  backend.connect(aliceUser, daveUser);
  backend.connect(bobUser, carolUser);

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

test("login registers the device, and MLS in the order the backend demands", async () => {
  expect(alice.isLoggedIn).toBe(true);
  expect(alice.session.clientID).toBe("a11ce00000000001");
  expect(alice.mlsEnabled).toBe(true);
  expect(alice.supportedProtocols).toEqual(["proteus", "mls"]);

  // Appendix B rule 6: `mls_public_keys` on the device before the first key
  // package, or the backend refuses every one of them for ever.
  let paths = backend.requests.map(request => `${request.method} ${request.path}`);
  expect(paths.indexOf("post /clients"))
    .toBeLessThan(paths.indexOf("post /mls/key-packages/self/a11ce00000000001"));
  let client = backend.user(kAliceID).clients.get("a11ce00000000001");
  expect(client.mlsPublicKeys.ed25519).toBeTruthy();
  // §4.7: the official clients' policy, and every one of them validated
  expect(client.keyPackages.length).toBe(100);
  // The backend demands Proteus prekeys even of an MLS client
  expect(client.prekeys.size).toBe(100);
  expect(client.lastPrekey.id).toBe(0xFFFF);

  // Dave's team has no MLS: he registers his device without any MLS key
  expect(dave.mlsEnabled).toBe(false);
  expect(dave.mls).toBe(null);
  expect(backend.user(kDaveID).clients.get("da7e000000000004").keyPackages.length).toBe(0);

  expect(alice.roster.contents.map(person => person.userID).sort())
    .toEqual([kBobID, kCarolID, kDaveID].sort());
  expect(errorStacks()).toEqual([]);
});

test("an MLS group conversation: Alice adds Bob, and both read what the other wrote", async () => {
  let aliceRoom = await alice.createGroupChat("Design team", [person(alice, kBobID)]);
  groupRoomID = aliceRoom.id;
  let conversation = backend.conversation(WirePerson.parseChatID(groupRoomID).id);

  expect(aliceRoom.isMLS).toBe(true);
  expect(aliceRoom.protocol).toBe("mls");
  // The group exists only once its first commit landed; that is what adds Bob
  expect(conversation.epoch).toBe(1);
  expect(conversation.cipherSuite).toBe(1);
  expect([...conversation.mlsClients].sort()).toEqual(["a11ce00000000001", kBobClientID]);
  expect(aliceRoom.members.contents.map(member => member.userID)).toEqual([kBobID]);

  // Bob heard of the conversation for the first time through the Welcome
  let bobRoom = await waitFor("Bob's room", () => bob.getExistingRoom(groupRoomID));
  expect(bobRoom.isMLS).toBe(true);
  expect(bobRoom.groupID).toBe(aliceRoom.groupID);
  expect(bobRoom.name).toBe("Design team");
  expect(bobRoom.members.contents.map(member => member.userID)).toEqual([kAliceID]);

  await send(aliceRoom, "hello Bob");
  let received = await waitFor("Alice's message", () => incoming(bobRoom, "hello Bob"));
  expect(received).toBeInstanceOf(WireChatMessage);
  expect(received.to).toBe(bobRoom);
  expect((received.from as WirePerson).userID).toBe(kAliceID);
  expect(received.outgoing).toBe(false);
  expect(received.sent.getTime()).toBeGreaterThan(0);

  await send(bobRoom, "hi Alice");
  let reply = await waitFor("Bob's reply", () => incoming(aliceRoom, "hi Alice"));
  expect((reply.from as WirePerson).userID).toBe(kBobID);
  expect(reply.outgoing).toBe(false);

  // Neither message needed a new epoch, and neither was sent in the clear
  expect(conversation.epoch).toBe(1);
  expect(errorStacks()).toEqual([]);
}, 60000);

test("a 1:1 with a Proteus-only peer negotiates Proteus and encrypts per device", async () => {
  let davePerson = person(alice, kDaveID);
  expect(davePerson.supportedProtocols).toEqual(["proteus"]);
  expect(alice.protocolFor(davePerson)).toBe("proteus");

  let aliceRoom = await alice.getChatWith(davePerson);
  daveRoomID = aliceRoom.id;
  expect(aliceRoom.protocol).toBe("proteus");
  expect(aliceRoom.isMLS).toBe(false);
  let daveRoom = dave.getExistingRoom(aliceRoom.id);
  expect(daveRoom).toBeTruthy();

  let prekeysBefore = backend.user(kDaveID).clients.get("da7e000000000004").prekeys.size;
  await send(aliceRoom, "hello Dave");
  // §4.4: starting the session consumed one of Dave's one-time prekeys
  expect(backend.user(kDaveID).clients.get("da7e000000000004").prekeys.size)
    .toBe(prekeysBefore - 1);

  let received = await waitFor("Alice's message", () => incoming(daveRoom, "hello Dave"));
  expect((received.from as WirePerson).userID).toBe(kAliceID);
  // Proteus names the sending device in the event; MLS carries none
  expect(received.senderClientID).toBe("a11ce00000000001");

  await send(daveRoom, "hello back");
  let reply = await waitFor("Dave's reply", () => incoming(aliceRoom, "hello back"));
  expect((reply.from as WirePerson).userID).toBe(kDaveID);
  expect(errorStacks()).toEqual([]);
}, 60000);

test("an attachment goes through the asset store encrypted and comes back byte for byte", async () => {
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

  await file.load();
  expect(new Uint8Array(await file.content.arrayBuffer())).toEqual(bytes);

  // The asset store never saw the plaintext: what it holds is `iv ‖ ciphertext`
  let stored = [...backend.assets.values()].at(-1);
  expect(stored.public).toBe(true);
  expect(stored.bytes.length).toBe(16 + bytes.length + 16); // IV and PKCS#7
  expect(stored.bytes.subarray(16, 48)).not.toEqual(bytes.subarray(0, 32));
  expect(errorStacks()).toEqual([]);
}, 60000);

test("both sides keep the conversation across a restart", async () => {
  let conversation = backend.conversation(WirePerson.parseChatID(groupRoomID).id);
  let epochBefore = conversation.epoch;

  // Alice closes the app, and Bob writes to the group while she is away
  let saved = await close(alice);
  let bobRoom = bob.getExistingRoom(groupRoomID);
  await send(bobRoom, "while you were out");
  alice = await start(saved);

  let aliceRoom = alice.getExistingRoom(groupRoomID);
  expect(aliceRoom.mlsGroupJSON).toBeTruthy();
  expect(alice.mls.groupFor(aliceRoom)).toBeTruthy();
  // Coming back is not a reason to re-key: the epoch is where we left it
  expect(conversation.epoch).toBe(epochBefore);
  // What she missed came out of `GET /notifications`, from her stored cursor
  expect(await waitFor("the message she missed while away",
    () => incoming(aliceRoom, "while you were out"))).toBeTruthy();

  bob = await start(await close(bob));
  bobRoom = bob.getExistingRoom(groupRoomID);
  expect(bob.mls.groupFor(bobRoom)).toBeTruthy();

  await send(aliceRoom, "still here");
  expect(await waitFor("the message after the restart", () => incoming(bobRoom, "still here"))).toBeTruthy();

  await send(bobRoom, "so am I");
  expect(await waitFor("the reply after the restart", () => incoming(aliceRoom, "so am I"))).toBeTruthy();

  // The Proteus session survived too, and its ratchet did not repeat a key
  let daveRoom = dave.getExistingRoom(daveRoomID);
  let aliceDaveRoom = alice.getExistingRoom(daveRoomID);
  await send(aliceDaveRoom, "back again");
  expect(await waitFor("the Proteus message after the restart",
    () => incoming(daveRoom, "back again"))).toBeTruthy();
  expect(errorStacks()).toEqual([]);
}, 120000);

test("Carol joins the group, and Bob can no longer read what follows", async () => {
  let aliceRoom = alice.getExistingRoom(groupRoomID) as WireGroupChatRoom;
  let bobRoom = bob.getExistingRoom(groupRoomID);
  let conversation = backend.conversation(WirePerson.parseChatID(groupRoomID).id);
  let bobGroup = bob.mls.groupFor(bobRoom);
  let epochBefore = conversation.epoch;

  await aliceRoom.addMembers([person(alice, kCarolID)]);
  expect(conversation.epoch).toBe(epochBefore + 1);
  expect([...conversation.mlsClients].sort())
    .toEqual(["a11ce00000000001", kBobClientID, "ca40100000000003"].sort());

  let carolRoom = await waitFor("Carol's room", () => carol.getExistingRoom(groupRoomID));
  expect(carolRoom.members.contents.map(member => member.userID).sort()).toEqual([kAliceID, kBobID].sort());

  await send(aliceRoom, "welcome Carol");
  expect(await waitFor("Carol's first message", () => incoming(carolRoom, "welcome Carol"))).toBeTruthy();
  // Bob is still in the group and still reads it
  expect(await waitFor("Bob's copy", () => incoming(bobRoom, "welcome Carol"))).toBeTruthy();
  expect(await waitFor("Alice's member list",
    () => aliceRoom.members.contents.length == 2 && aliceRoom.members)).toBeTruthy();

  await aliceRoom.removeMembers([person(alice, kBobID)]);
  expect(conversation.epoch).toBe(epochBefore + 2);
  expect([...conversation.mlsClients].sort()).toEqual(["a11ce00000000001", "ca40100000000003"].sort());
  await waitFor("Bob to be out of the conversation", () => !bob.getExistingRoom(groupRoomID));

  await send(aliceRoom, "after Bob");
  expect(await waitFor("Carol's second message", () => incoming(carolRoom, "after Bob"))).toBeTruthy();

  // The backend never handed it to Bob, and his last group state cannot open it
  let last = lastMLSMessageIn(conversation.id);
  expect(last.clientIDs).not.toContain(kBobClientID);
  expect(() => bobGroup.process(MLSMessage.fromBytes(base64Decode(last.payload[0].data))))
    .toThrow();
  expect(errorStacks()).toEqual([]);
}, 120000);

test("a 1:1 with an MLS peer opens the MLS conversation, not the Proteus one", async () => {
  let carolPerson = person(alice, kCarolID);
  expect(alice.protocolFor(carolPerson)).toBe("mls");
  let proteusRoomID = alice.rooms.get(carolPerson).id;

  // §11: a conversation that neither side had, which the backend conjures and
  // whose group only exists once our commit established it
  let aliceRoom = await alice.getChatWith(carolPerson);
  expect(aliceRoom.id).not.toBe(proteusRoomID);
  expect(aliceRoom.isMLS).toBe(true);
  expect(alice.mls.groupFor(aliceRoom)).toBeTruthy();
  let conversation = backend.conversation(WirePerson.parseChatID(aliceRoom.id).id);
  expect(conversation.epoch).toBe(1);
  expect([...conversation.mlsClients].sort()).toEqual(["a11ce00000000001", "ca40100000000003"].sort());

  let carolRoom = await waitFor("Carol's MLS 1:1", () => carol.getExistingRoom(aliceRoom.id));
  await send(aliceRoom, "just the two of us");
  let received = await waitFor("Alice's message",
    () => incoming(carolRoom, "just the two of us"));
  expect((received.from as WirePerson).userID).toBe(kAliceID);

  await send(carolRoom, "indeed");
  expect(await waitFor("Carol's reply", () => incoming(aliceRoom, "indeed"))).toBeTruthy();

  // Our room list holds one room per contact, and Wire has 2 one-to-one
  // conversations with this person. Listing them again must not hand the
  // Proteus one back, whatever order the server sends them in.
  await alice.listConversations();
  expect(alice.rooms.get(carolPerson)).toBe(aliceRoom);
  expect(alice.protocolFor(carolPerson)).toBe("mls");
  expect(errorStacks()).toEqual([]);
}, 120000);

test("a read receipt, a reaction, an edit and a deletion all find the message again", async () => {
  let aliceRoom = alice.rooms.get(person(alice, kCarolID));
  let carolRoom = carol.getExistingRoom(aliceRoom.id);
  expect(aliceRoom.receiptMode).toBe(1);

  let sent = await send(aliceRoom, "check this");
  let received = await waitFor("Alice's message", () => incoming(carolRoom, "check this"));
  expect(received.id).toBe(sent.id);
  expect(received.expectsReadConfirmation).toBe(true);

  // Wire has no receipt event: a receipt is an ordinary encrypted message back
  await received.markRead();
  await waitFor("the read receipt", () => sent.deliveryStatus == DeliveryStatus.Seen);

  await received.setMyReaction("👍");
  await waitFor("the reaction", () => sent.reactions.get(person(alice, kCarolID)) == "👍");

  // An edit carries a new message ID and names the old one, and the receiver
  // re-keys its copy, so that a later edit or reaction still finds it
  let edit = await sent.createEdit() as WireChatMessage;
  edit.text = "check this, corrected";
  await aliceRoom.sendMessage(edit);
  await waitFor("the edit", () => received.text == "check this, corrected");
  expect(received.id).toBe(edit.id);
  expect(sent.id).toBe(edit.id);

  await sent.deleteForOthers();
  await waitFor("the deletion", () => received.deleted);
  expect(errorStacks()).toEqual([]);
}, 120000);

test("a commit that lost the race puts itself back in from the GroupInfo", async () => {
  let aliceRoom = alice.rooms.get(person(alice, kCarolID));
  let carolRoom = carol.getExistingRoom(aliceRoom.id);
  let conversation = backend.conversation(WirePerson.parseChatID(aliceRoom.id).id);
  let epochBefore = conversation.epoch;
  let requestsBefore = backend.requests.length;

  // Carol's connection drops, so she never sees Alice's commit, and the one
  // she builds next is for an epoch that is already gone. §9.3
  // `mls-stale-message`: only a fresh GroupInfo can repair that.
  let deliver = carol.eventStream.onEvent;
  carol.eventStream.onEvent = async () => undefined;
  await alice.mls.rotateOurKey(aliceRoom);
  expect(conversation.epoch).toBe(epochBefore + 1);
  expect(carol.mls.groupFor(carolRoom).epoch).toBe(BigInt(epochBefore));

  await carol.mls.rotateOurKey(carolRoom);
  carol.eventStream.onEvent = deliver;

  // §10: she committed herself back in by external commit, which works only
  // because of the `ratchet_tree` that every GroupInfo we publish carries
  expect(conversation.epoch).toBe(epochBefore + 2);
  expect(carol.mls.groupFor(carolRoom).epoch).toBe(BigInt(epochBefore + 2));
  expect(backend.requests.slice(requestsBefore)
    .some(request => request.path.endsWith("/groupinfo"))).toBe(true);
  await waitFor("Alice to follow the external commit",
    () => alice.mls.groupFor(aliceRoom).epoch == BigInt(epochBefore + 2));

  await send(aliceRoom, "after the race");
  expect(await waitFor("Alice's message after the race",
    () => incoming(carolRoom, "after the race"))).toBeTruthy();
  await send(carolRoom, "and back");
  expect(await waitFor("Carol's reply after the race",
    () => incoming(aliceRoom, "and back"))).toBeTruthy();
  expect(errorStacks()).toEqual([]);
}, 120000);

///////////////////////////////////////////////////////////
// Driving the accounts

async function login(user: FakeUser): Promise<WireAccount> {
  let account = new WireAccount();
  let storage = new MemoryChatStorage();
  storages.set(account, storage);
  account.storage = storage;
  account.url = backend.baseURL;
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

/** Nothing went wrong in the background. The stacks, because that is the half
 * of a background error that says where it came from. */
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

function lastMLSMessageIn(conversationID: string): FakeNotification {
  return backend.notifications.filter(notification =>
    notification.payload[0]?.type == "conversation.mls-message-add" &&
    notification.payload[0]?.conversation == conversationID).at(-1);
}

/** The event stream is asynchronous, so give it a moment to arrive.
 * @throws with what we were waiting for, which is the useful half of a timeout */
async function waitFor<T>(what: string, get: () => T | null | undefined | false,
  timeoutMS = 10000): Promise<T> {
  let until = Date.now() + timeoutMS;
  do {
    let value = get();
    if (value) {
      return value;
    }
    await new Promise(resolve => setTimeout(resolve, 5));
  } while (Date.now() < until);
  throw new Error(`Timed out waiting for ${what}`);
}

/** What the app has on disk while it is not running */
interface SavedAccount {
  config: any;
  storage: MemoryChatStorage;
}
