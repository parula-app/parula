// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../../logic/app";
import { appGlobal } from "../../../../../logic/app";
import { SMIMEPublicKey, KeyStatus } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEPublicKey";
import { SMIMEDirectory } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEDirectory";
import { Certificate } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEASN1";
import { kUntrustedSMIMECertificate, trustTestCAs } from "../../../Contacts/testCertificate";
import type { ArrayColl } from "svelte-collections";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

/* The certificates below were generated with OpenSSL 3, each DER-encoded and then base64-encoded:
 * openssl req -x509 -newkey rsa:2048 -keyout root.key -out root.pem -days 7300 -nodes -subj "/CN=AIA Test Root CA" \
 *   -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
 * openssl req -newkey rsa:2048 -keyout intermediate.key -out intermediate.csr -nodes -subj "/CN=AIA Test Intermediate CA"
 * openssl x509 -req -in intermediate.csr -CA root.pem -CAkey root.key -out intermediate.pem -days 7300 -extfile ca.ext
 *   ca.ext: basicConstraints=critical,CA:TRUE,pathlen:0  keyUsage=critical,keyCertSign,cRLSign
 *           subjectKeyIdentifier=hash  authorityKeyIdentifier=keyid
 * openssl req -newkey rsa:2048 -keyout leaf.key -out leaf.csr -nodes -subj "/CN=AIA Test User/emailAddress=aia@example.com"
 * openssl x509 -req -in leaf.csr -CA intermediate.pem -CAkey intermediate.key -out leaf.pem -days 7300 -extfile leaf.ext
 *   leaf.ext: basicConstraints=critical,CA:FALSE  keyUsage=critical,digitalSignature,keyEncipherment
 *             extendedKeyUsage=emailProtection  subjectAltName=email:aia@example.com
 *             authorityInfoAccess=OCSP;URI:http://ocsp.example.com/,
 *               caIssuers;URI:ldap://ldap.example.com/cn=AIA%20Test%20Intermediate%20CA?cACertificate,
 *               caIssuers;URI:file:///etc/ssl/intermediate.cer, caIssuers;URI:http://ca.example.com/intermediate.cer
 * openssl crl2pkcs7 -nocrl -certfile root.pem -certfile intermediate.pem -outform DER -out intermediate.p7c
 * Two CAs that issued each other's certificate: "AIA Test Loop CA A" and "... B", each with
 * `authorityInfoAccess=caIssuers;URI:http://loop.example.com/a.cer` (B) or `.../b.cer` (A),
 * and "AIA Loop User" <loop@example.com>, issued by B, with `caIssuers;URI:http://loop.example.com/b.cer`.
 * "AIA IP User" <ip@example.com>, like the leaf above, but only with `caIssuers;URI:http://192.168.1.5/intermediate.cer`.
 */

