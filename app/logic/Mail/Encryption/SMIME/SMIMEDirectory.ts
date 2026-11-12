import { KeyStatus, SMIMEPublicKey, verifySignature } from "./SMIMEPublicKey";
import { Certificate, SignedData } from "./SMIMEASN1";
import { CAIntermediateCertDownload } from "./CAIntermediateCertDownload";
import { getBaseDomainFromURL } from "../../../util/netUtil";
import { LoopGuard } from "../../../util/flow/LoopGuard";
import { minorError } from "../../../util/error";
import { assert, type URLString } from "../../../util/util";
import { ArrayColl } from "svelte-collections";

export class SMIMEDirectory {
  readonly serverURL: URLString;
  protected static readonly intermediateCertDownload = new CAIntermediateCertDownload();

  /** @param serverURL of the directory, e.g. the EWS URL of the Exchange server */
  constructor(serverURL: URLString) {
    this.serverURL = serverURL;
  }

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
  async readDirectoryCertificates(smimeCertificates: string[], certificates: string[], errorCallback: (ex: Error) => void): Promise<ArrayColl<SMIMEPublicKey>> {
    let keys = new ArrayColl<SMIMEPublicKey>();
    for (let cert of smimeCertificates) {
      try {
        let key = await this.smimeCertificateToKey(cert);
        if (key) {
          keys.add(key);
        }
      } catch (ex) {
        errorCallback(ex);
      }
    }
    if (keys.hasItems) {
      return keys;
    }
    return await this.readCertificates(certificates, errorCallback);
  }

  /**
   * Reads the S/MIME certificates that a directory published for a person,
   * e.g. the `userCertificate` attribute in the Exchange GAL.
   * @param certificates DER-encoded X.509 certificates, each base64-encoded
   * @param errorCallback for certificates that we cannot read
   */
  async readCertificates(certificates: string[], errorCallback: (ex: Error) => void): Promise<ArrayColl<SMIMEPublicKey>> {
    let keys = new ArrayColl<SMIMEPublicKey>();
    for (let certificate of certificates) {
      try {
        // Decoding it here rejects blobs that aren't certificates, e.g. PKCS#7.
        let pem = Certificate.encodePEM(Certificate.decodeFromBase64(certificate), { label: "CERTIFICATE" });
        let key = await this.importTrustedKey(pem);
        if (key) {
          keys.add(key);
        }
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
  protected async smimeCertificateToKey(blob: string): Promise<SMIMEPublicKey | null> {
    let certificates = SignedData.decodeFromBase64(blob, { berToDER: true }).content.certificates;
    assert(certificates?.length, "No certificate in the PKCS#7 blob");
    // The certificate of the person comes first and the rest of the chain follows,
    // which is exactly how `importPublicKey()` reads a PEM file with a chain.
    return await this.importTrustedKey(certificates
      .map(certificate => Certificate.encodePEM(certificate, { label: "CERTIFICATE" }))
      .join("\n"));
  }

  /** The server could hand out a certificate of its own, so we take only those that a trusted CA issued */
  protected async importTrustedKey(pem: string): Promise<SMIMEPublicKey | null> {
    let key = await SMIMEPublicKey.importPublicKey(pem);
    let status = await key.keyStatus();
    const kMaxDownloads = 5;
    let loop = new LoopGuard(kMaxDownloads, () =>
      minorError(new Error(`The certificate chain of ${key.userIDs.first} is too long`)));
    while (status == KeyStatus.ChainIncomplete && loop.nextRound() && await this.addMissingIssuer(key)) {
      status = await key.keyStatus();
    }
    return status == KeyStatus.Valid ? key : null;
  }

  /**
   * Adds the CA certificate that issued the end of the chain of `key`,
   * from the URL in that certificate, if the URL is on the domain of the directory server.
   * @returns true, if it added a certificate to `key.chain`.
   *   false, if it found none, or only one that is already in the chain.
   */
  protected async addMissingIssuer(key: SMIMEPublicKey): Promise<boolean> {
    let chainEnd = Certificate.decodePEM((key.chain.last ?? key).certificate, { label: "CERTIFICATE" });
    let url = SMIMEDirectory.intermediateCertDownload.issuerURL(chainEnd);
    if (!url) {
      return false;
    }
    // Only download from user's own directory server,
    // to avoid certs in emails causing pingbacks to the sender, same as remote images.
    let domain = getBaseDomainFromURL(url);
    if (!domain || domain != getBaseDomainFromURL(this.serverURL)) {
      return false;
    }
    let issuers: Certificate[];
    try {
      let file = await SMIMEDirectory.intermediateCertDownload.download(url);
      issuers = SMIMEPublicKey.certificatesFromDER(file);
    } catch (ex) {
      minorError(ex);
      return false;
    }
    // A PKCS#7 file can hold several certificates: take the one that signed the end of the chain
    let issuer: Certificate | null = null;
    for (let downloaded of issuers) {
      if (await verifySignature(chainEnd, downloaded)) {
        issuer = downloaded;
        break;
      }
    }
    if (!issuer) {
      return false;
    }
    let issuerKey = new SMIMEPublicKey();
    await issuerKey.setCertificate(issuer);
    if (key.chain.some(chainKey => chainKey.fingerprint == issuerKey.fingerprint)) {
      return false;
    }
    key.chain.add(issuerKey);
    return true;
  }
}
