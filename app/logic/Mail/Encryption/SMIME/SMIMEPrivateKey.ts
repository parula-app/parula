import type { PrivateKey } from "../PrivateKey";
import { SMIMEPublicKey, splitPEM } from "./SMIMEPublicKey";
import { Any, PrivateKeyInfo, EncryptedPrivateKeyInfo, RSAPrivateKey, RSAPublicKey, ECPrivateKey, ECDSASigValue, SubjectPublicKeyInfo, CertificationRequestInfo, DigestInfo, DigestAlgorithm, CertificationRequest, Null, OctetString, Extensions, SubjectAlternativeName, KeyUsage, ExtKeyUsage, AlgorithmIdentifier, KeyAgreementAlgorithm, KeyWrapAlgorithm } from "./SMIMEASN1";
import { decryptPBES2, encryptPrivateKey } from "./PBES2";
import { decrypt, padFF } from "./SMIMERSAES";
import { sameName } from "./SMIMEVerify";
import { uint8ArrayToHex } from "../../../util/blob";
import { sanitize } from "../../../../../lib/util/sanitizeDatatypes";
import { notifyChangedProperty } from "../../../util/Observable";
import { assert, NotImplemented, UserError } from "../../../util/util";
import { gt } from "../../../../l10n/l10n";

export class SMIMEPrivateKey extends SMIMEPublicKey implements PrivateKey {
  /**
   * Armored private S/MIME key
   * This is super secret and should never leak.
   */
  protected privateKeyArmored: string;
  passphrase: string;

  /** User wishes to sign all outgoing emails */
  @notifyChangedProperty
  useToSign = false;
  @notifyChangedProperty
  didBackup = false;
  justCreated = false;

  /** User wishes to send encrypted emails whenever possible */
  get encryptByDefault(): boolean {
    return this._encryptByDefault;
  }
  set encryptByDefault(val: boolean) {
    this._encryptByDefault = val;
    if (this._encryptByDefault) {
      this.useToSign = true;
    }
  }

  async matches(publicKey: SubjectPublicKeyInfo): Promise<boolean> {
    let privateKeyInfo = PrivateKeyInfo.decode(await this.decryptKeyPKCS8());
    if (privateKeyInfo.privateKeyAlgorithm.algorithm == "ecPublicKey") {
      return !indexedDB.cmp(SubjectPublicKeyInfo.encode(publicKey), SubjectPublicKeyInfo.encode(this.ecPublicKey(privateKeyInfo)));
    }
    if (publicKey.algorithmIdentifier.algorithm != "rsaEncryption") {
      return false;
    }
    let key = RSAPublicKey.decode(publicKey.subjectPublicKey.data);
    let rawKey = RSAPrivateKey.decode(privateKeyInfo.privateKey);
    return key.n == rawKey.n && key.e == rawKey.e;
  }

  /** Our public key, as our certificate has it, from our EC private key */
  protected ecPublicKey(privateKeyInfo: PrivateKeyInfo): SubjectPublicKeyInfo {
    let { publicKey } = ECPrivateKey.decode(privateKeyInfo.privateKey);
    // Optional in RFC 5915, but all common apps write it, and Safari cannot import a key without it
    assert(publicKey, "Unsupported private key: It does not contain its public key");
    return { algorithmIdentifier: privateKeyInfo.privateKeyAlgorithm, subjectPublicKey: publicKey };
  }

  /** @param rid as decoded from a `KeyTransRecipientInfo` or `RecipientEncryptedKey` of the message */
  isRecipient(rid: any): boolean {
    if (!this.certificate) {
      return false;
    }
    let cert = this.decodedCertificate;
    switch (rid.type) {
    case "issuerAndSerialNumber":
      return rid.value.serialNumber == cert.tbsCertificate.serialNumber &&
        sameName(rid.value.issuer, cert.tbsCertificate.issuer);
    case "subjectKeyIdentifier": {
      let ski = cert.tbsCertificate.extensions?.find(ext => ext.extnID == "subjectKeyIdentifier");
      return !!ski && !indexedDB.cmp(OctetString.decode(ski.extnValue), rid.value);
    }
    case "rKeyId":
      return this.isRecipient({ type: "subjectKeyIdentifier", value: rid.value.subjectKeyIdentifier });
    default:
      return false;
    }
  }