/** Trusted by the OS */
const kRootCA = "MIIDJzCCAg+gAwIBAgIUHKMi52mkaH/HL2zYH5REjYzYTpEwDQYJKoZIhvcNAQELBQAwGzEZMBcGA1UEAwwQQUlBIFRlc3QgUm9vdCBDQTAeFw0yNjExMDUxMTA4NDBaFw00NjEwMzExMTA4NDBaMBsxGTAXBgNVBAMMEEFJQSBUZXN0IFJvb3QgQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCkUdnNSdBaKeBHEijpeTXXH9ODYvzJbdlywdYBNms2hLo0LmXpdFUclVbtuEFxJrKatZ6B5BuFo94uDsGQr/2ZNn3Qc5oFn4hxemHs/pGgJnBXnYsxmSD3C+BgB3mKYFgd4QV64oYjhF9qSMGRrRyN02O7r3TMd7M4lZJZo2lkucNmadUYuBof8HpFL4/dM9s3FaZoHtNby54hAjzRCawbTjEUPI41yXehfdB8jwPhclwmno3iUTc4WCH2zI6HnzmikFDhaN1l9hZMRg5/n9OAXhhSQviLYlaoRIu1XEqE9s9aR6RdAsnZfZxL0s0tFsOqsX01tyVnZFWUgNabtQ/nAgMBAAGjYzBhMB0GA1UdDgQWBBR/zV8BJBsgIYzOsd4ObS4UUMbAKjAfBgNVHSMEGDAWgBR/zV8BJBsgIYzOsd4ObS4UUMbAKjAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBBjANBgkqhkiG9w0BAQsFAAOCAQEAcRS32KqW0WMiuwIp6B/wWvFkEpkhZg1I0LS9rc98rpKltEdwDQHxAXuqaFl5cqV8kBuRCVD+cuG5s4qY/9aw29Cu3vUgiULJRO70MDbRi+oG1FXFZqdtwzrWS4OM6o0lLc9s3evouWNJHZgcwIirIJilGbPIRrmo8OkJk4ylnhagFVjAzEFitV06EZaZYE+KTQH6dm7MK38phA1/0Z1acGrmx5mGxeN4lns+vfjTzSMcFClDaI3A8VBmjYG02X3Grqyyp7JRgs3mzyTzegUSEb7ejDS6K18hSyg5nvNhLUg6dDojG7BttSR2pcoHcJGAOVLCWJcOxBuPKtjXyoYoBg==";

/** Issued by `kRootCA`. Directories often lack it. */
const kIntermediateCA = "MIIDMjCCAhqgAwIBAgIUAhJ2wicNaVQ4K5MDek1vVOqmh7EwDQYJKoZIhvcNAQELBQAwGzEZMBcGA1UEAwwQQUlBIFRlc3QgUm9vdCBDQTAeFw0yNjExMDUxMTA4NDBaFw00NjEwMzExMTA4NDBaMCMxITAfBgNVBAMMGEFJQSBUZXN0IEludGVybWVkaWF0ZSBDQTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAM8xvQny+FpTaLdD0GCp6f8pz9gDsRJ/sKIQ+/cXyqitYash0FaS49sATx44xOT+1maXEYcgqPLf/FgoGvJC5HvF7GicZNvhFd+y4SVm8xY7HggI/fEzA0IctDgWmv4jGY1FN5MSaubrRxMS/BwzPZ8f8/q7TsGZRQVA03QLQNaBdthlpjpY55QsdK1dplY2V86T5+siQjt1Y6tgXNIqLTyahuSarVqiMNAKdKE33c3UHiSvGWDJSWMI5+bNLdFXI+nui8ySp2JBmAO36MzUveNqJR1igomtw5udmp+7pHjqocSBEnXDRHyzYBMe8neINtGIwTUw8gsSMNPRbhcJGusCAwEAAaNmMGQwEgYDVR0TAQH/BAgwBgEB/wIBADAOBgNVHQ8BAf8EBAMCAQYwHQYDVR0OBBYEFNXdq7jHwad34vjtHqU7uJJpXW4AMB8GA1UdIwQYMBaAFH/NXwEkGyAhjM6x3g5tLhRQxsAqMA0GCSqGSIb3DQEBCwUAA4IBAQBl7CgeZC0zld7Mp5vXXUVgY+FxcIsyIytbQMeMxqMrHaHkY3tUQxF5pAfXJ1Vd20uBAvEtc9VyF1n+U0spg+OAOVljx+GJ7U8oehV7UlwmV5o5upjlnX1SIgIRHc4BwlfulNMAMxPNTFYFXbwvbT/0LzYrGL+m1nlMTaJ3hjYs+c5OprMaYLTaPpMHGoL41IoZms95AEOrCH6g1BOqd93EDz8xCUvbbEbNB4ofBdvjxcyOy0Xwvgg5tkpEB+cPHbhjXm/1+jRUoBxaId+zqYXcXtwKHHb2UDdYSXYdHOCvYQmJXQYt9UXyOkkHNwI5cIlSN1+IInsHHtfENcwN8w6A";

