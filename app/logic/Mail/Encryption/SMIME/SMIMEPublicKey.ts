import { PublicKey } from "../PublicKey";
import { EncryptionSystem, TrustLevel, trustOrder } from "../enums";
import { DigestAlgorithm, SignatureAlgorithm, Certificate, RSAPublicKey, SubjectAlternativeName, RDNSequence, TBSCertificate, DigestInfo } from "./SMIMEASN1";
import { BlockType, unpadPKCS, decrypt, encrypt, padFF } from "./SMIMERSAES";
import { appGlobal } from "../../../app";
import { uint8ArrayToHex } from "../../../util/blob";
import { sanitize } from "../../../../../lib/util/sanitizeDatatypes";
import { ArrayColl } from "svelte-collections";

export class SMIMEPublicKey extends PublicKey {
  system = EncryptionSystem.SMIME;
  cipher = "RSA";
  /**
   * Armored (base64-encoded) public S/MIME certificate
   */
  declare publicKeyArmored: string;

  chain = new ArrayColl<SMIMEPublicKey>();

  constructor() {
    super();
    this.obsolete = true;
  }

  get certificate(): string {
    return this.publicKeyArmored;
  }

  get commonName(): string {
    let cert = Certificate.decodePEM(this.publicKeyArmored, { label: "Certificate" });
    return certificateCommonName(cert) ?? "";
  }

  async matches(key: RSAPublicKey): Promise<boolean> {
    if (!this.publicKeyArmored) {
      return false;
    }
    let cert = Certificate.decodePEM(this.publicKeyArmored, { label: "Certificate" });
    let rawKey = RSAPublicKey.decode(cert.tbsCertificate.publicKey.subjectPublicKey.data);
    return key.n == rawKey.n && key.e == rawKey.e;
  }

  /**
   * Parses the given certificate and sets it as the public key.
   */
  async setCertificate(cert: Certificate) {
    let rsa = RSAPublicKey.decode(cert.tbsCertificate.publicKey.subjectPublicKey.data);
    if (!this.id) {
      let id = sanitize.bigint(rsa.n).toString(16);
      this.id = id.slice(-16);
      this.keyLengthInBits = id.length * 4;
    }
    this.publicKeyArmored = Certificate.encodePEM(cert, { label: "CERTIFICATE" });
    this.userIDs.replaceAll(certificateEMailAddresses(cert));
    // Do not overwrite the name that the user gave the key
    this.name ||= this.defaultName;
    let hash = new Uint8Array(await crypto.subtle.digest("SHA-256", Certificate.encode(cert)));
    this.fingerprint = uint8ArrayToHex(hash);
    let { notBefore, notAfter } = cert.tbsCertificate.validity;
    this.created = sanitize.date(notBefore.value);
    this.expires = sanitize.date(notAfter.value);
    let now = Date.now();
    this.obsolete = now < this.created.getTime() || now > this.expires.getTime();
  }

  async addCertificate(cert: Certificate): Promise<boolean> {
    let rsa = RSAPublicKey.decode(cert.tbsCertificate.publicKey.subjectPublicKey.data);
    if (!this.publicKeyArmored) {
      await this.setCertificate(cert);
      return true;
    }
    if (await this.matches(rsa)) {
      await this.setCertificate(cert);
      return false;
    }
    for (let key of this.chain) {
      if (await key.matches(rsa)) {
        await key.setCertificate(cert);
        return false;
      }
    }
    let key = new SMIMEPublicKey();
    await key.setCertificate(cert);
    this.chain.add(key);
    return true;
  }

  async addCertificates(publicKey: string) {
    let parts = splitPEM(publicKey);
    for (let part of parts) {
      if (part.startsWith("-----BEGIN CERTIFICATE-----")) {
        await this.addCertificate(Certificate.decodePEM(part, { label: "CERTIFICATE" }));
      } else if (part.startsWith("-----BEGIN TRUSTED CERTIFICATE-----")) {
        await this.addCertificate(Certificate.decodePEM(part, { label: "TRUSTED CERTIFICATE" }));
      }
    }
  }

  isValidAt(date: Date): boolean {
    return date.getTime() >= this.created.getTime() && date.getTime() <= this.expires.getTime();
  }

  async keyStatus(date = new Date()): Promise<KeyStatus> {
    if (!this.certificate) {
      return KeyStatus.NoCertificate;
    }
    if (!this.isValidAt(date)) {
      return KeyStatus.Expired;
    }
    // This checks only that each certificate is validly signed by the next one
    // up to a trusted root. It does not verify basicConstraints (CA:TRUE) or
    // keyUsage/extKeyUsage (emailProtection). Identity is bound elsewhere, by
    // matching the signer's stored key ID against `email.from`, so a rogue leaf
    // cannot sign as another identity today. Do not start trusting the chain
    // itself for identity binding without adding those X.509 path checks first.
    let cert = Certificate.decodePEM(this.certificate, { label: "CERTIFICATE" });
    for (let key of this.chain) {
      if (!key.isValidAt(date)) {
        console.log("obsolete certificate in chain");
        return KeyStatus.ChainInvalid;
      }
      let signer = Certificate.decodePEM(key.certificate, { label: "CERTIFICATE" });
      if (!await verifySignature(cert, signer)) {
        return KeyStatus.ChainInvalid;
      }
      cert = signer;
    }
    for (let type of ["bundled", "system", "extra"]) {
      for (let ca of await lazyGetCACertificates(type)) {
        if (await verifySignature(cert, ca)) {
          let caTrust = type == "bundled" ? TrustLevel.ThirdParty : type == "system" ? TrustLevel.OS : TrustLevel.Personal;
          if (trustOrder(this.trustLevel) < trustOrder(caTrust)) {
            this.trustLevel = caTrust;
            this.caName = certificateCommonName(ca);
          }
          return KeyStatus.Valid;
        }
      }
    }
    if (await verifySignature(cert, cert)) {
      return KeyStatus.SelfSignedRoot;
    }
    return KeyStatus.ChainIncomplete;
  }

