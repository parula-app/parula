// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { WhatsAppAccount } from "../../../../logic/Chat/WhatsApp/WhatsAppAccount";
import { JID } from "../../../../logic/Chat/WhatsApp/Binary/JID";
import { DummyChatStorage } from "../../../../logic/Chat/SQL/DummyChatStorage";
import { Addressbook } from "../../../../logic/Contacts/Addressbook";
import { DummyAddressbookStorage } from "../../../../logic/Contacts/SQL/DummyAddressbookStorage";
import { ContactEntry, Person } from "../../../../logic/Abstract/Person";
import { ChatPersonUID } from "../../../../logic/Chat/ChatPersonUID";
import { WhatsAppContact } from "../../../../logic/Chat/WhatsApp/WhatsAppContact";
import { Group } from "../../../../logic/Abstract/Group";
import { encode } from "../../../../logic/Chat/Signal/Proto/codec";
import { HistorySync, HistorySyncType, ProtocolMessageType, decodeHistorySync, encodeWAMessage, decodeWAMessage, type WAMessage } from "../../../../logic/Chat/WhatsApp/Proto/schema";
import { WANode } from "../../../../logic/Chat/WhatsApp/Binary/WANode";
import { SignalStore } from "../../../../logic/Chat/Signal/Crypto/Store";
import { createSenderKey, createDistributionMessage, groupEncrypt } from "../../../../logic/Chat/Signal/Crypto/GroupCipher";
import { initiateSession, encrypt } from "../../../../logic/Chat/Signal/Crypto/SessionCipher";
import { PreKeyBundle } from "../../../../logic/Chat/Signal/Crypto/Identity";
import { IdentityChange } from "../../../../logic/Chat/RoomEvent";
import { expect, test } from "vitest";

/** A prekey bundle from a store, to establish a session to it (test helper). */
function bundleFrom(store: SignalStore): PreKeyBundle {
  let signed = store.signedPreKeys.get(1)!;
  let oneTime = [...store.preKeys.values()][0];
  let bundle = new PreKeyBundle();
  bundle.registrationID = store.registrationID;
  bundle.identityKey = store.identityKeyPair.publicKey;
  bundle.signedPreKeyID = signed.keyID;
  bundle.signedPreKeyPublic = signed.keyPair.publicKey;
  bundle.signedPreKeySignature = signed.signature;
  bundle.preKeyID = oneTime.keyID;
  bundle.preKeyPublic = oneTime.keyPair.publicKey;
  return bundle;
}

const kAliceJID = "491761111111@s.whatsapp.net";
const kBobJID = "491762222222@s.whatsapp.net";
const kGroupJID = "12345-67890@g.us";
/** Another device of our own account (see `setup()`) */
const kOwnPhoneJID = "412300000000:0@s.whatsapp.net";
const kMalloryJID = "491769999999@s.whatsapp.net";

/** A WhatsApp account with an empty personal address book, both backed by no-op
 * storage so we exercise only the in-memory room/contact creation. */
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

test("auto-creates a 1:1 room and contact on the first message, reusing them after", async () => {
  let account = setup();

  let room = await account.getOrCreateRoom(JID.parse(kAliceJID), "Alice Liveexample");
  expect(account.rooms.length).toBe(1);
  expect(room.id).toBe(kAliceJID);
  expect(room.contact).toBeInstanceOf(ChatPersonUID);
  expect(room.contact.name).toBe("Alice Liveexample"); // taken from the stanza's push name
  let contact = room.contact as WhatsAppContact;
  expect(contact.chatID).toBe(kAliceJID);
  expect(contact.protocol).toBe("whatsapp");
  expect(account.roster.includes(contact)).toBe(true);
  // The chat contact is not auto-added to the address book; linking is UI-driven.
  expect(appGlobal.personalAddressbook.persons.length).toBe(0);

  // A later message — even from a specific device JID — reuses the same room.
  let again = await account.getOrCreateRoom(JID.parse("491761111111:7@s.whatsapp.net"), "Alice Liveexample");
  expect(again).toBe(room);
  expect(account.rooms.length).toBe(1);
  expect(appGlobal.personalAddressbook.persons.length).toBe(0);
});

test("auto-creates a group room on the first group message", async () => {
  let account = setup();

  let room = await account.getOrCreateRoom(JID.parse(kGroupJID));
  expect(account.rooms.length).toBe(1);
  expect(room.id).toBe(kGroupJID);
  expect(room.contact).toBeInstanceOf(Group);
});

