/** End-to-end 1:1 Signal messaging round-trip, fully in-process (no live server).
 *
 * Two SignalAccounts (Alice, Bob), each with its own SignalStore + Kyber
 * last-resort prekey. The transport is stubbed: instead of a real PUT, the
 * outgoing per-device ciphertext is wrapped in an Envelope and fed straight into
 * the other account's inbound handling. We assert a `Content{dataMessage}` arrives
 * decrypted in the peer's room, the ratchet advances over many back-and-forth
 * messages, and a reaction routes to the right message. This exercises the whole
 * combined stack: PQXDH establishment + the Double Ratchet + the SPQR triple
 * ratchet, the 0x80 Content padding, and the /v1/messages JSON shape. */
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { SignalAccount } from "../../../../logic/Chat/Signal/SignalAccount";
import { ServiceId } from "../../../../logic/Chat/Signal/ServiceId";
import { SignalStore } from "../../../../logic/Chat/Signal/Crypto/Store";
import { KyberKeyPair } from "../../../../logic/Chat/Signal/Encryption/kyber";
import { KyberPreKeyBundle, signKyberPreKey } from "../../../../logic/Chat/Signal/Encryption/pqxdh";
import { PreKeyBundle } from "../../../../logic/Chat/Signal/Crypto/Identity";
import { xeddsaSign } from "../../../../logic/Chat/Signal/Crypto/curve";
import { base64Encode, base64Decode, randomBytes } from "../../../../logic/Chat/Signal/Crypto/primitives";
import { Envelope, EnvelopeType, type Content } from "../../../../logic/Chat/Signal/Proto/signalService";
import { encode } from "../../../../logic/Chat/Signal/Proto/codec";
import { Signal1to1ChatRoom } from "../../../../logic/Chat/Signal/Signal1to1ChatRoom";
import { SignalChatMessage } from "../../../../logic/Chat/Signal/SignalChatMessage";
import { DummyChatStorage } from "../../../../logic/Chat/SQL/DummyChatStorage";
import { Addressbook } from "../../../../logic/Contacts/Addressbook";
import { DummyAddressbookStorage } from "../../../../logic/Contacts/SQL/DummyAddressbookStorage";
import { Person } from "../../../../logic/Abstract/Person";
import { ChatMessage } from "../../../../logic/Chat/ChatMessage";
import { expect, test, beforeEach } from "vitest";

/** A SignalAccount wired for in-process delivery: `fetchPreKeyBundle` reads the
 * peer's published bundle directly, and `putMessages` hands each per-device
 * ciphertext to the peer as an inbound Envelope. */
class TestSignalAccount extends SignalAccount {
  peer!: TestSignalAccount;
  /** Drop the leading 0x05 DJB byte from EC pubkeys → the 33-byte DJB the keys
   * endpoint publishes; the parser unframes it again. */
  protected override async fetchPreKeyBundle(serviceId: ServiceId, deviceID: number) {
    void serviceId; void deviceID;
    return this.peer.publishBundle();
  }
  protected override async putMessages(serviceId: ServiceId, body: any) {
    void serviceId;
    for (let msg of body.messages) {
      let envelope: Envelope = {
        type: msg.type,
        sourceServiceId: this.aci!.toString(),
        sourceDeviceId: this.deviceID,
        destinationServiceId: this.peer.aci!.toString(),
        content: base64Decode(msg.content),
        serverTimestamp: Date.now(),
        clientTimestamp: body.timestamp,
      };
      await this.peer.receiveEnvelope(envelope);
    }
  }
  /** Test seam: feed an Envelope as if the websocket delivered it. */
  async receiveEnvelope(envelope: Envelope): Promise<void> {
    await this.handleInboundRequest({ verb: "PUT", path: "/api/v1/message", body: encode(Envelope, envelope) });
  }
  /** Publish our prekey bundle the way the keys endpoint would (one-time prekey +
   * signed prekey + kyber last-resort prekey). */
  publishBundle(): { bundle: PreKeyBundle, kyberPreKey: KyberPreKeyBundle } {
    let store = this.aciStore!;
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
    let kyber = this.kyberLastResort!;
    let kyberPreKey = new KyberPreKeyBundle(kyber.keyID, kyber.keyPair.publicKey, kyber.signature);
    return { bundle, kyberPreKey };
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
    signature: signKyberPreKey(store.identityKeyPair.privateKey, kyberKeyPair.publicKey),
  };
  appGlobal.chatAccounts.add(account);
  return account;
}

/** Open (or reuse) the 1:1 room from `account` to `peer` and return it. */
async function roomTo(account: SignalAccount, peer: SignalAccount): Promise<Signal1to1ChatRoom> {
  return (await account.getOrCreateRoom(peer.aci!)) as Signal1to1ChatRoom;
}

