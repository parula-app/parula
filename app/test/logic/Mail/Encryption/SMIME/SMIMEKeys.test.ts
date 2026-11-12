// The key classes use the app singleton. Importing it first breaks the
// import cycle, which would otherwise leave the base classes undefined.
import "../../../../../logic/app";
import { SMIMEPrivateKey } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEPrivateKey";
import { SMIMEPublicKey } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEPublicKey";
import { CertificationRequest, Extensions, SubjectAlternativeName, KeyUsage, ExtKeyUsage } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEASN1";
import { expect, test, describe } from "vitest";

// `setCertificate()` digests using `window.crypto`,
// which the browser has, but Node does not.
globalThis.window ??= globalThis as any;

/* Test certificates, generated with:
 * openssl req -x509 -newkey rsa:2048 -keyout /dev/null -days 7300 -nodes \
 *   -subj "/CN=Ben Bucksch" \
 *   -addext "subjectAltName=DNS:example.com,email:ben@example.com,email:ben.bucksch@example.com"
 * The DNS entry comes first, to ensure that we skip non-email entries. */
const kSANCert = `
-----BEGIN CERTIFICATE-----
MIIDUTCCAjmgAwIBAgIUCUI0bwNJoB+lDmgUgJhTbax3BL4wDQYJKoZIhvcNAQEL
BQAwFjEUMBIGA1UEAwwLQmVuIEJ1Y2tzY2gwHhcNMjYwODE4MTg1MzA1WhcNNDYw
ODEzMTg1MzA1WjAWMRQwEgYDVQQDDAtCZW4gQnVja3NjaDCCASIwDQYJKoZIhvcN
AQEBBQADggEPADCCAQoCggEBAKC9k395FT9YtQGAsBrcALeC+kOeI5IgwkY9fEFb
q2fbn+/Z5clJ+LN8ZpS86YvDJOqNzs6hVr4ObmLC7SYZ6DeM6PSnhWsGloUk196p
0dbqWPZrCeIXc3A8umKBoSIbinoYMuevvh/mFgNz3B/1NOMIa6yd/jZd7JTh61bl
VSceCoOWrJAyJHo53tTZPaAEZO4cBTkmEbVtXOBUEcQyKzqGkpGzxlA4DPF5SMJq
1cHoC19uo34leeuM2pPxxjgSWWci3W2BG67/JwioBn/sNp3BSWAz+BTkhDCW5OTY
+tE9oWh/8BzKQwh5L2zFp1D9i2balxkzEB5AaQbDrIjY7q0CAwEAAaOBljCBkzAd
BgNVHQ4EFgQUlqqa0f42jbj760HsJDtzTVEGu0YwHwYDVR0jBBgwFoAUlqqa0f42
jbj760HsJDtzTVEGu0YwDwYDVR0TAQH/BAUwAwEB/zBABgNVHREEOTA3ggtleGFt
cGxlLmNvbYEPYmVuQGV4YW1wbGUuY29tgRdiZW4uYnVja3NjaEBleGFtcGxlLmNv
bTANBgkqhkiG9w0BAQsFAAOCAQEATAIPhcqQ3Rsq8/+uaGvND5X0dBWl4ah+auBN
qXAVDKDkA4M61Cm2if4srAbb6YMpcH2ud/hAlkud3jjaT5lNudyJW0TPHhD0vys/
Qdz82EDnOE3E2GHI3sWRTNR501V3ylyc9MgFj59lxWpj5P0YDFj4Q6Ww/ySdXFd9
KF2j/OF2dgjVNA105lYg8xBUUVLHNOOl8ITise6P6kzOI8eWfElOWVqYnT0df7nJ
YX5n7EFBXWPJpaYQAc01iv//P1OeUaxgcMta4AGsAru57fCN8vu2voWu1K9ZNYu/
gJjFINW8e/nTD20skKc0C5Rt5jTuohi5Ck4kkzyh1SeXx1otxQ==
-----END CERTIFICATE-----
`;

/* openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 30 -nodes \
 *   -subj "/CN=Test Signer/emailAddress=signer@example.com"
 * No subjectAlternativeName, so the email address is only in the subject. */
