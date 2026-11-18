// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { WhatsAppAccount } from "../../../../logic/Chat/WhatsApp/WhatsAppAccount";
import { JID } from "../../../../logic/Chat/WhatsApp/Binary/JID";
import { WANode } from "../../../../logic/Chat/WhatsApp/Binary/WANode";
import { SignalStore } from "../../../../logic/Chat/Signal/Crypto/Store";
import { decryptPreKeyMessage, decryptSignalMessage } from "../../../../logic/Chat/Signal/Crypto/SessionCipher";
import { processDistributionMessage, groupDecrypt } from "../../../../logic/Chat/Signal/Crypto/GroupCipher";
import { decodeWAMessage } from "../../../../logic/Chat/WhatsApp/Proto/schema";
import { bigEndian } from "../../../../logic/Chat/WhatsApp/util";
import { DummyChatStorage } from "../../../../logic/Chat/SQL/DummyChatStorage";
import { Addressbook } from "../../../../logic/Contacts/Addressbook";
import { DummyAddressbookStorage } from "../../../../logic/Contacts/SQL/DummyAddressbookStorage";
import { Person } from "../../../../logic/Abstract/Person";
import { expect, test } from "vitest";

const kSelfJID = "491700000000:5@s.whatsapp.net"; // our device (device 5)
const kSelfLID = "99887766@lid";                   // our LID
const kGroupJID = "120363041234567890@g.us";
const kDeviceIdentity = new Uint8Array([0x0a, 0x03, 0x01, 0x02, 0x03]);

/** A fake connection answering the w:g2 metadata, usync device-list, and encrypt
 * prekey IQs, plus recording sent stanzas. Modelled on send.test.ts. */
class FakeConnection {
  sent: WANode[] = [];
  deviceStores = new Map<string, SignalStore>();
  deviceList = new Map<string, number[]>();
  /** The `<participant jid>`s the w:g2 response returns. */
  participants: string[] = [];
  addressingMode = "lid";

  async sendNode(node: WANode): Promise<void> {
    this.sent.push(node);
  }

  async sendIQ(node: WANode): Promise<WANode> {
    let xmlns = node.attrs.xmlns;
    if (xmlns == "w:g2") {
      return this.groupResponse();
    }
    if (xmlns == "usync") {
      return this.usyncResponse(node);
    }
    if (xmlns == "encrypt" && node.attrs.type == "get") {
      return this.preKeyResponse(node);
    }
    return new WANode("iq", { type: "result" });
  }

  protected groupResponse(): WANode {
    let participantNodes = this.participants.map(jid => new WANode("participant", { jid }));
    return new WANode("iq", { type: "result" }, [
      new WANode("group", { id: "120363041234567890", subject: "Test Group", addressing_mode: this.addressingMode },
        participantNodes),
    ]);
  }

  protected usyncResponse(iq: WANode): WANode {
    let queried = iq.child("usync")?.child("list")?.children("user") ?? [];
    let users: WANode[] = [];
    for (let user of queried) {
      let base = JID.parse(user.attrs.jid).toNonDevice();
      let ids = this.deviceList.get(base.user) ?? [0];
      let deviceNodes = ids.map(id => new WANode("device", { id: String(id) }));
      users.push(new WANode("user", { jid: base.toString() }, [
        new WANode("devices", {}, [new WANode("device-list", {}, deviceNodes)]),
      ]));
    }
    return new WANode("iq", { type: "result" }, [new WANode("usync", {},
      [new WANode("result", {}, [new WANode("devices", {}, [new WANode("list", {}, users)])])])]);
  }

  protected preKeyResponse(iq: WANode): WANode {
    let queried = iq.child("key")?.children("user") ?? [];
    let users: WANode[] = [];
    for (let user of queried) {
      let jid = JID.parse(user.attrs.jid);
      let store = this.deviceStores.get(jid.toString())
        ?? this.deviceStores.get(`${jid.user}:${jid.device}@${jid.server}`);
      if (!store) {
        continue;
      }
      users.push(bundleUserNode(user.attrs.jid, store));
    }
    return new WANode("iq", { type: "result" }, [new WANode("list", {}, users)]);
  }
}