/** `kRootCA` and `kIntermediateCA` as PKCS#7 "certs-only", as in a .p7c file */
const kIntermediateCAAsPKCS7 = "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";

/** Issued by `kIntermediateCA`, which is at `kIntermediateCAURL` */
const kUserCertificate = "MIIEbjCCA1agAwIBAgIUQ6e13JQZPdCuOFh10K6lLzCyN7wwDQYJKoZIhvcNAQELBQAwIzEhMB8GA1UEAwwYQUlBIFRlc3QgSW50ZXJtZWRpYXRlIENBMB4XDTI2MTEwNTExMDg0MFoXDTQ2MTAzMTExMDg0MFowODEWMBQGA1UEAwwNQUlBIFRlc3QgVXNlcjEeMBwGCSqGSIb3DQEJARYPYWlhQGV4YW1wbGUuY29tMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAut6mrPtKgHMgZPt5y31dRZ6XUebTwb9WyrOhy9eZ4FEs2VC1Pd+sRSxgXDIoHbadaAhps15Ai/XxmveqNhJD5MjhF2/mlWlBAY7/peXb7LWdNlDp+XimgfNyUAL8avfmeEbiGsatAkbF6lgVrF3LBTtOhY4HjVwJuscGsvp+Mm3rS0AihirdbP7kadTgYfkJlUqOikVd/dRPKNyJcXFaB07PAigT3ZDiQaIgKfiP07lMIvN8zhkHioehhSLrz+s01E2LYFqsNFDXeafbZuvyz0Wd5RrwxMQ8M7GxPRTma3bSHgT7z6IWpbFhcy11te5evIcT0+SGUEySqi7VZHRIeQIDAQABo4IBgzCCAX8wDAYDVR0TAQH/BAIwADAOBgNVHQ8BAf8EBAMCBaAwEwYDVR0lBAwwCgYIKwYBBQUHAwQwGgYDVR0RBBMwEYEPYWlhQGV4YW1wbGUuY29tMIHtBggrBgEFBQcBAQSB4DCB3TAkBggrBgEFBQcwAYYYaHR0cDovL29jc3AuZXhhbXBsZS5jb20vMFMGCCsGAQUFBzAChkdsZGFwOi8vbGRhcC5leGFtcGxlLmNvbS9jbj1BSUElMjBUZXN0JTIwSW50ZXJtZWRpYXRlJTIwQ0E/Y0FDZXJ0aWZpY2F0ZTAsBggrBgEFBQcwAoYgZmlsZTovLy9ldGMvc3NsL2ludGVybWVkaWF0ZS5jZXIwMgYIKwYBBQUHMAKGJmh0dHA6Ly9jYS5leGFtcGxlLmNvbS9pbnRlcm1lZGlhdGUuY2VyMB0GA1UdDgQWBBQJCq6UcH78jbjFNWk5kLS9sX1jWDAfBgNVHSMEGDAWgBTV3au4x8Gnd+L47R6lO7iSaV1uADANBgkqhkiG9w0BAQsFAAOCAQEAS6xjJcjYKNDXAXYWa2dECXtE7FkJ5dBlXWxQKWgyRocomKoixKHOTCRQdW4UjFlA0DNQ9CfeI8qH2x1l8rTUtK+CIMdyHqZrPGYff/24eCQGM1cEtkvR7a44fE/EY43LMV1oCUV+T1lxOE6Fngwh5LcJcEJeJBnYnzTzj+1lwEO4FS4w/wV/7RbFwnGyhodoF44pYXyM789I7CjhoFBGOEB5tfWxUTgkSTiPKO0gvD6ffa3owqsIRjn9CU2fqJ+sA6Uos2B4hJjPPIH6UQR1SYL2N6YhwHi8AaujMi515djSVItRJSwOQ1eEbeeoBlpixjBCcshltTJ6VfFjp0NCww==";
const kIntermediateCAURL = "http://ca.example.com/intermediate.cer";

