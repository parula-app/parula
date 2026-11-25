/** The CBOR prekey bundle: the one Proteus structure whose exact bytes we can
 * check against something real. `wire-server` ships this 83-byte bundle as a
 * test fixture, so decoding it field by field and re-encoding it byte-for-byte
 * is our only external confirmation that the format is right - in particular
 * that key 2 is nested one map deep and key 3 two, which the Haskell field
 * *names* get backwards. */
import { PreKeyBundle, ProteusPreKey, CBORReader, CBORWriter, kLastResortPreKeyID } from "../../../../../logic/Chat/Wire/Proteus/PreKeyBundle";
import { ProteusIdentity } from "../../../../../logic/Chat/Wire/Proteus/ProteusIdentity";
import { base64Decode, base64Encode } from "../../../../../logic/Chat/Signal/Crypto/primitives";
import { bytesToHex, hexToBytes } from "@noble/curves/utils.js";
import { expect, test } from "vitest";

/** `wire-server/libs/wire-api/src/Wire/API/User/Client/Prekey.hs:273` */
const kFixture = "pQABAQcCoQBYIDXdN8VlKb5lbgPmoDPLPyqNIEyShG4oT/DlW0peRRZUA6EAoQBYILLf1TIwSB62q69Ojs/X1tzJ+dYHNAw4QbW/7TC5vSZqBPY=";
const kFixturePreKey = "35dd37c56529be656e03e6a033cb3f2a8d204c92846e284ff0e55b4a5e451654";
const kFixtureIdentity = "b2dfd53230481eb6abaf4e8ecfd7d6dcc9f9d607340c3841b5bfed30b9bd266a";

test("decode the wire-server prekey bundle fixture", () => {
  let bytes = base64Decode(kFixture);
  expect(bytes.length).toBe(83);

  let bundle = PreKeyBundle.decode(bytes);
  expect(bundle.version).toBe(1);
  expect(bundle.preKeyID).toBe(7);
  expect(bytesToHex(bundle.preKeyPublic)).toBe(kFixturePreKey);
  expect(bytesToHex(bundle.identityKey)).toBe(kFixtureIdentity);
  expect(bundle.signature).toBe(null);
  expect(bundle.isLastResort).toBe(false);
  // No signature to check, so nothing to reject either.
  expect(bundle.verify()).toBe(true);
});

test("re-encode the fixture byte for byte", () => {
  let bytes = base64Decode(kFixture);
  expect(bytesToHex(PreKeyBundle.decode(bytes).encode())).toBe(bytesToHex(bytes));
  expect(PreKeyBundle.decode(bytes).toBase64()).toBe(kFixture);
});

test("the raw CBOR structure is the documented one", () => {
  let cbor = new CBORReader(base64Decode(kFixture));
  let keys: number[] = [];
  let preKey: Uint8Array;
  let identity: Uint8Array;
  for (let key of cbor.mapKeys()) {
    keys.push(key);
    switch (key) {
    case 0: expect(cbor.uint()).toBe(1); break;
    case 1: expect(cbor.uint()).toBe(7); break;
    // Key 2 is one map level deep, key 3 is two. Reading them at the wrong
    // depth throws rather than silently returning the wrong bytes.
    case 2: preKey = cbor.wrapped(1); break;
    case 3: identity = cbor.wrapped(2); break;
    case 4: expect(cbor.takeNull()).toBe(true); break;
    }
  }
  expect(keys).toEqual([0, 1, 2, 3, 4]);
  expect(bytesToHex(preKey)).toBe(kFixturePreKey);
  expect(bytesToHex(identity)).toBe(kFixtureIdentity);
  expect(cbor.atEnd).toBe(true);
});

test("reading key 3 at the wrong nesting depth fails", () => {
  let readAtDepth = (depth: number) => {
    let cbor = new CBORReader(base64Decode(kFixture));
    for (let key of cbor.mapKeys()) {
      if (key == 3) {
        return cbor.wrapped(depth);
      }
      cbor.skip();
    }
  };
  expect(bytesToHex(readAtDepth(2))).toBe(kFixtureIdentity);
  expect(() => readAtDepth(1)).toThrow();
});

test("round-trip a generated bundle, signed and unsigned", () => {
  let identity = ProteusIdentity.createNew();
  let preKey = ProteusPreKey.generate(4711, 1)[0];
  let bundle = preKey.bundleFor(identity);
  expect(bundle.preKeyID).toBe(4711);

  let decoded = PreKeyBundle.decode(bundle.encode());
  expect(decoded.equals(bundle)).toBe(true);
  expect(decoded.signature).toBe(null);
  expect(decoded.encode().length).toBe(83 + 2); // 4711 needs 2 more bytes than 7

  bundle.signature = identity.keyPair.sign(bundle.preKeyPublic);
  let signed = PreKeyBundle.decode(bundle.encode());
  expect(signed.equals(bundle)).toBe(true);
  expect(signed.signature.length).toBe(64);
  expect(signed.verify()).toBe(true);
  // The `f6` null becomes `a1 00 58 40` plus 64 signature bytes.
  expect(signed.encode().length).toBe(85 - 1 + 68);

  signed.signature[0] ^= 0xFF;
  expect(signed.verify()).toBe(false);
});

