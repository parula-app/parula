import { Any, AuthenticatedSafe, CertBag, Certificate, ECPrivateKey, EncryptedData, EncryptedPrivateKeyInfo, OctetString, PBEParams, PFX, PrivateKeyInfo, RSAPrivateKey, RSAPublicKey, SafeContents, type AlgorithmIdentifier, type SubjectPublicKeyInfo } from "./SMIMEASN1";
import { sameName } from "./SMIMEVerify";
import { decryptPBES2, encryptPrivateKey } from "./PBES2";
import { rc2Decrypt, rc4Decrypt, tripleDESDecrypt } from "./legacyCiphers";
import { sanitize } from "../../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../../util/util";
import { gt } from "../../../../l10n/l10n";
import { hmac } from "@noble/hashes/hmac.js";
import { sha1 } from "@noble/hashes/legacy.js";
import { sha256, sha384, sha512 } from "@noble/hashes/sha2.js";

/**
 * Reads .p12 files, also called .pfx: the private key and the certificates
 * of an S/MIME identity, protected by a passphrase. Certificate authorities
 * deliver new certificates in this format, and other mail apps export it.
 * RFC 7292
 */
export class PKCS12 {
  /** The private keys in the file, in PKCS#8 form */
  keys: Uint8Array[] = [];
  /** The certificates in the file, in X.509 DER form.
   * Typically the certificate of the key, and the CAs that signed it. */
  certificates: Uint8Array[] = [];
  protected passphrase: string;
  /** The passphrase in the form that the key derivation needs it */
  protected passphraseBytes: Uint8Array;

  constructor(passphrase: string) {
    assert(typeof passphrase == "string", "Need the passphrase");
    this.passphrase = passphrase;
    this.passphraseBytes = bmpString(passphrase);
  }

  /** Reads the contents of a .p12 file into `keys` and `certificates` */
  async read(fileContents: Uint8Array): Promise<void> {
    let pfx = PFX.decode(fileContents, { berToDER: true });
    assert(pfx.authSafe.contentType == "data", gt`This file uses an unsupported format`);
    let authSafe = OctetString.decode(pfx.authSafe.content);
    if (pfx.macData) {
      this.verifyMAC(pfx.macData, authSafe);
    }
    for (let safe of AuthenticatedSafe.decode(authSafe, { berToDER: true })) {
      await this.readSafeContents(await this.decryptSafe(safe));
    }
  }

  /**
   * Converts what we read to the PEM format that our S/MIME code reads:
   * first the private key, then its certificate, then the CA that issued
   * that, and so on, whatever their order in the file. The key is encrypted
   * again with the same passphrase, so that it is never stored in the clear.
   * A file with an empty passphrase gives an unencrypted key, which is the
   * form that `SMIMEPrivateKey` expects when there is no passphrase.
   *
   * A file with several keys is not an S/MIME identity that we could
   * represent, so only the first key is used. All certificates are kept,
   * because they form the chain up to the CA.
   */
  async toPEM(): Promise<string> {
    assert(this.keys.length, gt`This file contains no secret key`);
    let parts = [this.passphrase
      ? await encryptPrivateKey(this.keys[0], this.passphrase)
      : Any.encodePEM(this.keys[0], { label: "PRIVATE KEY" })];
    for (let certificate of this.certificatesSortedByChain()) {
      parts.push(Certificate.encodePEM(certificate, { label: "CERTIFICATE" }));
    }
    return parts.join("\n") + "\n";
  }

  /** The certificate that matches the private key first, then its issuer, and so on up to the root,
   * then the rest in file order (all of them, for a key that is neither RSA nor EC). `addCertificate()` takes
   * the first as the key's own and the rest as its chain, which `keyStatus()` checks in this order. */
  protected certificatesSortedByChain(): Certificate[] {
    let unsorted = this.certificates.map(der => Certificate.decode(der));
    let privateKeyInfo = PrivateKeyInfo.decode(this.keys[0]);
    let sorted: Certificate[] = [];
    let next = unsorted.find(cert => PKCS12.isOfKey(cert.tbsCertificate.publicKey, privateKeyInfo));
    while (next) {
      sorted.push(next);
      unsorted.splice(unsorted.indexOf(next), 1);
      let issuer = next.tbsCertificate.issuer;
      next = unsorted.find(cert => sameName(cert.tbsCertificate.subject, issuer));
    }
    return sorted.concat(unsorted);
  }