  /** Decrypts the content key that the sender encrypted to our EC key with ECDH. RFC 5753 section 3.1.2
   * @param kari as decoded from a `KeyAgreeRecipientInfo` of the message */
  async decryptKeyAgreement(kari: any, encryptedKey: Uint8Array): Promise<Uint8Array> {
    let { originator, ukm, keyEncryptionAlgorithm } = kari;
    let keyWrapAlgorithm = AlgorithmIdentifier.decode(keyEncryptionAlgorithm.parameters);
    let hash = sanitize.translate(keyEncryptionAlgorithm.algorithm, KeyAgreementAlgorithm, null);
    if (!hash || !sanitize.translate(keyWrapAlgorithm.algorithm, KeyWrapAlgorithm, null)) {
      throw new NotImplemented(gt`The key of this message is encrypted with ECDH using ${keyEncryptionAlgorithm.algorithm} and ${keyWrapAlgorithm.algorithm}, which is not supported`);
    }
    assert(originator.type == "originatorKey" && originator.value.algorithm.algorithm == "ecPublicKey", "Unsupported ECDH: The key of the sender is missing");
    // Outlook sends its key without the curve, so it is on the curve of our key
    let curve = this.curveBits(this.decodedCertificate.tbsCertificate.publicKey);
    let algorithm = { name: "ECDH", namedCurve: "P-" + curve };
    let senderKey = await crypto.subtle.importKey("raw", originator.value.publicKey.data as BufferSource, algorithm, false, []);
    let ourKey = await crypto.subtle.importKey("pkcs8", await this.decryptKeyPKCS8() as BufferSource, algorithm, false, ["deriveBits"]);
    let secret = await crypto.subtle.deriveBits({ name: "ECDH", public: senderKey }, ourKey, (curve + 7 >> 3) * 8);
    let keyEncryptionKey = await this.keyEncryptionKey(secret, hash, keyEncryptionAlgorithm.parameters, ukm);
    try {
      let key = await crypto.subtle.unwrapKey("raw", encryptedKey as BufferSource, keyEncryptionKey, "AES-KW", "AES-CBC", true, ["decrypt"]);
      return new Uint8Array(await crypto.subtle.exportKey("raw", key));
    } catch (ex) {
      throw new UserError(gt`Could not decrypt this message`);
    }
  }

  /** Decrypts our private key with our passphrase */
  async decryptKey(): Promise<RSAPrivateKey> {
    let privateKeyInfo = PrivateKeyInfo.decode(await this.decryptKeyPKCS8());
    if (privateKeyInfo.privateKeyAlgorithm.algorithm != "rsaEncryption") {
      throw new Error("Unsupported private key algorithm");
    }
    return RSAPrivateKey.decode(privateKeyInfo.privateKey);
  }

  /** Decrypts our private key with our passphrase, in the PKCS#8 form that `crypto.subtle.importKey()` reads */
  protected async decryptKeyPKCS8(): Promise<Uint8Array> {
    let pkcs8: Uint8Array;
    if (this.passphrase) {
      let encryptedKey = EncryptedPrivateKeyInfo.decodePEM(this.privateKeyArmored, { label: "ENCRYPTED PRIVATE KEY" });
      if (encryptedKey.encryptionAlgorithm.algorithm != "pkcs5PBES2") {
        throw new Error("Unsupported private key encryption algorithm");
      }
      pkcs8 = await decryptPBES2(encryptedKey.encryptedData, encryptedKey.encryptionAlgorithm.parameters, this.passphrase);
    } else {
      pkcs8 = Any.decodePEM(this.privateKeyArmored, { label: "PRIVATE KEY" });
    }
    return pkcs8;
  }

  privateKeyAsFile(): File {
    return this.keyAsFile(this.privateKeyArmored, "application/pkcs8", "SecretKey", "key");
  }

