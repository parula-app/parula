import { EncryptedPrivateKeyInfo, KeyDerivationAlgorithm, Null, OctetString, PBES2Params, PBKDF2Params } from "./SMIMEASN1";
import { tripleDESDecrypt } from "./legacyCiphers";
import { sanitize } from "../../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../../util/util";

/**
 * Decrypts data that is protected with a passphrase, using PBES2, RFC 8018.
 * The passphrase is stretched with PBKDF2, and the result is used as the
 * key for AES or Triple DES in CBC mode.
 * @param parameters the parameters of the `pkcs5PBES2` algorithm identifier
 */
export async function decryptPBES2(data: Uint8Array, parameters: Uint8Array, passphrase: string): Promise<Uint8Array> {
  let pbes2 = PBES2Params.decode(parameters);
  if (pbes2.keyDerivationFunc.algorithm != "pkcs5PBKDF2") {
    throw new Error("Unsupported private key derivation function");
  }
  let pbkdf2 = PBKDF2Params.decode(pbes2.keyDerivationFunc.parameters);
  if (pbkdf2.salt.type != "specified") {
    throw new Error("Unsupported private key derivation salt");
  }
  let hash = sanitize.translate(pbkdf2.prf.algorithm, KeyDerivationAlgorithm);
  // Cap the iterations, otherwise a malicious key file would freeze the app
  let iterations = sanitize.integerRange(Number(pbkdf2.iterationCount), 1, 10000000);
  let derivation = { name: "PBKDF2", salt: pbkdf2.salt.value, iterations, hash };
  let passphraseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveBits", "deriveKey"]);
  let iv = OctetString.decode(pbes2.encryptionScheme.parameters);
  if (pbes2.encryptionScheme.algorithm == "desEDE3CBC") {
    // WebCrypto does not implement Triple DES
    let key = new Uint8Array(await crypto.subtle.deriveBits(derivation, passphraseKey, 24 * 8));
    return tripleDESDecrypt(data, key, iv);
  }
  let length = sanitize.translate(pbes2.encryptionScheme.algorithm, { aes128cbc: 128, aes192cbc: 192, aes256cbc: 256 });
  let key = await crypto.subtle.deriveKey(derivation, passphraseKey, { name: "AES-CBC", length }, false, ["decrypt"]);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv }, key, data));
}

/**
 * Encrypts a private key with a passphrase, using PBES2 with AES-256-CBC,
 * so that we do not store the key in the clear.
 * @param privateKey the key in PKCS#8 form
 * @returns the encrypted key, ASCII-armored
 */
export async function encryptPrivateKey(privateKey: Uint8Array, passphrase: string): Promise<string> {
  assert(passphrase, "Need a passphrase to protect the private key");
  let salt = crypto.getRandomValues(new Uint8Array(8));
  let iv = crypto.getRandomValues(new Uint8Array(16));
  let passphraseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  let derivedKey = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 2048, hash: "SHA-256" }, passphraseKey, { name: "AES-CBC", length: 256 }, false, ["encrypt"]);
  let encryptedData = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv }, derivedKey, privateKey));
  let pbkdf2: PBKDF2Params = { salt: { type: "specified", value: salt }, iterationCount: 2048n, prf: { algorithm: "hmacWithSHA256", parameters: Null.encode() } };
  let pbes2 = { keyDerivationFunc: { algorithm: "pkcs5PBKDF2", parameters: PBKDF2Params.encode(pbkdf2) }, encryptionScheme: { algorithm: "aes256cbc", parameters: OctetString.encode(iv) } };
  let encryptedKey = { encryptionAlgorithm: { algorithm: "pkcs5PBES2", parameters: PBES2Params.encode(pbes2) }, encryptedData };
  return EncryptedPrivateKeyInfo.encodePEM(encryptedKey, { label: "ENCRYPTED PRIVATE KEY" });
}