test("links to an existing contact matched by WhatsApp ID, without duplicating it", async () => {
  let account = setup();
  let existing = appGlobal.personalAddressbook.newPerson();
  existing.name = "Alice Imported";
  existing.chatAccounts.add(new ContactEntry(kAliceJID, "WhatsApp", "whatsapp"));
  appGlobal.personalAddressbook.persons.add(existing);

  let room = await account.getOrCreateRoom(JID.parse(kAliceJID), "Alice Push");

  let contact = room.contact as ChatPersonUID;
  expect(contact).toBeInstanceOf(ChatPersonUID);
  expect(contact.findPerson()).toBe(existing); // linked to the existing contact
  expect(appGlobal.personalAddressbook.persons.length).toBe(1); // not duplicated
});

test("history sync builds the chat list and back-fills old messages", async () => {
  let account = setup();

  // A HistorySync blob as the phone would send it: a 1:1 and a group, each with
  // stored messages. Encode then decode it, to exercise the real wire format.
  let blob = encode(HistorySync, {
    syncType: 2, // FULL
    conversations: [
      {
        id: kAliceJID,
        messages: [
          { message: { key: { remoteJID: kAliceJID, fromMe: false, id: "A1" }, message: { conversation: "Hello from Alice" }, messageTimestamp: 1700000000, pushName: "Alice History" } },
          { message: { key: { remoteJID: kAliceJID, fromMe: true, id: "A2" }, message: { conversation: "Hi back" }, messageTimestamp: 1700000100 } },
        ],
      },
      {
        id: kGroupJID,
        name: "Weekend Trip",
        messages: [
          { message: { key: { remoteJID: kGroupJID, fromMe: false, id: "G1", participant: kBobJID }, message: { conversation: "Group hi" }, messageTimestamp: 1700000200, pushName: "Bob" } },
        ],
      },
      {
        // A LID-keyed 1:1 (modern privacy accounts) — must still import.
        id: "111222333444@lid",
        messages: [
          { message: { key: { remoteJID: "111222333444@lid", fromMe: false, id: "L1" }, message: { conversation: "Hi over lid" }, messageTimestamp: 1700000300, pushName: "Lid Contact" } },
        ],
      },
    ],
  });

  let result = await account.historySync.importHistory(decodeHistorySync(blob));
  expect(result.chats).toBe(3);
  expect(result.messages).toBe(4);
  expect(account.rooms.length).toBe(3);
  let lidRoom = account.rooms.contents.find(room => room.id == "111222333444@lid")!;
  expect(lidRoom).toBeDefined();
  expect(lidRoom.messages.contents.find(msg => msg.text == "Hi over lid")).toBeDefined();

  let aliceRoom = account.rooms.contents.find(room => room.id == kAliceJID)!;
  expect(aliceRoom).toBeDefined();
  expect(aliceRoom.contact.name).toBe("Alice History"); // from the message push name
  expect(aliceRoom.messages.length).toBe(2);
  let hello = aliceRoom.messages.contents.find(msg => msg.text == "Hello from Alice")!;
  expect(hello.outgoing).toBe(false);
  expect(hello.contact.name).toBe("Alice History"); // attributed to the partner
  // Our own message is outgoing and attributed to the account-owner chat contact
  // keyed by our JID, not appGlobal.me — so it persists.
  let hiBack = aliceRoom.messages.contents.find(msg => msg.text == "Hi back")!;
  expect(hiBack.outgoing).toBe(true);
  expect(hiBack.contact).not.toBe(appGlobal.me);
  expect((hiBack.contact as ChatPersonUID).chatID).toBe("412300000000@s.whatsapp.net");
  expect(aliceRoom.lastMessage.text).toBe("Hi back"); // the newest

  let groupRoom = account.rooms.contents.find(room => room.id == kGroupJID)!;
  expect(groupRoom).toBeDefined();
  expect(groupRoom.contact).toBeInstanceOf(Group);
  expect(groupRoom.name).toBe("Weekend Trip");
  expect(groupRoom.messages.contents.find(msg => msg.text == "Group hi")).toBeDefined();
});

