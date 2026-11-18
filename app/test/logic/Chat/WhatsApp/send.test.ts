// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { WhatsAppAccount } from "../../../../logic/Chat/WhatsApp/WhatsAppAccount";
import { WhatsAppSender } from "../../../../logic/Chat/WhatsApp/WhatsAppSend";
import { JID, kServerUser } from "../../../../logic/Chat/WhatsApp/Binary/JID";
import { WANode } from "../../../../logic/Chat/WhatsApp/Binary/WANode";
import { SignalStore } from "../../../../logic/Chat/Signal/Crypto/Store";
import { PreKeyBundle } from "../../../../logic/Chat/Signal/Crypto/Identity";
import {
  initiateSession, encrypt, decryptPreKeyMessage, decryptSignalMessage, type EncryptedSignalMessage,
} from "../../../../logic/Chat/Signal/Crypto/SessionCipher";
import { decodeWAMessage, ProtocolMessageType } from "../../../../logic/Chat/WhatsApp/Proto/schema";
import { bigEndian } from "../../../../logic/Chat/WhatsApp/util";
import { DummyChatStorage } from "../../../../logic/Chat/SQL/DummyChatStorage";
import { Addressbook } from "../../../../logic/Contacts/Addressbook";
import { DummyAddressbookStorage } from "../../../../logic/Contacts/SQL/DummyAddressbookStorage";
import { Person } from "../../../../logic/Abstract/Person";
import { expect, test } from "vitest";

const str = (b: Uint8Array) => new TextDecoder().decode(b);

/** Encrypts a reply on a recipient store (so we can feed it back to confirm our
 * session, the way a real reply from the peer would). */
function encryptOn(store: SignalStore, address: string, text: string): Promise<EncryptedSignalMessage> {
  return encrypt(store, address, new TextEncoder().encode(text));
}

const kSelfJID = "491700000000:5@s.whatsapp.net"; // our device (device 5)
const kBobJID = "491762222222@s.whatsapp.net";
const kSelfLID = "99887766@lid"; // our hidden-user (LID) identity
const kBobLID = "55667788@lid"; // a recipient addressed by LID
const kMalloryJID = "491769999999@s.whatsapp.net"; // somebody we didn't send to
/** Stand-in for the account-signed ADVSignedDeviceIdentity captured at pairing;
 * a pkmsg send attaches it (its bytes are opaque to the sender path under test). */
const kDeviceIdentity = new Uint8Array([0x0a, 0x03, 0x01, 0x02, 0x03]);

/** A fake connection that answers the usync (device list) and encrypt (prekey
 * bundle) IQs from a set of recipient stores, and records every stanza we send. */
class FakeConnection {
  sent: WANode[] = [];
  /** device JID string (with device) -> the store standing in for that device. */
  deviceStores = new Map<string, SignalStore>();
  /** Devices the usync should report per base user, e.g. "49176..." -> [0, 3]. */
  deviceList = new Map<string, number[]>();
  /** Devices whose prekey fetch should return an error (server out of keys). */
  errorDevices = new Set<string>();
  /** Devices that should be served a bundle WITHOUT a one-time prekey. */
  noOneTimeDevices = new Set<string>();

  async sendNode(node: WANode): Promise<void> {
    this.sent.push(node);
  }

  async sendIQ(node: WANode): Promise<WANode> {
    let xmlns = node.attrs.xmlns;
    if (xmlns == "usync") {
      return this.usyncResponse(node);
    }
    if (xmlns == "encrypt" && node.attrs.type == "get") {
      return this.preKeyResponse(node);
    }
    return new WANode("iq", { type: "result" });
  }

  nextIQID(): string {
    return "iq-1";
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
    // The real server nests the list as <usync><result><devices><list>.
    return new WANode("iq", { type: "result" }, [new WANode("usync", {},
      [new WANode("result", {}, [new WANode("devices", {}, [new WANode("list", {}, users)])])])]);
  }

  protected preKeyResponse(iq: WANode): WANode {
    let queried = iq.child("key")?.children("user") ?? [];
    let users: WANode[] = [];
    for (let user of queried) {
      let jid = JID.parse(user.attrs.jid);
      let key = `${jid.user}.${jid.device}`;
      if (this.errorDevices.has(key)) {
        users.push(new WANode("user", { jid: user.attrs.jid, type: "error" }, [new WANode("error", { code: "404" })]));
        continue;
      }
      let store = this.deviceStores.get(jid.toString()) ?? this.deviceStores.get(`${jid.user}:${jid.device}@${jid.server}`);
      if (!store) {
        continue;
      }
      users.push(bundleUserNode(user.attrs.jid, store, !this.noOneTimeDevices.has(key)));
    }
    return new WANode("iq", { type: "result" }, [new WANode("list", {}, users)]);
  }
}

