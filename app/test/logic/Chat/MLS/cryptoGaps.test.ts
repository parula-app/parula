/** Two things about the crypto layer that the layers above trip over:
 *
 * - MLS carries a private key as an opaque vector and never pads it to the
 *   curve's field width, so a NIST scalar with leading zero bytes arrives
 *   short, for signatures as well as for the KEM. The official
 *   `message-protection.json` vector for cipher suite 5 (P-521) is 65 bytes
 *   instead of 66.
 * - RFC 9420 § 8.3 external initialization derives the new init secret through
 *   HPKE's exporter, which `Crypto/HPKE.ts` used to omit. Without it there are
 *   no external commits, and therefore no rejoin. */
import { CipherSuite } from "../../../../logic/Chat/MLS/Crypto/CipherSuite";
import { NISTKEM, X25519KEM } from "../../../../logic/Chat/MLS/Crypto/KEM";
import { ECDSASignature, Ed25519Signature } from "../../../../logic/Chat/MLS/Crypto/SignatureScheme";
import { utf8 } from "../../../../logic/Chat/MLS/util";
import { bytesEqual, concatBytes } from "../../../../logic/Chat/Signal/Crypto/primitives";
import messageProtection from "./vectors/message-protection.json";
import { expect, test } from "vitest";

test("the short P-521 signature key of the official vector signs and verifies", () => {
  let vector = messageProtection.find(vector => vector.cipher_suite == 5);
  let suite = CipherSuite.forID(vector.cipher_suite);
  let privateKey = hex(vector.signature_priv);
  let publicKey = hex(vector.signature_pub);
  expect(privateKey.length).toBe(65); // P-521 is 66 bytes wide
  expect(publicKey.length).toBe(133);

  expect(bytesEqual(suite.signatureScheme.publicKeyFor(privateKey), publicKey)).toBe(true);
  let content = hex(vector.application);
  let signature = suite.signWithLabel(privateKey, "FramedContentTBS", content);
  expect(suite.verifyWithLabel(publicKey, "FramedContentTBS", content, signature)).toBe(true);
});

let curves: [string, ECDSASignature][] = [
  ["P-256", ECDSASignature.p256],
  ["P-384", ECDSASignature.p384],
  ["P-521", ECDSASignature.p521],
];
for (let [name, scheme] of curves) {
  test(`a ${name} private key works whatever length it arrives in`, () => {
    let { privateKey } = scheme.generateKeyPair();
    privateKey[0] = 0; // Still a valid scalar, and one byte shorter on the wire
    let publicKey = scheme.publicKeyFor(privateKey);
    let short = privateKey.slice(1);
    expect(short.length).toBe(scheme.privateKeyLength - 1);

    expect(bytesEqual(scheme.publicKeyFor(short), publicKey)).toBe(true);
    let message = utf8("What we sign");
    expect(scheme.verify(publicKey, message, scheme.sign(short, message))).toBe(true);
    expect(scheme.verify(publicKey, message, scheme.sign(privateKey, message))).toBe(true);

    // Too long is a malformed key, not a stripped one, and must not be truncated
    let long = concatBytes(new Uint8Array(1), privateKey);
    expect(() => scheme.sign(long, message)).toThrow();
    expect(() => scheme.publicKeyFor(long)).toThrow();
  });
}

test("an Ed25519 private key is a seed, so a short one is invalid, not padded", () => {
  let scheme = Ed25519Signature.instance;
  let { privateKey, publicKey } = scheme.generateKeyPair();
  let message = utf8("What we sign");
  expect(scheme.verify(publicKey, message, scheme.sign(privateKey, message))).toBe(true);
  expect(() => scheme.sign(privateKey.slice(1), message)).toThrow();
});

let kems: [string, NISTKEM][] = [
  ["P-256", NISTKEM.p256],
  ["P-384", NISTKEM.p384],
  ["P-521", NISTKEM.p521],
];
for (let [name, kem] of kems) {
  test(`a ${name} KEM private key works whatever length it arrives in`, () => {
    let { privateKey } = kem.generateKeyPair();
    privateKey[0] = 0; // Still a valid scalar, and one byte shorter on the wire
    let publicKey = kem.publicKeyFor(privateKey);
    let short = privateKey.slice(1);
    expect(short.length).toBe(kem.privateKeyLength - 1);
    expect(bytesEqual(kem.publicKeyFor(short), publicKey)).toBe(true);

    // What a restart does: the stored key comes back short and must still decapsulate
    let { sharedSecret, enc } = kem.encapsulate(publicKey);
    expect(bytesEqual(kem.decapsulate(enc, short), sharedSecret)).toBe(true);
    expect(bytesEqual(kem.decapsulate(enc, privateKey), sharedSecret)).toBe(true);

    let long = concatBytes(new Uint8Array(1), privateKey);
    expect(() => kem.publicKeyFor(long)).toThrow();
    expect(() => kem.decapsulate(enc, long)).toThrow();
  });
}

