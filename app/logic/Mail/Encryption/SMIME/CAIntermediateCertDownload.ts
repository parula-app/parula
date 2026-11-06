import { AuthorityInfoAccess, Certificate } from "./SMIMEASN1";
import { SMIMEPublicKey } from "./SMIMEPublicKey";
import { appGlobal } from "../../../app";
import { makeAbortable } from "../../../util/flow/Abortable";
import { Timeout } from "../../../util/flow/Timeout";
import { minorError } from "../../../util/error";
import { assert, type URLString } from "../../../util/util";
import { sanitize } from "../../../../../lib/util/sanitizeDatatypes";

/**
 * Downloads the certificate of the CA that issued a certificate,
 * from the URL in its Authority Information Access extension.
 * The CA certificate gets no trust from this. It must chain to a trusted root.
 */
export class CAIntermediateCertDownload {
  /** By URL */
  protected readonly downloads = new Map<URLString, Promise<Certificate[]>>();

  /** @returns the certificates at `url`, see `issuerURL()` */
  async download(url: URLString): Promise<Certificate[]> {
    let download = this.downloads.get(url);
    if (!download) {
      download = this.fetchCertificates(url);
      this.downloads.set(url, download);
    }
    return await download;
  }

  /** @returns the URL that `cert` names for the certificate of its issuer.
   * Only http and https. E.g. `file:` would read local files. */
  issuerURL(cert: Certificate): URLString | null {
    let aia = cert.tbsCertificate.extensions?.find(ext => ext.extnID == "authorityInfoAccess");
    if (!aia) {
      return null;
    }
    for (let access of AuthorityInfoAccess.decode(aia.extnValue)) {
      if (access.accessMethod == "caIssuers" && access.accessLocation.type == "uri") {
        let url = sanitize.url(access.accessLocation.value, null);
        if (url) {
          return url;
        }
      }
    }
    return null;
  }

  protected async fetchCertificates(url: URLString): Promise<Certificate[]> {
    const kTimeoutSeconds = 10;
    let abort = new AbortController();
    let timeout = new Timeout(kTimeoutSeconds, () => abort.abort());
    try {
      let ky = await appGlobal.remoteApp.kyCreate({ retry: 0 });
      let answer = new Uint8Array(await makeAbortable(ky.get(url, { result: "arrayBuffer" }), abort));
      const kMaxBytes = 256 * 1024;
      assert(answer.length <= kMaxBytes, `The CA certificate at ${url} is too large`);
      return SMIMEPublicKey.certificatesFromDER(answer);
    } catch (ex) {
      minorError(ex);
      const kRetryAfterMS = 10 * 60 * 1000;
      setTimeout(() => this.downloads.delete(url), kRetryAfterMS);
      return [];
    } finally {
      timeout.fulfilled();
    }
  }
}
