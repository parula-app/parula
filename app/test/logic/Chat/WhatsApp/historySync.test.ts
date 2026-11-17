// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { WhatsAppAccount } from "../../../../logic/Chat/WhatsApp/WhatsAppAccount";
import { JID } from "../../../../logic/Chat/WhatsApp/Binary/JID";
import { DummyChatStorage } from "../../../../logic/Chat/SQL/DummyChatStorage";
import { Addressbook } from "../../../../logic/Contacts/Addressbook";
import { DummyAddressbookStorage } from "../../../../logic/Contacts/SQL/DummyAddressbookStorage";
import { Person } from "../../../../logic/Abstract/Person";
import { encode, decode } from "../../../../logic/Chat/Signal/Proto/codec";
import {
  HistorySync, HistorySyncType, ProtocolMessageType, PeerDataOperationRequestType,
  PeerDataOperationRequestMessage, Message, decodeHistorySync, decodeWAMessage,
} from "../../../../logic/Chat/WhatsApp/Proto/schema";
import { expect, test } from "vitest";

const kAliceJID = "491761111111@s.whatsapp.net";
const kBobJID = "491762222222@s.whatsapp.net";
/** `kOnDemandPageSize` in `WhatsAppHistorySync.ts` */
const kOnDemandPageSize = 50;

/** A WhatsApp account on no-op storage, as in liveReceive.test.ts. */
function setup(): WhatsAppAccount {
  appGlobal.addressbooks.clear();
  appGlobal.chatAccounts.clear();
  let addressbook = new Addressbook();
  addressbook.name = "Personal";
  addressbook.storage = new DummyAddressbookStorage();
  appGlobal.addressbooks.add(addressbook);
  appGlobal.personalAddressbook = addressbook;
  let account = new WhatsAppAccount();
  account.storage = new DummyChatStorage();
  account.deviceJID = JID.parse("412300000000:1@s.whatsapp.net");
  appGlobal.chatAccounts.add(account);
  appGlobal.me = new Person();
  appGlobal.me.name = "Me";
  return account;
}

/** Builds one conversation with `count` plain-text messages, ids `${prefix}N`. */
function conversationWith(id: string, prefix: string, count: number) {
  let messages: any[] = [];
  for (let i = 0; i < count; i++) {
    messages.push({
      message: {
        key: { remoteJID: id, fromMe: false, id: `${prefix}${i}` },
        message: { conversation: `${prefix} message ${i}` },
        messageTimestamp: 1700000000 + i,
        pushName: "Sender",
      },
    });
  }
  return { id, messages };
}

test("a FULL history dump imports all conversations and messages", async () => {
  let account = setup();

  // A large FULL blob: many conversations, many messages each — the shape a
  // phone pushes at link time when requireFullSync asked for the whole history.
  let conversations: any[] = [];
  for (let c = 0; c < 30; c++) {
    conversations.push(conversationWith(`49176${1000000 + c}@s.whatsapp.net`, `c${c}-`, 20));
  }
  let blob = encode(HistorySync, { syncType: HistorySyncType.Full, conversations });

  let result = await account.historySync.importHistory(decodeHistorySync(blob), HistorySyncType.Full);
  expect(result.chats).toBe(30);
  expect(result.messages).toBe(30 * 20);
  expect(account.rooms.length).toBe(30);
});

test("history sync push names become the contacts' display names", async () => {
  let account = setup();

  // A conversation with only an OUTGOING message (so `nameFor` finds no push name),
  // plus a separate `pushnames` list — the contact must still be named from it, not
  // left as the bare JID. Bob has a push name but no conversation.
  let blob = encode(HistorySync, {
    syncType: HistorySyncType.Full,
    conversations: [{
      id: kAliceJID,
      messages: [
        { message: { key: { remoteJID: kAliceJID, fromMe: true, id: "m1" }, message: { conversation: "hi" }, messageTimestamp: 1700000000 } },
      ],
    }],
    pushnames: [
      { id: kAliceJID, pushname: "Alice Liddell" },
      { id: kBobJID, pushname: "Bob Builder" },
    ],
  });

  await account.historySync.importHistory(decodeHistorySync(blob), HistorySyncType.Full);

  let room = account.rooms.contents.find(r => r.id == kAliceJID)!;
  expect(room.contact.name).toBe("Alice Liddell"); // not the JID number
  expect(room.name).toBe("Alice Liddell");

  // A contact we create later (e.g. on Bob's first message) picks up the remembered name.
  expect(account.getContact(JID.parse(kBobJID)).name).toBe("Bob Builder");
});

