import { SignalStore } from "../../../../logic/Chat/Signal/Crypto/Store";
import { PreKeyBundle } from "../../../../logic/Chat/Signal/Crypto/Identity";
import { initiateSession, encrypt, decryptPreKeyMessage, decryptSignalMessage }
  from "../../../../logic/Chat/Signal/Crypto/SessionCipher";
import { serializeSignalMessage, parseSignalMessage } from "../../../../logic/Chat/Signal/Crypto/messages";
import { KeyPair } from "../../../../logic/Chat/Signal/Crypto/KeyPair";
import { djbEncode } from "../../../../logic/Chat/Signal/Crypto/curve";
import { randomBytes, hmacSHA256 } from "../../../../logic/Chat/Signal/Crypto/primitives";
import {
  createSenderKey, createDistributionMessage, processDistributionMessage, groupEncrypt, groupDecrypt,
} from "../../../../logic/Chat/Signal/Crypto/GroupCipher";
import { expect, test } from "vitest";

const utf8 = (s: string) => new TextEncoder().encode(s);
const str = (b: Uint8Array) => new TextDecoder().decode(b);

/** Builds a prekey bundle from a store (as if fetched from the server). */
function bundleFrom(store: SignalStore, withOneTime: boolean): PreKeyBundle {
  let signed = store.signedPreKeys.get(1)!;
  let bundle = new PreKeyBundle();
  bundle.registrationID = store.registrationID;
  bundle.identityKey = store.identityKeyPair.publicKey;
  bundle.signedPreKeyID = signed.keyID;
  bundle.signedPreKeyPublic = signed.keyPair.publicKey;
  bundle.signedPreKeySignature = signed.signature;
  if (withOneTime) {
    let preKey = store.preKeys.get(1)!;
    bundle.preKeyID = preKey.keyID;
    bundle.preKeyPublic = preKey.keyPair.publicKey;
  }
  return bundle;
}

test("X3DH + Double Ratchet: full bidirectional conversation", async () => {
  let alice = SignalStore.createNew();
  let bob = SignalStore.createNew();

  // Alice fetches Bob's bundle and starts a session.
  initiateSession(alice, "bob", bundleFrom(bob, true));

  // Alice -> Bob (first message is a pkmsg that establishes Bob's session)
  let m1 = await encrypt(alice, "bob", utf8("hello bob"));
  expect(m1.type).toBe("pkmsg");
  expect(str(await decryptPreKeyMessage(bob, "alice", m1.body))).toBe("hello bob");

  // Alice -> Bob again (still pkmsg until Bob replies)
  let m2 = await encrypt(alice, "bob", utf8("second"));
  expect(str(await decryptPreKeyMessage(bob, "alice", m2.body))).toBe("second");

  // Bob -> Alice (triggers Alice's DH ratchet)
  let r1 = await encrypt(bob, "alice", utf8("hi alice"));
  expect(r1.type).toBe("msg");
  expect(str(await decryptSignalMessage(alice, "bob", r1.body))).toBe("hi alice");

  // Now Alice's messages become plain `msg` (session confirmed)
  let m3 = await encrypt(alice, "bob", utf8("third"));
  expect(m3.type).toBe("msg");
  expect(str(await decryptSignalMessage(bob, "alice", m3.body))).toBe("third");

  // Several back-and-forth rounds with ratcheting
  for (let i = 0; i < 5; i++) {
    let a = await encrypt(alice, "bob", utf8(`a${i}`));
    expect(str(await decryptSignalMessage(bob, "alice", a.body))).toBe(`a${i}`);
    let b = await encrypt(bob, "alice", utf8(`b${i}`));
    expect(str(await decryptSignalMessage(alice, "bob", b.body))).toBe(`b${i}`);
  }
});

test("Out-of-order delivery uses skipped message keys", async () => {
  let alice = SignalStore.createNew();
  let bob = SignalStore.createNew();
  initiateSession(alice, "bob", bundleFrom(bob, true));
  // establish
  let first = await encrypt(alice, "bob", utf8("establish"));
  await decryptPreKeyMessage(bob, "alice", first.body);
  let reply = await encrypt(bob, "alice", utf8("ack"));
  await decryptSignalMessage(alice, "bob", reply.body);

  // Alice sends 4 messages; Bob receives them out of order: 3, 1, 0, 2
  let msgs: any[] = [];
  for (let i = 0; i < 4; i++) {
    msgs.push((await encrypt(alice, "bob", utf8(`msg${i}`))).body);
  }
  expect(str(await decryptSignalMessage(bob, "alice", msgs[3]))).toBe("msg3");
  expect(str(await decryptSignalMessage(bob, "alice", msgs[1]))).toBe("msg1");
  expect(str(await decryptSignalMessage(bob, "alice", msgs[0]))).toBe("msg0");
  expect(str(await decryptSignalMessage(bob, "alice", msgs[2]))).toBe("msg2");
});

