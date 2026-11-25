/** Two Proteus identities talking to each other in-process.
 *
 * There are no published Proteus test vectors, so this is where the confidence
 * has to come from: every derivation is exercised from both ends at once, and
 * an error in any constant, info string, nesting depth or nonce layout makes
 * the very first decrypt fail. What it cannot prove is that our constants match
 * *Wire's* rather than merely each other — only a real peer can show that.
 *
 * The scenarios are the ones that break a hand-written ratchet: out-of-order
 * delivery, a message that arrives long after the peer moved on, both sides
 * sending before either has heard back, a peer re-initiating, and a ciphertext
 * that someone touched in flight. */
import { ProteusSession, ProteusError, ProteusErrorCode, Envelope, PreKeyMessage, CipherMessage } from "../../../../../logic/Chat/Wire/Proteus/ProteusSession";
import { ProteusStore } from "../../../../../logic/Chat/Wire/Proteus/ProteusStore";
import { ProteusIdentity } from "../../../../../logic/Chat/Wire/Proteus/ProteusIdentity";
import { ProteusPreKey, PreKeyBundle, kLastResortPreKeyID } from "../../../../../logic/Chat/Wire/Proteus/PreKeyBundle";
import { expect, test } from "vitest";

test("a session established from a prekey bundle carries a conversation both ways", () => {
  let alice = newPeer();
  let bob = newPeer();
  let toBob = ProteusSession.initiate(kBob, alice.identity, bundleOf(bob, 0));

  // Everything we send before the peer answers is a PreKeyMessage, so the
  // session still comes up if any one of them is lost.
  let opening = toBob.encrypt(text("hello"));
  expect(messageOf(opening)).toBeInstanceOf(PreKeyMessage);
  expect(messageOf(toBob.encrypt(text("still hello")))).toBeInstanceOf(PreKeyMessage);

  let { session: toAlice, plaintext } = ProteusSession.fromPreKeyMessage(kAlice, bob.identity, opening, bob.preKeys);
  expect(read(plaintext)).toBe("hello");
  expect(toAlice.remoteFingerprint).toBe(alice.identity.fingerprint);
  expect(toBob.remoteFingerprint).toBe(bob.identity.fingerprint);

  // Bob's reply is a plain CipherMessage; it also confirms the session, so
  // Alice stops prepending her prekey material.
  let reply = toAlice.encrypt(text("hi back"));
  expect(messageOf(reply)).toBeInstanceOf(CipherMessage);
  expect(read(toBob.decrypt(reply, alice.preKeys))).toBe("hi back");
  expect(toBob.pendingPreKey).toBe(null);
  expect(messageOf(toBob.encrypt(text("now plain")))).toBeInstanceOf(CipherMessage);

  for (let i = 0; i < 20; i++) {
    expect(read(toAlice.decrypt(toBob.encrypt(text(`a${i}`)), bob.preKeys))).toBe(`a${i}`);
    expect(read(toBob.decrypt(toAlice.encrypt(text(`b${i}`)), alice.preKeys))).toBe(`b${i}`);
  }
});

test("the consumed prekey is deleted, but the last-resort one never is", () => {
  let alice = newPeer();
  let bob = newPeer();
  expect(bob.preKeys.has(0)).toBe(true);
  let toBob = ProteusSession.initiate(kBob, alice.identity, bundleOf(bob, 0));
  ProteusSession.fromPreKeyMessage(kAlice, bob.identity, toBob.encrypt(text("one")), bob.preKeys);
  expect(bob.preKeys.has(0)).toBe(false);

  let viaLastResort = ProteusSession.initiate(kBob, alice.identity, bundleOf(bob, kLastResortPreKeyID));
  ProteusSession.fromPreKeyMessage(kAlice, bob.identity, viaLastResort.encrypt(text("two")), bob.preKeys);
  expect(bob.preKeys.has(kLastResortPreKeyID)).toBe(true);
});

