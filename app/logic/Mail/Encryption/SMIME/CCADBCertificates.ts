import { Certificate, RDNSequence, type TBSCertificate } from "./SMIMEASN1";
import { appGlobal } from "../../../app";
import { getConfigDir } from "../../../util/backend-wrapper";
import { parseCSV } from "../../../util/csv";
import { uint8ArrayToHex } from "../../../util/blob";
import { k1DayMS, k1WeekMS } from "../../../util/date";
import { RunOnce } from "../../../util/flow/RunOnce";
import { Timeout } from "../../../util/flow/Timeout";
import { makeAbortable } from "../../../util/flow/Abortable";
import { dataError, minorError } from "../../../util/error";
import { assert } from "../../../util/util";
import { sanitize } from "../../../../../lib/util/sanitizeDatatypes";

/**
 * A list of public CA certificates in the Common CA Database (CCADB) of Mozilla,
 * downloaded when needed and cached on disk.
 * It adds no trust: A certificate from it must still chain to a trusted root.
 */
export class CCADBCertificates {
  protected bySubject = new Map<string, Certificate[]>();
  /** When we last tried to download the list, or downloaded the cached list */
  protected lastDownload: Date | null = null;
  protected loading: Promise<void> | null = null;
  protected readonly downloadOnce = new RunOnce<void>();

  constructor(
    protected readonly url: string,
    protected readonly fileName: string) {
  }

  /** The certificates in the list that may have issued `cert`.
   * Downloads the list again, if it's old, or if it has no issuer for `cert` and is older than a day. */
  async issuersOf(cert: Certificate): Promise<Certificate[]> {
    const kRefreshInterval = k1WeekMS;
    const kMinAge = k1DayMS;
    await (this.loading ??= this.load());
    if (this.isOlderThan(kRefreshInterval)) {
      await this.download();
    }
    let issuer = this.nameKey(cert.tbsCertificate.issuer);
    if (!this.bySubject.has(issuer) && this.isOlderThan(kMinAge)) {
      await this.download();
    }
    return this.bySubject.get(issuer) ?? [];
  }

  protected isOlderThan(milliseconds: number): boolean {
    return !this.lastDownload || Date.now() - this.lastDownload.getTime() > milliseconds;
  }

  protected async download() {
    await this.downloadOnce.runOnce(async () => {
      const kTimeoutSeconds = 60;
      const kMaxLength = 20 * 1000 * 1000;
      let abort = new AbortController();
      let timeout = new Timeout(kTimeoutSeconds, () => abort.abort());
      try {
        let ky = await appGlobal.remoteApp.kyCreate({ timeout: kTimeoutSeconds * 1000 });
        let csv: string = await makeAbortable(ky.get(this.url, { result: "text", retry: 0 }), abort);
        assert(csv.length <= kMaxLength, "The list of CA certificates is too large");
        let certificates = this.readCSV(csv);
        assert(certificates.length, "The list of CA certificates is empty");
        this.setCertificates(certificates);
        await this.save(certificates);
      } catch (ex) {
        minorError(ex);
      } finally {
        timeout.fulfilled();
        this.lastDownload = new Date();
      }
    });
  }

  /** Reads the CSV report of the CCADB, and keeps the CA certificates that may issue S/MIME certificates */
  protected readCSV(csv: string): Certificate[] {
    let rows = parseCSV(csv);
    let header = rows.shift() ?? [];
    let pemColumn = header.indexOf("PEM Info");
    let extKeyUsageColumn = header.indexOf("Extended Key Usage");
    assert(pemColumn >= 0 && extKeyUsageColumn >= 0, "The list of CA certificates has an unknown format");
    let certificates: Certificate[] = [];
    for (let row of rows) {
      let extKeyUsage = row[extKeyUsageColumn];
      if (extKeyUsage && !extKeyUsage.includes("ExtKeyUsageEmailProtection")) {
        continue;
      }
      try {
        // The report puts the PEM in apostrophes
        certificates.push(Certificate.decodePEM(row[pemColumn].replaceAll("'", ""), { label: "CERTIFICATE" }));
      } catch (ex) {
        dataError(ex);
      }
    }
    return certificates;
  }

  protected setCertificates(certificates: Certificate[]) {
    this.bySubject.clear();
    for (let cert of certificates) {
      let subject = this.nameKey(cert.tbsCertificate.subject);
      let sameSubject = this.bySubject.get(subject) ?? [];
      sameSubject.push(cert);
      this.bySubject.set(subject, sameSubject);
    }
  }

  protected nameKey(name: TBSCertificate["subject"]): string {
    return uint8ArrayToHex(RDNSequence.encode(name));
  }

  protected async load() {
    try {
      let json = JSON.parse(new TextDecoder().decode(await appGlobal.remoteApp.readFile(await this.filePath())));
      let certificates: Certificate[] = [];
      for (let base64 of sanitize.array(json.certificates, [])) {
        try {
          certificates.push(Certificate.decodeFromBase64(sanitize.nonemptystring(base64)));
        } catch (ex) {
          dataError(ex);
        }
      }
      this.setCertificates(certificates);
      this.lastDownload = sanitize.date(json.downloaded, null);
    } catch (ex) {
      if (ex.code != "ENOENT") {
        minorError(ex);
      }
    }
  }

  protected async save(certificates: Certificate[]) {
    let json = {
      downloaded: new Date(),
      certificates: certificates.map(cert => Certificate.encodeToBase64(cert)),
    };
    await appGlobal.remoteApp.writeFile(await this.filePath(), 0o600, new TextEncoder().encode(JSON.stringify(json)));
  }

  protected async filePath(): Promise<string> {
    return `${await getConfigDir()}/${this.fileName}`;
  }
}
