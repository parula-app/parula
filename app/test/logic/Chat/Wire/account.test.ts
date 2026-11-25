// @vitest-environment happy-dom
// happy-dom gives us `navigator` and `crypto.randomUUID()`.

// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { WireAccount } from "../../../../logic/Chat/Wire/WireAccount";
import { Wire1to1ChatRoom } from "../../../../logic/Chat/Wire/Wire1to1ChatRoom";
import { WireGroupChatRoom } from "../../../../logic/Chat/Wire/WireGroupChatRoom";
import { WireChatMessage } from "../../../../logic/Chat/Wire/WireChatMessage";
import { WireRoomEvent } from "../../../../logic/Chat/Wire/WireRoomEvent";
import { WirePerson } from "../../../../logic/Chat/Wire/WirePerson";
import { GenericMessage } from "../../../../logic/Chat/Wire/Proto/messages";
import { encode } from "../../../../logic/Chat/Signal/Proto/codec";
import { base64Encode } from "../../../../logic/Chat/Signal/Crypto/primitives";
import { DummyChatStorage } from "../../../../logic/Chat/SQL/DummyChatStorage";
import { DeliveryStatus } from "../../../../logic/Chat/ChatMessage";
import { RoomEventKind } from "../../../../logic/Chat/RoomEvent";
import { Group } from "../../../../logic/Abstract/Group";
import { expect, test } from "vitest";

const kDomain = "example.com";
const kOurUserID = "00000000-0000-4000-8000-00000000000f";
const kAliceID = "11111111-1111-4111-8111-111111111111";
const kBobID = "22222222-2222-4222-8222-222222222222";
const kCarolID = "33333333-3333-4333-8333-333333333333";
const kGroupID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const kOneToOneID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const kSelfConversationID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

test("the conversation list becomes rooms of the right kind", async () => {
  let account = newAccount();
  await account.listConversations();

  expect(account.rooms.size).toBe(2); // our own notes are not a chat room

  let group = account.getExistingRoom(`${kGroupID}@${kDomain}`);
  expect(group).toBeInstanceOf(WireGroupChatRoom);
  expect(group.contact).toBeInstanceOf(Group);
  expect(group.name).toBe("Design team");
  expect(group.type).toBe(0);
  expect(group.isAdmin).toBe(true); // `wire_admin` in `members.self`
  expect(group.members.contents.map(person => person.chatID).sort())
    .toEqual([`${kAliceID}@${kDomain}`, `${kBobID}@${kDomain}`]);

  let oneToOne = account.getExistingRoom(`${kOneToOneID}@${kDomain}`);
  expect(oneToOne).toBeInstanceOf(Wire1to1ChatRoom);
  expect(oneToOne.contact).toBeInstanceOf(WirePerson);
  expect((oneToOne.contact as WirePerson).chatID).toBe(`${kAliceID}@${kDomain}`);
  expect((oneToOne.contact as WirePerson).userID).toBe(kAliceID);
  expect((oneToOne.contact as WirePerson).domain).toBe(kDomain);
  expect(oneToOne.protocol).toBe("mls");
  expect(oneToOne.groupID).toBe("Z3JvdXA=");
});

test("a Proteus and an MLS message become the same message, from one decode", async () => {
  let account = newAccount();
  await account.listConversations();
  let proteusRoom = account.getExistingRoom(`${kGroupID}@${kDomain}`);
  let mlsRoom = account.getExistingRoom(`${kOneToOneID}@${kDomain}`);

  let payload = encode(GenericMessage, {
    messageID: "0d1e2f30-0000-4000-8000-000000000001",
    text: { content: "Hello over both transports" },
  });
  // Only the decryption differs: both hand the very same bytes to the room.
  (account as any).proteus = { decryptEvent: async () => payload };
  (account as any).mls = { processMessage: async () => ({ kind: "application", plaintext: payload }) };

  await (account as any).onEvent({
    type: "conversation.otr-message-add",
    qualified_conversation: { id: kGroupID, domain: kDomain },
    qualified_from: { id: kAliceID, domain: kDomain },
    time: "2026-01-02T03:04:05.678Z",
    data: { sender: "a1b2c3d4e5f60718", recipient: "0011223344556677", text: "…" },
  });
  await (account as any).onEvent({
    type: "conversation.mls-message-add",
    qualified_conversation: { id: kOneToOneID, domain: kDomain },
    qualified_from: { id: kAliceID, domain: kDomain },
    time: "2026-01-02T03:04:05.678Z",
    data: base64Encode(new Uint8Array([1, 2, 3])),
  });

  let overProteus = proteusRoom.messages.first as WireChatMessage;
  let overMLS = mlsRoom.messages.first as WireChatMessage;
  for (let msg of [overProteus, overMLS]) {
    expect(msg).toBeInstanceOf(WireChatMessage);
    expect(msg.text).toBe("Hello over both transports");
    expect(msg.id).toBe("0d1e2f30-0000-4000-8000-000000000001");
    expect(msg.outgoing).toBe(false);
    expect((msg.from as WirePerson).chatID).toBe(`${kAliceID}@${kDomain}`);
    expect(msg.sent.toISOString()).toBe("2026-01-02T03:04:05.678Z");
  }
  // Proteus names the sending device in the event; MLS does not carry one.
  expect(overProteus.senderClientID).toBe("a1b2c3d4e5f60718");
  expect(overMLS.senderClientID).toBe(null);
});