function bundleUserNode(jid: string, store: SignalStore): WANode {
  let signed = store.signedPreKeys.get(1)!;
  let preKey = store.preKeys.values().next().value!;
  return new WANode("user", { jid }, [
    new WANode("registration", {}, bigEndian(store.registrationID, 4)),
    new WANode("identity", {}, store.identityKeyPair.publicKey),
    new WANode("skey", {}, [
      new WANode("id", {}, bigEndian(signed.keyID, 3)),
      new WANode("value", {}, signed.keyPair.publicKey),
      new WANode("signature", {}, signed.signature),
    ]),
    new WANode("key", {}, [
      new WANode("id", {}, bigEndian(preKey.keyID, 3)),
      new WANode("value", {}, preKey.keyPair.publicKey),
    ]),
  ]);
}

function makeAccount(connection: FakeConnection): WhatsAppAccount {
  appGlobal.addressbooks.clear();
  appGlobal.chatAccounts.clear();
  let addressbook = new Addressbook();
  addressbook.storage = new DummyAddressbookStorage();
  appGlobal.addressbooks.add(addressbook);
  appGlobal.personalAddressbook = addressbook;
  appGlobal.me = new Person();
  appGlobal.me.name = "Me";

  let account = new WhatsAppAccount();
  account.storage = new DummyChatStorage();
  account.deviceJID = JID.parse(kSelfJID);
  account.ownLID = JID.parse(kSelfLID);
  account.deviceIdentityBytes = kDeviceIdentity;
  account.signalStore = SignalStore.createNew();
  account.connection = connection as any;
  appGlobal.chatAccounts.add(account);
  return account;
}

/** Recovers a recipient device's SKDM (the Message proto with the sender key). */
async function decryptSKDM(stanza: WANode, deviceJID: string, store: SignalStore, ourAddress: string): Promise<any> {
  let want = JID.parse(deviceJID).toString();
  let to = stanza.child("participants")!.children("to").find(n => JID.parse(n.attrs.jid).toString() == want)!;
  let enc = to.child("enc")!;
  let bytes = enc.contentBytes!;
  let plaintext = enc.attrs.type == "pkmsg"
    ? await decryptPreKeyMessage(store, ourAddress, bytes)
    : await decryptSignalMessage(store, ourAddress, bytes);
  return decodeWAMessage(plaintext);
}

test("group send: builds addressing_mode + phash + per-device SKDM + skmsg, device-identity on pkmsg", async () => {
  let connection = new FakeConnection();
  let account = makeAccount(connection);
  let bob = SignalStore.createNew();
  connection.participants = ["99887766@lid", "55667788@lid"]; // us + Bob, LID-addressed
  connection.deviceList.set("99887766", [0, 5]); // our LID: phone(0) + this device(5)
  connection.deviceList.set("55667788", [0]);    // Bob: one device
  connection.deviceStores.set("55667788:0@lid", bob);
  let ownPhone = SignalStore.createNew();
  connection.deviceStores.set("99887766:0@lid", ownPhone);

  await account.getOrCreateRoom(JID.parse(kGroupJID)); // the group room holds the metadata the send reads
  let id = await account.sender.sendGroupMessage(JID.parse(kGroupJID), { conversation: "hello group" });
  expect(id.startsWith("3EB0")).toBe(true);
  let stanza = connection.sent.at(-1)!;
  expect(stanza.tag).toBe("message");
  expect(stanza.attrs.to).toBe(kGroupJID);
  expect(stanza.attrs.addressing_mode).toBe("lid");
  expect(stanza.attrs.phash).toMatch(/^2:/);
  expect(stanza.attrs.type).toBe("text");

  // Per-device SKDM fan-out, but NOT to our own sending device (:5).
  let tos = stanza.child("participants")!.children("to").map(t => t.attrs.jid);
  expect(tos).toContain("55667788@lid");   // Bob (device 0, bare)
  expect(tos).toContain("99887766@lid");   // our phone, via our LID
  expect(tos).not.toContain("99887766:5@lid"); // never to ourselves
  expect(tos.every(jid => jid.endsWith("@lid"))).toBe(true);

  // The group ciphertext.
  let skmsg = stanza.child("enc")!;
  expect(skmsg.attrs.type).toBe("skmsg");
  expect(skmsg.contentBytes!.length).toBeGreaterThan(0);

  // A pkmsg SKDM means our paired device-identity is attached.
  let anyPreKey = stanza.child("participants")!.children("to")
    .some(t => t.child("enc")!.attrs.type == "pkmsg");
  expect(anyPreKey).toBe(true);
  expect(stanza.child("device-identity")?.contentBytes).toEqual(kDeviceIdentity);
});

