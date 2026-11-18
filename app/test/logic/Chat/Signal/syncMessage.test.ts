/** SyncMessage.Sent transcript routing (a message the user sent from their phone,
 * mirrored to this linked device). The decrypt path is exercised elsewhere
 * (messaging.test.ts); here we feed a decrypted `Content{syncMessage}` straight
 * into `handleEnvelope` (via a decrypt seam) and assert that:
 *   - a Sent transcript to a 1:1 peer creates/updates THAT peer's room with an
 *     OUTGOING message (from our own contact), not a room for ourselves;
 *   - a Sent transcript with a groupV2 context routes to the group room;
 *   - a SyncMessage.Read marks our matching sent message as Seen;
 *   - a SyncMessage from another account is ignored.
 * This is the gap that previously dropped the transcript because Content.syncMessage
 * was an unparsed `bytes` placeholder. */
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { SignalAccount } from "../../../../logic/Chat/Signal/SignalAccount";
import { ServiceId } from "../../../../logic/Chat/Signal/ServiceId";
import { SignalStore } from "../../../../logic/Chat/Signal/Crypto/Store";
import { KyberKeyPair } from "../../../../logic/Chat/Signal/Encryption/kyber";
import { xeddsaSign } from "../../../../logic/Chat/Signal/Crypto/curve";
import { base64Encode, randomBytes } from "../../../../logic/Chat/Signal/Crypto/primitives";
import { Envelope, EnvelopeType, type Content, type DataMessage } from "../../../../logic/Chat/Signal/Proto/signalService";
import { Signal1to1ChatRoom } from "../../../../logic/Chat/Signal/Signal1to1ChatRoom";
import { SignalGroupChatRoom } from "../../../../logic/Chat/Signal/SignalGroupChatRoom";
import { SignalChatMessage } from "../../../../logic/Chat/Signal/SignalChatMessage";
import { SignalGroup } from "../../../../logic/Chat/Signal/Groups/Group";
import { DeliveryStatus } from "../../../../logic/Chat/ChatMessage";
import { DummyChatStorage } from "../../../../logic/Chat/SQL/DummyChatStorage";
import { Addressbook } from "../../../../logic/Contacts/Addressbook";
import { DummyAddressbookStorage } from "../../../../logic/Contacts/SQL/DummyAddressbookStorage";
import { Person } from "../../../../logic/Abstract/Person";
import { expect, test, beforeEach } from "vitest";

/** A SignalAccount whose decrypt step is a seam: `receiveSync` injects a decrypted
 * `Content` straight into the real `handleEnvelope` routing (no crypto needed). */
class TestSignalAccount extends SignalAccount {
  protected nextContent: Content | null = null;
  protected nextSender: ServiceId | null = null;
  protected override async decryptEnvelope(_envelope: Envelope): Promise<{ content: Content, sender: ServiceId, deviceID: number } | null> {
    let content = this.nextContent;
    this.nextContent = null;
    return content ? { content, sender: this.nextSender!, deviceID: 2 } : null;
  }
  /** Feed a decrypted Content as if the websocket delivered + decrypted it.
   * A sync is from our own account, unless the test passes another `sender`. */
  async receiveSync(content: Content, sender = this.aci!): Promise<void> {
    this.nextContent = content;
    this.nextSender = sender;
    let envelope: Envelope = {
      type: EnvelopeType.UnidentifiedSender,
      sourceServiceId: sender.toString(),
      sourceDeviceId: 2,
      content: new Uint8Array([1]), // non-empty so decrypt is invoked
      serverTimestamp: Date.now(),
    };
    await this.handleEnvelope(envelope);
  }
}

function newAccount(name: string): TestSignalAccount {
  let account = new TestSignalAccount();
  account.storage = new DummyChatStorage();
  account.aci = ServiceId.aci(randomBytes(16));
  account.servicePassword = base64Encode(randomBytes(18));
  account.realname = name;
  let store = SignalStore.createNew();
  account.aciStore = store;
  let kyberKeyPair = KyberKeyPair.generate();
  account.kyberLastResort = {
    keyID: 1, keyPair: kyberKeyPair,
    signature: xeddsaSign(store.identityKeyPair.privateKey, kyberKeyPair.publicKey),
  };
  appGlobal.chatAccounts.add(account);
  return account;
}

function textsIn(room: { messages: { contents: any[] } }): string[] {
  return room.messages.contents
    .filter((m): m is SignalChatMessage => m instanceof SignalChatMessage)
    .map(m => m.text);
}