test("a session cannot be built from a prekey we no longer have", () => {
  let alice = newPeer();
  let bob = newPeer();
  let toBob = ProteusSession.initiate(kBob, alice.identity, bundleOf(bob, 1));
  let opening = toBob.encrypt(text("hello"));
  bob.preKeys.delete(1);
  expectCode(ProteusErrorCode.SessionNotFound,
    () => ProteusSession.fromPreKeyMessage(kAlice, bob.identity, opening, bob.preKeys));
});

test("messages that arrive out of order all decrypt, and a replay does not", () => {
  let { toBob, toAlice, alice, bob } = established();
  let sent = [0, 1, 2, 3, 4].map(i => toBob.encrypt(text(`m${i}`)));

  // Backwards, which is the worst case: every message but the last needs a key
  // that was staged when a later one ran the chain forward.
  for (let i = 4; i >= 0; i--) {
    expect(read(toAlice.decrypt(sent[i], bob.preKeys))).toBe(`m${i}`);
  }
  // The key was removed as it was used, so the same bytes cannot be used twice.
  expectCode(ProteusErrorCode.DuplicateMessage, () => toAlice.decrypt(sent[2], bob.preKeys));
  expect(read(toBob.decrypt(toAlice.encrypt(text("still fine")), alice.preKeys))).toBe("still fine");
});

test("a message skipped now still decrypts after the peer has ratcheted past it", () => {
  let { toBob, toAlice, alice, bob } = established();
  let skipped = toBob.encrypt(text("lost in the post"));
  expect(read(toAlice.decrypt(toBob.encrypt(text("arrived first")), bob.preKeys))).toBe("arrived first");

  // Several DH ratchets happen before the straggler shows up.
  for (let i = 0; i < 3; i++) {
    expect(read(toBob.decrypt(toAlice.encrypt(text(`b${i}`)), alice.preKeys))).toBe(`b${i}`);
    expect(read(toAlice.decrypt(toBob.encrypt(text(`a${i}`)), bob.preKeys))).toBe(`a${i}`);
  }
  expect(read(toAlice.decrypt(skipped, bob.preKeys))).toBe("lost in the post");
});

test("both sides send before either has heard back", () => {
  let alice = newPeer();
  let bob = newPeer();
  let toBob = ProteusSession.initiate(kBob, alice.identity, bundleOf(bob, 0));

  let a0 = toBob.encrypt(text("a0"));
  let { session: toAlice, plaintext } = ProteusSession.fromPreKeyMessage(kAlice, bob.identity, a0, bob.preKeys);
  expect(read(plaintext)).toBe("a0");

  // Neither has anything of the other's in flight yet, so both write into the
  // void: Alice on her original chain, Bob on the one his first ratchet made.
  let a1 = toBob.encrypt(text("a1"));
  let a2 = toBob.encrypt(text("a2"));
  let b0 = toAlice.encrypt(text("b0"));
  let b1 = toAlice.encrypt(text("b1"));

  // And they arrive interleaved and each in the wrong order.
  expect(read(toAlice.decrypt(a2, bob.preKeys))).toBe("a2");
  expect(read(toBob.decrypt(b1, alice.preKeys))).toBe("b1");
  expect(read(toAlice.decrypt(a1, bob.preKeys))).toBe("a1");
  expect(read(toBob.decrypt(b0, alice.preKeys))).toBe("b0");

  // Both ratchets are still in step afterwards.
  let a3 = toBob.encrypt(text("a3"));
  let b2 = toAlice.encrypt(text("b2"));
  expect(read(toAlice.decrypt(a3, bob.preKeys))).toBe("a3");
  expect(read(toBob.decrypt(b2, alice.preKeys))).toBe("b2");
});