  /** Whether the public key of a certificate belongs to the private key: the same RSA modulus, or the same EC point */
  protected static isOfKey(publicKey: SubjectPublicKeyInfo, privateKeyInfo: PrivateKeyInfo): boolean {
    let algorithm = privateKeyInfo.privateKeyAlgorithm.algorithm;
    if (publicKey.algorithmIdentifier.algorithm != algorithm) {
      return false;
    }
    switch (algorithm) {
    case "ecPublicKey": {
      let point = ECPrivateKey.decode(privateKeyInfo.privateKey).publicKey?.data;
      return !!point && !indexedDB.cmp(point, publicKey.subjectPublicKey.data);
    }
    case "rsaEncryption":
      return RSAPublicKey.decode(publicKey.subjectPublicKey.data).n == RSAPrivateKey.decode(privateKeyInfo.privateKey).n;
    default:
      return false;
    }
  }

  /** Checks that the file was not modified, using the MAC over its contents.
   * This is also where a wrong passphrase shows up. */
  protected verifyMAC(macData: any, authSafe: Uint8Array) {
    let hash = sanitize.translate(macData.mac.digestAlgorithm.algorithm, kHashes);
    if (this.macMatches(macData, authSafe, hash)) {
      return;
    }
    // An empty passphrase and no passphrase at all are 2 different keys, and
    // the file does not say which of them the app that wrote it used, so try
    // the other one as well. This is the only place that can tell them apart.
    if (!this.passphrase) {
      this.passphraseBytes = kNoPassphrase;
      if (this.macMatches(macData, authSafe, hash)) {
        return;
      }
    }
    throw new Error(gt`Wrong passphrase for this file`);
  }

  protected macMatches(macData: any, authSafe: Uint8Array, hash: Hash): boolean {
    let key = this.deriveKey(KeyPurpose.MAC, hash.outputLen, macData.macSalt, macData.iterations, hash);
    return !indexedDB.cmp(hmac(hash, key, authSafe), macData.mac.digest);
  }

  /** @returns the `SafeContents` of one part of the file, decrypted if needed */
  protected async decryptSafe(safe: any): Promise<Uint8Array> {
    if (safe.contentType == "data") {
      return OctetString.decode(safe.content);
    }
    assert(safe.contentType == "encryptedData", gt`This file uses an unsupported format`);
    let { encryptedContentInfo } = EncryptedData.decode(safe.content);
    return await this.decrypt(encryptedContentInfo.contentEncryptionAlgorithm, encryptedContentInfo.encryptedContent);
  }

  protected async readSafeContents(safeContents: Uint8Array): Promise<void> {
    for (let bag of SafeContents.decode(safeContents, { berToDER: true })) {
      await this.readBag(bag);
    }
  }

  /** Reads one key or certificate. Other bags, e.g. CRLs and passwords,
   * are of no use for an S/MIME identity and are skipped. */
  protected async readBag(bag: any): Promise<void> {
    if (bag.bagId == "keyBag") {
      this.keys.push(bag.bagValue);
    } else if (bag.bagId == "pkcs8ShroudedKeyBag") {
      let encryptedKey = EncryptedPrivateKeyInfo.decode(bag.bagValue);
      this.keys.push(await this.decrypt(encryptedKey.encryptionAlgorithm, encryptedKey.encryptedData));
    } else if (bag.bagId == "certBag") {
      let certBag = CertBag.decode(bag.bagValue);
      if (certBag.certId == "x509Certificate") {
        this.certificates.push(certBag.certValue);
      }
    } else if (bag.bagId == "safeContentsBag") {
      await this.readSafeContents(bag.bagValue);
    }
  }

  /**
   * Decrypts one part of the file with our passphrase.
   * Recent files use PBES2, older ones one of the ciphers that PKCS#12
   * defines itself. Which cipher and key length to use is part of the
   * algorithm OID, so the parameters hold only the salt and iterations.
   */
  protected async decrypt(algorithm: AlgorithmIdentifier, data: Uint8Array): Promise<Uint8Array> {
    if (algorithm.algorithm == "pkcs5PBES2") {
      return await decryptPBES2(data, algorithm.parameters, this.passphrase);
    }
    let { salt, iterations } = PBEParams.decode(algorithm.parameters);
    let derive = (purpose: KeyPurpose, length: number) =>
      this.deriveKey(purpose, length, salt, iterations, sha1);
    switch (algorithm.algorithm) {
    case "pbeWithSHAAnd3KeyTripleDESCBC":
      return tripleDESDecrypt(data, derive(KeyPurpose.Key, 24), derive(KeyPurpose.IV, 8));
    case "pbeWithSHAAnd2KeyTripleDESCBC":
      return tripleDESDecrypt(data, derive(KeyPurpose.Key, 16), derive(KeyPurpose.IV, 8));
    case "pbeWithSHAAnd128BitRC2CBC":
      return rc2Decrypt(data, derive(KeyPurpose.Key, 16), derive(KeyPurpose.IV, 8), 128);
    case "pbeWithSHAAnd40BitRC2CBC":
      return rc2Decrypt(data, derive(KeyPurpose.Key, 5), derive(KeyPurpose.IV, 8), 40);
    case "pbeWithSHAAnd128BitRC4":
      return rc4Decrypt(data, derive(KeyPurpose.Key, 16));
    case "pbeWithSHAAnd40BitRC4":
      return rc4Decrypt(data, derive(KeyPurpose.Key, 5));
    default:
      throw new Error(gt`This file uses an unsupported encryption`);
    }
  }

