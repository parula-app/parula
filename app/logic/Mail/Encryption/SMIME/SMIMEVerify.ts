import { DigestAlgorithm, Attributes, SubjectPublicKeyInfo, OctetString, Oid, KeyUsageBit, ECPrivateKey, RSAPrivateKey, RSAPublicKey, type PrivateKeyInfo, type TBSCertificate } from "./SMIMEASN1";
import { SMIMEPublicKey } from "./SMIMEPublicKey";
import { sanitize } from "../../../../../lib/util/sanitizeDatatypes";

/**
 * Verifies the signature of a CMS SignedData over the given content.
 * Checks only the signature itself, not the certificate chain.
 * @param signedData decoded `SignedData`
 * @param content the signed bytes: the cleartext MIME part for
 *   `multipart/signed`, or the unwrapped eContent for opaque-signed messages
 * @param date when the message arrived, at which the certificates must be valid
 * @returns the last hex digits of the signer's RSA modulus,
 *   or null, if the signature does not verify
 */
export async function verifySignedData(signedData: any, content: Uint8Array, date = new Date()): Promise<SMIMEPublicKey | null> {
  let certificates = sanitize.array(signedData.content.certificates, []);
  let signerInfos = sanitize.array(signedData.content.signerInfos, []);
  if (!certificates.length || !signerInfos.length) {
    console.log("signed data has no certificate and/or signature");
    return null;
  }
  let signerInfo = signerInfos[0];
  let cert = certificates[0];
  if (signerInfo.sid?.type == "issuerAndSerialNumber") {
    let sid = signerInfo.sid.value;
    // Fall back to the first certificate, for messages that we signed
    // before, when the sid held the subject instead of the issuer.
    cert = certificates.find(cert =>
      cert.tbsCertificate.serialNumber == sid.serialNumber &&
      sameName(sid.issuer, cert.tbsCertificate.issuer)) ?? cert;
  }
  let publicKey = cert.tbsCertificate.publicKey;
  // `verify()` refuses other keys, too, but `addCertificate()` below throws for them first,
  // and the mail would show that error instead of being unsigned
  if (publicKey.algorithmIdentifier.algorithm != "rsaEncryption" && publicKey.algorithmIdentifier.algorithm != "ecPublicKey") {
    console.log("certificate does not contain an RSA or EC public key");
    return null;
  }
  let digestAlgorithm = sanitize.translate(signerInfo.digestAlgorithm.algorithm, DigestAlgorithm, null);
  if (!digestAlgorithm) {
    console.log("message was digested with an algorithm that we do not know");
    return null;
  }
  let messageDigest = new Uint8Array(await crypto.subtle.digest(digestAlgorithm, content as BufferSource));
  // Without signed attributes, the signature covers the content digest directly.
  let signedContent = content;
  if (signerInfo.signedAttrs) {
    // RFC 8551 section 2.4.1: MIME content is id-data. The eContentType is not signed.
    let contentTypeAttribute = signerInfo.signedAttrs.find(attr => attr.attrType == "contentType");
    if (!contentTypeAttribute || Oid.decode(contentTypeAttribute.attrValue[0]) != "data") {
      return null;
    }
    let digestAttribute = signerInfo.signedAttrs.find(attr => attr.attrType == "messageDigest");
    if (!digestAttribute) {
      console.log("signature did not contain a message digest");
      return null;
    }
    if (indexedDB.cmp(OctetString.decode(digestAttribute.attrValue[0]), messageDigest)) {
      console.log("signed digest did not match message");
      return null;
    }
    signedContent = Attributes.encode(signerInfo.signedAttrs);
  }
  /* `await crypto.subtle.verify()` returns `false` on
   * correctly signed messages...
  let key = await crypto.subtle.importKey("spki", SubjectPublicKeyInfo.encode(publicKey), { name: "RSASSA-PKCS1-v1_5", hash: digestAlgorithm }, false, ["verify"]);
  if (await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signerInfo.encryptedDigest, signedDigest)) {
    let rsa = RSAPublicKey.decode(publicKey.subjectPublicKey.data);
    return rsa.n.toString(16);
  }
  */
  let signer = new SMIMEPublicKey();
  while (cert && await signer.addCertificate(cert)) {
    cert = certificates.find(chain =>
      sameName(chain.tbsCertificate.subject, cert.tbsCertificate.issuer));
  };
  if (!await signer.verify(signerInfo.signature, signedContent, signerInfo.signatureAlgorithm, signerInfo.digestAlgorithm)) {
    return null;
  }
  if (!signer.allowsAnyKeyUsage(KeyUsageBit.digitalSignature, KeyUsageBit.nonRepudiation)) {
    return null;
  }
  // Update the signer's trustLevel if possible. The signature is already
  // proven here, so a failure to reach the CA certificates - they are not
  // available on all platforms - must not discard it. The trustLevel then
  // stays `Sender`, which is what an unknown CA gives us anyway.
  try {
    await signer.keyStatus(date);
  } catch (ex) {
    console.error(ex);
  }
  return signer;
}

/** Compares two X.501 names, e.g. certificate issuer and subject */
export function sameName(a: TBSCertificate["issuer"], b: TBSCertificate["issuer"]): boolean {
  // Attribute types that our OID map lacks, e.g. domainComponent, decode to number arrays
  return a.length == b.length &&
    a.every((attr, i) => String(attr.type) == String(b[i].type) && attr.value.value == b[i].value.value);
}

/** Whether the public key of a certificate belongs to the private key: the same RSA modulus and exponent, or the same EC point */
export function isOfKey(publicKey: SubjectPublicKeyInfo, privateKeyInfo: PrivateKeyInfo): boolean {
  let algorithm = privateKeyInfo.privateKeyAlgorithm.algorithm;
  if (publicKey.algorithmIdentifier.algorithm != algorithm) {
    return false;
  }
  switch (algorithm) {
  case "ecPublicKey": {
    let point = ECPrivateKey.decode(privateKeyInfo.privateKey).publicKey?.data;
    return !!point && !indexedDB.cmp(point, publicKey.subjectPublicKey.data);
  }
  case "rsaEncryption": {
    let key = RSAPublicKey.decode(publicKey.subjectPublicKey.data);
    let rawKey = RSAPrivateKey.decode(privateKeyInfo.privateKey);
    return key.n == rawKey.n && key.e == rawKey.e;
  }
  default:
    return false;
  }
}
