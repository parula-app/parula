/** Signal Groups V2, fully in-process (no live server, no zk auth server):
 *
 * (a) Lizard encode↔decode round-trip (the inverse-Elligator + 8-candidate check).
 * (b) Field encryption: build GroupSecretParams, encrypt a `Group` state (members +
 *     title via the encrypt path), decrypt it back → members' ACIs + title recovered.
 * (c) Two accounts sharing a group master key: account A sends a group DataMessage
 *     (fanned out pairwise), account B receives it routed to the GROUP room (by
 *     masterKey→groupId), not the 1:1 sender room. Reuses the messaging.test.ts
 *     harness (stubbed transport). */
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { SignalAccount } from "../../../../logic/Chat/Signal/SignalAccount";
import { SignalGroupChatRoom } from "../../../../logic/Chat/Signal/SignalGroupChatRoom";
import { Signal1to1ChatRoom } from "../../../../logic/Chat/Signal/Signal1to1ChatRoom";
import { SignalChatMessage } from "../../../../logic/Chat/Signal/SignalChatMessage";
import { ServiceId } from "../../../../logic/Chat/Signal/ServiceId";
import { SignalStore } from "../../../../logic/Chat/Signal/Crypto/Store";
import { KyberKeyPair } from "../../../../logic/Chat/Signal/Encryption/kyber";
import { KyberPreKeyBundle, signKyberPreKey } from "../../../../logic/Chat/Signal/Encryption/pqxdh";
import { PreKeyBundle } from "../../../../logic/Chat/Signal/Crypto/Identity";
import { xeddsaSign } from "../../../../logic/Chat/Signal/Crypto/curve";
import { base64Encode, base64Decode, randomBytes } from "../../../../logic/Chat/Signal/Crypto/primitives";
import { Envelope } from "../../../../logic/Chat/Signal/Proto/signalService";
import { encode } from "../../../../logic/Chat/Signal/Proto/codec";
import { GroupSecretParams } from "../../../../logic/Chat/Signal/Encryption/ZKGroup/groupParams";
import { SignalGroup } from "../../../../logic/Chat/Signal/Groups/Group";
import { Group, GroupResponse, MemberRole } from "../../../../logic/Chat/Signal/Proto/groups";
import { lizardEncode } from "../../../../logic/Chat/Signal/Encryption/ZKGroup/ristretto";
import { lizardEncodeToPoint, lizardDecode } from "../../../../logic/Chat/Signal/Encryption/ZKGroup/ristretto";
import { decode } from "../../../../logic/Chat/Signal/Proto/codec";
import { DummyChatStorage } from "../../../../logic/Chat/SQL/DummyChatStorage";
import { Addressbook } from "../../../../logic/Contacts/Addressbook";
import { DummyAddressbookStorage } from "../../../../logic/Contacts/SQL/DummyAddressbookStorage";
import { Person } from "../../../../logic/Abstract/Person";
import { ChatMessage } from "../../../../logic/Chat/ChatMessage";
import { bytesToHex } from "@noble/curves/utils.js";
import { expect, test, beforeEach } from "vitest";

// --- (a) lizard round-trip ---

test("lizard encode↔decode round-trips for many random 16-byte values", () => {
  for (let i = 0; i < 300; i++) {
    let data = randomBytes(16);
    let point = lizardEncodeToPoint(data);
    let back = lizardDecode(point);
    expect(back).not.toBeNull();
    expect(bytesToHex(back!)).toBe(bytesToHex(data));
  }
});

test("lizard decode recovers the curve25519-dalek known-answer vectors", () => {
  // Same KATs as ristretto.test.ts, exercised through the point form.
  let vectors: Uint8Array[] = [
    new Uint8Array(16),
    new Uint8Array(16).fill(1),
    Uint8Array.from({ length: 16 }, (_, i) => i),
  ];
  for (let data of vectors) {
    let point = lizardEncodeToPoint(data);
    expect(lizardEncode(data).length).toBe(32);
    expect(bytesToHex(lizardDecode(point)!)).toBe(bytesToHex(data));
  }
});

// --- (b) Group state encrypt → decrypt ---