test("A forged message doesn't change the session, and the next real messages still decrypt", async () => {
  let alice = SignalStore.createNew();
  let bob = SignalStore.createNew();
  initiateSession(alice, "bob", bundleFrom(bob, true));
  await decryptPreKeyMessage(bob, "alice", (await encrypt(alice, "bob", utf8("establish"))).body);
  await decryptSignalMessage(alice, "bob", (await encrypt(bob, "alice", utf8("ack"))).body);
  let late = await encrypt(alice, "bob", utf8("late"));
  expect(str(await decryptSignalMessage(bob, "alice", (await encrypt(alice, "bob", utf8("first"))).body))).toBe("first");
  let real = await encrypt(alice, "bob", utf8("real"));
  let before = bob.sessions.get("alice")!.toJSON();

  // Without the session keys, the MAC can only be guessed: with a new ratchet key, the saved key of the late message, and the next counter
  let ratchetKey = parseSignalMessage(real.body).ratchetKey;
  for (let [key, counter] of [[djbEncode(KeyPair.generate().publicKey), 0], [ratchetKey, 0], [ratchetKey, 2]] as const) {
    let forged = serializeSignalMessage({ ratchetKey: key, counter, previousCounter: 0, ciphertext: randomBytes(32) },
      randomBytes(32), randomBytes(33), randomBytes(33));
    await expect(decryptSignalMessage(bob, "alice", forged)).rejects.toThrow();
  }
  expect(bob.sessions.get("alice")!.toJSON()).toEqual(before);

  expect(str(await decryptSignalMessage(bob, "alice", real.body))).toBe("real");
  expect(str(await decryptSignalMessage(bob, "alice", late.body))).toBe("late");
  expect(str(await decryptSignalMessage(bob, "alice", (await encrypt(alice, "bob", utf8("next"))).body))).toBe("next");
  expect(str(await decryptSignalMessage(alice, "bob", (await encrypt(bob, "alice", utf8("reply"))).body))).toBe("reply");
});

test("A late message from their previous chain doesn't break the session", async () => {
  let alice = SignalStore.createNew();
  let bob = SignalStore.createNew();
  initiateSession(alice, "bob", bundleFrom(bob, true));
  await decryptPreKeyMessage(bob, "alice", (await encrypt(alice, "bob", utf8("establish"))).body);
  await decryptSignalMessage(alice, "bob", (await encrypt(bob, "alice", utf8("ack"))).body);
  let late = await encrypt(alice, "bob", utf8("late"));
  expect(str(await decryptSignalMessage(bob, "alice", (await encrypt(alice, "bob", utf8("first"))).body))).toBe("first");
  // Bob's reply makes Alice start a new chain
  expect(str(await decryptSignalMessage(alice, "bob", (await encrypt(bob, "alice", utf8("reply"))).body))).toBe("reply");
  expect(str(await decryptSignalMessage(bob, "alice", (await encrypt(alice, "bob", utf8("new chain"))).body))).toBe("new chain");

  expect(str(await decryptSignalMessage(bob, "alice", late.body))).toBe("late");
  expect(str(await decryptSignalMessage(bob, "alice", (await encrypt(alice, "bob", utf8("after"))).body))).toBe("after");
  expect(str(await decryptSignalMessage(alice, "bob", (await encrypt(bob, "alice", utf8("reply 2"))).body))).toBe("reply 2");
});

test("The peer can't grow the saved session without bound", async () => {
  let alice = SignalStore.createNew();
  let bob = SignalStore.createNew();
  initiateSession(alice, "bob", bundleFrom(bob, true));
  await decryptPreKeyMessage(bob, "alice", (await encrypt(alice, "bob", utf8("establish"))).body);
  for (let round = 0; round < 6; round++) {
    // Bob's reply makes Alice start a new chain
    await decryptSignalMessage(alice, "bob", (await encrypt(bob, "alice", utf8("reply"))).body);
    // As if Alice had sent 2000 messages that never arrived
    let state = alice.sessions.get("bob")!;
    for (let i = 0; i < 2000; i++) {
      state.senderChainKey = hmacSHA256(state.senderChainKey, new Uint8Array([2]));
    }
    state.senderChainIndex += 2000;
    expect(str(await decryptSignalMessage(bob, "alice", (await encrypt(alice, "bob", utf8("after 2000 lost"))).body)))
      .toBe("after 2000 lost");
  }
  let session = bob.sessions.get("alice")!;
  expect(session.receiverChains.size).toBeLessThanOrEqual(5);
  expect(session.skippedKeys.size).toBeLessThanOrEqual(5 * 2000);
});

