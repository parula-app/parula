/** The official MLS interop test vectors for the labelled crypto primitives,
 * from <https://github.com/mlswg/mls-implementations> `test-vectors/`.
 * They pin `RefHash`, `ExpandWithLabel`, `DeriveSecret`, `DeriveTreeSecret`,
 * `SignWithLabel` and `EncryptWithLabel` byte for byte, per cipher suite. */
import { CipherSuite } from "../../../../logic/Chat/MLS/Crypto/CipherSuite";
import { TLSReader } from "../../../../logic/Chat/MLS/Codec/TLSReader";
import { TLSWriter } from "../../../../logic/Chat/MLS/Codec/TLSWriter";
import { bytesEqual } from "../../../../logic/Chat/Signal/Crypto/primitives";
import cryptoBasics from "./vectors/crypto-basics.json";
import deserialization from "./vectors/deserialization.json";
import { expect, test } from "vitest";

for (let vector of cryptoBasics) {
  let suite = supportedSuite(vector.cipher_suite);
  if (!suite) {
    continue;
  }
  test(`crypto basics for ${suite.name}`, () => {
    let refHash = (suite as any).refHash(vector.ref_hash.label, hex(vector.ref_hash.value));
    expect(bytes(refHash)).toBe(vector.ref_hash.out);

    let expanded = suite.expandWithLabel(hex(vector.expand_with_label.secret), vector.expand_with_label.label,
      hex(vector.expand_with_label.context), vector.expand_with_label.length);
    expect(bytes(expanded)).toBe(vector.expand_with_label.out);

    let derived = suite.deriveSecret(hex(vector.derive_secret.secret), vector.derive_secret.label);
    expect(bytes(derived)).toBe(vector.derive_secret.out);

    let treeSecret = suite.deriveTreeSecret(hex(vector.derive_tree_secret.secret), vector.derive_tree_secret.label,
      vector.derive_tree_secret.generation, vector.derive_tree_secret.length);
    expect(bytes(treeSecret)).toBe(vector.derive_tree_secret.out);

    // ECDSA is randomized, so verify the vector's signature instead of comparing bytes
    expect(suite.verifyWithLabel(hex(vector.sign_with_label.pub), vector.sign_with_label.label,
      hex(vector.sign_with_label.content), hex(vector.sign_with_label.signature))).toBe(true);
    let ourSignature = suite.signWithLabel(hex(vector.sign_with_label.priv), vector.sign_with_label.label,
      hex(vector.sign_with_label.content));
    expect(suite.verifyWithLabel(hex(vector.sign_with_label.pub), vector.sign_with_label.label,
      hex(vector.sign_with_label.content), ourSignature)).toBe(true);

    let decrypted = suite.decryptWithLabel(hex(vector.encrypt_with_label.priv), vector.encrypt_with_label.label,
      hex(vector.encrypt_with_label.context),
      { kemOutput: hex(vector.encrypt_with_label.kem_output), ciphertext: hex(vector.encrypt_with_label.ciphertext) });
    expect(bytes(decrypted)).toBe(vector.encrypt_with_label.plaintext);

    // HPKE is randomized, so round-trip our own ciphertext
    let sealed = suite.encryptWithLabel(hex(vector.encrypt_with_label.pub), vector.encrypt_with_label.label,
      hex(vector.encrypt_with_label.context), hex(vector.encrypt_with_label.plaintext));
    let reopened = suite.decryptWithLabel(hex(vector.encrypt_with_label.priv), vector.encrypt_with_label.label,
      hex(vector.encrypt_with_label.context), sealed);
    expect(bytesEqual(reopened, hex(vector.encrypt_with_label.plaintext))).toBe(true);
  });
}

test("variable-length vector headers match the RFC 9420 § 2.1.2 vectors", () => {
  for (let vector of deserialization) {
    expect(new TLSReader(hex(vector.vlbytes_header)).variableLength()).toBe(vector.length);
    expect(bytes(new TLSWriter().variableLength(vector.length).finish())).toBe(vector.vlbytes_header);
  }
  // The three worked examples of RFC 9420 § 2.1.2
  expect(new TLSReader(hex("9d7f3e7d")).variableLength()).toBe(494878333);
  expect(new TLSReader(hex("7bbd")).variableLength()).toBe(15293);
  expect(new TLSReader(hex("25")).variableLength()).toBe(37);
  for (let value of [0, 1, 63, 64, 16383, 16384, 1073741823]) {
    let encoded = new TLSWriter().variableLength(value).finish();
    expect(new TLSReader(encoded).variableLength()).toBe(value);
  }
  // Non-minimal and reserved encodings must be rejected
  expect(() => new TLSReader(hex("4020")).variableLength()).toThrow();
  expect(() => new TLSReader(hex("c0000000")).variableLength()).toThrow();
});

/** null for a cipher suite that we deliberately do not implement (X448) */
function supportedSuite(id: number): CipherSuite | null {
  return CipherSuite.all.find(suite => suite.id == id) ?? null;
}

function hex(text: string): Uint8Array {
  let out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(text.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytes(data: Uint8Array): string {
  return [...data].map(b => b.toString(16).padStart(2, "0")).join("");
}