/** Encodes a store's published bundle as the server's `<user>` reply node, the
 * exact shape WhatsAppSender.parsePreKeyBundles reads. */
function bundleUserNode(jid: string, store: SignalStore, withOneTime: boolean): WANode {
  let signed = store.signedPreKeys.get(1)!;
  let children: WANode[] = [
    new WANode("registration", {}, bigEndian(store.registrationID, 4)),
    new WANode("identity", {}, store.identityKeyPair.publicKey),
    new WANode("skey", {}, [
      new WANode("id", {}, bigEndian(signed.keyID, 3)),
      new WANode("value", {}, signed.keyPair.publicKey),
      new WANode("signature", {}, signed.signature),
    ]),
  ];
  if (withOneTime) {
    let preKey = store.preKeys.values().next().value!;
    children.push(new WANode("key", {}, [
      new WANode("id", {}, bigEndian(preKey.keyID, 3)),
      new WANode("value", {}, preKey.keyPair.publicKey),
    ]));
  }
  return new WANode("user", { jid }, children);
}

/** An account wired with our Signal store and a fake connection, ready to send. */
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
  account.deviceIdentityBytes = kDeviceIdentity; // a real pkmsg send requires our paired device-identity
  account.signalStore = SignalStore.createNew();
  account.connection = connection as any;
  appGlobal.chatAccounts.add(account);
  return account;
}

/** Pulls the first device's enc body out of a sent `<message>`, decrypting it on
 * a recipient store to recover the plaintext Message protobuf. */
async function decryptSentTo(stanza: WANode, deviceJID: string, store: SignalStore, ourAddress: string): Promise<any> {
  let want = JID.parse(deviceJID).toString();
  let to = stanza.child("participants")!.children("to").find(node => JID.parse(node.attrs.jid).toString() == want)!;
  let enc = to.child("enc")!;
  let bytes = enc.contentBytes!;
  let plaintext = enc.attrs.type == "pkmsg"
    ? await decryptPreKeyMessage(store, ourAddress, bytes)
    : await decryptSignalMessage(store, ourAddress, bytes);
  return decodeWAMessage(plaintext);
}

// --- prekey-bundle parse ---

test("parses a prekey-bundle response, with and without a one-time prekey", () => {
  let account = makeAccount(new FakeConnection());
  let bob = SignalStore.createNew();
  let withKey = bundleUserNode("491762222222:0@s.whatsapp.net", bob, true);
  let withoutKey = bundleUserNode("491762222222:3@s.whatsapp.net", bob, false);
  let response = new WANode("iq", {}, [new WANode("list", {}, [withKey, withoutKey])]);

  let bundles = account.sender.parsePreKeyBundles(response);
  let b0 = bundles.get("491762222222.0")!;
  expect(b0).toBeDefined();
  expect(b0.registrationID).toBe(bob.registrationID);
  expect([...b0.identityKey]).toEqual([...bob.identityKeyPair.publicKey]);
  expect([...b0.signedPreKeyPublic]).toEqual([...bob.signedPreKeys.get(1)!.keyPair.publicKey]);
  expect(b0.preKeyPublic).toBeDefined(); // one-time present
  let b3 = bundles.get("491762222222.3")!;
  expect(b3.preKeyPublic).toBeUndefined(); // one-time absent — server out of keys
});

test("maps a server prekey error (out of that user's keys) to no bundle", () => {
  let account = makeAccount(new FakeConnection());
  let errored = new WANode("user", { jid: "491762222222:0@s.whatsapp.net", type: "error" },
    [new WANode("error", { code: "404" })]);
  let response = new WANode("iq", {}, [new WANode("list", {}, [errored])]);
  expect(account.sender.parsePreKeyBundles(response).get("491762222222.0")).toBeUndefined();
});

test("parses a usync device-list response into one JID per device", () => {
  let account = makeAccount(new FakeConnection());
  let response = new WANode("iq", {}, [new WANode("usync", {}, [new WANode("list", {}, [
    new WANode("user", { jid: kBobJID }, [new WANode("devices", {}, [new WANode("device-list", {}, [
      new WANode("device", { id: "0" }), new WANode("device", { id: "3" }),
    ])])]),
  ])])]);
  let devices = account.sender.parseDeviceList(response);
  expect(devices.map(d => d.toString())).toEqual(["491762222222@s.whatsapp.net", "491762222222:3@s.whatsapp.net"]);
});

