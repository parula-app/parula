import { appGlobal } from "../../../logic/app";
import { Certificate } from "../../../logic/Mail/Encryption/SMIME/SMIMEASN1";

/** A self-signed S/MIME certificate for `signer@example.com`, in the form in
 * which the directory attribute `userCertificate` holds it:
 * DER-encoded and then base64-encoded.
 * It is also for the addresses to which the GAL tests give it,
 * because we take a certificate from the directory only for the addresses that it names.
 * Generated with:
 * openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 3650 -nodes \
 *   -subj "/CN=Test Signer/emailAddress=signer@example.com" \
 *   -addext "subjectAltName=email:signer@example.com,email:ben@example.com,email:cathy@example.com"
 */
export const kCertificate = "MIIDmDCCAoCgAwIBAgIUJNr9OZ1NGijnhhctnl1CS2wzqiowDQYJKoZIhvcNAQELBQAwOTEUMBIGA1UEAwwLVGVzdCBTaWduZXIxITAfBgkqhkiG9w0BCQEWEnNpZ25lckBleGFtcGxlLmNvbTAeFw0yNjExMTgwMzMzNTRaFw0zNjExMTUwMzMzNTRaMDkxFDASBgNVBAMMC1Rlc3QgU2lnbmVyMSEwHwYJKoZIhvcNAQkBFhJzaWduZXJAZXhhbXBsZS5jb20wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCwws5gt8y4/fWwJRdChz9LxGVkXHXRBGdnQgP8iVvdl4iTGU46CNTZvAiPFzhwAgzxGYSP0Dix50ABBxNlF7wfeHpz9JDKgnDvYlzdkde3EYYZyzSX0HfJFpDOc+qOkHI3peT1+1d9DqOdx/xgIcxf7iLiHsijm7aaOhfZxUKF2nPj+cowvw6MaBk3LB/UgQJePmyOG10BE4/V755P+ZdVWF+m0dGyVqW+PoTdWnJHLTrMz1/tTINPfKLdT+4HeRSM01+MK97VOnppP+ihWV1uixCFbRJIFKxidX++1cCj6i1eoR1D1O6lQyJ18V0qnHnKUU/Zl9izt/c+72gzKs0ZAgMBAAGjgZcwgZQwHQYDVR0OBBYEFNbvK0ut2Xua8mEeMQMkiYcekb29MB8GA1UdIwQYMBaAFNbvK0ut2Xua8mEeMQMkiYcekb29MA8GA1UdEwEB/wQFMAMBAf8wQQYDVR0RBDowOIESc2lnbmVyQGV4YW1wbGUuY29tgQ9iZW5AZXhhbXBsZS5jb22BEWNhdGh5QGV4YW1wbGUuY29tMA0GCSqGSIb3DQEBCwUAA4IBAQCL4lxKV+h7367yMzMJ93E2+izDBpMaoLjLt8bLujmUYxayD57el7H/GSNkkPtLb74j/gxvVcQvhqAWm/DkyrmxbrQDsSi2biQs2NeOj9/ztoK4iA5HA8uXAtFypPZarluHMItg+Xac53Hv6ooKbzlYBdgK0gxLCd3sl51NE3JtSRUODQqMj4RG2fYf2nCv28ku9wmFmar7DPHqpx0nWoHCZI3SEbIyog1JhT33NH+8fnlGv01AxVwnxrtGiV7rTbE9Vc6fWIEn7Ol83lNDjIlf28t0Vu6FXzMVCTN7FxsYIDBiqQJWrquw1ixRPO4W3eMnOwNskFT6JHSx2Iw0eAfx";

/** The email address in the subject of `kCertificate` */
export const kCertificateEmailAddress = "signer@example.com";

/** A certificate for `smime@example.com` together with the CA that issued it,
 * in the form in which the directory attribute `userSMIMECertificate` holds it:
 * a PKCS#7 SignedData without content, DER-encoded and then base64-encoded.
 * Like `kCertificate`, it is also for the addresses to which the directory tests give it.
 * Generated with:
 * openssl req -x509 -newkey rsa:2048 -keyout ca.key -out ca.pem -days 3650 -nodes \
 *   -subj "/CN=Test SMIME CA"
 * openssl req -newkey rsa:2048 -keyout leaf.key -out leaf.csr -nodes \
 *   -subj "/CN=SMIME User/emailAddress=smime@example.com" \
 *   -addext "subjectAltName=email:smime@example.com,email:ben@example.com,email:colleague@example.com,email:colleague@sales.example.com,email:partner@other.org"
 * openssl x509 -req -in leaf.csr -CA ca.pem -CAkey ca.key -out leaf.pem -days 3000 -copy_extensions copy
 * openssl crl2pkcs7 -nocrl -certfile leaf.pem -certfile ca.pem -outform DER -out chain.p7b
 */