/** Issued by `kIntermediateCA`, which is at `kIntermediateCAIPURL` */
const kIPUserCertificate = "MIIDuTCCAqGgAwIBAgIUW4tbu/Z2rfPNRws4sM0dI5wecegwDQYJKoZIhvcNAQELBQAwIzEhMB8GA1UEAwwYQUlBIFRlc3QgSW50ZXJtZWRpYXRlIENBMB4XDTI2MTEwNjA5MDMxOVoXDTQ2MTEwMTA5MDMxOVowNTEUMBIGA1UEAwwLQUlBIElQIFVzZXIxHTAbBgkqhkiG9w0BCQEWDmlwQGV4YW1wbGUuY29tMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAn/BubuLw+RBZzW0+oNLVj1cu6laj0Bgqngk5yUhBNZNj24aEDLYVGnGg+R2qNoTbHEcvwVXrLGqHIDLBA1XmGch+KaZ6sLaiO4MEwA3/iJlTbsR0IAhCVhEpdB05ikWkeMfFFm31UVPFgW+qA/UWQN7uLJmEdRUQdYBtzRDOqKNXBQwp8f6OqSMaiKvlsBX3QDvawdEKjNBeCViVaocX34gdrLssfc+Z1lRQ4gUiEClqzNCRnHO6ndECCb95KZk5VwLByoChbl9i4msdvR2VovHATd2CIEt5EH2MP5TTkxN5adUlZnc03ZzUoNeImeKTK2H1ad0BK5a6lTekRskljwIDAQABo4HSMIHPMAwGA1UdEwEB/wQCMAAwDgYDVR0PAQH/BAQDAgWgMBMGA1UdJQQMMAoGCCsGAQUFBwMEMBkGA1UdEQQSMBCBDmlwQGV4YW1wbGUuY29tMD8GCCsGAQUFBwEBBDMwMTAvBggrBgEFBQcwAoYjaHR0cDovLzE5Mi4xNjguMS41L2ludGVybWVkaWF0ZS5jZXIwHQYDVR0OBBYEFCYZO1ly0jR+q/VHpxt0ZSyVxBAaMB8GA1UdIwQYMBaAFNXdq7jHwad34vjtHqU7uJJpXW4AMA0GCSqGSIb3DQEBCwUAA4IBAQBTNph0OqQPz/FQ0/d5UZrkaBvvzX5htJ/3UtwKs9p4L2cZ2eVluxTSE0FhQqJRfkFlLUO+0IKfKPgw12+7/36MYO45BHDX8K2H3X+vroSTy7XVeGDUg6G16+ZlZurO2acurjqXH0NQeq7m4PWIItVh5sWJlFzx0ebct8La1JJiaNuIv3WfZ+Ue91F3O6tcosdkfdU8GyFMynsjldh2OPYN4fBwjKn01ga4KmpNw+FUQK7bujdRuCk+nm/rxg1CEhfTdkC+OMEvNkCwHn9Qm81c82tXvNhuE+V2H55Cohtn68s5XeUCql4JKh5rl1XIHB73k4MzftnGgpQmR0dYaisc";
const kIntermediateCAIPURL = "http://192.168.1.5/intermediate.cer";

