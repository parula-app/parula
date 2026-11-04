import { SMIMEPublicKey } from "./SMIMEPublicKey";
import { Certificate, SignedData } from "./SMIMEASN1";
import { assert } from "../../../util/util";
import { ArrayColl } from "svelte-collections";

/**
 * Reads the S/MIME certificates that a directory, e.g. the Exchange GAL,
 * published for a person.
 *
 * RFC 2798 defines both attributes and states: "If available, this attribute
 * [`userSMIMECertificate`] is preferred over the `userCertificate` attribute
 * for S/MIME applications", because it also carries the certificate chain.
 *
 * @param smimeCertificates `userSMIMECertificate`: PKCS#7 SignedData, each base64-encoded
 * @param certificates `userCertificate`: DER-encoded X.509 certificates, each base64-encoded
 * @param errorCallback for certificates that we cannot read
 */
export async function readDirectoryCertificates(smimeCertificates: string[], certificates: string[], errorCallback: (ex: Error) => void): Promise<ArrayColl<SMIMEPublicKey>> {
  let keys = new ArrayColl<SMIMEPublicKey>();
  for (let cert of smimeCertificates) {
    try {
      keys.add(await smimeCertificateToKey(cert));
    } catch (ex) {
      errorCallback(ex);
    }
  }
  if (keys.hasItems) {
    return keys;
  }
  return await readCertificates(certificates, errorCallback);
}

/**
 * Reads the S/MIME certificates that a directory published for a person,
 * e.g. the `userCertificate` attribute in the Exchange GAL.
 * @param certificates DER-encoded X.509 certificates, each base64-encoded
 * @param errorCallback for certificates that we cannot read
 */
export async function readCertificates(certificates: string[], errorCallback: (ex: Error) => void): Promise<ArrayColl<SMIMEPublicKey>> {
  let keys = new ArrayColl<SMIMEPublicKey>();
  for (let certificate of certificates) {
    try {
      // Decoding it here rejects blobs that aren't certificates, e.g. PKCS#7.
      let pem = Certificate.encodePEM(Certificate.decodeFromBase64(certificate), { label: "CERTIFICATE" });
      keys.add(await SMIMEPublicKey.importPublicKey(pem));
    } catch (ex) {
      errorCallback(ex);
    }
  }
  return keys;
}

/**
 * Reads one `userSMIMECertificate` value: a PKCS#7 SignedData whose signature
 * and content RFC 2798 tells us to ignore, and which holds the certificate of
 * the person together with the CA certificates that issued it.
 * @param blob base64-encoded PKCS#7 SignedData
 */
async function smimeCertificateToKey(blob: string): Promise<SMIMEPublicKey> {
  let certificates = SignedData.decodeFromBase64(blob, { berToDER: true }).content.certificates;
  assert(certificates?.length, "No certificate in the PKCS#7 blob");
  // The certificate of the person comes first and the rest of the chain follows,
  // which is exactly how `importPublicKey()` reads a PEM file with a chain.
  return await SMIMEPublicKey.importPublicKey(certificates
    .map(certificate => Certificate.encodePEM(certificate, { label: "CERTIFICATE" }))
    .join("\n"));
}