test("the last-resort prekey has id 0xFFFF", () => {
  let identity = ProteusIdentity.createNew();
  let bundle = ProteusPreKey.lastResort().bundleFor(identity);
  expect(bundle.preKeyID).toBe(65535);
  expect(bundle.isLastResort).toBe(true);
  expect(PreKeyBundle.decode(bundle.encode()).preKeyID).toBe(kLastResortPreKeyID);
  // 0xFFFF encodes as `19 ff ff`, so two bytes more than the fixture's `07`.
  expect(bundle.encode().length).toBe(85);
});

test("prekey IDs cover the whole u16 range and skip the last-resort id", () => {
  let identity = ProteusIdentity.createNew();
  for (let id of [0, 1, 23, 24, 255, 256, 65534]) {
    let bundle = new PreKeyBundle(id, ProteusPreKey.generate(0, 1)[0].keyPair.publicKey, identity.publicKey);
    expect(PreKeyBundle.decode(bundle.encode()).preKeyID).toBe(id);
  }
  let wrapping = ProteusPreKey.generate(kLastResortPreKeyID - 1, 3);
  expect(wrapping.map(each => each.keyID)).toEqual([65534, 0, 1]);
});

test("unknown map keys are skipped, not fatal", () => {
  let cbor = new CBORWriter();
  cbor.map(7);
  cbor.uint(0).uint(1);
  cbor.uint(1).uint(9);
  cbor.uint(2).map(1).uint(0).bytes(hexToBytes(kFixturePreKey));
  cbor.uint(3).map(1).uint(0).map(1).uint(0).bytes(hexToBytes(kFixtureIdentity));
  cbor.uint(4).null();
  cbor.uint(9).array(2); // a future field holding a nested container
  cbor.uint(1).bytes(new Uint8Array([1, 2, 3]));
  cbor.uint(10).map(1).uint(0).uint(5);

  let bundle = PreKeyBundle.decode(cbor.finish());
  expect(bundle.preKeyID).toBe(9);
  expect(bytesToHex(bundle.identityKey)).toBe(kFixtureIdentity);
});

test("malformed bundles are rejected", () => {
  let bytes = base64Decode(kFixture);
  expect(() => PreKeyBundle.decode(bytes.slice(0, 40))).toThrow(); // truncated
  expect(() => PreKeyBundle.decode(new Uint8Array([...bytes, 0x00]))).toThrow(/[Tt]railing/);

  let duplicate = new CBORWriter();
  duplicate.map(2).uint(0).uint(1).uint(0).uint(1);
  expect(() => PreKeyBundle.decode(duplicate.finish())).toThrow(/[Dd]uplicate/);

  let wrongVersion = new CBORWriter();
  wrongVersion.map(1).uint(0).uint(2);
  expect(() => PreKeyBundle.decode(wrongVersion.finish())).toThrow(/version/);

  let noKeys = new CBORWriter();
  noKeys.map(2).uint(0).uint(1).uint(1).uint(7);
  expect(() => PreKeyBundle.decode(noKeys.finish())).toThrow(/missing a key/);
});

test("integers use the shortest encoding, as the reference encoder does", () => {
  let encoded = (value: number) => bytesToHex(new CBORWriter().uint(value).finish());
  expect(encoded(0)).toBe("00");
  expect(encoded(23)).toBe("17");
  expect(encoded(24)).toBe("1818");
  expect(encoded(255)).toBe("18ff");
  expect(encoded(256)).toBe("190100");
  expect(encoded(65535)).toBe("19ffff");
  expect(encoded(65536)).toBe("1a00010000");
  expect(encoded(0xFFFFFFFF)).toBe("1affffffff");

  let roundTrip = (value: number) => new CBORReader(new CBORWriter().uint(value).finish()).uint();
  for (let value of [0, 23, 24, 255, 256, 65535, 65536, 0xFFFFFFFF]) {
    expect(roundTrip(value)).toBe(value);
  }
});

test("a prekey serializes for the server as {id, key}", () => {
  let identity = ProteusIdentity.createNew();
  let preKey = ProteusPreKey.generate(3, 1)[0];
  let json = preKey.toJSONForServer(identity);
  expect(json.id).toBe(3);
  expect(base64Encode(base64Decode(json.key))).toBe(json.key);
  let bundle = PreKeyBundle.fromBase64(json.key);
  expect(bundle.preKeyID).toBe(3);
  expect(bytesToHex(bundle.identityKey)).toBe(bytesToHex(identity.publicKey));
  expect(bytesToHex(bundle.preKeyPublic)).toBe(bytesToHex(preKey.keyPair.publicKey));
});