  /** Reads an S/MIME certificate from a file.
   * @param publicKey The certificate in PEM format
   * Factory function. */
  static async importPublicKey(publicKey: string): Promise<SMIMEPublicKey> {
    let key = new SMIMEPublicKey();
    await key.addCertificates(publicKey);
    return key;
  }

  publicKeyAsFile(): File {
    return this.keyAsFile(this.publicKeyArmored, "application/x-pem-file", "PublicKey", "pem");
  }

  toJSON() {
    let json = super.toJSON();
    json.chain = this.chain.contents.map(key => key.toJSON());
    return json;
  }

  fromJSON(json: any) {
    super.fromJSON(json);
    for (let certificate of sanitize.array(json.chain, [])) {
      let key = new SMIMEPublicKey();
      key.fromJSON(certificate);
      this.chain.add(key);
    }
  }
}

/** The email addresses that the certificate was issued for.
 * They are in the subjectAlternativeName extension, but older certificates
 * have them only in the subject. */
function certificateEMailAddresses(cert: Certificate): string[] {
  let san = cert.tbsCertificate.extensions?.find(ext => ext.extnID == "subjectAlternativeName");
  if (san) {
    try {
      let emailAddresses = SubjectAlternativeName.decode(san.extnValue)
        .filter(entry => entry.type == "rfc822Name")
        .map(entry => sanitize.emailAddress(entry.value, null))
        .filter(Boolean);
      if (emailAddresses.length) {
        return emailAddresses;
      }
    } catch (ex) {
      // Entry types that we do not implement, e.g. directoryName, fail to decode
      console.error(ex);
    }
  }
  let email = cert.tbsCertificate.subject.find(attr => attr.type == "E");
  let emailAddress = sanitize.emailAddress(email?.value?.value, null);
  return emailAddress ? [emailAddress] : [];
}

/** The name of the person or organisation that the certificate was issued to */
function certificateCommonName(cert: Certificate): string | null {
  let cn = cert.tbsCertificate.subject.find(attr => attr.type == "CN");
  return sanitize.label(cn?.value?.value, null);
}

async function verifySignature(cert: Certificate, signer: Certificate): Promise<boolean> {
  try {
    if (indexedDB.cmp(RDNSequence.encode(cert.tbsCertificate.issuer), RDNSequence.encode(signer.tbsCertificate.subject))) {
      console.log("subject did not match issuer");
      return false;
    }
    let algorithm = sanitize.translate(cert.signatureAlgorithm.algorithm, SignatureAlgorithm);
    let signedCert = TBSCertificate.encode(cert.tbsCertificate);
    let signedDigest = new Uint8Array(await crypto.subtle.digest(algorithm, signedCert));
    let rsa = RSAPublicKey.decode(signer.tbsCertificate.publicKey.subjectPublicKey.data);
    let block = encrypt(cert.signatureValue.data, rsa);
    let digestInfo = DigestInfo.decode(unpadPKCS(block, BlockType.Signed));
    if (sanitize.translate(digestInfo.digestAlgorithm.algorithm, DigestAlgorithm) != algorithm) {
      console.log("mismatched digest signature algorithm");
      return false;
    }
    if (indexedDB.cmp(digestInfo.digest, signedDigest)) {
      console.log("signature mismatch");
      return false;
    }
    // Rebuild the whole PKCS#1 v1.5 block and compare byte-for-byte, so that
    // trailing bytes after the DigestInfo or non-canonical padding are rejected
    // rather than silently ignored (RFC8017 EMSA-PKCS1-v1_5 verification).
    if (indexedDB.cmp(block, padFF(DigestInfo.encode(digestInfo), rsa))) {
      console.log("non-canonical signature padding");
      return false;
    }
    return true;
  } catch (ex) {
    // Typically a decryption error, but the validation should fail anyway.
    console.error(ex);
    return false;
  }
}

let promiseGetCACertificates: Record<string, Promise<Certificate[]> | undefined> = {};
function lazyGetCACertificates(type: string): Promise<Certificate[]> {
  return promiseGetCACertificates[type] ??= getCACertificatesLazy(type);
}

async function getCACertificatesLazy(type: string): Promise<Certificate[]> {
  let certificates: Certificate[] = [];
  let rootCertificates: string[] = await appGlobal.remoteApp.getCACertificates(type);
  for (let cert of rootCertificates) {
    try {
      certificates.push(Certificate.decodePEM(cert, { label: "CERTIFICATE" }));
    } catch (ex) {
      console.log("Error decoding certificate", cert);
      console.error(ex);
    }
  }
  return certificates;
}

export enum KeyStatus {
  NoCertificate,
  ChainInvalid,
  ChainIncomplete,
  SelfSignedRoot,
  Valid,
  Expired,
}

export function splitPEM(key: string): string[] {
  let result: string[] = [];
  let label: string | null = null;
  let pem: string | null = null;
  for (let line of key.split(/[\r\n]+/)) {
    if (line.endsWith("-----")) {
      if (line.startsWith("-----BEGIN ")) {
        label = line.slice(11, -5);
        pem = line + "\n";
      } else if (line.startsWith("-----END ")) {
        if (label && line.slice(9, -5) == label) {
          result.push(pem + line);
        }
        label = null;
        pem = null;
      }
    } else if (pem) {
      pem += line + "\n";
    }
  }
  return result;
}
