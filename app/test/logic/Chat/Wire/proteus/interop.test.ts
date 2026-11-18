/**
 * Proteus against Wire's own implementation.
 *
 * Proteus has no published test vectors, and `session.test.ts` has our code on
 * both ends, where a wrong constant agrees with itself and passes. So this
 * checks us against a second implementation: `@wireapp/proteus`, the one the
 * official clients use.
 *
 * Two halves:
 *
 * - **`vectors/interop.json`** was produced by running that implementation
 *   (see `makeVectors` below for exactly what) and is replayed here with
 *   nothing but our own code. It pins first contact and the message chain:
 *   the triple Diffie-Hellman, the HKDF info strings, the chain and message
 *   key steps, the ChaCha20 nonce layout, the MAC, and the CBOR framing.
 * - **The live cross-check** runs both implementations against each other, in
 *   both directions. It needs the package, so it is skipped unless
 *   `WIRE_PROTEUS_REF` points at it:
 *
 *       mkdir /tmp/proteus && cd /tmp/proteus && npm install @wireapp/proteus
 *       WIRE_PROTEUS_REF=/tmp/proteus/node_modules/@wireapp/proteus/src/index.js \
 *         yarn test proteus/interop
 *
 * The vectors alone caught a real bug: we framed `Message` as a 2-element CBOR
 * array, where it is a bare tag followed by the body. Every first contact with
 * a real Wire client would have failed.
 */
import "../../../../../logic/app";
import { ProteusIdentity } from "../../../../../logic/Chat/Wire/Proteus/ProteusIdentity";
import { ProteusPreKey, PreKeyBundle } from "../../../../../logic/Chat/Wire/Proteus/PreKeyBundle";
import { ProteusSession } from "../../../../../logic/Chat/Wire/Proteus/ProteusSession";
import vectors from "./vectors/interop.json";
import { beforeAll, expect, test } from "vitest";

const kRefPath = process.env.WIRE_PROTEUS_REF;
const kCrossCheck = kRefPath ? test : test.skip;
const kText = new TextEncoder();
const kUTF8 = new TextDecoder();
let ref: any = null;

beforeAll(async () => {
  if (!kRefPath) {
    return;
  }
  ref = await import(/* @vite-ignore */ kRefPath);
  await ref.init();
});

test("we decrypt what Wire's own implementation encrypted, out of order", () => {
  let identity = ProteusIdentity.fromJSON(vectors.ourIdentity);
  let preKey = ProteusPreKey.fromJSON(vectors.ourPreKey);
  let preKeys = new Map([[preKey.keyID, preKey]]);
  let messages = vectors.messages.map(each => ({
    envelope: base64Decode(each.envelope),
    plaintext: each.plaintext,
  }));

  // The first one they sent is the PreKeyMessage that opens the session, and
  // it need not be the first to arrive
  let [first, ...rest] = vectors.deliveryOrder;
  expect(first).toBe(0);
  let { session, plaintext } = ProteusSession.fromPreKeyMessage(
    "vector", identity, messages[0].envelope, preKeys);
  expect(kUTF8.decode(plaintext)).toBe(messages[0].plaintext);
  // §4.4: the session consumed the one-time prekey it named
  expect(preKeys.has(preKey.keyID)).toBe(false);

  for (let index of rest) {
    expect(kUTF8.decode(session.decrypt(messages[index].envelope, preKeys)))
      .toBe(messages[index].plaintext);
  }
});

test("the prekey bundle we publish is the one they read", () => {
  let identity = ProteusIdentity.fromJSON(vectors.ourIdentity);
  let preKey = ProteusPreKey.fromJSON(vectors.ourPreKey);
  let encoded = preKey.bundleFor(identity).encode();
  expect(base64Encode(encoded)).toBe(vectors.ourPreKeyBundle);
  // And it survives the round trip through our own reader
  let read = PreKeyBundle.decode(encoded);
  expect(read.preKeyID).toBe(preKey.keyID);
});

kCrossCheck("they start, we answer: their first message and our reply both land", async () => {
  let ourIdentity = ProteusIdentity.createNew();
  let ourPreKey = ProteusPreKey.generate(1, 1)[0];
  let bundleBytes = ourPreKey.bundleFor(ourIdentity).encode();

  let theirIdentity = new ref.keys.IdentityKeyPair();
  let theirBundle = ref.keys.PreKeyBundle.deserialise(arrayBuffer(bundleBytes));
  expect(theirBundle.prekey_id).toBe(ourPreKey.keyID);
  let theirSession = ref.session.Session.init_from_prekey(theirIdentity, theirBundle);

  let envelope = ref.session.Session.encrypt(theirSession, kText.encode("hello from Wire"));
  let { session: ourSession, plaintext } = ProteusSession.fromPreKeyMessage(
    "s1", ourIdentity, new Uint8Array(envelope.serialise()),
    new Map([[ourPreKey.keyID, ourPreKey]]));
  expect(kUTF8.decode(plaintext)).toBe("hello from Wire");

  let ourEnvelope = ourSession.encrypt(kText.encode("hello from us"));
  let back = await theirSession.decrypt(refStore([]),
    ref.message.Envelope.deserialise(arrayBuffer(ourEnvelope)));
  expect(kUTF8.decode(new Uint8Array(back))).toBe("hello from us");
});

