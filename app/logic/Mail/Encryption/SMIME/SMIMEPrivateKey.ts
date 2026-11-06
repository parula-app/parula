import type { PrivateKey } from "../PrivateKey";
import { SMIMEPublicKey, splitPEM } from "./SMIMEPublicKey";
import { Any, PrivateKeyInfo, EncryptedPrivateKeyInfo, RSAPrivateKey, RSAPublicKey, CertificationRequestInfo, DigestInfo, CertificationRequest, Null, Extensions, SubjectAlternativeName, KeyUsage, ExtKeyUsage } from "./SMIMEASN1";
import { decryptPBES2, encryptPrivateKey } from "./PBES2";
import { decrypt, padFF } from "./SMIMERSAES";
import { sanitize } from "../../../../../lib/util/sanitizeDatatypes";
import { notifyChangedProperty } from "../../../util/Observable";
import { assert } from "../../../util/util";

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

  async matches(key: RSAPublicKey): Promise<boolean> {
    let rawKey = await this.decryptKey();
    return key.n == rawKey.n && key.e == rawKey.e;
  }

  /** Decrypts our private key with our passphrase */
  async decryptKey(): Promise<RSAPrivateKey> {
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
    let privateKeyInfo = PrivateKeyInfo.decode(pkcs8);
    if (privateKeyInfo.privateKeyAlgorithm.algorithm != "rsaEncryption") {
      throw new Error("Unsupported private key algorithm");
    }
    return RSAPrivateKey.decode(privateKeyInfo.privateKey);
  }

  privateKeyAsFile(): File {
    return this.keyAsFile(this.privateKeyArmored, "application/pkcs8", "SecretKey", "key");
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
    key.id = rsaKey.n.toString(16).slice(-16);
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
    let rawKey = await key.decryptKey();
    assert(rawKey.n == rawKey.p * rawKey.q, "modulus should be product of primes");
    assert(rawKey.d * rawKey.e % (rawKey.p - 1n) == 1n, "prime exponents product should equal 1 modulo 1 less than prime 1");
    assert(rawKey.d * rawKey.e % (rawKey.q - 1n) == 1n, "prime exponents product should equal 1 modulo 1 less than prime 2");
    assert(rawKey.dP == rawKey.d % (rawKey.p - 1n), "prime 1 exponent does not match private exponent");
    assert(rawKey.dQ == rawKey.d % (rawKey.q - 1n), "prime 2 exponent does not match private exponent");
    assert(rawKey.qInv * rawKey.q % rawKey.p == 1n, "inverse does not match primes");
    let id = sanitize.bigint(rawKey.n).toString(16);
    key.id = id.slice(-16);
    key.name = key.defaultName;
    key.keyLengthInBits = id.length * 4;
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