test("group send round-trip: a recipient processes the SKDM and decrypts the skmsg", async () => {
  let connection = new FakeConnection();
  let account = makeAccount(connection);
  let bob = SignalStore.createNew();
  connection.participants = ["99887766@lid", "55667788@lid"];
  connection.deviceList.set("99887766", [5]);  // only our own sending device (skipped)
  connection.deviceList.set("55667788", [0]);
  connection.deviceStores.set("55667788:0@lid", bob);
  let ourAddress = `${JID.parse(kSelfLID).user}.${JID.parse(kSelfJID).device}`; // 99887766.5

  await account.getOrCreateRoom(JID.parse(kGroupJID));
  await account.sender.sendGroupMessage(JID.parse(kGroupJID), { conversation: "secret group text" });
  let stanza = connection.sent.at(-1)!;

  // Bob recovers the SKDM, builds the sender-key state, then decrypts the skmsg.
  let skdm = await decryptSKDM(stanza, "55667788:0@lid", bob, ourAddress);
  expect(skdm.senderKeyDistributionMessage?.groupID).toBe(kGroupJID);
  let senderState = processDistributionMessage(skdm.senderKeyDistributionMessage!.axolotlSenderKeyDistributionMessage!);
  let skmsg = stanza.child("enc")!.contentBytes!;
  let recovered = decodeWAMessage(await groupDecrypt(senderState, skmsg));
  expect(recovered.conversation).toBe("secret group text");
});

test("group send: our own state is stored so our other devices and a restart can decrypt", async () => {
  let connection = new FakeConnection();
  let account = makeAccount(connection);
  let bob = SignalStore.createNew();
  connection.participants = ["99887766@lid", "55667788@lid"];
  connection.deviceList.set("99887766", [5]);
  connection.deviceList.set("55667788", [0]);
  connection.deviceStores.set("55667788:0@lid", bob);

  await account.getOrCreateRoom(JID.parse(kGroupJID));
  await account.sender.sendGroupMessage(JID.parse(kGroupJID), { conversation: "first" });
  let storeKey = `${kGroupJID}|99887766.5`; // group | ownLID.user . our device index
  expect(account.signalStore!.senderKeys.has(storeKey)).toBe(true);
  let stateAfterFirst = account.signalStore!.senderKeys.get(storeKey)!;
  let keyID = stateAfterFirst.keyID;

  // A second send reuses the SAME sender-key chain (advances it, doesn't mint a new id).
  await account.sender.sendGroupMessage(JID.parse(kGroupJID), { conversation: "second" });
  expect(account.signalStore!.senderKeys.get(storeKey)!.keyID).toBe(keyID);
});

test("group send: a retry receipt re-sends to a member, but not to somebody outside the group", async () => {
  let connection = new FakeConnection();
  let account = makeAccount(connection);
  connection.participants = ["99887766@lid", "55667788@lid"];
  connection.deviceList.set("99887766", [5]);
  connection.deviceList.set("55667788", [0]);
  connection.deviceStores.set("55667788:0@lid", SignalStore.createNew());
  let ourAddress = `${JID.parse(kSelfLID).user}.${JID.parse(kSelfJID).device}`;
  await account.getOrCreateRoom(JID.parse(kGroupJID));
  let messageID = await account.sender.sendGroupMessage(JID.parse(kGroupJID), { conversation: "members only" });

  let mallory = SignalStore.createNew();
  await (account as any).onReceipt(new WANode("receipt", { id: messageID, type: "retry", from: kGroupJID, participant: "11223344@lid" },
    [new WANode("keys", {}, bundleUserNode("11223344@lid", mallory).children())]));
  expect(connection.sent.filter(n => n.tag == "message").length).toBe(1); // only the original send

  let bobReplacement = SignalStore.createNew();
  await (account as any).onReceipt(new WANode("receipt", { id: messageID, type: "retry", from: kGroupJID, participant: "55667788@lid" },
    [new WANode("keys", {}, bundleUserNode("55667788@lid", bobReplacement).children())]));
  let resent = connection.sent.filter(n => n.tag == "message").at(-1)!;
  expect(resent.attrs.id).toBe(messageID);
  expect((await decryptSKDM(resent, "55667788@lid", bobReplacement, ourAddress)).conversation).toBe("members only");
});
