/** The official MLS interop test vectors for the secret tree, from
 * <https://github.com/mlswg/mls-implementations> `test-vectors/`, trimmed to the
 * cipher suites we implement.
 *
 * They pin the tree derivation of RFC 9420 § 9, both sender ratchets of § 9.1
 * and the sender-data key of § 6.3.2. Each leaf is checked at generation 0 and
 * again at generation 15, so the ratchet also has to skip correctly. */
import { SecretTree } from "../../../../logic/Chat/MLS/Tree/SecretTree";
import { CipherSuite } from "../../../../logic/Chat/MLS/Crypto/CipherSuite";
import secretTrees from "./vectors/secret-tree.json";
import { expect, test } from "vitest";

for (let vector of secretTrees) {
  let suite = supportedSuite(vector.cipher_suite);
  if (!suite) {
    continue;
  }
  test(`secret tree of ${vector.leaves.length} leaves for ${suite.name}`, () => {
    let tree = newTree(suite, vector);
    let senderData = tree.senderDataKey(hex(vector.sender_data.ciphertext));
    expect(bytes(senderData.key)).toBe(vector.sender_data.key);
    expect(bytes(senderData.nonce)).toBe(vector.sender_data.nonce);

    for (let leafIndex = 0; leafIndex < vector.leaves.length; leafIndex++) {
      for (let expected of vector.leaves[leafIndex]) {
        let handshake = tree.handshakeKey(leafIndex, expected.generation);
        expect(bytes(handshake.key)).toBe(expected.handshake_key);
        expect(bytes(handshake.nonce)).toBe(expected.handshake_nonce);

        let application = tree.applicationKey(leafIndex, expected.generation);
        expect(bytes(application.key)).toBe(expected.application_key);
        expect(bytes(application.nonce)).toBe(expected.application_nonce);
      }
    }
  });
}

test("a secret tree can be walked in any leaf order", () => {
  let vector = secretTrees.find(vector => vector.cipher_suite == 1 && vector.leaves.length > 1);
  let tree = newTree(CipherSuite.forID(vector.cipher_suite), vector);
  for (let leafIndex = vector.leaves.length - 1; leafIndex >= 0; leafIndex--) {
    expect(bytes(tree.applicationKey(leafIndex, 0).key)).toBe(vector.leaves[leafIndex][0].application_key);
  }
});

test("a message that arrives late still gets its key, but only once", () => {
  let vector = secretTrees.find(vector => vector.cipher_suite == 1);
  let suite = CipherSuite.forID(vector.cipher_suite);
  let inOrder = newTree(suite, vector);
  let expected = [0, 1, 2].map(generation => bytes(inOrder.applicationKey(0, generation).key));

  // Generation 2 arrives first; 0 and 1 are late, but their keys are kept
  let tree = newTree(suite, vector);
  let third = tree.applicationKey(0, 2);
  expect(bytes(tree.applicationKey(0, 0).key)).toBe(expected[0]);
  expect(bytes(tree.applicationKey(0, 1).key)).toBe(expected[1]);
  expect(bytes(third.key)).toBe(expected[2]);
  // Keys are single use, RFC 9420 § 9.1
  expect(() => tree.applicationKey(0, 1)).toThrow();
  expect(() => tree.applicationKey(0, 2)).toThrow();
  // And a sender cannot make us derive billions of keys, RFC 9420 § 15.3
  expect(() => tree.applicationKey(0, 0xFFFFFFFF)).toThrow();

  // Our own messages simply count up, and use the same keys
  let ourTree = newTree(suite, vector);
  expect(ourTree.nextApplicationKey(0).generation).toBe(0);
  let second = ourTree.nextApplicationKey(0);
  expect(second.generation).toBe(1);
  expect(bytes(second.key)).toBe(expected[1]);
  expect(ourTree.nextHandshakeKey(0).generation).toBe(0);
});

function newTree(suite: CipherSuite, vector: typeof secretTrees[0]): SecretTree {
  return new SecretTree(suite, vector.leaves.length, hex(vector.encryption_secret),
    hex(vector.sender_data.sender_data_secret));
}

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