/** CA A, issued by CA B, at `http://loop.example.com/a.cer` */
const kLoopCAA = "MIIDizCCAnOgAwIBAgIUWefMFyoyO0KD8wHjnpxUzFFYpdUwDQYJKoZIhvcNAQELBQAwHTEbMBkGA1UEAwwSQUlBIFRlc3QgTG9vcCBDQSBCMB4XDTI2MTEwNTExMDg0MVoXDTQ2MTAzMTExMDg0MVowHTEbMBkGA1UEAwwSQUlBIFRlc3QgTG9vcCBDQSBBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArL61KrN8FAPWYKfGOZ5evktjS/1ER1alFkcyuxJTi3IzndOgZMhaPTuP44Dztq5T4oUWEBkBEki8F7KWIEupOHGDlMlX6pZIeZAueYKh76nr3F0sppYEDm1fIHI27RWsSU05yRGpp/8rENtfVN6wYqxTBAjJzAOnRuf8/NSe8xAKECNlS/AFze85XTIwEaqqRRBOteMOIK3seM4UrJs67IG217K4q63A9Ds1R+y5x1ft9viYyX+h4nD9/ovlQoj8aAe1xbRj4zp48Xi6optalfIQgrlzI7SYspapITzqbS58jKKu0+Fn6q35KRouWoN94QqnKeqe7VNy0315IyxDNQIDAQABo4HCMIG/MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMDkGCCsGAQUFBwEBBC0wKzApBggrBgEFBQcwAoYdaHR0cDovL2xvb3AuZXhhbXBsZS5jb20vYi5jZXIwHQYDVR0OBBYEFFunFWKnC2il4OChRJ+QZDaXk///MEIGA1UdIwQ7MDmhIaQfMB0xGzAZBgNVBAMMEkFJQSBUZXN0IExvb3AgQ0EgQoIUDIjBJJf7QyO5qaDrCRQ2QKkucFcwDQYJKoZIhvcNAQELBQADggEBAHetTo8o/sLbomMvgAL2+bMtR/hhrq6TyAmkWvsklROr+Zr0w2kf6c0ruhFqxtpDUxvKF73cCk7J//cDVysWDLuvWW9RH9g4C3KUuRNVyHtXKso9WdHNj8UZ49trKyTDXFbNEzrwKf5HMXgiTEDMWDU3fBe1qVk1a3c4mw4vv5t50s4ElssF1BOdHv8EluDoG9XRtDwF0kOq55kM4wpgcg9PdSM9Fq+Gt3HcPdNIzuS0Nu0OCPKHeH3G000vQbEls919TSb7kOy/G0RmGGjwMtkKR67g+4bkDcIy6qFlFURBBvTEjZYcRLAnrYc5ZifzjkVO837sCJNJd609A2NIS3k=";
/** CA B, issued by CA A, at `http://loop.example.com/b.cer` */
const kLoopCAB = "MIIDizCCAnOgAwIBAgIUA5USoid8EshMC8zB7LJ8zoyuarMwDQYJKoZIhvcNAQELBQAwHTEbMBkGA1UEAwwSQUlBIFRlc3QgTG9vcCBDQSBBMB4XDTI2MTEwNTExMDg0MVoXDTQ2MTAzMTExMDg0MVowHTEbMBkGA1UEAwwSQUlBIFRlc3QgTG9vcCBDQSBCMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAslaogmxdujNxFSThi65PHjv0h+9b7MGz9o4z6br3ChRD9XoWjXV5ibQZ5r0uKMh4ujwWn9ILsDB5Zw/G1UA9b81+O8BolrVOwc6eAbf/sfXyOX5cMZlrrYiJiRRsdCO6dBDe7rygdwXmu73Ywx58o/hFvhPtZEBMzHOGUMwkuM1pti5SRWcQki6zDpILyeb7m3k/gwalvo/YZ5fGN5mVHb3UNBVLJY7PmUh+7ThifPgqISdR/S38QCzpkfiI9HnNiU4PAK5Hr+1N2frtXbDNoGjXYxeXbfiAtxr8C1JM50fxop2yz9bfWReYuZ358xpTLHcc+NXztjt2rMaQeRb30QIDAQABo4HCMIG/MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMDkGCCsGAQUFBwEBBC0wKzApBggrBgEFBQcwAoYdaHR0cDovL2xvb3AuZXhhbXBsZS5jb20vYS5jZXIwHQYDVR0OBBYEFLLTmoqvVA74j9RnVqOG5Z/5wXaMMEIGA1UdIwQ7MDmhIaQfMB0xGzAZBgNVBAMMEkFJQSBUZXN0IExvb3AgQ0EgQYIUNvs2SgLu2punyDVadzeLFDpYvuwwDQYJKoZIhvcNAQELBQADggEBAD5y6oexzWslO9t1rq9xUXweLmtZsL0XguRE/b5Et4a37UHhvMm/LLOvT8Ep/saqBWG4BFD49tJJS+ZhN+/qHeRw/3+MS4S23B0V3aGp9w6yUvm7/ecMEvNqj9TXRzpGrtUTWK3Po3cDrsQ0JJpP3QmvQNwZUHGNYSnxFAZdqb+qEwEfjGiFFSkyA0P4cxpCRTPtNrA823a4sYK+NhDrw+9eTyfMPrtYycpNYYKfH0CYN5Suzrxv3+nQYSOKa93n6o+FsAnf4tmPBO+SCATViyhhhRtBeidARRkrxS76CuovY+uUxuwIZFMIduSJVMK/G3Mc80gvka02Q/urAXUUf90=";
/** Issued by CA B. No trusted root issued CA A or B. */
const kLoopUserCertificate = "MIID1jCCAr6gAwIBAgIUD8pJ+0JeNJWkVRCaK+m9leHcbqswDQYJKoZIhvcNAQELBQAwHTEbMBkGA1UEAwwSQUlBIFRlc3QgTG9vcCBDQSBCMB4XDTI2MTEwNTExMDg0MVoXDTQ2MTAzMTExMDg0MVowOTEWMBQGA1UEAwwNQUlBIExvb3AgVXNlcjEfMB0GCSqGSIb3DQEJARYQbG9vcEBleGFtcGxlLmNvbTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAL2hr+JD765hGor2+ZlRRQ56AYGykvzy9mKJeQOfL0oPcNBX2Qg3NRWmMe7U23BNVBqAgbYnvfRuIaQ3/IXe+tRz892U6q3b8zO2Nwo1HVIZ3Hi9ML04hIm99RYLe1LLUfbjGIt2J4wjEokMu30urzVe2itIgk4DY6mfz6xZ4LgIVyR+x9Hnsvc4ZfRrJuR4D7pe2U640oJjCU0DQ8I6a1UswWXx3VCGzFKf0CDpX0W6ROjBrKaIHEEg5r43XX7+HpAtBchspV8FTSWWAdqwXLf+6QVgOMFb0mZkZ9Ash0I8XEyUiAmqlGgk8ygfWKSpoWUkmzr+JJVqye4fo4rGf9UCAwEAAaOB8TCB7jAMBgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIFoDATBgNVHSUEDDAKBggrBgEFBQcDBDAbBgNVHREEFDASgRBsb29wQGV4YW1wbGUuY29tMDkGCCsGAQUFBwEBBC0wKzApBggrBgEFBQcwAoYdaHR0cDovL2xvb3AuZXhhbXBsZS5jb20vYi5jZXIwHQYDVR0OBBYEFFvb/+cAfwwAtOOOFUBtlGq8STYkMEIGA1UdIwQ7MDmhIaQfMB0xGzAZBgNVBAMMEkFJQSBUZXN0IExvb3AgQ0EgQoIUDIjBJJf7QyO5qaDrCRQ2QKkucFcwDQYJKoZIhvcNAQELBQADggEBAHCZ9UJJTTo/w1D9+fnmtb2GZqVHTNwhas2CTRnb2g+e2pvqxv2BZx65X8RW4qWrY+52RnObLvEGE+riVFLaTwXVucWSchnxtYBqgSSlqWN5QWIjA9l3wok3tbtH90nDSNYLWFzRvnjL7Fk0vMPyRoU7me6TYmTdP1mnRNTlbXOfTwCK4/3dPRRVhGRavtQuDlfsG6RITTHzQLsXuZwvTTcHY5ncs2cS6W9YbfHMGt+vp16qrFEL/wfk4r6hASRCXHEY9HtGZqv1xiM52CPhL9NtSUvMYUrdwhHrVIfpZTfAn3BS+afKpHTTTqsPJ0gF8sHq0qZrI+24wI8eWfcYzIo=";

