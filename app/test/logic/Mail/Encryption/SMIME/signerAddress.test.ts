import "../../../../../logic/app";
import { setupTestFolder } from "../../SQL/setup";
import { Addressbook } from "../../../../../logic/Contacts/Addressbook";
import { findOrCreatePersonUID, type PersonUID } from "../../../../../logic/Abstract/PersonUID";
import type { EMail } from "../../../../../logic/Mail/EMail";
import { kClearSigned } from "./signedMessages";
import { expect, test, describe } from "vitest";

// The browser has this, but Node does not.
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

/** @param from As the server gives it before we have the MIME source */
async function readMessage(mime: string, from?: PersonUID): Promise<EMail> {
  let { folder } = await setupTestFolder({ getCACertificates: async () => [] });
  let email = folder.newEMail();
  if (from) {
    email.from = from;
  }
  email.mime = new TextEncoder().encode(mime.replace(/\n/g, "\r\n"));
  await email.parseMIME();
  return email;
}

function expectSigned(email: EMail) {
  expect(email.signedByKeyID).toBeTruthy();
  expect(email.signedByKeyID).toBe(email.signedKey?.id);
}

function expectNotSigned(email: EMail) {
  expect(email.signedByKeyID).toBe(null);
  expect(email.signedKey).toBe(null);
}

/** The outer headers are not signed, so anybody can change `From:`
 * of a signed message, and the signature stays valid. */
const kSignedByAliceFromCEO = kClearSigned.replace("From: Alice <alice@example.com>", "From: CEO <ceo@example.com>");

describe("S/MIME signature with a certificate for another address than From:", () => {
  test("is not signed", async () => {
    let email = await readMessage(kSignedByAliceFromCEO);
    expectNotSigned(email);
  });

  test("is not stored as the key of the sender", async () => {
    let email = await readMessage(kSignedByAliceFromCEO);
    expect(email.from.encryptionPublicKey).toBeFalsy();
    let ceo = email.from.createPerson(new Addressbook());
    expect(ceo.encryptionPublicKeys.isEmpty).toBe(true);
  });
});

describe("S/MIME signature with a certificate for the From: address", () => {
  test("in another case is signed", async () => {
    let email = await readMessage(kClearSigned, findOrCreatePersonUID("Alice@Example.COM", "Alice"));
    expectSigned(email);
    expect(email.from.encryptionPublicKey).toBe(email.signedKey);
  });

  test("only in the subject E= is signed", async () => {
    let email = await readMessage(kSignedSubjectOnlyCert);
    expectSigned(email);
  });
});

describe("S/MIME signed part with its own From:", () => {
  test("that is the outer From: is signed", async () => {
    let email = await readMessage(kSignedWithInnerFrom);
    expectSigned(email);
  });

  test("that is another address than the outer From: is not signed", async () => {
    // The certificate is also for bob@, but the signed part says that Alice wrote it
    let email = await readMessage(kSignedWithInnerFrom.replace("From: Alice <alice@example.com>", "From: Bob <bob@example.com>"));
    expect(email.from.emailAddress).toBe("bob@example.com");
    expectNotSigned(email);
  });
});

/* openssl req -x509 -newkey rsa:2048 -nodes -days 7300 \
 *   -subj "/CN=Bob/emailAddress=bob@example.com" \
 *   -addext "basicConstraints=critical,CA:FALSE" \
 *   -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
 *   -addext "extendedKeyUsage=emailProtection"
 * openssl smime -sign -md sha256
 * No subjectAltName, so the email address is only in the subject. */
