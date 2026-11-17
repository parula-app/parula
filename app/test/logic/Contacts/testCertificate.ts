import { appGlobal } from "../../../logic/app";
import { Certificate } from "../../../logic/Mail/Encryption/SMIME/SMIMEASN1";

/** A self-signed S/MIME certificate for `signer@example.com`, in the form in
 * which the directory attribute `userCertificate` holds it:
 * DER-encoded and then base64-encoded.
 * Generated with:
 * openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 3650 -nodes \
 *   -subj "/CN=Test Signer/emailAddress=signer@example.com"
 */
export const kCertificate = "MIIDUzCCAjugAwIBAgIUSkf7tdhUuEhNCfqiD4yD1Vw2+lcwDQYJKoZIhvcNAQELBQAwOTEUMBIGA1UEAwwLVGVzdCBTaWduZXIxITAfBgkqhkiG9w0BCQEWEnNpZ25lckBleGFtcGxlLmNvbTAeFw0yNjEwMjIyMzE5MjZaFw0zNjEwMTkyMzE5MjZaMDkxFDASBgNVBAMMC1Rlc3QgU2lnbmVyMSEwHwYJKoZIhvcNAQkBFhJzaWduZXJAZXhhbXBsZS5jb20wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC1n9RaRVdxlFhvMOyEFxL6tazrV7KXs8r3xWrjEKgfreHOQEBsGwd77YUFT0fCgzpPk6sMXKMUqeY3ZVV7belK68/yB+rR3CcNTp3LDi0Myy0LYhtgU3cmR+IuRv+LchBSun3kr14QnW+dfx95ow48wZ5C/WvuKEt+kQLF68b7xTXhLHhlWyatD9222XyXS6RGoO17eLexTOoGiwifo1HfmoVFeVNakRg1pzXJzOECd+ZAbpVgvZGbeTEk5UUPlL3co2dFo32Ibk8yVRpmpoZjBXngzE5P0Mmf6+r7VWUyTqitlMQpLJ6zhtyjJbRMNsbdqiEiWDP88mv/5wAQ4o6jAgMBAAGjUzBRMB0GA1UdDgQWBBS02Lr3mwXiznq2OGyRFWihB/BANjAfBgNVHSMEGDAWgBS02Lr3mwXiznq2OGyRFWihB/BANjAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQBiIVrAV0UHcojiEXXCCyje6sVCaGYTQLdhUu4OWjX6CjdXSh6s5aW0UZnU71Ip+YUbpEtCOkPFz22lUj0PVI+6XyXNGW4asS4j2yAXqTk6lnSNUtNbUha21/8E2S1beAnxwc6uSlakUPfPat0q08rAqIQO+v0tmCS89ZpA0ECXABoolKIeFN1y601SqiFfDp0kO8Tlj4edhpNxe9+MiOa+aU9Y7CTKrMHxKuNDsE2l2ImpOVeyd1ExVuh/Kb/eoGCrCzd6oFzj9RjBpmLFlYl1q2pN5bgLxtEQTsQvSofGsqKfZ8X6VQ7ok6HnaaHQdXixp48PBqK67t3H3PqbiLyj";

/** The email address in the subject of `kCertificate` */
export const kCertificateEmailAddress = "signer@example.com";

/** A certificate for `smime@example.com` together with the CA that issued it,
 * in the form in which the directory attribute `userSMIMECertificate` holds it:
 * a PKCS#7 SignedData without content, DER-encoded and then base64-encoded.
 * Generated with:
 * openssl req -x509 -newkey rsa:2048 -keyout ca.key -out ca.pem -days 3650 -nodes \
 *   -subj "/CN=Test SMIME CA"
 * openssl req -newkey rsa:2048 -keyout leaf.key -out leaf.csr -nodes \
 *   -subj "/CN=SMIME User/emailAddress=smime@example.com"
 * openssl x509 -req -in leaf.csr -CA ca.pem -CAkey ca.key -out leaf.pem -days 3000
 * openssl crl2pkcs7 -nocrl -certfile leaf.pem -certfile ca.pem -outform DER -out chain.p7b
 */
export const kSMIMECertificate = "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";

/** The email address in the subject of the leaf certificate of `kSMIMECertificate` */
export const kSMIMECertificateEmailAddress = "smime@example.com";

/** The CA certificate in `kSMIMECertificate`, DER-encoded and then base64-encoded.
 * Extracted with:
 * openssl pkcs7 -inform DER -in chain.p7b -print_certs
 */
export const kSMIMECACertificate = "MIIDETCCAfmgAwIBAgIUEYy9Dmg0uKTWOvcvMiJ6IcetjLMwDQYJKoZIhvcNAQELBQAwGDEWMBQGA1UEAwwNVGVzdCBTTUlNRSBDQTAeFw0yNjA4MTgxNTA3MzVaFw0zNjA4MTUxNTA3MzVaMBgxFjAUBgNVBAMMDVRlc3QgU01JTUUgQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC6R44sJVl7dlIKsplOe6Bfu9vLtFzzS2z6YgYhQWATfXhVpqr6GPDvCeKbmGiF1Yp2YfGglbSWtrt2hxq8oKyBcdMf2LkwyfV0BWCMe8+WaSfACP71/DcQSW0XgudmG/AbOhKxoBxn6cajPZ6xHTTCjOoJ3UV3P+VCobLM9IkArUvJE5iyq5ctNQsakd4r0Dtd4hsg33loGRY4pvp9LoApxtc62fB7qSnKwVaUMDkbH+wfCLt5yCfKcgtBV2cBLnTvbIKZ914e0Zj1j/EbzkcPA9CqyqTqCWXarqanqDNB0jGo6csLYsidqmk4rcYcgiqLcPvAb9RFaK23jNOVXmA5AgMBAAGjUzBRMB0GA1UdDgQWBBQb8dEo26Zr1zYROeOttY5Xei8qGTAfBgNVHSMEGDAWgBQb8dEo26Zr1zYROeOttY5Xei8qGTAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQBWZdTfBuDB/rbS8PCSVl7WWrYvcOqrRn95jCaRbKZ1jsL4K/i0ZrOrAtrJiASFEx6bOeqIStCXy6gAL6ecUG5d6bb4gGnZ1SO/Pg8U9P1SI4Fg4eD9mlB66kKwvESQfN2yJ9kiOVL51jIiZwIp/3oG7u4xZzLUD2Z//6RkOlm8CD2iX/W5e0A+OkuOxfFAnJOcWwf/JmRuwWjeh/jya6fZwAc1QkMlDIFCa61dw2YilEUqAaaQ+Z69wqoPR7JpgY+z+GQ1CxiEgwl7Q82dd6C0JRYkUn9AeIhTFwvufA5qFkTiikcmnayySg+5nhJ5r5Qv6U++YvHNTJ8eh0hzZwcA";

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