test("a live message we sent from another device is outgoing, attributed to us", async () => {
  let account = setup();
  let room = await account.getOrCreateRoom(JID.parse(kAliceJID), "Alice");

  // As delivered by receiveMessageStanza for an outgoing (deviceSent / own-JID) message.
  let stanza = new WANode("message", { id: "OUT1", t: "1700000500" });
  await room.receiveMessage(stanza, { conversation: "Sent from my phone" } as any, JID.parse(kAliceJID), true);

  let msg = room.messages.contents.find(m => m.text == "Sent from my phone")!;
  expect(msg).toBeDefined();
  expect(msg.outgoing).toBe(true);
  expect(msg.contact).not.toBe(appGlobal.me); // the owner chat contact, not appGlobal.me
  expect((msg.contact as ChatPersonUID).chatID).toBe("412300000000@s.whatsapp.net");
});

/** Lets the account receive a `<message>` stanza `from` that JID, which decrypts to `payload`. */
async function receive(account: WhatsAppAccount, from: string, id: string, payload: WAMessage): Promise<void> {
  (account as any).decryptStanza = async () => encodeWAMessage(payload);
  await (account as any).receiveMessageStanza(new WANode("message", { from, id, t: "1700000500" }));
}

test("a copy of a message we sent counts only from our own devices", async () => {
  let account = setup();

  await receive(account, kMalloryJID, "DSM1", { deviceSentMessage: { destinationJID: kBobJID, message: { conversation: "Fake from me" } } });
  await receive(account, kOwnPhoneJID, "DSM2", { deviceSentMessage: { destinationJID: kBobJID, message: { conversation: "Really from me" } } });

  let messages = account.rooms.contents.flatMap(room => room.messages.contents);
  expect(messages.find(msg => msg.text == "Fake from me")).toBeUndefined();
  let real = messages.find(msg => msg.text == "Really from me")!;
  expect(real.outgoing).toBe(true);
  expect(account.rooms.contents.find(room => room.id == kBobJID)!.messages.contents).toContain(real);
});

test("app-state sync keys are taken only from our own devices", async () => {
  let account = setup();
  let keyShare = (keyID: number) => ({
    protocolMessage: {
      type: ProtocolMessageType.AppStateSyncKeyShare,
      appStateSyncKeyShare: { keys: [{ keyID: { keyID: new Uint8Array([keyID]) }, keyData: { keyData: new Uint8Array(32).fill(keyID) } }] },
    },
  });

  await receive(account, kMalloryJID, "KS1", keyShare(1));
  expect(account.appState.keys.size).toBe(0);

  await receive(account, kOwnPhoneJID, "KS2", keyShare(2));
  expect(account.appState.keys.size).toBe(1);
});

test("a history sync is imported only from our own devices", async () => {
  let account = setup();
  let notified: any[] = [];
  account.historySync.handleNotification = async notification => {
    notified.push(notification);
  };
  let historySync = (directPath: string) => ({
    protocolMessage: {
      type: ProtocolMessageType.HistorySyncNotification,
      historySyncNotification: { syncType: HistorySyncType.Full, directPath, mediaKey: new Uint8Array(32) },
    },
  });

  await receive(account, kMalloryJID, "HS1", historySync("/fake"));
  await receive(account, kOwnPhoneJID, "HS2", historySync("/real"));

  expect(notified.map(notification => notification.directPath)).toEqual(["/real"]);
});

test("after login it uploads prekeys and switches the connection to active", async () => {
  let account = setup();
  account.signalStore = SignalStore.createNew();
  let sentIQs: WANode[] = [];
  account.connection = {
    async sendIQ(node: WANode) {
      sentIQs.push(node);
      return new WANode("iq", { type: "result" });
    },
    async sendNode() {},
  } as any;

  await (account as any).afterLogin();
  (account as any).stopKeepAlive(); // don't leak the interval into other tests

  // The encrypt IQ publishes our identity, signed prekey and one-time prekeys —
  // without this the phone can't establish a session to send us history/messages.
  let upload = sentIQs.find(node => node.attrs.xmlns == "encrypt")!;
  expect(upload).toBeDefined();
  expect(upload.attrs.type).toBe("set");
  expect(upload.child("registration")!.contentBytes!.length).toBe(4);
  expect([...upload.child("identity")!.contentBytes!]).toEqual([...account.signalStore.identityKeyPair.publicKey]);
  expect(upload.child("list")!.children("key").length).toBe(account.signalStore.preKeys.size);
  let skey = upload.child("skey")!;
  expect([...skey.child("value")!.contentBytes!]).toEqual([...account.signalStore.signedPreKeys.get(1)!.keyPair.publicKey]);
  expect(skey.child("signature")!.contentBytes!.length).toBe(64);
  expect(skey.child("id")!.contentBytes!.length).toBe(3);

  // The <active> IQ is what actually starts the inbound stream (offline + history).
  let active = sentIQs.find(node => node.attrs.xmlns == "passive")!;
  expect(active).toBeDefined();
  expect(active.attrs.type).toBe("set");
  expect(active.child("active")).toBeDefined();
});