/** The Exchange server whose GAL has the certificates. On the same base domain as the CA URLs above. */
const kServerURL = "https://mail.example.com/EWS/Exchange.asmx";

/** What the web servers answer, by URL. Other URLs fail. */
let webServer: Record<string, Uint8Array>;
/** The URLs that we fetched */
let requests: string[];

function der(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

trustTestCAs(); // for `indexedDB.cmp()`
appGlobal.remoteApp = {
  async getCACertificates(type: string): Promise<string[]> {
    return type == "system"
      ? [Certificate.encodePEM(Certificate.decodeFromBase64(kRootCA), { label: "CERTIFICATE" })]
      : [];
  },
  async kyCreate() {
    return {
      async get(url: string): Promise<ArrayBuffer> {
        requests.push(url);
        let answer = webServer[url];
        if (!answer) {
          throw new Error(`404 Not Found: ${url}`);
        }
        return answer.slice().buffer;
      },
    };
  },
};

beforeEach(() => {
  webServer = {};
  requests = [];
  (SMIMEDirectory as any).intermediateCertDownload.downloads.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

/** The keys that we take from a certificate that the company directory,
 * e.g. ActiveSync, returned without its CA certificates */
async function directoryKeys(certificate: string, serverURL = kServerURL): Promise<ArrayColl<SMIMEPublicKey>> {
  return await new SMIMEDirectory(serverURL).readCertificates([certificate], ex => { throw ex; });
}

/** The certificate of the signer of a received mail, without its CA certificates */
async function signerKey(certificate: string): Promise<SMIMEPublicKey> {
  return await SMIMEPublicKey.importPublicKey(Certificate.encodePEM(Certificate.decodeFromBase64(certificate), { label: "CERTIFICATE" }));
}

test("Directory certificate without its intermediate CA: get the CA from the URL in the certificate", async () => {
  webServer[kIntermediateCAURL] = der(kIntermediateCA);
  let keys = await directoryKeys(kUserCertificate);
  expect(keys.length).toBe(1);
  expect(keys.first.userIDs.contents).toContain("aia@example.com");
  expect(await keys.first.keyStatus()).toBe(KeyStatus.Valid);
  expect(requests).toEqual([kIntermediateCAURL]);
});

test("Directory certificate without its intermediate CA, which comes as PKCS#7", async () => {
  webServer[kIntermediateCAURL] = der(kIntermediateCAAsPKCS7);
  let keys = await directoryKeys(kUserCertificate);
  expect(keys.length).toBe(1);
  expect(await keys.first.keyStatus()).toBe(KeyStatus.Valid);
});

test("Only http and https URLs, not file: or ldap:", async () => {
  await directoryKeys(kUserCertificate);
  expect(requests.length).toBeGreaterThan(0);
  for (let url of requests) {
    expect(url).toMatch(/^https?:\/\//);
  }
});

test("CA URL on another domain than the directory server: no request, and no certificate", async () => {
  webServer[kIntermediateCAURL] = der(kIntermediateCA);
  let keys = await directoryKeys(kUserCertificate, "https://outlook.office365.com/EWS/Exchange.asmx");
  expect(keys.length).toBe(0);
  expect(requests).toEqual([]);
});

test("CA URL on the IP address of the directory server", async () => {
  webServer[kIntermediateCAIPURL] = der(kIntermediateCA);
  let keys = await directoryKeys(kIPUserCertificate, "https://192.168.1.5/EWS/Exchange.asmx");
  expect(keys.length).toBe(1);
  expect(requests).toEqual([kIntermediateCAIPURL]);
});

test("CA URL on another IP address than the directory server, which ends in the same numbers: no request", async () => {
  webServer[kIntermediateCAIPURL] = der(kIntermediateCA);
  let keys = await directoryKeys(kIPUserCertificate, "https://10.0.1.5/EWS/Exchange.asmx");
  expect(keys.length).toBe(0);
  expect(requests).toEqual([]);
});

test("Ask the web server only once, also for other certificates from the same CA", async () => {
  webServer[kIntermediateCAURL] = der(kIntermediateCA);
  expect((await directoryKeys(kUserCertificate)).length).toBe(1);
  expect((await directoryKeys(kUserCertificate)).length).toBe(1);
  expect(requests.length).toBe(1);
});

test("Ask again only a while after the web server failed", async () => {
  vi.useFakeTimers();
  expect((await directoryKeys(kUserCertificate)).length).toBe(0);
  expect((await directoryKeys(kUserCertificate)).length).toBe(0);
  expect(requests.length).toBe(1);
  vi.advanceTimersByTime(24 * 60 * 60 * 1000);
  webServer[kIntermediateCAURL] = der(kIntermediateCA);
  expect((await directoryKeys(kUserCertificate)).length).toBe(1);
  expect(requests.length).toBe(2);
});

test("The CA from the URL needs a trusted root itself", async () => {
  webServer["http://loop.example.com/b.cer"] = der(kLoopCAB);
  expect((await directoryKeys(kLoopUserCertificate)).length).toBe(0);
  expect(requests).toContain("http://loop.example.com/b.cer");
});

test("CAs that issued each other: no endless loop", async () => {
  webServer["http://loop.example.com/a.cer"] = der(kLoopCAA);
  webServer["http://loop.example.com/b.cer"] = der(kLoopCAB);
  expect((await directoryKeys(kLoopUserCertificate)).length).toBe(0);
  expect(requests.length).toBeLessThan(10);
});

test("The web server sends another certificate than the CA", async () => {
  webServer[kIntermediateCAURL] = der(kLoopCAB);
  expect((await directoryKeys(kUserCertificate)).length).toBe(0);
});

test("The web server sends something that is not a certificate", async () => {
  webServer[kIntermediateCAURL] = new TextEncoder().encode("<html><body>Moved</body></html>");
  expect((await directoryKeys(kUserCertificate)).length).toBe(0);
});

test("The web server sends a huge answer", async () => {
  let huge = new Uint8Array(20 * 1024 * 1024);
  huge.set(der(kIntermediateCA));
  webServer[kIntermediateCAURL] = huge;
  expect((await directoryKeys(kUserCertificate)).length).toBe(0);
});

test("The web server fails", async () => {
  expect((await directoryKeys(kUserCertificate)).length).toBe(0);
  expect(requests).toEqual([kIntermediateCAURL]);
});

test("A directory certificate that no trusted CA issued is not taken", async () => {
  let keys = await new SMIMEDirectory(kServerURL).readDirectoryCertificates([kUntrustedSMIMECertificate], [], ex => { throw ex; });
  expect(keys.length).toBe(0);
});

test("userSMIMECertificate is not trusted: take userCertificate", async () => {
  webServer[kIntermediateCAURL] = der(kIntermediateCA);
  let keys = await new SMIMEDirectory(kServerURL).readDirectoryCertificates([kUntrustedSMIMECertificate], [kUserCertificate], ex => { throw ex; });
  expect(keys.length).toBe(1);
  expect(keys.first.userIDs.contents).toContain("aia@example.com");
});

test("Certificate of the signer of a received mail: no request, which would tell the sender that the mail was read", async () => {
  webServer[kIntermediateCAURL] = der(kIntermediateCA);
  let key = await signerKey(kUserCertificate);
  expect(await key.keyStatus()).not.toBe(KeyStatus.Valid);
  expect(requests).toEqual([]);
});
