/** The official MLS interop test vectors for Welcome, from
 * <https://github.com/mlswg/mls-implementations> `test-vectors/`, trimmed to
 * the cipher suites we implement.
 *
 * Each entry is one KeyPackage of ours plus the Welcome that consumed it, and
 * the vector prescribes exactly what to check: find our `EncryptedGroupSecrets`
 * by `KeyPackageRef`, decrypt it with the init key, derive the welcome key from
 * the joiner secret, decrypt the GroupInfo, verify its signature against
 * `signer_pub`, and check its confirmation tag against the key schedule that
 * the joiner secret produces.
 *
 * That is as far as this vector goes: its GroupInfo carries no `ratchet_tree`
 * extension and it comes with neither the leaf's encryption key nor a tree, so
 * the group state cannot be built from it. Joining for real, from a Welcome
 * that does carry its tree, is `passiveClient.test.ts`. */
import { MLSClient } from "../../../../logic/Chat/MLS/MLSClient";
import { MLSGroup } from "../../../../logic/Chat/MLS/MLSGroup";
import { KeySchedule } from "../../../../logic/Chat/MLS/KeySchedule";
import { MLSMessage } from "../../../../logic/Chat/MLS/Messages/MLSMessage";
import { KeyPackage } from "../../../../logic/Chat/MLS/Messages/KeyPackage";
import { CipherSuite } from "../../../../logic/Chat/MLS/Crypto/CipherSuite";
import welcomeVectors from "./vectors/welcome.json";
import { expect, test } from "vitest";

welcomeVectors.forEach((vector, index) => {
  let suite = CipherSuite.all.find(suite => suite.id == vector.cipher_suite);
  if (!suite) {
    return;
  }
  let keyPackageOf = () => MLSMessage.fromBytes(hex(vector.key_package)).keyPackage;
  let welcomeOf = () => MLSMessage.fromBytes(hex(vector.welcome)).welcome;

  test(`welcome vector ${index} for ${suite.name}`, () => {
    let keyPackage = keyPackageOf();
    let welcome = welcomeOf();
    expect(welcome.suite).toBe(suite);
    expect(welcome.find(keyPackage.ref())).not.toBe(null);

    let secrets = welcome.groupSecretsFor(keyPackage.ref(), hex(vector.init_priv));
    let noPSKs = new Uint8Array(suite.secretLength);
    // The welcome key hangs off the joiner secret alone, which is just as well:
    // the GroupContext it needs otherwise is inside the GroupInfo it decrypts
    let welcomeKey = KeySchedule.fromJoinerSecret(suite, secrets.joinerSecret, kNoBytes, noPSKs)
      .welcomeKeyAndNonce();
    let groupInfo = welcome.decryptGroupInfo(welcomeKey);

    expect(groupInfo.verify(hex(vector.signer_pub))).toBe(true);
    expect(groupInfo.groupContext.suite).toBe(suite);
    let epoch = KeySchedule.fromJoinerSecret(suite, secrets.joinerSecret, groupInfo.groupContext.toBytes(), noPSKs);
    expect(groupInfo.verifyConfirmationTag(epoch.confirmationKey)).toBe(true);
    expect(groupInfo.confirmationTag.length).toBe(suite.secretLength);
    expect(epoch.epochAuthenticator.length).toBe(suite.secretLength);
  });

  test(`welcome vector ${index} for ${suite.name} needs the ratchet tree to join`, () => {
    let keyPackage = keyPackageOf();
    let client = clientFor(suite, keyPackage, hex(vector.init_priv));

    // Everything up to the tree works; the tree is what this vector leaves out
    expect(() => MLSGroup.fromWelcome(client, welcomeOf())).toThrow(/no ratchet_tree extension/);
    expect(client.keyPackageForRef(keyPackage.ref())).not.toBe(null);
  });

  test(`welcome vector ${index} for ${suite.name} is not for anybody else's KeyPackage`, () => {
    let client = MLSClient.create(suite, keyPackageOf().leafNode.credential);

    expect(() => MLSGroup.fromWelcome(client, welcomeOf())).toThrow(/not addressed to any KeyPackage/);
  });
});

/** A client that holds the KeyPackage the vector says the Welcome consumed.
 * Only the init key opens the Welcome; the leaf's encryption private key is not
 * part of the vector, and nothing here gets far enough to use it. */
function clientFor(suite: CipherSuite, keyPackage: KeyPackage, initPrivateKey: Uint8Array): MLSClient {
  let client = MLSClient.create(suite, keyPackage.leafNode.credential);
  client.rememberKeyPackage({
    keyPackage,
    ref: keyPackage.ref(),
    initKeyPair: { privateKey: initPrivateKey, publicKey: keyPackage.initKey },
    encryptionKeyPair: {
      privateKey: new Uint8Array(suite.kem.privateKeyLength),
      publicKey: keyPackage.leafNode.encryptionKey,
    },
  });
  return client;
}

function hex(text: string): Uint8Array {
  let out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(text.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

const kNoBytes = new Uint8Array(0);