// --- the X3DH-initiator round trip ---

test("new contact: first message is a pkmsg the recipient decrypts, follow-up is a msg", async () => {
  let connection = new FakeConnection();
  let account = makeAccount(connection);
  let bob = SignalStore.createNew();
  connection.deviceList.set("491762222222", [0]); // Bob has one device
  connection.deviceStores.set("491762222222:0@s.whatsapp.net", bob);

  let id1 = await account.sender.sendText(JID.parse(kBobJID), "hello bob");
  expect(id1.startsWith("3EB0")).toBe(true);
  let stanza1 = connection.sent.at(-1)!;
  expect(stanza1.tag).toBe("message");
  expect(stanza1.attrs.to).toBe(kBobJID);
  // A pkmsg (new session) carries our paired device-identity so the recipient can trust it.
  expect(stanza1.child("device-identity")?.contentBytes).toEqual(kDeviceIdentity);
  let to = stanza1.child("participants")!.child("to")!;
  expect(to.attrs.jid).toBe(kBobJID); // device 0 is addressed without a `:0` suffix
  expect(to.child("enc")!.attrs.type).toBe("pkmsg"); // brand-new session
  expect(to.child("enc")!.attrs.v).toBe("2");

  let ourAddress = `${JID.parse(kSelfJID).user}.${JID.parse(kSelfJID).device}`;
  let msg1 = await decryptSentTo(stanza1, "491762222222:0@s.whatsapp.net", bob, ourAddress);
  expect(msg1.conversation).toBe("hello bob");

  // A second message reuses the session and is still a pkmsg until Bob replies.
  let id2 = await account.sender.sendText(JID.parse(kBobJID), "second");
  expect(id2).not.toBe(id1);
  let stanza2 = connection.sent.at(-1)!;
  let enc2 = stanza2.child("participants")!.child("to")!.child("enc")!;
  expect(enc2.attrs.type).toBe("pkmsg");
  expect(decodeWAMessage(await decryptPreKeyMessage(bob, ourAddress, enc2.contentBytes!)).conversation).toBe("second");
});

test("delete-for-everyone sends a REVOKE tagged edit=7 referencing the original", async () => {
  let connection = new FakeConnection();
  let account = makeAccount(connection);
  let bob = SignalStore.createNew();
  connection.deviceList.set("491762222222", [0]);
  connection.deviceStores.set("491762222222:0@s.whatsapp.net", bob);

  await account.sender.sendMessage(JID.parse(kBobJID), {
    protocolMessage: {
      key: { remoteJID: kBobJID, fromMe: true, id: "3EB0ORIGINAL" },
      type: ProtocolMessageType.Revoke,
    },
  });
  let stanza = connection.sent.at(-1)!;
  // The `edit` attribute is what makes WhatsApp delete the original (sender revoke);
  // without it the peer and our own devices silently ignore the revoke.
  expect(stanza.attrs.edit).toBe("7");

  let ourAddress = `${JID.parse(kSelfJID).user}.${JID.parse(kSelfJID).device}`;
  let msg = await decryptSentTo(stanza, "491762222222:0@s.whatsapp.net", bob, ourAddress);
  expect(msg.protocolMessage.key.id).toBe("3EB0ORIGINAL"); // targets the original message
});

test("once the recipient replies, our next message is a plain msg (session confirmed)", async () => {
  let connection = new FakeConnection();
  let account = makeAccount(connection);
  let bob = SignalStore.createNew();
  connection.deviceList.set("491762222222", [0]);
  connection.deviceStores.set("491762222222:0@s.whatsapp.net", bob);
  let ourAddress = `${JID.parse(kSelfJID).user}.${JID.parse(kSelfJID).device}`;

  // We send, Bob decrypts (establishing his side), Bob replies, we decrypt it.
  await account.sender.sendText(JID.parse(kBobJID), "hi");
  await decryptSentTo(connection.sent.at(-1)!, "491762222222:0@s.whatsapp.net", bob, ourAddress);
  let reply = await encryptOn(bob, ourAddress, "from bob");
  await decryptSignalMessage(account.signalStore!, "491762222222.0", reply.body); // confirms our session

  // Now our follow-up must be a plain `msg`.
  await account.sender.sendText(JID.parse(kBobJID), "after reply");
  let enc2 = connection.sent.at(-1)!.child("participants")!.child("to")!.child("enc")!;
  expect(enc2.attrs.type).toBe("msg");
  expect(decodeWAMessage(await decryptSignalMessage(bob, ourAddress, enc2.contentBytes!)).conversation).toBe("after reply");
});