test("Bundle without a one-time prekey still works", async () => {
  let alice = SignalStore.createNew();
  let bob = SignalStore.createNew();
  initiateSession(alice, "bob", bundleFrom(bob, false));
  let m = await encrypt(alice, "bob", utf8("no one-time prekey"));
  expect(str(await decryptPreKeyMessage(bob, "alice", m.body))).toBe("no one-time prekey");
});

test("Tampered ciphertext fails the MAC check", async () => {
  let alice = SignalStore.createNew();
  let bob = SignalStore.createNew();
  initiateSession(alice, "bob", bundleFrom(bob, true));
  let m = await encrypt(alice, "bob", utf8("secret"));
  m.body[m.body.length - 12] ^= 0xFF; // corrupt the ciphertext region
  await expect(decryptPreKeyMessage(bob, "alice", m.body)).rejects.toThrow();
});

test("A failed pkmsg rolls back the half-open session and preserves the prekey", async () => {
  let alice = SignalStore.createNew();
  let bob = SignalStore.createNew();
  initiateSession(alice, "bob", bundleFrom(bob, true));

  // A corrupted pkmsg must fail WITHOUT leaving a dead session for "alice" or
  // burning Bob's one-time prekey — otherwise every later message decrypts
  // against the broken session and also fails (the cascade we saw live).
  let bad = await encrypt(alice, "bob", utf8("secret"));
  bad.body[bad.body.length - 12] ^= 0xFF;
  let preKeysBefore = bob.preKeys.size;
  await expect(decryptPreKeyMessage(bob, "alice", bad.body)).rejects.toThrow();
  expect(bob.sessions.has("alice")).toBe(false); // rolled back, not half-open
  expect(bob.preKeys.size).toBe(preKeysBefore); // prekey not consumed

  // A later valid pkmsg on the same bundle still establishes cleanly.
  let good = await encrypt(alice, "bob", utf8("hello for real"));
  expect(str(await decryptPreKeyMessage(bob, "alice", good.body))).toBe("hello for real");
  expect(bob.sessions.has("alice")).toBe(true);
});

test("an incoming pkmsg rebuilds over our own outbound session (send-first collision)", async () => {
  // The live "sending works, then every reply is Bad MAC" bug: once we send first,
  // we hold an *initiator* session for the peer. Their pkmsg then arrives at the
  // same address; decrypting it against our outbound session gives Bad MAC forever.
  // It must rebuild a responder session from the pkmsg instead.
  let us = SignalStore.createNew();
  let them = SignalStore.createNew();
  initiateSession(us, "them", bundleFrom(them, true)); // we send first -> we hold an outbound session
  let ours = await encrypt(us, "them", utf8("from us"));
  expect(ours.type).toBe("pkmsg");

  // They independently start their own session to us and send.
  initiateSession(them, "us", bundleFrom(us, true));
  let theirs = await encrypt(them, "us", utf8("from them"));
  expect(theirs.type).toBe("pkmsg");

  // We receive their pkmsg while holding our outbound session at "them": it must
  // decrypt by rebuilding, not Bad MAC against our own session.
  expect(str(await decryptPreKeyMessage(us, "them", theirs.body))).toBe("from them");

  // Their follow-up (same outbound session: same base key, next counter) decrypts
  // on the responder session we just rebuilt, without rebuilding again.
  let theirs2 = await encrypt(them, "us", utf8("from them again"));
  expect(str(await decryptPreKeyMessage(us, "them", theirs2.body))).toBe("from them again");
});

test("an unrelated newer pkmsg replaces a stale responder session", async () => {
  // The peer reinstalled / re-paired: a pkmsg arrives with a *different* base key
  // than the one that established our current session. We must rebuild from the
  // new one (their old session's keys are gone), not reuse the stale session.
  // (No one-time prekey here, so the helper's reused prekey id isn't consumed.)
  let bob = SignalStore.createNew();
  let alice1 = SignalStore.createNew();
  initiateSession(alice1, "bob", bundleFrom(bob, false));
  expect(str(await decryptPreKeyMessage(bob, "alice", (await encrypt(alice1, "bob", utf8("first install"))).body)))
    .toBe("first install");

  let alice2 = SignalStore.createNew(); // a fresh identity for the same peer address
  initiateSession(alice2, "bob", bundleFrom(bob, false));
  let fromNew = await encrypt(alice2, "bob", utf8("reinstalled"));
  expect(fromNew.type).toBe("pkmsg");
  expect(str(await decryptPreKeyMessage(bob, "alice", fromNew.body))).toBe("reinstalled");
});