test("encrypt a Group state (members + title) and decrypt members' ACIs + title", () => {
  let masterKey = randomBytes(32);
  let params = GroupSecretParams.deriveFromMasterKey(masterKey);
  let signalGroup = new SignalGroup(masterKey);

  let alice = ServiceId.aci(randomBytes(16));
  let bob = ServiceId.aci(randomBytes(16));
  let aliceProfileKey = randomBytes(32);

  // Build an encrypted Group the way the server stores it (userId/profileKey enc).
  let group: Group = {
    publicKey: params.getPublicParams().serialize(),
    version: 3,
    title: signalGroup.encryptTitle("Weekend Trip 🏔️"),
    members: [
      {
        userId: signalGroup.encryptServiceId(alice),
        role: MemberRole.Administrator,
        profileKey: signalGroup.encryptProfileKey(aliceProfileKey, alice.uuid),
        joinedAtVersion: 0,
      },
      {
        userId: signalGroup.encryptServiceId(bob),
        role: MemberRole.Default,
        joinedAtVersion: 2,
      },
    ],
  };

  // Round-trip through the wire (GroupResponse) too.
  let wire = encode(GroupResponse, { group });
  let decoded = decode(GroupResponse, wire);
  let decrypted = signalGroup.decryptGroup(decoded.group!);

  expect(decrypted.title).toBe("Weekend Trip 🏔️");
  expect(decrypted.revision).toBe(3);
  let acis = (decrypted.members ?? []).map(m => bytesToHex(m.aciBytes!));
  expect(acis).toContain(bytesToHex(alice.uuid));
  expect(acis).toContain(bytesToHex(bob.uuid));

  let aliceMember = decrypted.members!.find(m => bytesToHex(m.aciBytes!) == bytesToHex(alice.uuid))!;
  expect(aliceMember.role).toBe(MemberRole.Administrator);
  expect(bytesToHex(aliceMember.profileKey!)).toBe(bytesToHex(aliceProfileKey));
});

// --- (c) end-to-end group message routing ---

/** Shared in-process delivery: every account registers by ACI; a `putMessages`
 * PUT to `destination` is wrapped in an Envelope and fed to that account. */
const network = new Map<string, TestSignalAccount>();

class TestSignalAccount extends SignalAccount {
  protected override async fetchPreKeyBundle(serviceId: ServiceId, deviceID: number) {
    void deviceID;
    let peer = network.get(serviceId.toString());
    if (!peer) {
      throw new Error("no such peer: " + serviceId);
    }
    return peer.publishBundle();
  }
  protected override async putMessages(serviceId: ServiceId, body: any) {
    let peer = network.get(serviceId.toString());
    if (!peer) {
      return; // recipient not in this test network
    }
    for (let msg of body.messages) {
      let envelope: Envelope = {
        type: msg.type,
        sourceServiceId: this.aci!.toString(),
        sourceDeviceId: this.deviceID,
        destinationServiceId: serviceId.toString(),
        content: base64Decode(msg.content),
        serverTimestamp: Date.now(),
        clientTimestamp: body.timestamp,
      };
      await peer.receiveEnvelope(envelope);
    }
  }
  async receiveEnvelope(envelope: Envelope): Promise<void> {
    await this.handleInboundRequest({ verb: "PUT", path: "/api/v1/message", body: encode(Envelope, envelope) });
  }
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
    return { bundle, kyberPreKey: new KyberPreKeyBundle(kyber.keyID, kyber.keyPair.publicKey, kyber.signature) };
  }
}

function newAccount(name: string): TestSignalAccount {
  let account = new TestSignalAccount();
  account.storage = new DummyChatStorage();
  account.aci = ServiceId.aci(randomBytes(16));
  account.servicePassword = base64Encode(randomBytes(18));
  account.realname = name;
  account.aciStore = SignalStore.createNew();
  let kyberKeyPair = KyberKeyPair.generate();
  account.kyberLastResort = {
    keyID: 1, keyPair: kyberKeyPair,
    signature: signKyberPreKey(account.aciStore.identityKeyPair.privateKey, kyberKeyPair.publicKey),
  };
  appGlobal.chatAccounts.add(account);
  network.set(account.aci.toString(), account);
  return account;
}

/** A group room on `account` for `masterKey`, with `members` as recipients (so the
 * sender fans out to them) — bypasses the gated server fetch. */
function groupRoom(account: TestSignalAccount, masterKey: Uint8Array, members: SignalAccount[]): SignalGroupChatRoom {
  let signalGroup = new SignalGroup(masterKey);
  let group = appGlobal.personalAddressbook.newGroup();
  group.name = "Test Group";
  let room = account.newRoom(true) as SignalGroupChatRoom;
  room.id = bytesToHex(signalGroup.groupId);
  room.contact = group;
  room.masterKey = masterKey;
  room.groupId = signalGroup.groupId;
  room.group = signalGroup;
  room.revision = 5;
  room.members.replaceAll(members.map(m => account.getContact(m.aci!)));
  (account.rooms as any).set(group, room);
  return room;
}