test("a member joining becomes a room event", async () => {
  let account = newAccount();
  await account.listConversations();
  let room = account.getExistingRoom(`${kGroupID}@${kDomain}`);

  await (account as any).onEvent({
    type: "conversation.member-join",
    qualified_conversation: { id: kGroupID, domain: kDomain },
    qualified_from: { id: kAliceID, domain: kDomain },
    time: "2026-01-02T03:04:05.678Z",
    data: {
      users: [{ qualified_id: { id: kCarolID, domain: kDomain }, conversation_role: "wire_member" }],
      add_type: "internal_add",
    },
  });

  let event = room.messages.first as WireRoomEvent;
  expect(event).toBeInstanceOf(WireRoomEvent);
  expect(event.kind).toBe(RoomEventKind.JoinLeave);
  expect(event.wireType).toBe("conversation.member-join");
  expect(event.persons.contents.map(person => person.chatID)).toEqual([`${kCarolID}@${kDomain}`]);
  expect(event.text).toContain("joined");
  expect(room.members.contents.map(person => person.chatID)).toContain(`${kCarolID}@${kDomain}`);
  // The same event again from the notification stream is the second copy
  expect(room.isOutdatedEvent({ type: "conversation.member-join", time: "2026-01-02T03:04:05.678Z" })).toBe(true);
  expect(room.isOutdatedEvent({ type: "conversation.member-join", time: "2026-01-02T03:04:06.000Z" })).toBe(false);
  expect(room.isOutdatedEvent({ type: "conversation.otr-message-add", time: "2020-01-01T00:00:00.000Z" })).toBe(false);
});

test("a text message survives a round trip through the DB JSON", async () => {
  let account = newAccount();
  await account.listConversations();
  let room = account.getExistingRoom(`${kOneToOneID}@${kDomain}`);

  let original = room.newMessage();
  original.id = "0d1e2f30-0000-4000-8000-000000000002";
  original.text = "See you tomorrow";
  original.outgoing = true;
  original.senderClientID = "a1b2c3d4e5f60718";
  original.edited = true;
  original.expectsReadConfirmation = true;
  original.ephemeralMillis = 10_000;
  original.deliveryStatus = DeliveryStatus.Seen;
  original.assetRemote = {
    otrKey: new Uint8Array(32).fill(7),
    sha256: new Uint8Array(32).fill(9),
    assetID: "3-1-47de4580-ae51-4650-acbb-d10c028cb0ac",
    assetDomain: kDomain,
  };

  let json = JSON.parse(JSON.stringify(original.toExtraJSON()));
  let restored = room.newMessage();
  restored.text = original.text;
  restored.fromExtraJSON(json);

  expect(restored.text).toBe(original.text);
  expect(restored.senderClientID).toBe(original.senderClientID);
  expect(restored.edited).toBe(true);
  expect(restored.expectsReadConfirmation).toBe(true);
  expect(restored.ephemeralMillis).toBe(10_000);
  expect(restored.deliveryStatus).toBe(DeliveryStatus.Seen);
  // Without this, a file we never downloaded would be lost after a restart.
  expect(restored.assetRemote.assetID).toBe(original.assetRemote.assetID);
  expect([...restored.assetRemote.otrKey]).toEqual([...original.assetRemote.otrKey]);
  expect([...restored.assetRemote.sha256]).toEqual([...original.assetRemote.sha256]);
});