// --- edge: server prekeys exhausted ---

test("recipient's server prekeys exhausted: still establishes (no one-time key) and sends", async () => {
  let connection = new FakeConnection();
  let account = makeAccount(connection);
  let bob = SignalStore.createNew();
  connection.deviceList.set("491762222222", [0]);
  connection.deviceStores.set("491762222222:0@s.whatsapp.net", bob);
  connection.noOneTimeDevices.add("491762222222.0"); // server hands back no one-time prekey

  let ourAddress = `${JID.parse(kSelfJID).user}.${JID.parse(kSelfJID).device}`;
  await account.sender.sendText(JID.parse(kBobJID), "no one-time prekey");
  let stanza = connection.sent.at(-1)!;
  let enc = stanza.child("participants")!.child("to")!.child("enc")!;
  expect(enc.attrs.type).toBe("pkmsg");
  // Bob decrypts via a pkmsg whose inner X3DH omitted the one-time prekey.
  expect(decodeWAMessage(await decryptPreKeyMessage(bob, ourAddress, enc.contentBytes!)).conversation)
    .toBe("no one-time prekey");
});

// --- edge: multi-device fan-out ---

test("multi-device: encrypts once per recipient device, both decrypt", async () => {
  let connection = new FakeConnection();
  let account = makeAccount(connection);
  let bobPhone = SignalStore.createNew();
  let bobLaptop = SignalStore.createNew();
  connection.deviceList.set("491762222222", [0, 3]); // two devices
  connection.deviceStores.set("491762222222:0@s.whatsapp.net", bobPhone);
  connection.deviceStores.set("491762222222:3@s.whatsapp.net", bobLaptop);
  let ourAddress = `${JID.parse(kSelfJID).user}.${JID.parse(kSelfJID).device}`;

  await account.sender.sendText(JID.parse(kBobJID), "to all devices");
  let stanza = connection.sent.at(-1)!;
  let tos = stanza.child("participants")!.children("to");
  expect(tos.length).toBe(2);
  expect(tos.map(t => t.attrs.jid).sort()).toEqual(
    ["491762222222:3@s.whatsapp.net", "491762222222@s.whatsapp.net"]); // device 0 bare
  // Each device's own store decrypts its own enc to the same plaintext.
  expect((await decryptSentTo(stanza, "491762222222:0@s.whatsapp.net", bobPhone, ourAddress)).conversation).toBe("to all devices");
  expect((await decryptSentTo(stanza, "491762222222:3@s.whatsapp.net", bobLaptop, ourAddress)).conversation).toBe("to all devices");
});

test("multi-device: a device the server has no keys for is skipped, the rest still get it", async () => {
  let connection = new FakeConnection();
  let account = makeAccount(connection);
  let bobPhone = SignalStore.createNew();
  connection.deviceList.set("491762222222", [0, 3]);
  connection.deviceStores.set("491762222222:0@s.whatsapp.net", bobPhone);
  connection.errorDevices.add("491762222222.3"); // no keys for device 3
  let ourAddress = `${JID.parse(kSelfJID).user}.${JID.parse(kSelfJID).device}`;

  await account.sender.sendText(JID.parse(kBobJID), "partial");
  let stanza = connection.sent.at(-1)!;
  let tos = stanza.child("participants")!.children("to");
  expect(tos.map(t => t.attrs.jid)).toEqual([kBobJID]); // device 3 dropped, device 0 bare
  expect((await decryptSentTo(stanza, "491762222222:0@s.whatsapp.net", bobPhone, ourAddress)).conversation).toBe("partial");
});