test("a tampered ciphertext is rejected and leaves the session usable", () => {
  let { toBob, toAlice, bob } = established();
  let good = toBob.encrypt(text("untouched"));

  let flippedCipherText = good.slice();
  flippedCipherText[flippedCipherText.length - 1] ^= 0xFF; // inside cipher_text
  expectCode(ProteusErrorCode.InvalidSignature, () => toAlice.decrypt(flippedCipherText, bob.preKeys));

  let envelope = Envelope.decode(good);
  envelope.mac[0] ^= 0xFF;
  expectCode(ProteusErrorCode.InvalidSignature, () => toAlice.decrypt(envelope.encode(), bob.preKeys));

  // The failures were decrypted on a copy, so the real chain never moved and
  // the genuine message still decrypts.
  expect(read(toAlice.decrypt(good, bob.preKeys))).toBe("untouched");
});

test("a truncated or nonsensical envelope is an InvalidMessage, not a crash", () => {
  let { toBob, toAlice, bob } = established();
  let good = toBob.encrypt(text("fine"));
  for (let broken of [new Uint8Array(0), good.slice(0, 20), new Uint8Array([0xA3, 0x00, 0x01])]) {
    expect(() => toAlice.decrypt(broken, bob.preKeys)).toThrow();
  }
  expect(read(toAlice.decrypt(good, bob.preKeys))).toBe("fine");
});

test("a peer that re-initiates gets a second session state, and the old one keeps working", () => {
  let alice = newPeer();
  let bob = newPeer();
  let toBob = ProteusSession.initiate(kBob, alice.identity, bundleOf(bob, 0));
  let { session: toAliceOld } = ProteusSession.fromPreKeyMessage(kAlice, bob.identity, toBob.encrypt(text("hello")), bob.preKeys);
  expect(read(toBob.decrypt(toAliceOld.encrypt(text("hi")), alice.preKeys))).toBe("hi");
  expect(toBob.states.size).toBe(1);

  let straggler = toAliceOld.encrypt(text("from the old session"));

  // Bob resets: he throws his half away and starts over from a fresh prekey of
  // Alice's. Alice must recognise that, without losing the session she has.
  let toAliceNew = ProteusSession.initiate(kAlice, bob.identity, bundleOf(alice, 2));
  expect(read(toBob.decrypt(toAliceNew.encrypt(text("starting over")), alice.preKeys))).toBe("starting over");
  expect(toBob.states.size).toBe(2);
  // Our next message goes out on the state whose message we last read.
  expect(read(toAliceNew.decrypt(toBob.encrypt(text("ok")), bob.preKeys))).toBe("ok");

  expect(read(toBob.decrypt(straggler, alice.preKeys))).toBe("from the old session");
  // Reading the straggler moved us back onto the old state, which is proteus's
  // own behaviour and its one real wart here: the reply would go to a session
  // the peer has thrown away. Nothing we can fix on our side of the wire.
  expect(toBob.sessionTag).toBe([...toBob.states.keys()][0]);
});

test("a PreKeyMessage from a different identity is a security event", () => {
  let alice = newPeer();
  let bob = newPeer();
  let mallory = newPeer();
  let toBob = ProteusSession.initiate(kBob, alice.identity, bundleOf(bob, 0));
  let { session: toAlice } = ProteusSession.fromPreKeyMessage(kAlice, bob.identity, toBob.encrypt(text("hello")), bob.preKeys);
  expect(read(toBob.decrypt(toAlice.encrypt(text("hi")), alice.preKeys))).toBe("hi");

  // Someone else claims to be Bob's device and opens a session to Alice.
  let impostor = ProteusSession.initiate(kAlice, mallory.identity, bundleOf(alice, 3));
  expectCode(ProteusErrorCode.RemoteIdentityChanged,
    () => toBob.decrypt(impostor.encrypt(text("trust me")), alice.preKeys));
  expect(alice.preKeys.has(3)).toBe(true); // and it did not burn a prekey
});