test("the room state survives a round trip through the DB JSON", async () => {
  let account = newAccount();
  await account.listConversations();
  let room = account.getExistingRoom(`${kOneToOneID}@${kDomain}`);
  room.lastEventDate = new Date("2026-01-02T03:04:05.678Z");
  room.mlsGroupJSON = { epoch: 3 };

  let restored = account.newRoom(false);
  restored.fromExtraJSON(JSON.parse(JSON.stringify(room.toExtraJSON())));

  expect(restored.protocol).toBe("mls");
  expect(restored.isMLS).toBe(true);
  expect(restored.groupID).toBe("Z3JvdXA=");
  expect(restored.type).toBe(2);
  expect(restored.role).toBe("wire_member");
  expect(restored.isAdmin).toBe(false);
  expect(restored.lastEventDate.toISOString()).toBe("2026-01-02T03:04:05.678Z");
  expect(restored.mlsGroupJSON).toEqual({ epoch: 3 });
});

test("logout() leaves nothing running", async () => {
  let account = newAccount();
  let streamStopped = false;
  let refreshStopped = false;
  let loggedOut = false;
  account.isOnline = true;
  (account as any).eventStream = { stop: async () => { streamStopped = true; } };
  (account.session as any).stop = () => { refreshStopped = true; };
  (account.session as any).logout = async () => { loggedOut = true; };

  await account.logout();

  expect(streamStopped).toBe(true);   // the WebSocket and its reconnect timer
  expect(refreshStopped).toBe(true);  // the access-token refresh timer
  expect(loggedOut).toBe(true);       // the cookie is revoked on the server
  expect(account.isOnline).toBe(false);
  expect(account.eventStream).toBe(null);
  expect(account.session).toBe(null);
  expect(account.transport).toBe(null);
  expect(account.proteus).toBe(null);
  expect(account.mls).toBe(null);
});

/** A logged-in account whose network seams are all faked. */
function newAccount(): WireAccount {
  let account = new WireAccount();
  account.storage = new DummyChatStorage();
  account.url = `https://nginz-https.${kDomain}`;
  account.transport = { domain: kDomain, accessToken: "access-token", cookie: "zuid" } as any;
  account.session = {
    userID: kOurUserID,
    domain: kDomain,
    clientID: "0011223344556677",
    stop: () => undefined,
    logout: async () => undefined,
  } as any;
  account.api = fakeAPI() as any;
  account.eventStream = { isLive: true, lastNotificationID: null } as any;
  return account;
}

function fakeAPI() {
  return {
    async listAllConversations() {
      return { found: [groupConversation(), oneToOneConversation(), selfConversation()], notFound: [], failed: [] };
    },
    async getConversation(id: any) {
      return id.id == kGroupID ? groupConversation() : oneToOneConversation();
    },
  };
}

function groupConversation() {
  return {
    qualified_id: { id: kGroupID, domain: kDomain },
    type: 0,
    name: "Design team",
    protocol: "proteus",
    group_id: null,
    epoch: null,
    cipher_suite: null,
    receipt_mode: 1,
    message_timer: null,
    members: {
      self: { qualified_id: { id: kOurUserID, domain: kDomain }, conversation_role: "wire_admin" },
      others: [
        { qualified_id: { id: kAliceID, domain: kDomain }, conversation_role: "wire_member" },
        { qualified_id: { id: kBobID, domain: kDomain }, conversation_role: "wire_member" },
      ],
    },
  } as any;
}

function oneToOneConversation() {
  return {
    qualified_id: { id: kOneToOneID, domain: kDomain },
    type: 2,
    name: null,
    protocol: "mls",
    group_id: "Z3JvdXA=", // opaque bytes, base64 in JSON
    epoch: 4,
    cipher_suite: 1,
    receipt_mode: null,
    message_timer: null,
    members: {
      self: { qualified_id: { id: kOurUserID, domain: kDomain }, conversation_role: "wire_member" },
      others: [{ qualified_id: { id: kAliceID, domain: kDomain }, conversation_role: "wire_member" }],
    },
  } as any;
}

/** Our own notes. It carries only the state our devices sync, never a chat. */
function selfConversation() {
  return {
    qualified_id: { id: kSelfConversationID, domain: kDomain },
    type: 1,
    name: null,
    protocol: "proteus",
    members: { self: { qualified_id: { id: kOurUserID, domain: kDomain }, conversation_role: "wire_admin" }, others: [] },
  } as any;
}