test("our own other devices receive a deviceSentMessage; the sending device is skipped", async () => {
  let connection = new FakeConnection();
  let account = makeAccount(connection);
  let bob = SignalStore.createNew();
  let ownOther = SignalStore.createNew(); // our phone (device 0)
  connection.deviceList.set("491762222222", [0]);
  connection.deviceList.set("491700000000", [0, 5]); // our own devices: phone(0) + this(5)
  connection.deviceStores.set("491762222222:0@s.whatsapp.net", bob);
  connection.deviceStores.set("491700000000:0@s.whatsapp.net", ownOther);
  let ourAddress = `${JID.parse(kSelfJID).user}.${JID.parse(kSelfJID).device}`;

  await account.sender.sendText(JID.parse(kBobJID), "sync me");
  let stanza = connection.sent.at(-1)!;
  let jids = stanza.child("participants")!.children("to").map(t => t.attrs.jid);
  expect(jids).toContain(kBobJID); // Bob (device 0, bare)
  expect(jids).toContain("491700000000@s.whatsapp.net"); // our phone (device 0, bare)
  expect(jids).not.toContain(kSelfJID); // never to ourselves (device 5)

  // Bob gets the plain message; our phone gets it wrapped as deviceSentMessage.
  let toBob = await decryptSentTo(stanza, "491762222222:0@s.whatsapp.net", bob, ourAddress);
  expect(toBob.conversation).toBe("sync me");
  let toPhone = await decryptSentTo(stanza, "491700000000:0@s.whatsapp.net", ownOther, ourAddress);
  expect(toPhone.deviceSentMessage?.destinationJID).toBe(kBobJID);
  expect(toPhone.deviceSentMessage?.message?.conversation).toBe("sync me");
});

test("a LID-addressed chat uses our LID for our own devices, never mixing in our phone number", async () => {
  // Sending to a @lid recipient must address the WHOLE message in the LID
  // namespace, including our own other devices via our LID. Mixing a phone-number
  // participant into a LID-addressed message makes the server reject it with
  // <ack error="400"> — the live "sending does nothing" failure.
  let connection = new FakeConnection();
  let account = makeAccount(connection);
  account.ownLID = JID.parse(kSelfLID); // our hidden-user identity; our device index stays :5
  let bob = SignalStore.createNew();
  let ownPhone = SignalStore.createNew();
  connection.deviceList.set("55667788", [0]);    // recipient LID: one device
  connection.deviceList.set("99887766", [0, 5]); // our LID: phone(0) + this device(5)
  connection.deviceStores.set("55667788:0@lid", bob);
  connection.deviceStores.set("99887766:0@lid", ownPhone);
  let ourAddress = `${JID.parse(kSelfLID).user}.${JID.parse(kSelfJID).device}`; // 99887766.5

  await account.sender.sendText(JID.parse(kBobLID), "hi over lid");
  let stanza = connection.sent.at(-1)!;
  expect(stanza.attrs.to).toBe(kBobLID);
  let jids = stanza.child("participants")!.children("to").map(t => t.attrs.jid);
  expect(jids).toContain(kBobLID);            // recipient (device 0, bare)
  expect(jids).toContain("99887766@lid");     // our phone, via our LID (device 0, bare)
  expect(jids).not.toContain("99887766:5@lid"); // never to ourselves (our device :5)
  // The crux of the 400 fix: every participant is LID-addressed, none by phone number.
  expect(jids.every(jid => jid.endsWith("@lid"))).toBe(true);

  let toBob = await decryptSentTo(stanza, "55667788:0@lid", bob, ourAddress);
  expect(toBob.conversation).toBe("hi over lid");
  let toPhone = await decryptSentTo(stanza, "99887766:0@lid", ownPhone, ourAddress);
  expect(toPhone.deviceSentMessage?.destinationJID).toBe(kBobLID);
  expect(toPhone.deviceSentMessage?.message?.conversation).toBe("hi over lid");
});

// --- edge: existing session reuse ---

test("an existing session is reused: no new prekey fetch, message is a plain msg", async () => {
  let connection = new FakeConnection();
  let account = makeAccount(connection);
  let bob = SignalStore.createNew();
  connection.deviceList.set("491762222222", [0]);
  connection.deviceList.set("491700000000", [5]); // our only own device is this one (skipped)
  connection.deviceStores.set("491762222222:0@s.whatsapp.net", bob);
  let ourAddress = `${JID.parse(kSelfJID).user}.${JID.parse(kSelfJID).device}`;

  // First send establishes; Bob decrypts and replies so the session is confirmed.
  await account.sender.sendText(JID.parse(kBobJID), "one");
  await decryptSentTo(connection.sent.at(-1)!, "491762222222:0@s.whatsapp.net", bob, ourAddress);
  let reply = await encryptOn(bob, ourAddress, "ack");
  await decryptSignalMessage(account.signalStore!, "491762222222.0", reply.body);

  // Count prekey fetches on the next send: there should be none (session reused).
  let prekeyFetches = 0;
  let origSendIQ = connection.sendIQ.bind(connection);
  connection.sendIQ = async (node: WANode) => {
    if (node.attrs.xmlns == "encrypt" && node.attrs.type == "get") {
      prekeyFetches++;
    }
    return origSendIQ(node);
  };
  await account.sender.sendText(JID.parse(kBobJID), "two");
  expect(prekeyFetches).toBe(0);
  let enc2 = connection.sent.at(-1)!.child("participants")!.child("to")!.child("enc")!;
  expect(enc2.attrs.type).toBe("msg");
  expect(decodeWAMessage(await decryptSignalMessage(bob, ourAddress, enc2.contentBytes!)).conversation).toBe("two");
});