beforeEach(() => {
  network.clear();
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

test("group DataMessage from A is routed to the group room on B (not the 1:1 room)", async () => {
  let masterKey = randomBytes(32);
  let alice = newAccount("Alice");
  let bob = newAccount("Bob");
  let carol = newAccount("Carol");

  // Alice's group room fans out to Bob + Carol.
  let aliceRoom = groupRoom(alice, masterKey, [bob, carol]);
  let msg = aliceRoom.newMessage();
  msg.text = "hello group";
  await aliceRoom.sendMessage(msg);

  // Bob received it in the GROUP room (keyed by the derived group id), not a 1:1.
  let groupId = bytesToHex(new SignalGroup(masterKey).groupId);
  let bobGroupRoom = bob.rooms.contents.find(
    (r): r is SignalGroupChatRoom => r instanceof SignalGroupChatRoom && r.id == groupId)!;
  expect(bobGroupRoom).toBeTruthy();
  expect(textsIn(bobGroupRoom)).toContain("hello group");

  // The received message is incoming, attributed to Alice, in the group room.
  let received = bobGroupRoom.messages.contents.find(
    (m): m is SignalChatMessage => m instanceof SignalChatMessage && m.text == "hello group")!;
  expect(received.outgoing).toBe(false);
  expect((received.from as any)?.serviceId?.equals(alice.aci)).toBe(true);

  // There is NO 1:1 room from Bob to Alice carrying this message.
  let bob1to1 = bob.rooms.contents.find(
    (r): r is Signal1to1ChatRoom => r instanceof Signal1to1ChatRoom && r.id == alice.aci!.toString());
  expect(bob1to1 ? textsIn(bob1to1) : []).not.toContain("hello group");

  // Carol also received it in her group room.
  let carolGroupRoom = carol.rooms.contents.find(
    (r): r is SignalGroupChatRoom => r instanceof SignalGroupChatRoom && r.id == groupId)!;
  expect(carolGroupRoom).toBeTruthy();
  expect(textsIn(carolGroupRoom)).toContain("hello group");
});

test("in a group, only the author can edit or delete a message", async () => {
  let bob = newAccount("Bob");
  let alice = bob.getContact(ServiceId.aci(randomBytes(16)), "Alice");
  let mallory = bob.getContact(ServiceId.aci(randomBytes(16)), "Mallory");
  let room = groupRoom(bob, randomBytes(32), []);
  let groupV2 = room.groupContext();
  let alices = SignalChatMessage.processMessage(room, { dataMessage: { body: "lunch at 12", timestamp: 1000, groupV2 } }, alice, false)!;

  SignalChatMessage.processMessage(room, { editMessage: { targetSentTimestamp: 1000, dataMessage: { body: "lunch is cancelled", timestamp: 2000, groupV2 } } }, mallory, false);
  SignalChatMessage.processMessage(room, { dataMessage: { timestamp: 3000, groupV2, delete: { targetSentTimestamp: 1000 } } }, mallory, false);
  expect(alices.text).toBe("lunch at 12");
  expect(alices.edited).toBe(false);
  expect(alices.deleted).toBe(false);

  // A message of Mallory's with the same timestamp: her edit changes only hers
  let mallorys = SignalChatMessage.processMessage(room, { dataMessage: { body: "hi", timestamp: 1000, groupV2 } }, mallory, false)!;
  SignalChatMessage.processMessage(room, { editMessage: { targetSentTimestamp: 1000, dataMessage: { body: "hi all", timestamp: 4000, groupV2 } } }, mallory, false);
  expect(mallorys.text).toBe("hi all");
  expect(alices.text).toBe("lunch at 12");

  SignalChatMessage.processMessage(room, { editMessage: { targetSentTimestamp: 1000, dataMessage: { body: "lunch at 1", timestamp: 5000, groupV2 } } }, alice, false);
  SignalChatMessage.processMessage(room, { dataMessage: { timestamp: 6000, groupV2, delete: { targetSentTimestamp: 1000 } } }, alice, false);
  expect(alices.edited).toBe(true);
  expect(alices.deleted).toBe(true);
  expect(mallorys.deleted).toBe(false);
});

function textsIn(room: { messages: { contents: any[] } }): string[] {
  return room.messages.contents
    .filter((m): m is SignalChatMessage => m instanceof SignalChatMessage)
    .map(m => m.text);
}

// Touch ChatMessage so the import is used by the type guards above.
void ChatMessage;
