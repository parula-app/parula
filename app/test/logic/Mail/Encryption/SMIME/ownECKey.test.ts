// The key classes use the app singleton. Importing it first breaks the
// import cycle, which would otherwise leave the base classes undefined.
import "../../../../../logic/app";
import { SMIMEPrivateKey } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEPrivateKey";
import { SMIMEPublicKey } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEPublicKey";
import { Any, ECPrivateKey, PrivateKeyInfo } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEASN1";
import { importPrivateKey } from "../../../../../logic/Mail/Encryption/KeyUtils";
import { kOwnP256, kOwnP384, kOwnP521, kSecp256k1Key, kEd25519Key } from "./ownECKeys";
import { NotImplemented } from "../../../../../logic/util/util";
import { expect, test, describe } from "vitest";

// The browser has these, but Node does not.
globalThis.window ??= globalThis as any;
globalThis.indexedDB ??= {
  cmp(a: Uint8Array, b: Uint8Array): number {
    let length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i++) {
      if (a[i] != b[i]) {
        return a[i] < b[i] ? -1 : 1;
      }
    }
    return Math.sign(a.length - b.length);
  },
} as any;

describe("Our own EC key", () => {
  test.each([
    ["P-256", kOwnP256, 256],
    ["P-384", kOwnP384, 384],
    ["P-521", kOwnP521, 521],
  ])("on %s is added from a PEM file", async (name, pem, bits) => {
    let key = await importPrivateKey(pem, "") as SMIMEPrivateKey;
    expect(key).toBeInstanceOf(SMIMEPrivateKey);
    expect(key.userIDs.contents).toEqual(["user@example.com"]);
    expect(key.keyLengthInBits).toBe(bits);
    // As when somebody adds our certificate, or reads mail that we signed
    expect(key.id).toBe((await SMIMEPublicKey.importPublicKey(pem)).id);
  });

  test("gets its certificate again, without it going into the chain", async () => {
    let key = await SMIMEPrivateKey.importPrivateKey(kOwnP256);
    await key.addCertificates(kOwnP256);
    expect(key.userIDs.contents).toEqual(["user@example.com"]);
    expect(key.chain.length).toBe(0);
  });

  test("on a curve that WebCrypto does not have is rejected", async () => {
    await expect(SMIMEPrivateKey.importPrivateKey(kSecp256k1Key)).rejects.toThrow(/unsupported/i);
  });

  test("of an algorithm that we do not support is rejected, naming the algorithm", async () => {
    let importing = SMIMEPrivateKey.importPrivateKey(kEd25519Key);
    await expect(importing).rejects.toThrow(NotImplemented);
    // Ed25519, by its name or its OID
    await expect(importing).rejects.toThrow(/Ed25519|1\.3\.101\.112/i);
  });

  // The public key is optional in the file, but Safari cannot use a key without it
  test("without its public key in the file is rejected", async () => {
    let privateKeyInfo = PrivateKeyInfo.decodePEM(kOwnP256, { label: "PRIVATE KEY" });
    let ecKey = ECPrivateKey.decode(privateKeyInfo.privateKey);
    delete ecKey.publicKey;
    privateKeyInfo.privateKey = ECPrivateKey.encode(ecKey);
    let pem = Any.encodePEM(PrivateKeyInfo.encode(privateKeyInfo), { label: "PRIVATE KEY" });
    await expect(SMIMEPrivateKey.importPrivateKey(pem)).rejects.toThrow(/unsupported/i);
  });
});