// --- edge: incoming retry receipt re-sends ---

test("an incoming retry receipt re-encrypts and re-sends to the failing device", async () => {
  let connection = new FakeConnection();
  let account = makeAccount(connection);
  let bob = SignalStore.createNew();
  connection.deviceList.set("491762222222", [0]);
  connection.deviceStores.set("491762222222:0@s.whatsapp.net", bob);
  let ourAddress = `${JID.parse(kSelfJID).user}.${JID.parse(kSelfJID).device}`;

  let messageID = await account.sender.sendText(JID.parse(kBobJID), "retry me");
  let firstStanza = connection.sent.at(-1)!;
  expect(firstStanza.attrs.id).toBe(messageID);

  // Bob's device couldn't decrypt: it sends `<receipt type=retry>` carrying a
  // fresh bundle in `<keys>` (a NEW recipient store, simulating a re-keyed device).
  let bobReplacement = SignalStore.createNew();
  let keys = new WANode("keys", {}, bundleUserNode(kBobJID, bobReplacement, true).children());
  let retry = new WANode("receipt", { id: messageID, type: "retry", from: kBobJID }, [
    new WANode("retry", { count: "1", id: messageID, t: "0", v: "1" }),
    keys,
  ]);

  await (account as any).onReceipt(retry);

  // We re-sent a fresh <message> to the same device (then acked the receipt).
  let resent = connection.sent.filter(n => n.tag == "message").at(-1)!;
  expect(resent.attrs.id).toBe(messageID);
  let enc = resent.child("participants")!.child("to")!.child("enc")!;
  expect(enc.attrs.type).toBe("pkmsg"); // re-established session
  expect(decodeWAMessage(await decryptPreKeyMessage(bobReplacement, ourAddress, enc.contentBytes!)).conversation)
    .toBe("retry me");

  // An ack for the receipt is also sent (so the server stops repeating it).
  expect(connection.sent.some(n => n.tag == "ack")).toBe(true);
});

test("a retry receipt from somebody we didn't send the message to gets nothing", async () => {
  let connection = new FakeConnection();
  let account = makeAccount(connection);
  connection.deviceList.set("491762222222", [0]);
  connection.deviceStores.set("491762222222:0@s.whatsapp.net", SignalStore.createNew());
  let messageID = await account.sender.sendText(JID.parse(kBobJID), "secret for bob only");

  // Mallory (or the server) asks for Bob's message, with keys of her own: from her
  // account, and as a "participant" on a receipt from Bob.
  let mallory = SignalStore.createNew();
  let keys = new WANode("keys", {}, bundleUserNode(kMalloryJID, mallory, true).children());
  await (account as any).onReceipt(new WANode("receipt", { id: messageID, type: "retry", from: kMalloryJID }, [keys]));
  await (account as any).onReceipt(new WANode("receipt",
    { id: messageID, type: "retry", from: kBobJID, participant: kMalloryJID }, [keys]));

  expect(connection.sent.filter(n => n.tag == "message").length).toBe(1); // only the original send to Bob
});