const kSubjectOnlyCert = `
-----BEGIN CERTIFICATE-----
MIIDUzCCAjugAwIBAgIUAQW15cvskbzwNvhVJXyq52QDxaEwDQYJKoZIhvcNAQEL
BQAwOTEUMBIGA1UEAwwLVGVzdCBTaWduZXIxITAfBgkqhkiG9w0BCQEWEnNpZ25l
ckBleGFtcGxlLmNvbTAeFw0yNjA4MDYwNDM5MDhaFw0yNjA5MDUwNDM5MDhaMDkx
FDASBgNVBAMMC1Rlc3QgU2lnbmVyMSEwHwYJKoZIhvcNAQkBFhJzaWduZXJAZXhh
bXBsZS5jb20wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC4k0cl19gs
x4Xl1cHEKDcWQlXKxOSukx61JUWRBOO7xbSe1AtwOMiW1JqkQX3kfa0w8ZmSGVHx
kdgrFOlR338FvlFb69kXRvNzUGeItQe74VNtx0tQXnPXqY+Tagu5ADylnmigrOu2
rg5c+SBLOJQAoWtMD6mbM6KYCRR19eldVgxcCof7F4Y3G7STtG4qpGKICuVJId7z
Rnqu3yXNG3xOYxzzTS5zr6e93Hw/yDv1xzRxDI+SbIw0L4ACEBH8s8YfaNaiANdG
JJ2Xx1P+efrnkspHatB7q9A7lqciLOlDnyAZCAjjAO2p72ZnpKkFvjudEBr4rHZ/
99j9TTnt0SAdAgMBAAGjUzBRMB0GA1UdDgQWBBTujBkKZezwOop+jqJtHfK7RwFr
rzAfBgNVHSMEGDAWgBTujBkKZezwOop+jqJtHfK7RwFrrzAPBgNVHRMBAf8EBTAD
AQH/MA0GCSqGSIb3DQEBCwUAA4IBAQBoXOLO6OTXNPAQ5RqtP7mQ28dCu6bkeJSa
0a+Aov1GK88Hs0XhoC4JO6EvEAOgvjHpXfCS0UVmN+G87wcJwBUFfi8hRpukkChm
9pljV8ae7QXZda9p3BMq17F2dTnPV6UoFhhrh9sFFbqthIL9wHudNHhtmSptuDFS
sZBeHGzYLMtQyCqUaEw+29hj3xGC1oa0lpr4lGw6bT4MLo9CUw+Kgmy7+SbwkOVD
IQTe2BtjfHHDGT55E95h5IdbModq2XwqVL5Q9IE+AF+pHsaXqNgftU6a6mNHDrYW
l4zpoSh99If6kRdiy11N0gE6GKhZEXdjsLWMOugiyXKPnpI80lv9
-----END CERTIFICATE-----
`;

describe("Newly created private key", () => {
  test("is named after its key ID and has the email address of the identity", async () => {
    let key = await SMIMEPrivateKey.createNewPrivateKey("ben@example.com");
    expect(key.name).toBe(key.id.substring(0, 4).toUpperCase());
    expect(key.userIDs.contents).toEqual(["ben@example.com"]);
    let csr = await key.generateCSRFile({ CN: "Ben Bucksch", E: "ben@example.com" });
    expect(csr.name).toBe(`CertificateRequest-ben@example.com-${key.name}.csr`);
  }, 60000); // generating an RSA 4096 key takes a while

  test("certificate request asks for the email address, signing, encryption and email protection", async () => {
    let key = await SMIMEPrivateKey.createNewPrivateKey("ben@example.com");
    let csr = await key.generateCSRFile({ CN: "Ben Bucksch", E: "ben@example.com" });
    let request = CertificationRequest.decodePEM(await csr.text(), { label: "CERTIFICATE REQUEST" });
    let extensionRequest = request.certificationRequestInfo.attributes.find(attr => attr.attrType == "extensionRequest");
    let extensions = Extensions.decode(extensionRequest.attrValue[0]);
    function extension(id: string): Uint8Array {
      return extensions.find(ext => ext.extnID == id).extnValue;
    }
    expect(SubjectAlternativeName.decode(extension("subjectAlternativeName"))).toContainEqual({ type: "rfc822Name", value: "ben@example.com" });
    // Bit 0 of a BIT STRING is the most significant bit of the first byte
    let keyUsage = KeyUsage.decode(extension("keyUsage")).data[0];
    expect(keyUsage & 0b10000000).toBeTruthy(); // digitalSignature
    expect(keyUsage & 0b00100000).toBeTruthy(); // keyEncipherment
    expect(ExtKeyUsage.decode(extension("extKeyUsage"))).toContain("emailProtection");
  }, 60000);
});

describe("Certificate", () => {
  test("email addresses become the user IDs", async () => {
    let key = await SMIMEPublicKey.importPublicKey(kSANCert);
    expect(key.userIDs.contents).toEqual(["ben@example.com", "ben.bucksch@example.com"]);
    expect(key.name).toBe(key.id.substring(0, 4).toUpperCase());
  });

  test("without subjectAlternativeName uses the subject", async () => {
    let key = await SMIMEPublicKey.importPublicKey(kSubjectOnlyCert);
    expect(key.userIDs.contents).toEqual(["signer@example.com"]);
  });

  test("does not overwrite the name of an existing key", async () => {
    let key = new SMIMEPublicKey();
    key.name = "My work key";
    await key.addCertificates(kSANCert);
    expect(key.name).toBe("My work key");
    expect(key.userIDs.contents).toEqual(["ben@example.com", "ben.bucksch@example.com"]);
  });
});

test("Key without a certificate has no user ID, and still gets a proper file name", () => {
  let key = new SMIMEPublicKey();
  key.name = "A1B2";
  expect(key.keyFilename("SecretKey", "key")).toBe("SecretKey-A1B2.key");
});