export const kSMIMECertificate = "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";

/** The email address in the subject of the leaf certificate of `kSMIMECertificate` */
export const kSMIMECertificateEmailAddress = "smime@example.com";

/** The CA certificate in `kSMIMECertificate`, DER-encoded and then base64-encoded.
 * Extracted with:
 * openssl pkcs7 -inform DER -in chain.p7b -print_certs
 */
export const kSMIMECACertificate = "MIIDETCCAfmgAwIBAgIUKbUXkCfzqpJ659uxyax3iJCw1AowDQYJKoZIhvcNAQELBQAwGDEWMBQGA1UEAwwNVGVzdCBTTUlNRSBDQTAeFw0yNjExMTgwMzMzNTRaFw0zNjExMTUwMzMzNTRaMBgxFjAUBgNVBAMMDVRlc3QgU01JTUUgQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDzWR1+x1zgbJVOyaEjgjZVlphq0MTal2d0iM5hYkDWpBg4rkQ95ly6aegPOZTjnbcGs12ruPMzfNREvcFnWdRLtkT3IN+rPOud/tAOXg92R8vjvN+bR0C4bb4Ngv29fLMg072XPRsTS3zXYlTjfLSwVTHeyrk+6XE+EWU9KexaeJNyEcekwaowXywDCzjrOXFAO7M0MzawkTue7KwaLZAJvmrvLjF2EDGPX2xb+s+KANhcdfeJEtl33x2Hrmj75ol9NvpovxTpUaaFYxM9xyC82uwYCGaEa7J+W7ZWfGJ9vS3amPkfV1YnrhlpxOeRLROTdLpjYbpT6FO3xR2a/METAgMBAAGjUzBRMB0GA1UdDgQWBBQwkZ+/SUhtVD9xLcMuf/3nSWNdaTAfBgNVHSMEGDAWgBQwkZ+/SUhtVD9xLcMuf/3nSWNdaTAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQAVTQg2FtFDsBvanmymCGUS+RNr9IXDKDsFqfRMjSeRPQUUOZJDS2dcBYObDnB8NkvRrsNcgtrhkvjbdBKF+mrVyc2keuOyylK7v9AJyzBZknMzr3KV1bHbQq5aq9w4e0+qIN1Ev5K6imkNDD+XUVI4GckFhWgMTQgzXVzvRyWirmet3LccWIIC/YXsYXyvx4T1SF2iQSR5ZdRHGPN11ko3+60EagJik/Yim7iZHogSg0DfOo4iAUcsc2kpRyoL+sJw9pDEpiml008WoJjy90x68o9R6TK7D05+Prh7d9HkdT4XW1l27jY3OX87pG9hCGe9/yGoynRpEoFaPqQYy+Nu";

/** Like `kSMIMECertificate`, but from a CA that no root store has.
 * Generated with:
 * openssl req -x509 -newkey rsa:2048 -keyout ca.key -out ca.pem -days 3650 -nodes \
 *   -subj "/CN=Untrusted Test CA"
 * openssl req -newkey rsa:2048 -keyout leaf.key -out leaf.csr -nodes \
 *   -subj "/CN=Untrusted User/emailAddress=untrusted@example.com"
 * openssl x509 -req -in leaf.csr -CA ca.pem -CAkey ca.key -out leaf.pem -days 3000
 * openssl crl2pkcs7 -nocrl -certfile leaf.pem -certfile ca.pem -outform DER -out chain.p7b
 */
export const kUntrustedSMIMECertificate = "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";

/** Lets `keyStatus()` run in Node, and trust `kCertificate` and `kSMIMECertificate`,
 * because the backend returns their CAs as roots of the OS */
export function trustTestCAs() {
  // `keyStatus()` compares signatures using `indexedDB.cmp()`, which the browser has, but Node does not.
  globalThis.indexedDB ??= {
    cmp(a: Uint8Array, b: Uint8Array): number {
      let length = Math.min(a.length, b.length);
      for (let i = 0; i < length; i++) {
        if (a[i] != b[i]) {
          return a[i] < b[i] ? -1 : 1;
        }
      }
      return Math.sign(a.length - b.length);
    },
  } as any;
  appGlobal.remoteApp = {
    async getCACertificates(type: string): Promise<string[]> {
      return type == "system"
        ? [kCertificate, kSMIMECACertificate].map(cert => Certificate.encodePEM(Certificate.decodeFromBase64(cert), { label: "CERTIFICATE" }))
        : [];
    },
  };
}