test("a retry receipt from our own phone re-sends the message to it", async () => {
  let connection = new FakeConnection();
  let account = makeAccount(connection);
  connection.deviceList.set("491762222222", [0]);
  connection.deviceStores.set("491762222222:0@s.whatsapp.net", SignalStore.createNew());
  connection.deviceList.set("491700000000", [0, 5]);
  connection.deviceStores.set("491700000000:0@s.whatsapp.net", SignalStore.createNew());
  let ourAddress = `${JID.parse(kSelfJID).user}.${JID.parse(kSelfJID).device}`;
  let messageID = await account.sender.sendText(JID.parse(kBobJID), "sync me again");

  // Our phone names the chat in `recipient`.
  let phoneReplacement = SignalStore.createNew();
  let keys = new WANode("keys", {}, bundleUserNode("491700000000@s.whatsapp.net", phoneReplacement, true).children());
  await (account as any).onReceipt(new WANode("receipt",
    { id: messageID, type: "retry", from: "491700000000@s.whatsapp.net", recipient: kBobJID }, [keys]));

  let messages = connection.sent.filter(n => n.tag == "message");
  expect(messages.length).toBe(2); // the original send, and the re-send
  let toPhone = await decryptSentTo(messages[1], "491700000000@s.whatsapp.net", phoneReplacement, ourAddress);
  expect(toPhone.deviceSentMessage?.message?.conversation).toBe("sync me again");
});

test("retry receipts are capped so a permanently-broken device cannot loop", async () => {
  let connection = new FakeConnection();
  let account = makeAccount(connection);
  connection.deviceList.set("491762222222", [0]);
  connection.deviceStores.set("491762222222:0@s.whatsapp.net", SignalStore.createNew());
  let messageID = await account.sender.sendText(JID.parse(kBobJID), "loops");

  // Always serve an error bundle so every retry fails to re-establish.
  connection.errorDevices.add("491762222222.0");
  let messagesBefore = connection.sent.filter(n => n.tag == "message").length; // the initial send
  let prekeyFetches = 0;
  let origSendIQ = connection.sendIQ.bind(connection);
  connection.sendIQ = async (node: WANode) => {
    if (node.attrs.xmlns == "encrypt" && node.attrs.type == "get") {
      prekeyFetches++;
    }
    return origSendIQ(node);
  };
  for (let i = 0; i < 8; i++) {
    let retry = new WANode("receipt", { id: messageID, type: "retry", from: kBobJID });
    await account.sender.handleRetryReceipt(retry, { payload: { conversation: "loops" }, recipients: [kBobJID] });
  }
  // The retries couldn't re-establish, so no new message went out, and after the
  // cap (kMaxRetrySends=5) it stopped even trying to refetch — not eight times.
  expect(connection.sent.filter(n => n.tag == "message").length).toBe(messagesBefore);
  expect(prekeyFetches).toBeLessThanOrEqual(5);
});

// --- peer message (own account) ---

test("sendPeerMessage targets our own account, category=peer, single enc to device 0", async () => {
  let connection = new FakeConnection();
  let account = makeAccount(connection);
  let ownPhone = SignalStore.createNew();
  connection.deviceStores.set("491700000000:0@s.whatsapp.net", ownPhone);
  let ourAddress = `${JID.parse(kSelfJID).user}.${JID.parse(kSelfJID).device}`;

  let id = await account.sender.sendPeerMessage({ conversation: "peer payload" });
  expect(id.startsWith("3EB0")).toBe(true);
  let stanza = connection.sent.at(-1)!;
  expect(stanza.tag).toBe("message");
  expect(stanza.attrs.category).toBe("peer");
  expect(stanza.attrs.to).toBe("491700000000@s.whatsapp.net"); // our own account
  expect(stanza.child("participants")).toBeUndefined(); // single enc, not a fan-out
  let enc = stanza.child("enc")!;
  expect(enc.attrs.type).toBe("pkmsg");
  expect(decodeWAMessage(await decryptPreKeyMessage(ownPhone, ourAddress, enc.contentBytes!)).conversation)
    .toBe("peer payload");
});

// --- integration: on-demand history paging reuses sendPeerMessage ---

test("on-demand history paging sends its request via sendPeerMessage", async () => {
  let connection = new FakeConnection();
  let account = makeAccount(connection);
  let ownPhone = SignalStore.createNew();
  connection.deviceStores.set("491700000000:0@s.whatsapp.net", ownPhone);
  let ourAddress = `${JID.parse(kSelfJID).user}.${JID.parse(kSelfJID).device}`;

  let room = await account.getOrCreateRoom(JID.parse(kBobJID), "Bob");
  await room.addHistoryMessage({
    key: { remoteJID: kBobJID, fromMe: false, id: "anchor" },
    message: { conversation: "oldest we hold" },
    messageTimestamp: 1700000000,
  } as any);

  account.historySync.pageOnDemand = true; // opt in to the secondary paging path
  await account.historySync.pageOlderMessages(room);

  // It went out as a peer message to our own account, decryptable on our phone.
  let stanza = connection.sent.at(-1)!;
  expect(stanza.attrs.category).toBe("peer");
  expect(stanza.attrs.to).toBe("491700000000@s.whatsapp.net");
  let request = decodeWAMessage(await decryptPreKeyMessage(ownPhone, ourAddress, stanza.child("enc")!.contentBytes!))
    .protocolMessage?.peerDataOperationRequestMessage?.historySyncOnDemandRequest;
  expect(request?.chatJID).toBe(kBobJID);
  expect(request?.oldestMsgID).toBe("anchor");
});