test("the skipped-key window is 1000 messages wide, in both directions", () => {
  let alice = newPeer();
  let bob = newPeer();
  let toBob = ProteusSession.initiate(kBob, alice.identity, bundleOf(bob, 0));
  let sent = [toBob.encrypt(text("m0"))];
  for (let i = 1; i <= 1002; i++) {
    sent.push(toBob.encrypt(text(`m${i}`)));
  }
  let { session: toAlice } = ProteusSession.fromPreKeyMessage(kAlice, bob.identity, sent[0], bob.preKeys);

  // The chain stands at 1, so 1002 would mean deriving 1001 keys we do not have.
  expectCode(ProteusErrorCode.TooDistantFuture, () => toAlice.decrypt(sent[1002], bob.preKeys));
  // One less is exactly the limit, and stages the whole gap.
  expect(read(toAlice.decrypt(sent[1001], bob.preKeys))).toBe("m1001");
  expect(read(toAlice.decrypt(sent[500], bob.preKeys))).toBe("m500");
  expect(read(toAlice.decrypt(sent[1], bob.preKeys))).toBe("m1");
  // Now the far end fits, because the chain has moved up to it.
  expect(read(toAlice.decrypt(sent[1002], bob.preKeys))).toBe("m1002");

  // m0 was consumed on session creation, and staging 1000 keys pushed the
  // oldest ones out, so replaying it is older than anything we kept.
  expectCode(ProteusErrorCode.OutdatedMessage, () => toAlice.decrypt(sent[0], bob.preKeys));
});

test("only the five most recent receive chains are kept", () => {
  let { toBob, toAlice, alice, bob } = established();
  let stragglers: Uint8Array[] = [];
  for (let i = 0; i < 6; i++) {
    stragglers.push(toBob.encrypt(text(`held back ${i}`)));
    expect(read(toAlice.decrypt(toBob.encrypt(text(`a${i}`)), bob.preKeys))).toBe(`a${i}`);
    expect(read(toBob.decrypt(toAlice.encrypt(text(`b${i}`)), alice.preKeys))).toBe(`b${i}`);
  }
  // The five newest chains are still there.
  for (let i = 5; i >= 1; i--) {
    expect(read(toAlice.decrypt(stragglers[i], bob.preKeys))).toBe(`held back ${i}`);
  }
  // The sixth-oldest was evicted, so its message can no longer be read.
  expectCode(ProteusErrorCode.InvalidSignature, () => toAlice.decrypt(stragglers[0], bob.preKeys));
  expect(read(toAlice.decrypt(toBob.encrypt(text("unharmed")), bob.preKeys))).toBe("unharmed");
});

test("a session survives being written out and read back mid-conversation", () => {
  let alice = newPeer();
  let bob = newPeer();
  let toBob = ProteusSession.initiate(kBob, alice.identity, bundleOf(bob, 0));
  let { session: toAlice } = ProteusSession.fromPreKeyMessage(kAlice, bob.identity, toBob.encrypt(text("hello")), bob.preKeys);
  alice.sessions.set(kBob, toBob);
  bob.sessions.set(kAlice, toAlice);
  let skipped = toBob.encrypt(text("in flight over the restart"));
  expect(read(toAlice.decrypt(toBob.encrypt(text("and one more")), bob.preKeys))).toBe("and one more");

  let aliceAgain = ProteusStore.fromJSON(JSON.parse(JSON.stringify(alice.toJSON())));
  let bobAgain = ProteusStore.fromJSON(JSON.parse(JSON.stringify(bob.toJSON())));
  expect(aliceAgain.identity.fingerprint).toBe(alice.identity.fingerprint);
  expect(aliceAgain.preKeys.size).toBe(alice.preKeys.size);
  expect(bobAgain.preKeys.has(0)).toBe(false);

  let restoredToBob = aliceAgain.session(kBob);
  let restoredToAlice = bobAgain.session(kAlice);
  // The staged key for the message that was in flight came back too.
  expect(read(restoredToAlice.decrypt(skipped, bobAgain.preKeys))).toBe("in flight over the restart");
  expect(read(restoredToBob.decrypt(restoredToAlice.encrypt(text("after")), aliceAgain.preKeys))).toBe("after");
  expect(read(restoredToAlice.decrypt(restoredToBob.encrypt(text("still going")), bobAgain.preKeys))).toBe("still going");
});

