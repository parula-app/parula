import { DigestAlgorithm, SignatureAlgorithm, Attributes, SubjectPublicKeyInfo, RSAPublicKey, DigestInfo, OctetString, type TBSCertificate } from "./SMIMEASN1";
import { BlockType, unpadPKCS, encrypt } from "./SMIMERSAES";
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
  if (publicKey.algorithmIdentifier.algorithm != "rsaEncryption") {
    console.log("certificate does not contain an RSA public key");
    return null;
  }
  let digestAlgorithm = sanitize.translate(signerInfo.digestAlgorithm.algorithm, DigestAlgorithm);
  // RFC 5652 section 10.1.2: signers write rsaEncryption, but verifiers
  // should also accept e.g. sha256WithRSAEncryption, which some clients
  // write instead. Its hash must match the digest algorithm.
  if (signerInfo.signatureAlgorithm.algorithm != "rsaEncryption" &&
      sanitize.translate(signerInfo.signatureAlgorithm.algorithm, SignatureAlgorithm, null) != digestAlgorithm) {
    console.log("signature was not signed with RSA");
    return null;
  }
  let messageDigest = new Uint8Array(await crypto.subtle.digest(digestAlgorithm, content as BufferSource));
  // Without signed attributes, the signature covers the content digest directly.
  let signedDigest = messageDigest;
  if (signerInfo.signedAttrs) {
    let digestAttribute = signerInfo.signedAttrs.find(attr => attr.attrType == "messageDigest");
    if (!digestAttribute) {
      console.log("signature did not contain a message digest");
      return null;
    }
    if (indexedDB.cmp(OctetString.decode(digestAttribute.attrValue[0]), messageDigest)) {
      console.log("signed digest did not match message");
      return null;
    }
    let signedAttrs = Attributes.encode(signerInfo.signedAttrs);
    signedDigest = new Uint8Array(await crypto.subtle.digest(digestAlgorithm, signedAttrs));
  }
  /* `await crypto.subtle.verify()` returns `false` on
   * correctly signed messages...
  let key = await crypto.subtle.importKey("spki", SubjectPublicKeyInfo.encode(publicKey), { name: "RSASSA-PKCS1-v1_5", hash: digestAlgorithm }, false, ["verify"]);
  if (await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signerInfo.encryptedDigest, signedDigest)) {
    let rsa = RSAPublicKey.decode(publicKey.subjectPublicKey.data);
    return rsa.n.toString(16);
  }
  */
  let rsa = RSAPublicKey.decode(publicKey.subjectPublicKey.data);
  let digestInfo = DigestInfo.decode(unpadPKCS(encrypt(signerInfo.signature, rsa), BlockType.Signed));
  if (digestInfo.digestAlgorithm.algorithm != signerInfo.digestAlgorithm.algorithm) {
    console.log("signature algorithm mismatch");
    return null;
  }
  if (indexedDB.cmp(digestInfo.digest, signedDigest)) {
    console.log("signature did not match the signed digest");
    return null;
  }
  let signer = new SMIMEPublicKey();
  while (cert && await signer.addCertificate(cert)) {
    cert = certificates.find(chain =>
      sameName(chain.tbsCertificate.subject, cert.tbsCertificate.issuer));
  };
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
  return a.length == b.length &&
    a.every((attr, i) => attr.type == b[i].type && attr.value.value == b[i].value.value);
}