// --- prekey regeneration / top-up ---

test("low-prekey notification tops the store back up to 100 and persists the count", async () => {
  let connection = new FakeConnection();
  let account = makeAccount(connection);
  let store = account.signalStore!;
  // Simulate peers having consumed most of our one-time prekeys.
  let ids = [...store.preKeys.keys()];
  for (let id of ids.slice(0, 95)) {
    store.preKeys.delete(id);
  }
  expect(store.preKeys.size).toBe(5);
  let highestBefore = Math.max(...store.preKeys.keys());

  // The server's `<notification type=encrypt>` triggers uploadPreKeys.
  await (account as any).onNotification(new WANode("notification", { type: "encrypt", id: "n1", from: kServerUser }));

  expect(store.preKeys.size).toBe(100); // refilled
  // New keys use fresh, never-reused ids (all above the highest we still held).
  let newIDs = [...store.preKeys.keys()].filter(id => id > highestBefore);
  expect(newIDs.length).toBe(95);
  expect(Math.min(...newIDs)).toBeGreaterThan(100); // continues past the original 1..100

  // The upload IQ carried all 100 current keys, and the count survives a config round-trip.
  let restored = SignalStore.fromJSON(JSON.parse(JSON.stringify(store.toJSON())));
  expect(restored.nextPreKeyID).toBe(store.nextPreKeyID);
  let topped = restored.replenishPreKeys();
  expect(topped.length).toBe(0); // already at target after restore
});

test("replenishPreKeys mints monotonic ids and only what is needed", () => {
  let store = SignalStore.createNew();
  expect(store.preKeys.size).toBe(100);
  expect(store.replenishPreKeys().length).toBe(0); // already full

  // Drop 10, replenish exactly 10 with brand-new ids.
  let drop = [...store.preKeys.keys()].slice(0, 10);
  for (let id of drop) store.preKeys.delete(id);
  let fresh = store.replenishPreKeys();
  expect(fresh.length).toBe(10);
  expect(store.preKeys.size).toBe(100);
  expect(Math.min(...fresh.map(k => k.keyID))).toBe(101); // never reuses 1..100
});

// --- message id format ---

test("message ids are 3EB0 + uppercase hex and unique", () => {
  let a = WhatsAppSender.generateMessageID();
  let b = WhatsAppSender.generateMessageID();
  expect(a).toMatch(/^3EB0[0-9A-F]+$/);
  expect(a).not.toBe(b);
});

// --- bundle without one-time prekey still drives X3DH (direct, mirrors signal.test) ---

test("a parsed bundle with no one-time prekey initiates a session and the peer decrypts", async () => {
  let account = makeAccount(new FakeConnection());
  let bob = SignalStore.createNew();
  let node = bundleUserNode("491762222222:0@s.whatsapp.net", bob, false);
  let bundle = account.sender.parsePreKeyBundles(
    new WANode("iq", {}, [new WANode("list", {}, [node])])).get("491762222222.0")! as PreKeyBundle;
  expect(bundle.preKeyPublic).toBeUndefined();

  initiateSession(account.signalStore!, "491762222222.0", bundle);
  let m = await encrypt(account.signalStore!, "491762222222.0", new TextEncoder().encode("hi no-otk"));
  expect(str(await decryptPreKeyMessage(bob, "self.0", m.body))).toBe("hi no-otk");
});

// --- live wire-format regressions ---

test("device-list query uses usync mode=query; prekey fetch sets reason=identity", () => {
  let sender = makeAccount(new FakeConnection()).sender;
  let usync = sender.deviceListIQ([JID.parse(kBobJID)]).child("usync")!;
  expect(usync.attrs.mode).toBe("query"); // NOT "usync" — the server silently drops that, hanging the send
  expect(usync.attrs.context).toBe("message");
  expect(usync.child("query")!.child("devices")!.attrs.version).toBe("2");

  let user = sender.preKeyBundleIQ([JID.parse(kBobJID)]).child("key")!.children("user")[0];
  expect(user.attrs.reason).toBe("identity");
});