/** The decrypted message text in `account`'s room with `peer`. */
function textsIn(room: Signal1to1ChatRoom): string[] {
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

test("Alice → Bob: first message establishes the session and arrives decrypted", async () => {
  let alice = newAccount("Alice");
  let bob = newAccount("Bob");
  alice.peer = bob;
  bob.peer = alice;

  let aliceRoom = await roomTo(alice, bob);
  await aliceRoom.sendMessage(messageWith(aliceRoom, "hi bob"));

  // Bob auto-created a room for Alice and stored the decrypted message.
  let bobRoom = (await bob.getOrCreateRoom(alice.aci!)) as Signal1to1ChatRoom;
  expect(textsIn(bobRoom)).toContain("hi bob");
  let received = bobRoom.messages.contents.find(
    (m): m is SignalChatMessage => m instanceof SignalChatMessage && m.text == "hi bob")!;
  expect(received.outgoing).toBe(false);
});

test("bidirectional conversation: many messages back and forth advance the ratchet", async () => {
  let alice = newAccount("Alice");
  let bob = newAccount("Bob");
  alice.peer = bob;
  bob.peer = alice;
  let aliceRoom = await roomTo(alice, bob);

  await aliceRoom.sendMessage(messageWith(aliceRoom, "hello")); // pkmsg: establishes Bob's session
  let bobRoom = (await bob.getOrCreateRoom(alice.aci!)) as Signal1to1ChatRoom;
  await bobRoom.sendMessage(messageWith(bobRoom, "hi back")); // confirms the session

  for (let i = 0; i < 6; i++) {
    await aliceRoom.sendMessage(messageWith(aliceRoom, `a${i}`));
    await bobRoom.sendMessage(messageWith(bobRoom, `b${i}`));
  }

  // Every message decrypted on the other side, in order.
  let bobGot = textsIn(bobRoom).filter(t => t.startsWith("a") || t == "hello");
  let aliceGot = textsIn(aliceRoom).filter(t => t.startsWith("b") || t == "hi back");
  expect(bobGot).toEqual(["hello", "a0", "a1", "a2", "a3", "a4", "a5"]);
  expect(aliceGot).toEqual(["hi back", "b0", "b1", "b2", "b3", "b4", "b5"]);
});

test("a reaction routes to the right message", async () => {
  let alice = newAccount("Alice");
  let bob = newAccount("Bob");
  alice.peer = bob;
  bob.peer = alice;
  let aliceRoom = await roomTo(alice, bob);

  let m = messageWith(aliceRoom, "react to me");
  await aliceRoom.sendMessage(m); // Alice → Bob
  let bobRoom = (await bob.getOrCreateRoom(alice.aci!)) as Signal1to1ChatRoom;
  await bobRoom.sendMessage(messageWith(bobRoom, "ok")); // confirm session both ways

  let target = bobRoom.messages.contents.find(
    (x): x is SignalChatMessage => x instanceof SignalChatMessage && x.text == "react to me")!;
  expect(target).toBeTruthy();

  // Bob reacts to Alice's message; Alice should see the reaction on her sent message.
  await target.setMyReaction("👍");

  let aliceMsg = aliceRoom.messages.contents.find(
    (x): x is SignalChatMessage => x instanceof SignalChatMessage && x.text == "react to me")!;
  let reactors = [...aliceMsg.reactions.values()];
  expect(reactors).toContain("👍");
});

test("sessions resume after a config save/restore (restart)", async () => {
  let alice = newAccount("Alice");
  let bob = newAccount("Bob");
  alice.peer = bob;
  bob.peer = alice;
  let aliceRoom = await roomTo(alice, bob);

  await aliceRoom.sendMessage(messageWith(aliceRoom, "before restart"));
  let bobRoom = (await bob.getOrCreateRoom(alice.aci!)) as Signal1to1ChatRoom;
  await bobRoom.sendMessage(messageWith(bobRoom, "ack")); // session confirmed both ways

  // Persist + restore Bob the way the account config does.
  let restored = new TestSignalAccount();
  restored.storage = new DummyChatStorage();
  restored.fromConfigJSON(JSON.parse(JSON.stringify(bob.toConfigJSON())));
  restored.peer = alice;
  alice.peer = restored;

  // Alice's next message decrypts on the restored Bob — no re-establishment.
  await aliceRoom.sendMessage(messageWith(aliceRoom, "after restart"));
  let restoredRoom = (await restored.getOrCreateRoom(alice.aci!)) as Signal1to1ChatRoom;
  expect(textsIn(restoredRoom)).toContain("after restart");
});

/** Build an unsent outgoing message in a room. */
function messageWith(room: Signal1to1ChatRoom, text: string): ChatMessage {
  let msg = room.newMessage();
  msg.text = text;
  return msg;
}