  /** The digest algorithm of our signatures. For EC keys, the one that fits the curve, as Thunderbird does. */
  get digestAlgorithm(): string {
    const kCurveDigests: Record<number, string> = { 256: "sha256", 384: "sha384", 521: "sha512" };
    let publicKey = this.decodedCertificate.tbsCertificate.publicKey;
    if (publicKey.algorithmIdentifier.algorithm == "ecPublicKey") {
      return kCurveDigests[this.curveBits(publicKey)];
    }
    return "sha256";
  }

  /** Signs the signed attributes of a `SignerInfo`, with RSA PKCS#1 v1.5 or, for EC keys, ECDSA */
  async sign(content: Uint8Array, digestAlgorithm: string): Promise<{ signatureAlgorithm: AlgorithmIdentifier, signature: Uint8Array }> {
    let hash = DigestAlgorithm[digestAlgorithm];
    let publicKey = this.decodedCertificate.tbsCertificate.publicKey;
    if (publicKey.algorithmIdentifier.algorithm == "ecPublicKey") {
      const kECDSAAlgorithms: Record<string, string> = { sha256: "ecdsaWithSHA256", sha384: "ecdsaWithSHA384", sha512: "ecdsaWithSHA512" };
      let key = await crypto.subtle.importKey("pkcs8", await this.decryptKeyPKCS8() as BufferSource, { name: "ECDSA", namedCurve: "P-" + this.curveBits(publicKey) }, false, ["sign"]);
      // WebCrypto gives r and s one after the other, but CMS wants an `ECDSASigValue`
      let rs = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash }, key, content as BufferSource));
      let size = rs.length / 2;
      return {
        signatureAlgorithm: { algorithm: kECDSAAlgorithms[digestAlgorithm], parameters: undefined },
        signature: ECDSASigValue.encode({
          r: BigInt("0x" + uint8ArrayToHex(rs.subarray(0, size))),
          s: BigInt("0x" + uint8ArrayToHex(rs.subarray(size))),
        }),
      };
    }
    let rawKey = await this.decryptKey();
    let digestInfo = {
      digestAlgorithm: {
        algorithm: digestAlgorithm,
        parameters: Null.encode(),
      },
      digest: new Uint8Array(await crypto.subtle.digest(hash, content as BufferSource)),
    };
    return {
      signatureAlgorithm: {
        algorithm: "rsaEncryption",
        parameters: Null.encode(),
      },
      signature: decrypt(padFF(DigestInfo.encode(digestInfo), rawKey), rawKey),
    };
  }

  async generateCSRFile(subject: Record<string, string>): Promise<File> {
    let key = await this.decryptKey();
    let subjectSequence = [];
    for (let attr in attributeTypes) {
      if (subject[attr]) {
        subjectSequence.push({
          type: attr,
          value: {
            type: attributeTypes[attr],
            value: subject[attr],
          }
        });
      }
    }
    let info = {
      version: 0n,
      subject: subjectSequence,
      subjectPublicKeyInfo: {
        algorithmIdentifier: {
          algorithm: "rsaEncryption",
          parameters: Null.encode(),
        },
        subjectPublicKey: {
          unused: 0,
          data: RSAPublicKey.encode(key),
        },
      },
      attributes: [{
        attrType: "extensionRequest",
        attrValue: [Extensions.encode([{
          extnID: "subjectAlternativeName",
          extnValue: SubjectAlternativeName.encode([{ type: "rfc822Name", value: subject.E }]),
        }, {
          extnID: "keyUsage",
          critical: true,
          // digitalSignature and keyEncipherment
          extnValue: KeyUsage.encode({ unused: 5, data: Uint8Array.of(0b10100000) }),
        }, {
          extnID: "extKeyUsage",
          extnValue: ExtKeyUsage.encode(["emailProtection"]),
        }])],
      }],
    };
    let digestInfo = {
      digestAlgorithm: {
        algorithm: "sha256",
        parameters: Null.encode(),
      },
      digest: new Uint8Array(await crypto.subtle.digest("SHA-256", CertificationRequestInfo.encode(info))),
    };
    let request = {
      certificationRequestInfo: info,
      signatureAlgorithm: {
        algorithm: "sha256WithRSAEncryption",
        parameters: Null.encode(),
      },
      signature: {
        unused: 0,
        data: decrypt(padFF(DigestInfo.encode(digestInfo), key), key),
      },
    };
    return this.keyAsFile(CertificationRequest.encodePEM(request, { label: "CERTIFICATE REQUEST" }), "application/pkcs10", "CertificateRequest", "csr");
  }

  /** Generates a new private key from scratch.
   * @param emailAddress of the identity that the key is for
   * Factory function. */
  static async createNewPrivateKey(emailAddress: string): Promise<SMIMEPrivateKey> {
    let passphrase = crypto.randomUUID();
    let { privateKey } = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 4096, publicExponent: Uint8Array.of(1, 0, 1), hash: "SHA-256" }, true, ["sign"]);
    let privateKeyPKCS8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", privateKey));
    let rsaKey = RSAPrivateKey.decode(PrivateKeyInfo.decode(privateKeyPKCS8).privateKey);
    let key = new SMIMEPrivateKey();
    key.privateKeyArmored = await encryptPrivateKey(privateKeyPKCS8, passphrase);
    key.passphrase = passphrase;
    key.id = key.keyID(rsaKey);
    key.name = key.defaultName;
    key.userIDs.add(emailAddress);
    key.keyLengthInBits = 4096;
    key.justCreated = true;
    key.created = new Date();
    key.fingerprint = "--";
    return key;
  }

  /**
   * Reads an S/MIME private key from a file.
   * Factory function.
   */
  static async importPrivateKey(privateKey: string, passphrase?: string): Promise<SMIMEPrivateKey> {
    let key = new SMIMEPrivateKey();
    key.privateKeyArmored = splitPEM(privateKey).shift();
    key.passphrase = passphrase;
    let privateKeyInfo = PrivateKeyInfo.decode(await key.decryptKeyPKCS8());
    if (privateKeyInfo.privateKeyAlgorithm.algorithm == "ecPublicKey") {
      let publicKey = key.ecPublicKey(privateKeyInfo);
      key.cipher = "EC";
      key.keyLengthInBits = key.curveBits(publicKey);
      assert(key.keyLengthInBits, "Unsupported elliptic curve");
      key.id = key.publicKeyID(publicKey);
    } else {
      let rawKey = await key.decryptKey();
      assert(rawKey.n == rawKey.p * rawKey.q, "modulus should be product of primes");
      assert(rawKey.d * rawKey.e % (rawKey.p - 1n) == 1n, "prime exponents product should equal 1 modulo 1 less than prime 1");
      assert(rawKey.d * rawKey.e % (rawKey.q - 1n) == 1n, "prime exponents product should equal 1 modulo 1 less than prime 2");
      assert(rawKey.dP == rawKey.d % (rawKey.p - 1n), "prime 1 exponent does not match private exponent");
      assert(rawKey.dQ == rawKey.d % (rawKey.q - 1n), "prime 2 exponent does not match private exponent");
      assert(rawKey.qInv * rawKey.q % rawKey.p == 1n, "inverse does not match primes");
      let id = sanitize.bigint(rawKey.n).toString(16);
      key.id = key.keyID(rawKey);
      key.keyLengthInBits = id.length * 4;
    }
    key.name = key.defaultName;
    key.justCreated = true;
    key.created = new Date();
    key.fingerprint = "--";
    await key.addCertificates(privateKey);
    return key;
  }

  toJSON() {
    let json = super.toJSON();
    json.privateKeyArmored = this.privateKeyArmored;
    json.useToSign = this.useToSign;
    json.didBackup = this.didBackup;
    json.passphrase = this.passphrase;
    return json;
  }
  fromJSON(json: any) {
    super.fromJSON(json);
    this.privateKeyArmored = sanitize.nonemptystring(json.privateKeyArmored, null);
    this.useToSign = sanitize.boolean(json.useToSign, null);
    this.didBackup = sanitize.boolean(json.didBackup, null);
    this.passphrase = sanitize.string(json.passphrase, null);
  }
}

const attributeTypes: Record<string, "printstr" | "utf8str" | "ia5str"> = {
  C: "printstr", // country
  ST: "utf8str", // state
  L: "utf8str", // locality (city)
  O: "utf8str", // organisation
  OU: "utf8str", // organisational unit
  CN: "utf8str", // commonName
  E: "ia5str", // emailAddress
};