const kSignedSubjectOnlyCert = `From: Bob <bob@example.com>
To: User <user@example.com>
Subject: Signed test
Date: Fri, 06 Nov 2026 09:00:00 +0000
Message-ID: <sig-subjectonly@example.com>
MIME-Version: 1.0
Content-Type: multipart/signed; protocol="application/x-pkcs7-signature"; micalg="sha-256"; boundary="----4F1C475965E2AF7C725D62A1A04F2E1F"

This is an S/MIME signed message

------4F1C475965E2AF7C725D62A1A04F2E1F
Content-Type: text/plain; charset=utf-8

Hello, this is signed.

------4F1C475965E2AF7C725D62A1A04F2E1F
Content-Type: application/x-pkcs7-signature; name="smime.p7s"
Content-Transfer-Encoding: base64
Content-Disposition: attachment; filename="smime.p7s"

MIIF9wYJKoZIhvcNAQcCoIIF6DCCBeQCAQExDzANBglghkgBZQMEAgEFADALBgkq
hkiG9w0BBwGgggNjMIIDXzCCAkegAwIBAgIUVGqSlYGyyTz7GlDFf+tCbErGbPUw
DQYJKoZIhvcNAQELBQAwLjEMMAoGA1UEAwwDQm9iMR4wHAYJKoZIhvcNAQkBFg9i
b2JAZXhhbXBsZS5jb20wHhcNMjYxMTA2MDkwOTI3WhcNNDYxMTAxMDkwOTI3WjAu
MQwwCgYDVQQDDANCb2IxHjAcBgkqhkiG9w0BCQEWD2JvYkBleGFtcGxlLmNvbTCC
ASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALkemxOgrN8p2z4qqstE8aCj
Wcj6iTEBVzUYLGRVYdVzj5mHVM6/m/V20VSdwVttaMCk8KIFaSAlSfLoy5G0Mu2N
bN13yNTU5wLL/Y++Gslwq4RdywysAHLpzLdgEMsZX7AeN0qMKl024+5P9h1LG2Kp
1xcCMXXiGfTvwCXPil6218zeDl0yBtk091SUNUiuLAsupJjwBpdMybIbfKGe1KYs
ooAtHBoFbgRKz0GJKWarBSn1m8AbaXfqTgeQWKboaq+Ag+VVHSS6jZf7rDvnB11L
JQj6ibQFckrsx17cv351dVRX93Pe6hmY3PoumEbafY8+iD7OpfpFsrc3AZd+WTkC
AwEAAaN1MHMwHQYDVR0OBBYEFLwWnDZjqo7SUZKnhQER1FrxleGfMB8GA1UdIwQY
MBaAFLwWnDZjqo7SUZKnhQER1FrxleGfMAwGA1UdEwEB/wQCMAAwDgYDVR0PAQH/
BAQDAgWgMBMGA1UdJQQMMAoGCCsGAQUFBwMEMA0GCSqGSIb3DQEBCwUAA4IBAQCi
xz9toRH76wrlYMv+D9Tov9gMbPHSoLgLcmEc22kYvIvMfiBCutF68t4pCys3iZdt
3QO0Zzpp6NfkBWHYG/qKr5b5gvIblGo0NEWA2LmcJv3Vt6xjQDpejHFbUK54WaMt
x3OvZ0ffSoad26sLyJPezJ7v7jweL8KKV2CH2alrh7sDGzB/fF/2nW0iiSMDg2hh
wfFa+BVsEMlxVWx//TW2VNbZylEjyFM5TcKs5D+lkXWCv49DpeoDwkK9YZ/ccwRE
mBltsEVJmCKRL0Mo3Zuw/nCSnv9LwSYh6dJ2VvSa/jLV7w7L4vtT0Eg5gTDUhjZQ
jcqpcla6BE9pNcRuS134MYICWDCCAlQCAQEwRjAuMQwwCgYDVQQDDANCb2IxHjAc
BgkqhkiG9w0BCQEWD2JvYkBleGFtcGxlLmNvbQIUVGqSlYGyyTz7GlDFf+tCbErG
bPUwDQYJYIZIAWUDBAIBBQCggeQwGAYJKoZIhvcNAQkDMQsGCSqGSIb3DQEHATAc
BgkqhkiG9w0BCQUxDxcNMjYxMTA2MDkwOTI3WjAvBgkqhkiG9w0BCQQxIgQgUM2k
mrp9VpXn/RyyroUucfFv2kO/f+MJVjpkHd2ZErgweQYJKoZIhvcNAQkPMWwwajAL
BglghkgBZQMEASowCwYJYIZIAWUDBAEWMAsGCWCGSAFlAwQBAjAKBggqhkiG9w0D
BzAOBggqhkiG9w0DAgICAIAwDQYIKoZIhvcNAwICAUAwBwYFKw4DAgcwDQYIKoZI
hvcNAwICASgwDQYJKoZIhvcNAQEBBQAEggEAjsJS5hIkHa7jZfvkHRRuzfyQK/PN
0CflrtVYYcqv5Y3Ml7hBQcgJ3Nzfmbl4j87Ez7Qph1dF24iXaBuQD0mq/9sRdQ/2
lmZcUMb7d3sfnHkK7MR2j8KfNcR4e3QGkJYyfYylycsHaHKyEp+XazVaGVJGCkvA
13CRiKmPS9Z/mxLoUo+RP8dxOcvglq6YyS8bqVOCP46+EjJpYXMpmhCQhwnW9b9P
nCRg+RI3usVaoOmIlMfw2/nueHgVWrUeN6TlzDjx5E630u2YnxE3BFyVwTTQTFag
50vWvJqC567Pjf1loyquJ0476rb/qZxBTI6ckcZOm0qdWGAjEzC5SAqBbw==

------4F1C475965E2AF7C725D62A1A04F2E1F--

`;

