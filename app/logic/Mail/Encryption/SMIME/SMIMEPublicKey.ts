import { PublicKey } from "../PublicKey";
import { EncryptionSystem, TrustLevel, trustOrder } from "../enums";
import { DigestAlgorithm, SignatureAlgorithm, AlgorithmIdentifier, Certificate, RSAPublicKey, RSASSAPSSParams, SubjectPublicKeyInfo, SubjectAlternativeName, RDNSequence, TBSCertificate, DigestInfo, SignedData, Any, Null, BasicConstraints, KeyUsage, KeyUsageBit, ExtKeyUsage } from "./SMIMEASN1";
import { BlockType, unpadPKCS, decrypt, encrypt, padFF } from "./SMIMERSAES";
import { sameName } from "./SMIMEVerify";
import { appGlobal } from "../../../app";
import { uint8ArrayToHex, base64ToUint8Array } from "../../../util/blob";
import { assert } from "../../../util/util";
import { sanitize } from "../../../../../lib/util/sanitizeDatatypes";
import { ArrayColl } from "svelte-collections";
import { gt } from "../../../../l10n/l10n";

export class SMIMEPublicKey extends PublicKey {
  system = EncryptionSystem.SMIME;
  cipher = "RSA";
  /**
   * Armored (base64-encoded) public S/MIME certificate
   */
  declare publicKeyArmored: string;

  chain = new ArrayColl<SMIMEPublicKey>();
  protected _decodedCertificate: Certificate | null = null; // cache only

  constructor() {
    super();
    this.obsolete = true;
  }

  get certificate(): string {
    return this.publicKeyArmored;
  }

  get decodedCertificate(): Certificate {
    assert(this.certificate, "Certificate PEM is missing");
    return this._decodedCertificate ??= Certificate.decodePEM(this.certificate, { label: "CERTIFICATE" });
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
    this._decodedCertificate = cert;
    this.userIDs.replaceAll(certificateEMailAddresses(cert));
    // Do not overwrite the name that the user gave the key
    this.name ||= this.defaultName;
    let hash = new Uint8Array(await crypto.subtle.digest("SHA-256", Certificate.encode(cert)));
    this.fingerprint = uint8ArrayToHex(hash);
    let { notBefore, notAfter } = cert.tbsCertificate.validity;
    this.created = sanitize.date(notBefore.value);
    this.expires = sanitize.date(notAfter.value);
    let now = Date.now();
    this.obsolete = now < this.created.getTime();
  }