  /**
   * Turns our passphrase into a key, an IV, or a MAC key.
   * PKCS#12 uses neither PBKDF2 nor the passphrase as-is, but its own
   * scheme: the salt and the passphrase are repeated to fill whole hash
   * blocks and hashed `iterations` times. If that gives fewer bytes than
   * we need, the result is added to the input, and it is hashed again.
   * RFC 7292 appendix B
   * @param length how many bytes to derive
   */
  protected deriveKey(purpose: KeyPurpose, length: number, salt: Uint8Array, iterations: bigint, hash: Hash): Uint8Array {
    // Cap the iterations, otherwise a malicious file would freeze the app
    let rounds = sanitize.integerRange(Number(iterations), 1, 10000000);
    let blockLength = hash.blockLen;
    let diversifier = new Uint8Array(blockLength).fill(purpose);
    let input = concat(repeatToBlocks(salt, blockLength), repeatToBlocks(this.passphraseBytes, blockLength));
    let derived = new Uint8Array(length);
    for (let pos = 0; pos < length; pos += hash.outputLen) {
      let block = hash(concat(diversifier, input));
      for (let round = 1; round < rounds; round++) {
        block = hash(block);
      }
      derived.set(block.subarray(0, Math.min(block.length, length - pos)), pos);
      // Add the result, plus 1, to each block of the input, for the next round
      let addend = repeatToBlocks(block, blockLength).subarray(0, blockLength);
      for (let start = 0; start < input.length; start += blockLength) {
        addWithCarry(input.subarray(start, start + blockLength), addend);
      }
    }
    return derived;
  }
}

/** Which value we derive from the passphrase. RFC 7292 appendix B.3 */
enum KeyPurpose {
  Key = 1,
  IV = 2,
  MAC = 3,
}

/** The hash functions that a .p12 file may use, by the name of their OID */
const kHashes = { sha1, sha256, sha384, sha512 };
type Hash = typeof sha1;

/** Some apps write a file without any passphrase, rather than with an empty
 * one, and then the passphrase is left out of the key derivation entirely.
 * That is a different key than the one an empty passphrase gives.
 * RFC 7292 appendix B.1 */
const kNoPassphrase = new Uint8Array(0);

/** The passphrase as PKCS#12 uses it: UTF-16, big endian, with a final null.
 * Characters outside the BMP go in as their 2 surrogates,
 * which is what the apps that write these files do as well. */
function bmpString(text: string): Uint8Array {
  let bytes = new Uint8Array(text.length * 2 + 2);
  let view = new DataView(bytes.buffer);
  for (let i = 0; i < text.length; i++) {
    view.setUint16(i * 2, text.charCodeAt(i));
  }
  return bytes;
}

/** Repeats the data until it fills whole hash blocks */
function repeatToBlocks(data: Uint8Array, blockLength: number): Uint8Array {
  if (!data.length) {
    return data;
  }
  let repeated = new Uint8Array(Math.ceil(data.length / blockLength) * blockLength);
  for (let pos = 0; pos < repeated.length; pos += data.length) {
    repeated.set(data.subarray(0, repeated.length - pos), pos);
  }
  return repeated;
}

/** Adds `addend` + 1 to `data`, as if both were one big number */
function addWithCarry(data: Uint8Array, addend: Uint8Array) {
  let carry = 1;
  for (let i = data.length - 1; i >= 0; i--) {
    let sum = data[i] + addend[i] + carry;
    data[i] = sum;
    carry = sum >> 8;
  }
}

function concat(first: Uint8Array, second: Uint8Array): Uint8Array {
  let combined = new Uint8Array(first.length + second.length);
  combined.set(first);
  combined.set(second, first.length);
  return combined;
}