test("large and empty payloads survive the stream cipher", () => {
  let { toBob, toAlice, bob } = established();
  let big = new Uint8Array(200_000);
  for (let i = 0; i < big.length; i++) {
    big[i] = i & 0xFF;
  }
  expect(toAlice.decrypt(toBob.encrypt(big), bob.preKeys)).toEqual(big);
  expect(toAlice.decrypt(toBob.encrypt(new Uint8Array(0)), bob.preKeys).length).toBe(0);
});

test("the ChaCha20 nonce is the message counter, not a random value", () => {
  let { toBob, toAlice, bob } = established();
  // Two messages of identical plaintext under the same chain must differ, which
  // they only do if the counter reaches the nonce.
  let sent = [toBob.encrypt(text("same")), toBob.encrypt(text("same"))];
  let messages = sent.map(each => Envelope.decode(each).message as CipherMessage);
  expect(messages.map(each => each.counter)).toEqual([0, 1]);
  expect(hex(messages[0].cipherText)).not.toBe(hex(messages[1].cipherText));
  expect(messages[0].cipherText.length).toBe(4); // a stream cipher, so no padding
  // Same session tag and ratchet key, so the counter is the only difference.
  expect(hex(messages[0].sessionTag)).toBe(hex(messages[1].sessionTag));
  expect(hex(messages[0].ratchetKey)).toBe(hex(messages[1].ratchetKey));
  expect(read(toAlice.decrypt(sent[1], bob.preKeys))).toBe("same");
  expect(read(toAlice.decrypt(sent[0], bob.preKeys))).toBe("same");
});

/** A peer with a handful of prekeys. `ProteusStore.createNew()` mints 100, which
 * is right for a real device and needlessly slow here. */
function newPeer(): ProteusStore {
  let store = new ProteusStore();
  store.identity = ProteusIdentity.createNew();
  let lastResort = ProteusPreKey.lastResort();
  store.preKeys.set(lastResort.keyID, lastResort);
  store.generateMorePreKeys(6);
  return store;
}

function bundleOf(peer: ProteusStore, preKeyID: number): PreKeyBundle {
  return peer.preKeys.get(preKeyID).bundleFor(peer.identity);
}

/** Alice initiated, Bob answered, both sides confirmed. */
function established(): { alice: ProteusStore, bob: ProteusStore, toBob: ProteusSession, toAlice: ProteusSession } {
  let alice = newPeer();
  let bob = newPeer();
  let toBob = ProteusSession.initiate(kBob, alice.identity, bundleOf(bob, 0));
  let { session: toAlice } = ProteusSession.fromPreKeyMessage(kAlice, bob.identity, toBob.encrypt(text("hello")), bob.preKeys);
  toBob.decrypt(toAlice.encrypt(text("hi")), alice.preKeys);
  return { alice, bob, toBob, toAlice };
}

function messageOf(envelope: Uint8Array) {
  return Envelope.decode(envelope).message;
}

/** vitest's `toThrow` cannot match on a property, and the code is the whole
 * point: the app switches on it. */
function expectCode(code: ProteusErrorCode, run: () => any) {
  try {
    run();
  } catch (ex) {
    expect((ex as ProteusError).code).toBe(code);
    return;
  }
  throw new Error(`Expected Proteus error ${code}, but nothing was thrown`);
}

const text = (value: string) => new TextEncoder().encode(value);
const hex = (value: Uint8Array) => Buffer.from(value).toString("hex");
const read = (value: Uint8Array) => new TextDecoder().decode(value);
const kAlice = "example.com@alice-user@a1b2c3";
const kBob = "example.com@bob-user@d4e5f6";