test("stores a group sender key from an incoming SenderKeyDistributionMessage", async () => {
  let account = setup();
  account.signalStore = SignalStore.createNew();

  // A real distribution message, as a group member would send it to us.
  let distribution = createDistributionMessage(createSenderKey(7));
  let payload = {
    senderKeyDistributionMessage: { groupID: kGroupJID, axolotlSenderKeyDistributionMessage: distribution },
  };
  let sender = JID.parse(kBobJID);

  (account as any).processSenderKeyDistribution(payload, sender);

  let stored = account.signalStore.senderKeys.get(`${kGroupJID}|${sender.user}.${sender.device}`)!;
  expect(stored).toBeDefined();
  expect(stored.keyID).toBe(7);
});

test("decrypts a group message's skmsg content, not just the rides-along sender key", async () => {
  let account = setup();
  account.signalStore = SignalStore.createNew();
  let group = JID.parse(kGroupJID);
  let bob = JID.parse(kBobJID);

  // Bob (a group member) opens a 1:1 session to us so he can ship the SKDM as a
  // pairwise pkmsg; the actual message rides separately in the skmsg.
  let bobStore = SignalStore.createNew();
  initiateSession(bobStore, "us", bundleFrom(account.signalStore));
  let bobSenderKey = createSenderKey(42);
  let skdm = encodeWAMessage({
    senderKeyDistributionMessage: {
      groupID: kGroupJID,
      axolotlSenderKeyDistributionMessage: createDistributionMessage(bobSenderKey),
    },
  });
  let pairwise = await encrypt(bobStore, "us", skdm);
  let skmsg = await groupEncrypt(bobSenderKey, encodeWAMessage({ conversation: "hello group" }));

  // The server delivers the SKDM enc and the skmsg enc in one <message>.
  let node = new WANode("message", { from: kGroupJID, participant: kBobJID, id: "ABC", type: "text" }, [
    new WANode("enc", { v: "2", type: pairwise.type }, pairwise.body),
    new WANode("enc", { v: "2", type: "skmsg" }, skmsg),
  ]);

  let content = await (account as any).decryptStanza(node, group, bob);
  expect(content).not.toBeNull();
  // The returned plaintext is the skmsg CONTENT — not the SKDM-only pairwise payload,
  // which is the bug that made group rooms stay empty.
  expect(decodeWAMessage(content!).conversation).toBe("hello group");
  // ...and the rides-along sender key was stored on the way through.
  expect(account.signalStore.senderKeys.has(`${kGroupJID}|${bob.user}.${bob.device}`)).toBe(true);
});

test("a contact's new identity key shows a notice in the chat, the first key doesn't", async () => {
  let account = setup();
  account.signalStore = SignalStore.createNew();
  account.connection = {
    async sendIQ() {
      return new WANode("iq", { type: "result" });
    },
    async sendNode() {},
  } as any;
  await (account as any).afterLogin();
  (account as any).stopKeepAlive();

  let bob = SignalStore.createNew();
  initiateSession(bob, "us", bundleFrom(account.signalStore));
  await receiveFromBob(account, bob, "M1", "hello");
  let room = await account.getOrCreateRoom(JID.parse(kBobJID));
  expect(room.messages.contents.filter(msg => msg instanceof IdentityChange)).toHaveLength(0);

  // Bob reinstalled WhatsApp, or the server put in its own keys
  let newBob = SignalStore.createNew();
  initiateSession(newBob, "us", bundleFrom(account.signalStore));
  await receiveFromBob(account, newBob, "M2", "new phone");

  expect(room.messages.contents.map(msg => msg.text)).toContain("new phone"); // not blocked
  expect(room.messages.contents.filter(msg => msg instanceof IdentityChange)).toHaveLength(1);
});

/** Delivers a 1:1 message from Bob's phone, encrypted with his `store`. */
async function receiveFromBob(account: WhatsAppAccount, store: SignalStore, id: string, text: string): Promise<void> {
  let enc = await encrypt(store, "us", encodeWAMessage({ conversation: text }));
  await (account as any).receiveMessageStanza(new WANode("message", { from: kBobJID, id, type: "text", t: "1700000000" }, [
    new WANode("enc", { v: "2", type: enc.type }, enc.body),
  ]));
}