test("a peer's new identity key is reported, but not its first key, nor a forged pkmsg", async () => {
  let bob = SignalStore.createNew();
  let changed: string[] = [];
  bob.onIdentityChange = name => changed.push(name);

  // First contact: there is no known key to compare with
  let alice = SignalStore.createNew();
  initiateSession(alice, "bob", bundleFrom(bob, false));
  await decryptPreKeyMessage(bob, "alice", (await encrypt(alice, "bob", utf8("hi"))).body);
  initiateSession(bob, "carol", bundleFrom(SignalStore.createNew(), false));
  expect(changed).toEqual([]);

  // A pkmsg with another key that fails the MAC must not replace Alice's key
  let mallory = SignalStore.createNew();
  initiateSession(mallory, "bob", bundleFrom(bob, false));
  let forged = await encrypt(mallory, "bob", utf8("forged"));
  forged.body[forged.body.length - 12] ^= 0xFF;
  await expect(decryptPreKeyMessage(bob, "alice", forged.body)).rejects.toThrow();
  expect(changed).toEqual([]);
  expect([...bob.identities.get("alice")!]).toEqual([...alice.identityKeyPair.publicKey]);

  // Alice reinstalled: her pkmsg with a new key still decrypts, and is reported
  let alice2 = SignalStore.createNew();
  initiateSession(alice2, "bob", bundleFrom(bob, false));
  expect(str(await decryptPreKeyMessage(bob, "alice", (await encrypt(alice2, "bob", utf8("new phone"))).body)))
    .toBe("new phone");
  expect(changed).toEqual(["alice"]);

  // A fetched bundle with a new key for a known peer is reported, too
  initiateSession(bob, "carol", bundleFrom(SignalStore.createNew(), false));
  expect(changed).toEqual(["alice", "carol"]);
});

test("a pairwise session survives a store serialize/restore round-trip", async () => {
  let alice = SignalStore.createNew();
  let bob = SignalStore.createNew();
  initiateSession(alice, "bob", bundleFrom(bob, true));

  // Establish and advance the ratchet a little (pkmsg + a reply, then a msg).
  expect(str(await decryptPreKeyMessage(bob, "alice", (await encrypt(alice, "bob", utf8("one"))).body))).toBe("one");
  await decryptSignalMessage(alice, "bob", (await encrypt(bob, "alice", utf8("ack"))).body);

  // Persist Bob's store the way the account config does, then restore it.
  let restored = SignalStore.fromJSON(JSON.parse(JSON.stringify(bob.toJSON())));
  expect(restored.sessions.has("alice")).toBe(true);

  // The restored store keeps decrypting Alice's next message — no re-establishment.
  let next = await encrypt(alice, "bob", utf8("after restart"));
  expect(str(await decryptSignalMessage(restored, "alice", next.body))).toBe("after restart");
});

test("a group sender key survives a store serialize/restore round-trip", async () => {
  let store = SignalStore.createNew();
  let aliceSenderKey = createSenderKey(9);
  store.senderKeys.set("group|111.0", processDistributionMessage(createDistributionMessage(aliceSenderKey)));

  let restored = SignalStore.fromJSON(JSON.parse(JSON.stringify(store.toJSON())));
  let view = restored.senderKeys.get("group|111.0")!;
  expect(view).toBeDefined();

  let ct = await groupEncrypt(aliceSenderKey, utf8("group after restart"));
  expect(str(await groupDecrypt(view, ct))).toBe("group after restart");
});

test("Sender Keys: group message from one member to others", async () => {
  // Alice creates her sender key and distributes it; Bob and Carol process it.
  let aliceSenderKey = createSenderKey(1);
  let distribution = createDistributionMessage(aliceSenderKey);
  let bobView = processDistributionMessage(distribution);
  let carolView = processDistributionMessage(distribution);

  for (let i = 0; i < 3; i++) {
    let ct = await groupEncrypt(aliceSenderKey, utf8(`group ${i}`));
    expect(str(await groupDecrypt(bobView, ct))).toBe(`group ${i}`);
    // Carol must process each in order too; send her a fresh copy
    let ct2 = await groupEncrypt(aliceSenderKey, utf8(`to carol ${i}`));
    expect(str(await groupDecrypt(carolView, ct2))).toBe(`to carol ${i}`);
  }
});

test("Sender Keys: forged signature is rejected", async () => {
  let aliceSenderKey = createSenderKey(1);
  let bobView = processDistributionMessage(createDistributionMessage(aliceSenderKey));
  let ct = await groupEncrypt(aliceSenderKey, utf8("real"));
  // Replace the signing key the receiver trusts -> signature check must fail
  bobView.signingPublicKey = createSenderKey(2).signingPublicKey;
  await expect(groupDecrypt(bobView, ct)).rejects.toThrow();
});