test("history sync names a 1:1 from displayName, and a saved contact from inlineContacts", async () => {
  let account = setup();

  let blob = encode(HistorySync, {
    syncType: HistorySyncType.Full,
    conversations: [{
      id: kAliceJID,
      displayName: "Alice Display", // Conversation.displayName (field 38), the modern 1:1 name
      messages: [{ message: { key: { remoteJID: kAliceJID, fromMe: true, id: "m1" }, message: { conversation: "hi" }, messageTimestamp: 1700000000 } }],
    }],
    inlineContacts: [
      { pnJID: kBobJID, fullName: "Bob Saved", firstName: "Bob" }, // address-book name, no conversation
    ],
  });

  await account.historySync.importHistory(decodeHistorySync(blob), HistorySyncType.Full);

  let room = account.rooms.contents.find(r => r.id == kAliceJID)!;
  expect(room.contact.name).toBe("Alice Display"); // from Conversation.displayName (38)
  expect(account.getContact(JID.parse(kBobJID)).name).toBe("Bob Saved"); // from InlineContact.fullName
});

test("one unparseable message does not abort the rest of its conversation", async () => {
  let account = setup();

  // A conversation whose 2nd stored message has no `message` body (skipped) and a
  // good one before and after — both good ones must still import.
  let blob = encode(HistorySync, {
    syncType: HistorySyncType.Full,
    conversations: [{
      id: kAliceJID,
      messages: [
        { message: { key: { remoteJID: kAliceJID, fromMe: false, id: "ok1" }, message: { conversation: "before" }, messageTimestamp: 1700000000 } },
        { msgOrderID: 2 }, // no `message` — addHistoryMessage returns false, must not throw/abort
        { message: { key: { remoteJID: kAliceJID, fromMe: false, id: "ok2" }, message: { conversation: "after" }, messageTimestamp: 1700000200 } },
      ],
    }],
  });

  let result = await account.historySync.importHistory(decodeHistorySync(blob), HistorySyncType.Full);
  expect(result.chats).toBe(1);
  expect(result.messages).toBe(2); // both good ones
  let room = account.rooms.contents.find(r => r.id == kAliceJID)!;
  expect(room.messages.contents.find(m => m.text == "before")).toBeDefined();
  expect(room.messages.contents.find(m => m.text == "after")).toBeDefined();
});

test("a NO_HISTORY notification is a clean no-op (no download, no rooms, no throw)", async () => {
  let account = setup();
  // No connection is set, so any attempt to download would throw. A NO_HISTORY
  // notification must short-circuit before that and create nothing.
  await account.historySync.handleNotification({
    syncType: HistorySyncType.NoHistory,
    directPath: "/should-not-be-fetched",
  });
  expect(account.rooms.length).toBe(0);
});