test("an X25519 private key is an opaque byte string, so a short one is invalid", () => {
  let kem = X25519KEM.instance;
  let { privateKey, publicKey } = kem.generateKeyPair();
  let { sharedSecret, enc } = kem.encapsulate(publicKey);
  expect(bytesEqual(kem.decapsulate(enc, privateKey), sharedSecret)).toBe(true);
  expect(() => kem.publicKeyFor(privateKey.slice(1))).toThrow();
});

for (let suite of CipherSuite.all) {
  test(`the HPKE context seals, opens and exports for ${suite.name}`, () => {
    let recipient = suite.kem.generateKeyPair();
    let info = utf8("Some info");
    let { enc, context } = suite.hpke.setupBaseS(recipient.publicKey, info);
    let receiver = suite.hpke.setupBaseR(enc, recipient.privateKey, info);

    let aad = utf8("Some aad");
    let plaintext = utf8("Some plaintext");
    expect(bytesEqual(receiver.open(aad, context.seal(aad, plaintext)), plaintext)).toBe(true);

    let exporterContext = utf8("Some exporter context");
    let exported = context.export(exporterContext, 32);
    expect(bytesEqual(receiver.export(exporterContext, 32), exported)).toBe(true);
    expect(exported.length).toBe(32);
    expect(bytesEqual(context.export(utf8("Another exporter context"), 32), exported)).toBe(false);
    expect(bytesEqual(context.export(exporterContext, 64).subarray(0, 32), exported)).toBe(false);

    // A different recipient key must not arrive at the same exported secret
    let stranger = suite.kem.generateKeyPair();
    expect(bytesEqual(suite.hpke.setupBaseR(enc, stranger.privateKey, info).export(exporterContext, 32),
      exported)).toBe(false);
  });

  test(`the external init secret matches on both sides for ${suite.name}`, () => {
    // In a group, this pair is KEM.DeriveKeyPair(external_secret), RFC 9420 § 8
    let external = suite.kem.generateKeyPair();
    let { kemOutput, initSecret } = suite.hpke.sendExternalInitSecret(external.publicKey);
    expect(initSecret.length).toBe(suite.kdf.hashLength);
    expect(kemOutput.length).toBe(suite.kem.publicKeyLength);

    expect(bytesEqual(suite.hpke.receiveExternalInitSecret(external.privateKey, kemOutput), initSecret)).toBe(true);
    // Every external commit brings its own init secret
    expect(bytesEqual(suite.hpke.sendExternalInitSecret(external.publicKey).initSecret, initSecret)).toBe(false);
    let stranger = suite.kem.generateKeyPair();
    expect(bytesEqual(suite.hpke.receiveExternalInitSecret(stranger.privateKey, kemOutput), initSecret)).toBe(false);
  });
}

/** The exporter must be HPKE's own `LabeledExpand(exporter_secret, "sec", …)`
 * and not MLS `ExpandWithLabel`, so redo RFC 9180 § 5.1 and § 5.3 here from the
 * RFC text, over a shared secret that we encapsulate ourselves. */
test("the external init secret is the HPKE exporter of RFC 9180 § 5.3", () => {
  let suite = CipherSuite.forID(0x0001);
  let recipient = suite.kem.generateKeyPair();
  let { sharedSecret, enc } = suite.kem.encapsulate(recipient.publicKey);
  let empty = new Uint8Array(0);
  let suiteID = concatBytes(utf8("HPKE"), uint16(suite.kem.id), uint16(suite.kdf.id), uint16(suite.aead.id));
  let extract = (salt: Uint8Array, label: string, ikm: Uint8Array) =>
    suite.kdf.extract(salt, concatBytes(utf8("HPKE-v1"), suiteID, utf8(label), ikm));
  let expand = (prk: Uint8Array, label: string, info: Uint8Array, length: number) =>
    suite.kdf.expand(prk, concatBytes(uint16(length), utf8("HPKE-v1"), suiteID, utf8(label), info), length);

  // MLS § 8.3 sets up with an empty info
  let scheduleContext = concatBytes(new Uint8Array([0x00]),
    extract(empty, "psk_id_hash", empty), extract(empty, "info_hash", empty));
  let secret = extract(sharedSecret, "secret", empty);
  let exporterSecret = expand(secret, "exp", scheduleContext, suite.kdf.hashLength);
  let exporterContext = utf8("MLS 1.0 external init secret");
  let expected = expand(exporterSecret, "sec", exporterContext, suite.kdf.hashLength);

  expect(bytesEqual(suite.hpke.setupBaseR(enc, recipient.privateKey, empty)
    .export(exporterContext, suite.kdf.hashLength), expected)).toBe(true);
  expect(bytesEqual(suite.hpke.receiveExternalInitSecret(recipient.privateKey, enc), expected)).toBe(true);
});

function uint16(value: number): Uint8Array {
  return new Uint8Array([value >> 8 & 0xFF, value & 0xFF]);
}

function hex(text: string): Uint8Array {
  let out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(text.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}