beforeEach(() => {
  appGlobal.addressbooks.clear();
  appGlobal.chatAccounts.clear();
  let addressbook = new Addressbook();
  addressbook.name = "Personal";
  addressbook.storage = new DummyAddressbookStorage();
  appGlobal.addressbooks.add(addressbook);
  appGlobal.personalAddressbook = addressbook;
  appGlobal.me = new Person();
  appGlobal.me.name = "Me";
});

test("SyncMessage.Sent (1:1): creates the destination room with an OUTGOING message", async () => {
  let me = newAccount("Me");
  let peer = ServiceId.aci(randomBytes(16));
  let ts = Date.now();

  let data: DataMessage = { body: "sent from my phone", timestamp: ts };
  await me.receiveSync({ syncMessage: { sent: { destinationServiceId: peer.toString(), timestamp: ts, message: data } } });

  let room = (await me.getOrCreateRoom(peer)) as Signal1to1ChatRoom;
  expect(textsIn(room)).toContain("sent from my phone");
  let msg = room.messages.contents.find(
    (m): m is SignalChatMessage => m instanceof SignalChatMessage && m.text == "sent from my phone")!;
  expect(msg.outgoing).toBe(true);
  expect(msg.from).toBe(me.getOwnContact());
  // The room is the PEER's room, not a room keyed on our own ACI.
  expect(room.id).toBe(peer.toString());
});

test("SyncMessage.Sent with destinationServiceIdBinary routes to the same peer room", async () => {
  let me = newAccount("Me");
  let peer = ServiceId.aci(randomBytes(16));
  let ts = Date.now();

  await me.receiveSync({ syncMessage: { sent: {
    destinationServiceIdBinary: peer.serviceIdBinary(), timestamp: ts,
    message: { body: "binary dest", timestamp: ts },
  } } });

  let room = (await me.getOrCreateRoom(peer)) as Signal1to1ChatRoom;
  expect(textsIn(room)).toContain("binary dest");
});

test("SyncMessage.Sent (group): routes to the group room as outgoing", async () => {
  let me = newAccount("Me");
  let masterKey = randomBytes(32);
  let ts = Date.now();

  await me.receiveSync({ syncMessage: { sent: {
    timestamp: ts,
    message: { body: "group sent from phone", timestamp: ts, groupV2: { masterKey } },
  } } });

  let groupRoom = await me.getOrCreateGroupRoom(masterKey);
  expect(groupRoom).toBeInstanceOf(SignalGroupChatRoom);
  let msg = groupRoom.messages.contents.find(
    (m): m is SignalChatMessage => m instanceof SignalChatMessage && m.text == "group sent from phone")!;
  expect(msg).toBeTruthy();
  expect(msg.outgoing).toBe(true);
});

test("SyncMessage.Read marks our sent message as Seen", async () => {
  let me = newAccount("Me");
  let peer = ServiceId.aci(randomBytes(16));
  let ts = Date.now();

  // First mirror a sent message, then a read of it.
  await me.receiveSync({ syncMessage: { sent: { destinationServiceId: peer.toString(), timestamp: ts, message: { body: "hi", timestamp: ts } } } });
  let room = (await me.getOrCreateRoom(peer)) as Signal1to1ChatRoom;
  let msg = room.messages.contents.find(
    (m): m is SignalChatMessage => m instanceof SignalChatMessage && m.text == "hi")!;
  expect(msg.deliveryStatus).not.toBe(DeliveryStatus.Seen);

  await me.receiveSync({ syncMessage: { read: [{ senderAci: peer.toString(), timestamp: ts }] } });
  expect(msg.deliveryStatus).toBe(DeliveryStatus.Seen);
});

test("A SyncMessage from another account is ignored", async () => {
  let me = newAccount("Me");
  let peer = ServiceId.aci(randomBytes(16));
  let ts = Date.now();

  await me.receiveSync({ syncMessage: { sent: { destinationServiceId: peer.toString(), timestamp: ts, message: { body: "hi", timestamp: ts } } } });
  let room = (await me.getOrCreateRoom(peer)) as Signal1to1ChatRoom;
  let msg = room.messages.contents.find(
    (m): m is SignalChatMessage => m instanceof SignalChatMessage && m.text == "hi")!;

  // The peer claims that we sent them another message, and that they read ours.
  await me.receiveSync({ syncMessage: { sent: { destinationServiceId: peer.toString(), timestamp: ts + 1, message: { body: "not from me", timestamp: ts + 1 } } } }, peer);
  await me.receiveSync({ syncMessage: { read: [{ senderAci: peer.toString(), timestamp: ts }] } }, peer);
  expect(textsIn(room)).toContain("hi");
  expect(textsIn(room)).not.toContain("not from me");
  expect(msg.deliveryStatus).not.toBe(DeliveryStatus.Seen);
});