kCrossCheck("we start, they answer: our first message and their reply both land", async () => {
  let theirIdentity = new ref.keys.IdentityKeyPair();
  let theirPreKey = new ref.keys.PreKey(7);
  let theirBundle = new ref.keys.PreKeyBundle(theirIdentity.public_key, theirPreKey);

  let ourBundle = PreKeyBundle.decode(new Uint8Array(theirBundle.serialise()));
  expect(ourBundle.preKeyID).toBe(7);
  let ourSession = ProteusSession.initiate("s2", ProteusIdentity.createNew(), ourBundle);

  let ourEnvelope = ourSession.encrypt(kText.encode("first contact"));
  let [theirSession, plaintext] = await ref.session.Session.init_from_message(
    theirIdentity, refStore([theirPreKey]),
    ref.message.Envelope.deserialise(arrayBuffer(ourEnvelope)));
  expect(kUTF8.decode(new Uint8Array(plaintext))).toBe("first contact");

  let reply = ref.session.Session.encrypt(theirSession, kText.encode("nice to meet you"));
  expect(kUTF8.decode(ourSession.decrypt(new Uint8Array(reply.serialise()), new Map())))
    .toBe("nice to meet you");
});

kCrossCheck("a long conversation stays in step, in both directions and out of order", async () => {
  let theirIdentity = new ref.keys.IdentityKeyPair();
  let theirPreKey = new ref.keys.PreKey(11);
  let theirBundle = new ref.keys.PreKeyBundle(theirIdentity.public_key, theirPreKey);
  let ourSession = ProteusSession.initiate("s3", ProteusIdentity.createNew(),
    PreKeyBundle.decode(new Uint8Array(theirBundle.serialise())));

  let first = ourSession.encrypt(kText.encode("m0"));
  let [theirSession] = await ref.session.Session.init_from_message(
    theirIdentity, refStore([theirPreKey]), ref.message.Envelope.deserialise(arrayBuffer(first)));

  // Several from us in a row, delivered out of order: they have to keep the
  // message keys they skipped
  let ours = [1, 2, 3, 4, 5].map(i => ourSession.encrypt(kText.encode(`us ${i}`)));
  for (let i of [2, 0, 4, 1, 3]) {
    let got = await theirSession.decrypt(refStore([theirPreKey]),
      ref.message.Envelope.deserialise(arrayBuffer(ours[i])));
    expect(kUTF8.decode(new Uint8Array(got))).toBe(`us ${i + 1}`);
  }

  // And the same the other way, which ratchets us onto a new receiving chain
  let theirs = [1, 2, 3, 4, 5].map(i =>
    new Uint8Array(ref.session.Session.encrypt(theirSession, kText.encode(`them ${i}`)).serialise()));
  for (let i of [1, 0, 3, 2, 4]) {
    expect(kUTF8.decode(ourSession.decrypt(theirs[i], new Map()))).toBe(`them ${i + 1}`);
  }

  // Back and forth, so both sides ratchet several times over
  for (let i = 0; i < 3; i++) {
    let out = ourSession.encrypt(kText.encode(`ping ${i}`));
    let got = await theirSession.decrypt(refStore([theirPreKey]),
      ref.message.Envelope.deserialise(arrayBuffer(out)));
    expect(kUTF8.decode(new Uint8Array(got))).toBe(`ping ${i}`);

    let reply = new Uint8Array(
      ref.session.Session.encrypt(theirSession, kText.encode(`pong ${i}`)).serialise());
    expect(kUTF8.decode(ourSession.decrypt(reply, new Map()))).toBe(`pong ${i}`);
  }
});

/** Their `PreKeyStore`: our test holds the prekeys and never forgets one. */
function refStore(preKeys: any[]) {
  return {
    async load_prekey(id: number) {
      return preKeys.find(each => each.key_id == id);
    },
    async delete_prekey(id: number) {
      return id;
    },
  };
}

/** Their API takes `ArrayBuffer`s, ours `Uint8Array`s. */
function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function base64Decode(text: string): Uint8Array {
  return Uint8Array.from(atob(text), char => char.charCodeAt(0));
}

function base64Encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