  /** Sets this key's certificate if it has none yet or the certificate is for the same key, otherwise adds it to the chain */
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
        // Some CAs label PKCS#7 as CERTIFICATE
        await this.addCertificatesFromDER(Any.decodePEM(part, { label: "CERTIFICATE" }));
      } else if (part.startsWith("-----BEGIN TRUSTED CERTIFICATE-----")) {
        await this.addCertificate(Certificate.decodePEM(part, { label: "TRUSTED CERTIFICATE" }));
      } else if (part.startsWith("-----BEGIN PKCS7-----")) {
        await this.addCertificatesFromDER(Any.decodePEM(part, { label: "PKCS7" }));
      }
    }
  }

  /** For the file that the user picked to add a certificate */
  async addCertificateFile(fileContent: string) {
    assert(fileContent.includes("-----BEGIN CERTIFICATE-----") ||
      fileContent.includes("-----BEGIN TRUSTED CERTIFICATE-----") ||
      fileContent.includes("-----BEGIN PKCS7-----"),
      gt`Could not find a certificate in this file`);
    await this.addCertificates(fileContent);
  }

  /** @param der An X.509 certificate, or a PKCS#7 with certificates */
  static certificatesFromDER(der: Uint8Array): Certificate[] {
    try {
      return [Certificate.decode(der)];
    } catch (ex) {
      return SignedData.decode(der, { berToDER: true }).content.certificates ?? [];
    }
  }

  protected async addCertificatesFromDER(der: Uint8Array) {
    let certificates = new ArrayColl<Certificate>(SMIMEPublicKey.certificatesFromDER(der));
    assert(certificates.hasItems, gt`Could not find a certificate in this file`);
    function isIssuer(issuer: Certificate, cert: Certificate): boolean {
      return issuer != cert && sameName(issuer.tbsCertificate.subject, cert.tbsCertificate.issuer);
    }
    // PKCS#7 has the certificates in no order, so start with the one that issued none of the others
    let cert = certificates.find(issuer => !certificates.some(issued => isIssuer(issuer, issued)));
    while (cert) {
      certificates.remove(cert);
      await this.addCertificate(cert);
      cert = certificates.find(issuer => isIssuer(issuer, cert));
    }
  }

  isValidAt(date: Date): boolean {
    return date.getTime() >= this.created.getTime() && date.getTime() <= this.expires.getTime();
  }

  /** @param parameters `RSASSA-PSS-params` of the signature algorithm, RFC 4055 section 3.1 */
  async verifyRSAPSS(signature: Uint8Array, parameters: Uint8Array, content: Uint8Array): Promise<boolean> {
    try {
      let { hashAlgorithm, maskGenAlgorithm, saltLength, trailerField } = RSASSAPSSParams.decode(parameters);
      let maskHashAlgorithm = maskGenAlgorithm.parameters ? AlgorithmIdentifier.decode(maskGenAlgorithm.parameters) : { algorithm: "sha1" };
      let hash = sanitize.translate(hashAlgorithm.algorithm, DigestAlgorithm, null);
      // WebCrypto uses the same hash for the mask
      if (!hash || maskGenAlgorithm.algorithm != "mgf1" || maskHashAlgorithm.algorithm != hashAlgorithm.algorithm || trailerField != 1n) {
        return false;
      }
      // WebCrypto does not import a key that is only for PSS (id-RSASSA-PSS)
      let { subjectPublicKey } = this.decodedCertificate.tbsCertificate.publicKey;
      let rsaKey = SubjectPublicKeyInfo.encode({ algorithmIdentifier: { algorithm: "rsaEncryption", parameters: Null.encode() }, subjectPublicKey });
      let key = await crypto.subtle.importKey("spki", rsaKey as BufferSource, { name: "RSA-PSS", hash }, false, ["verify"]);
      return await crypto.subtle.verify({ name: "RSA-PSS", saltLength: Number(saltLength) }, key, signature as BufferSource, content as BufferSource);
    } catch (ex) {
      return false; // Broken parameters, or a salt length too long for the key
    }
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
    if (!this.allowsEMailProtection()) {
      return KeyStatus.ChainInvalid;
    }
    for (let key of this.chain) {
      // Not `obsolete`: it also means "expired now", which would reject older mail
      if (key._obsolete || !key.isValidAt(date)) {
        console.log("obsolete certificate in chain");
        return KeyStatus.ChainInvalid;
      }
      let signer = Certificate.decodePEM(key.certificate, { label: "CERTIFICATE" });
      if (!await verifySignature(cert, signer)) {
        return KeyStatus.ChainInvalid;
      }
      if (!key.mayIssueCertificates(this.chain.contents.indexOf(key)) || !key.allowsEMailProtection()) {
        return KeyStatus.ChainInvalid;
      }
      cert = signer;
    }
    const kAcceptX509v1Roots = true;
    for (let type of ["bundled", "system", "extra"]) {
      for (let ca of await lazyGetCACertificates(type)) {
        if (await verifySignature(cert, ca)) {
          let root = new SMIMEPublicKey();
          await root.setCertificate(ca);
          if (root._obsolete || !root.isValidAt(date) || !root.allowsEMailProtection() || (!kAcceptX509v1Roots && !ca.tbsCertificate.version)) {
            continue;
          }
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

  /** @param subCAs How many CA certificates are between this one and the leaf */
  protected mayIssueCertificates(subCAs: number): boolean {
    let basicConstraints = this.extension("basicConstraints");
    if (!basicConstraints) {
      return false;
    }
    let { cA, pathLenConstraint } = BasicConstraints.decode(basicConstraints);
    return cA && (pathLenConstraint == null || subCAs <= pathLenConstraint) && this.allowsAnyKeyUsage(KeyUsageBit.keyCertSign);
  }

  /** True if the certificate allows at least one of these, e.g. signing needs digitalSignature or nonRepudiation (RFC 8550 section 4.4.2) */
  allowsAnyKeyUsage(...usages: KeyUsageBit[]): boolean {
    let keyUsage = this.extension("keyUsage");
    if (!keyUsage) {
      return true; // Without keyUsage, all usages are allowed (RFC 5280 section 6.1.4 (n), RFC 8550 section 4.4.2)
    }
    let { data } = KeyUsage.decode(keyUsage);
    return usages.some(bit => (data[bit >> 3] & (0x80 >> (bit % 8))) != 0);
  }

  protected allowsEMailProtection(): boolean {
    let extKeyUsage = this.extension("extKeyUsage");
    if (!extKeyUsage) {
      return true; // As for keyUsage in allowsAnyKeyUsage() (RFC 8550 section 4.4.4)
    }
    const kAcceptAnyPurpose = false;
    return ExtKeyUsage.decode(extKeyUsage).some(purpose => purpose == "emailProtection" || (purpose == "anyExtendedKeyUsage" && kAcceptAnyPurpose));
  }

  protected extension(extnID: string): Uint8Array | undefined {
    assert(this.certificate, "The S/MIME key has no certificate");
    let cert = Certificate.decodePEM(this.certificate, { label: "CERTIFICATE" });
    return cert.tbsCertificate.extensions?.find(ext => ext.extnID == extnID)?.extnValue;
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

export async function verifySignature(cert: Certificate, signer: Certificate): Promise<boolean> {
  try {
    if (indexedDB.cmp(RDNSequence.encode(cert.tbsCertificate.issuer), RDNSequence.encode(signer.tbsCertificate.subject))) {
      console.log("subject did not match issuer");
      return false;
    }
    if (cert.signatureAlgorithm.algorithm == "rsassaPss") {
      let signerKey = new SMIMEPublicKey();
      await signerKey.setCertificate(signer);
      return await signerKey.verifyRSAPSS(cert.signatureValue.data, cert.signatureAlgorithm.parameters, TBSCertificate.encode(cert.tbsCertificate));
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
  let rootCertificates: string[] = type == "bundled"
    ? splitPEM((await import("./roots/mozilla-email-roots.pem?raw")).default)
    : await appGlobal.remoteApp.getCACertificates(type);
  let notEmailRootsSHA256: string[] = type == "system" && rootCertificates.length
    ? (await import("./roots/mozilla-not-email-roots.txt?raw")).default.split(/[\r\n]+/)
      .filter(line => line && !line.startsWith("#")).map(line => line.split(" ")[0])
    : [];
  for (let cert of rootCertificates) {
    try {
      if (notEmailRootsSHA256.length) {
        let der = base64ToUint8Array(cert.replace("-----BEGIN CERTIFICATE-----", "").replace("-----END CERTIFICATE-----", ""));
        let hash = new Uint8Array(await crypto.subtle.digest("SHA-256", der));
        if (notEmailRootsSHA256.includes(uint8ArrayToHex(hash))) {
          continue;
        }
      }
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