test("on-demand request: PeerDataOperationRequestMessage round-trips on the wire", () => {
  // Encode then decode a full Message wrapping the on-demand request, to exercise
  // the real field numbers (ProtocolMessage.peerDataOperationRequestMessage=16,
  // PeerDataOperationRequestMessage{type=1, historySyncOnDemandRequest=4}, and the
  // HistorySyncOnDemandRequest fields 1..5).
  let original = {
    protocolMessage: {
      type: ProtocolMessageType.PeerDataOperationRequest,
      peerDataOperationRequestMessage: {
        peerDataOperationRequestType: PeerDataOperationRequestType.HistorySyncOnDemand,
        historySyncOnDemandRequest: {
          chatJID: kBobJID,
          oldestMsgID: "OLDEST123",
          oldestMsgFromMe: true,
          onDemandMsgCount: 50,
          oldestMsgTimestampSec: 1700000000,
        },
      },
    },
  };

  let decoded = decodeWAMessage(encode(Message, original));
  let pm = decoded.protocolMessage;
  expect(pm.type).toBe(16); // PEER_DATA_OPERATION_REQUEST_MESSAGE
  let request = pm.peerDataOperationRequestMessage;
  expect(request.peerDataOperationRequestType).toBe(3); // HISTORY_SYNC_ON_DEMAND
  let onDemand = request.historySyncOnDemandRequest;
  expect(onDemand.chatJID).toBe(kBobJID);
  expect(onDemand.oldestMsgID).toBe("OLDEST123");
  expect(onDemand.oldestMsgFromMe).toBe(true);
  expect(onDemand.onDemandMsgCount).toBe(kOnDemandPageSize);
  expect(onDemand.oldestMsgTimestampSec).toBe(1700000000); // seconds, despite the *MS name

  // The standalone sub-message also round-trips (field numbers isolated).
  let bare = decode(PeerDataOperationRequestMessage,
    encode(PeerDataOperationRequestMessage, original.protocolMessage.peerDataOperationRequestMessage));
  expect(bare.historySyncOnDemandRequest!.onDemandMsgCount).toBe(kOnDemandPageSize);
});

test("on-demand paging (on by default) requests the page before the oldest message", async () => {
  let account = setup();
  let room = await account.getOrCreateRoom(JID.parse(kAliceJID), "Alice");
  await room.addHistoryMessage({
    key: { remoteJID: kAliceJID, fromMe: false, id: "anchor" },
    message: { conversation: "anchor" },
    messageTimestamp: 1700000000,
  } as any);

  // Capture the peer request the paging issues, anchored on the oldest message.
  let sent: any = null;
  account.sendPeerMessage = async (payload: any) => { sent = payload; return "id"; };

  expect(account.historySync.pageOnDemand).toBe(true);
  await account.historySync.pageOlderMessages(room);

  let request = sent.protocolMessage.peerDataOperationRequestMessage.historySyncOnDemandRequest;
  expect(request.chatJID).toBe(room.id);
  expect(request.oldestMsgID).toBe("anchor");
  expect(request.onDemandMsgCount).toBe(kOnDemandPageSize);
});

test("history sync skips a message already in the room (e.g. from a backup import), by key id", async () => {
  let account = setup();
  let room = await account.getOrCreateRoom(JID.parse(kAliceJID), "Alice");
  // A backup import stores the bare WhatsApp key id, the same as live history sync.
  let imported = room.newMessage();
  imported.id = "KEYID123";
  imported.sent = new Date(1700000000 * 1000);
  imported.text = "hello";
  room.messages.add(imported);

  // The same message arriving via live history is recognized, not re-added.
  expect(await room.addHistoryMessage({
    key: { remoteJID: kAliceJID, fromMe: false, id: "KEYID123" },
    message: { conversation: "hello" }, messageTimestamp: 1700000000,
  } as any)).toBe(false);
  expect(room.messages.contents.length).toBe(1);

  // A genuinely different message (different key id) is still added.
  expect(await room.addHistoryMessage({
    key: { remoteJID: kAliceJID, fromMe: false, id: "KEYID456" },
    message: { conversation: "world" }, messageTimestamp: 1700000100,
  } as any)).toBe(true);
  expect(room.messages.contents.length).toBe(2);
});

test("history sync falls back to send time when an existing message has no key id", async () => {
  let account = setup();
  let room = await account.getOrCreateRoom(JID.parse(kAliceJID), "Alice");
  let existing = room.newMessage();
  existing.id = null as any; // an existing message we can't match by id
  existing.sent = new Date(1700000000 * 1000);
  room.messages.add(existing);

  expect(await room.addHistoryMessage({
    key: { remoteJID: kAliceJID, fromMe: false, id: "KEYID123" },
    message: { conversation: "hello" }, messageTimestamp: 1700000000, // same second
  } as any)).toBe(false);
  expect(room.messages.contents.length).toBe(1);
});
