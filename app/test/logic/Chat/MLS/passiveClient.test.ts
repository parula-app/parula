/** The official MLS interop "passive client" test vectors, from
 * <https://github.com/mlswg/mls-implementations> `test-vectors/`, trimmed to
 * the cipher suites we implement and to a size worth committing.
 *
 * This is the end-to-end test of the state machine: we join a group we know
 * nothing about from its Welcome, and then follow it as somebody else drives
 * it, epoch after epoch, through Adds, Removes, Updates, PreSharedKeys and
 * GroupContextExtensions, committed both by value and by reference. After every
 * single epoch the `epoch_authenticator` (RFC 9420 § 8.7) has to match the
 * generator's, which it only can if the tree, all three transcript hashes and
 * the whole key schedule agree down to the byte.
 *
 * `passive-client-random.json` is one long scripted run of that; the other two
 * files are the same idea per cipher suite, with a single hand-picked epoch.
 *
 * Nothing here touches the clock: the vectors were generated in 2023 and 2024,
 * so every leaf node in them has expired, and RFC 9420 § 7.3 makes the lifetime
 * check a recommendation for a leaf we receive rather than a requirement. */
import { MLSClient } from "../../../../logic/Chat/MLS/MLSClient";
import { MLSGroup } from "../../../../logic/Chat/MLS/MLSGroup";
import { RatchetTree } from "../../../../logic/Chat/MLS/Tree/RatchetTree";
import { MLSMessage } from "../../../../logic/Chat/MLS/Messages/MLSMessage";
import { KeyPackage } from "../../../../logic/Chat/MLS/Messages/KeyPackage";
import { CipherSuite } from "../../../../logic/Chat/MLS/Crypto/CipherSuite";
import welcomeVectors from "./vectors/passive-client-welcome.json";
import commitVectors from "./vectors/passive-client-handling-commit.json";
import randomVectors from "./vectors/passive-client-random.json";
import { expect, test } from "vitest";

runAll("welcome", welcomeVectors);
runAll("handling commit", commitVectors);
runAll("random", randomVectors);

function runAll(name: string, vectors: PassiveClientVector[]): void {
  vectors.forEach((vector, index) => {
    let suite = CipherSuite.all.find(suite => suite.id == vector.cipher_suite);
    if (!suite) {
      return;
    }
    test(`passive client, ${name} vector ${index}, ${vector.epochs.length} epochs, for ${suite.name}`, () => {
      let keyPackage = MLSMessage.fromBytes(hex(vector.key_package)).keyPackage;
      let client = clientFor(suite, vector, keyPackage);
      let tree = vector.ratchet_tree ? RatchetTree.fromBytes(suite, hex(vector.ratchet_tree)) : null;

      let group = MLSGroup.fromWelcome(client, MLSMessage.fromBytes(hex(vector.welcome)).welcome, tree);

      expect(bytes(group.epochAuthenticator)).toBe(vector.initial_epoch_authenticator);
      expect(bytes(group.tree.leaf(group.ourLeafIndex).toBytes())).toBe(bytes(keyPackage.leafNode.toBytes()));
      for (let epoch of vector.epochs) {
        let before = group.epoch;
        for (let proposal of epoch.proposals) {
          expect(group.process(MLSMessage.fromBytes(hex(proposal))).kind).toBe("proposal");
        }
        let result = group.process(MLSMessage.fromBytes(hex(epoch.commit)));

        expect(result.kind).toBe("commit");
        expect(result.weWereRemoved).toBe(undefined);
        expect(group.epoch).toBe(before + 1n);
        expect(bytes(group.epochAuthenticator)).toBe(epoch.epoch_authenticator);
        // Whatever the Commit did to the tree, our own view of it stays sound
        expect(bytes(group.tree.treeHash())).toBe(bytes(group.groupContext.treeHash));
        expect(group.tree.verifyParentHashes()).toBe(true);
      }
    });
  });
}

/** The client the vector describes: our KeyPackage with all three of its
 * private keys, plus the external PSKs the group will inject. */
function clientFor(suite: CipherSuite, vector: PassiveClientVector, keyPackage: KeyPackage): MLSClient {
  let client = new MLSClient(suite, keyPackage.leafNode.credential, {
    privateKey: hex(vector.signature_priv),
    publicKey: keyPackage.leafNode.signatureKey,
  });
  client.rememberKeyPackage({
    keyPackage,
    ref: keyPackage.ref(),
    initKeyPair: { privateKey: hex(vector.init_priv), publicKey: keyPackage.initKey },
    encryptionKeyPair: { privateKey: hex(vector.encryption_priv), publicKey: keyPackage.leafNode.encryptionKey },
  });
  for (let psk of vector.external_psks) {
    client.addExternalPSK(hex(psk.psk_id), hex(psk.psk));
  }
  return client;
}

interface PassiveClientVector {
  cipher_suite: number;
  external_psks: { psk_id: string, psk: string }[];
  key_package: string;
  signature_priv: string;
  encryption_priv: string;
  init_priv: string;
  welcome: string;
  ratchet_tree: string | null;
  initial_epoch_authenticator: string;
  epochs: { proposals: string[], commit: string, epoch_authenticator: string }[];
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