/* openssl req -x509 -newkey rsa:2048 -nodes -days 7300 \
 *   -subj "/CN=Alice/emailAddress=alice@example.com" \
 *   -addext "subjectAltName=email:alice@example.com,email:bob@example.com" \
 *   -addext "basicConstraints=critical,CA:FALSE" \
 *   -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
 *   -addext "extendedKeyUsage=emailProtection"
 * openssl smime -sign -md sha256
 * The signed part carries `From:`, as with header protection, RFC 9788. */
const kSignedWithInnerFrom = `From: Alice <alice@example.com>
To: User <user@example.com>
Subject: Signed test with protected headers
Date: Fri, 06 Nov 2026 09:00:00 +0000
Message-ID: <sig-innerfrom@example.com>
MIME-Version: 1.0
Content-Type: multipart/signed; protocol="application/x-pkcs7-signature"; micalg="sha-256"; boundary="----D3DBE3101F3EB954BE6767B05631E979"

This is an S/MIME signed message

------D3DBE3101F3EB954BE6767B05631E979
Content-Type: text/plain; charset=utf-8; hp="clear"
From: Alice <alice@example.com>

Hello, this is signed.

------D3DBE3101F3EB954BE6767B05631E979
Content-Type: application/x-pkcs7-signature; name="smime.p7s"
Content-Transfer-Encoding: base64
Content-Disposition: attachment; filename="smime.p7s"

MIIGNAYJKoZIhvcNAQcCoIIGJTCCBiECAQExDzANBglghkgBZQMEAgEFADALBgkq
hkiG9w0BBwGgggOcMIIDmDCCAoCgAwIBAgIUM2MogyAjRwnz8WVjMX9jVzqhNbgw
DQYJKoZIhvcNAQELBQAwMjEOMAwGA1UEAwwFQWxpY2UxIDAeBgkqhkiG9w0BCQEW
EWFsaWNlQGV4YW1wbGUuY29tMB4XDTI2MTEwNjA5MDYxM1oXDTQ2MTEwMTA5MDYx
M1owMjEOMAwGA1UEAwwFQWxpY2UxIDAeBgkqhkiG9w0BCQEWEWFsaWNlQGV4YW1w
bGUuY29tMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqwQhg2XZJNZG
7IA+HaSfdEl7IP+j98zAy9mkWCGyVu26bysNxeLoblnz7jQ1ehrm7kDfT9BlDBpo
4mOhe78sqScwdQwcXnDzV7zg8UuOq/ftbeoilI3MQODDQJhtCT8tLPXDsE8uoyGU
51rKQJDpSNhFYTRc6D/F4sRF7O/vddth0MXEuYS4nxm/WezjLTDFF8kjUuXxS2RL
h81kNPpwaqK3bdFKxaRIgpKhYao1psVqv7A2g7FRsIPawG90zzqMYV2w0eiVbpof
/FYO2OwlfAhkEb23Z95d12cSNIWa+r0p6QwAMQi0JyqhaQuzo9XFLQxDjIqa53wA
lrtfZ3cDBQIDAQABo4GlMIGiMB0GA1UdDgQWBBQV+xrow6I08JAok4febriSJhex
PjAfBgNVHSMEGDAWgBQV+xrow6I08JAok4febriSJhexPjAtBgNVHREEJjAkgRFh
bGljZUBleGFtcGxlLmNvbYEPYm9iQGV4YW1wbGUuY29tMAwGA1UdEwEB/wQCMAAw
DgYDVR0PAQH/BAQDAgWgMBMGA1UdJQQMMAoGCCsGAQUFBwMEMA0GCSqGSIb3DQEB
CwUAA4IBAQBtVaOJd+C3kQ46OsvXnVCBOSe1b0I+2BokbtSPrmgbfH4+CkhDcDC9
BSHg2q/9ODgC5cwOTZjIedGNwn+TA2Qd7Ayh/oCmrsf08KrxQzlY1MnqpMJHHvdY
RF38hWyCR+IOBZY8b1oc8xPds1YngA86IO9HTzFT+2aW9KozDsMomqgByuISDaB3
pGjUrKVghdqc2QbMOgcigj3xCAhTV28IwAHq7OAgCq4nc6M1V7FdTzGow9KrrMp3
5IKDrDm1/iX+2dYuCfLNuswLY6N4STP9KmW6hEr7Z3ox8fIM0uW2DQHrc9dK/Cez
YyJGWaS4yAFFeE05+UskAASc4t0GXEkfMYICXDCCAlgCAQEwSjAyMQ4wDAYDVQQD
DAVBbGljZTEgMB4GCSqGSIb3DQEJARYRYWxpY2VAZXhhbXBsZS5jb20CFDNjKIMg
I0cJ8/FlYzF/Y1c6oTW4MA0GCWCGSAFlAwQCAQUAoIHkMBgGCSqGSIb3DQEJAzEL
BgkqhkiG9w0BBwEwHAYJKoZIhvcNAQkFMQ8XDTI2MTEwNjA5MDYyMVowLwYJKoZI
hvcNAQkEMSIEIPae1ZOJGcdjt87nviBkYluI4JiGBrk9+OmDzscp1kizMHkGCSqG
SIb3DQEJDzFsMGowCwYJYIZIAWUDBAEqMAsGCWCGSAFlAwQBFjALBglghkgBZQME
AQIwCgYIKoZIhvcNAwcwDgYIKoZIhvcNAwICAgCAMA0GCCqGSIb3DQMCAgFAMAcG
BSsOAwIHMA0GCCqGSIb3DQMCAgEoMA0GCSqGSIb3DQEBAQUABIIBADVMmvRVdyCl
JDjlumuwvfrOxXKHSmjCly9tiIdd784Rm15RfcpXjIEj+jpC6wPPcT7YVxx0cv3/
VSo8yCovTNJen29Itkj0hIudlxU3WFzCBJfzm/QBsKyOwaNHg+PlIvP4TO+IE75f
OXFRbDMBE5PI6WUgioSr4HhdVSrIFoQdNPz43Q9Je69K1T4mo20LdBfY28P6kaL7
TkgIdSWhleSZCcqU+QkMDfX2R8Gc/1Gw3cM+HukM1sQ0thEx4F+Cfk+hcL+utk5c
o86BJ/3hwl2KF2WOp22InpV3by3MOPz9AMNr3XrYD4hSCISZ+XlRsyYY9749lbNF
+NioPKix148=

------D3DBE3101F3EB954BE6767B05631E979--

`;
