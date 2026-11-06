import "../../../../../logic/app";
import { setupTestFolder } from "../../SQL/setup";
import { appGlobal } from "../../../../../logic/app";
import { MailIdentity } from "../../../../../logic/Mail/MailIdentity";
import { SMIMEPrivateKey } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEPrivateKey";
import { expect, test } from "vitest";

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

test("An encrypted message that is not for us tells the user why it stays empty", async () => {
  let { folder } = await setupTestFolder();
  let identity = new MailIdentity(folder.account);
  identity.emailAddress = "user@example.com";
  identity.realname = "User";
  folder.account.identities.add(identity);
  appGlobal.emailAccounts.add(folder.account);
  let errors: Error[] = [];
  folder.account.errorCallback = (ex) => errors.push(ex);

  let email = folder.newEMail();
  email.mime = new TextEncoder().encode(kEncrypted.replace(/\n/g, "\r\n"));
  await email.parseMIME();

  expect(errors.map(ex => ex.message)).toEqual(["This message is encrypted, and the key is not available"]);
});

test("A message encrypted with 3DES, which we can't decrypt, tells the user which cipher it uses", async () => {
  let errors = await readAsBob("enveloped-data", kDES3);
  expect(errors.map(ex => ex.message)).toEqual([expect.stringMatching(/\bdes/i)]);
});

test("A message encrypted with AES-CCM, which we can't decrypt, tells the user which cipher it uses", async () => {
  let errors = await readAsBob("authEnveloped-data", kAESCCM);
  expect(errors.map(ex => ex.message)).toEqual([expect.stringMatching(/\bccm|2\.16\.840\.1\.101\.3\.4\.1\.47/i)]);
});

/** Reads the CMS blob as a message to Bob, whose private key we have.
 * @returns the errors that the user sees */
async function readAsBob(smimeType: string, cms: string): Promise<Error[]> {
  let { folder } = await setupTestFolder();
  let identity = new MailIdentity(folder.account);
  identity.emailAddress = "bob@example.com";
  identity.realname = "Bob";
  identity.encryptionPrivateKeys.add(await SMIMEPrivateKey.importPrivateKey(kBobKey + "\n" + kBobCert));
  folder.account.identities.add(identity);
  appGlobal.emailAccounts.add(folder.account);
  let errors: Error[] = [];
  folder.account.errorCallback = (ex) => errors.push(ex);

  let email = folder.newEMail();
  email.mime = new TextEncoder().encode(`From: Alice <alice@example.com>
To: Bob <bob@example.com>
Subject: Encrypted
Date: Tue, 14 Jul 2026 10:00:00 +0000
Message-ID: <${smimeType}@example.com>
MIME-Version: 1.0
Content-Disposition: attachment; filename="smime.p7m"
Content-Type: application/pkcs7-mime; smime-type=${smimeType}; name="smime.p7m"
Content-Transfer-Encoding: base64

${cms}
`.replace(/\n/g, "\r\n"));
  await email.parseMIME();
  return errors;
}

/** `openssl smime -sign | openssl smime -encrypt`, to a certificate that is not ours */
const kEncrypted = `From: Alice <alice@example.com>
To: User <user@example.com>
Subject: Signed and encrypted
Date: Tue, 14 Jul 2026 10:00:00 +0000
Message-ID: <sig-enc@example.com>
MIME-Version: 1.0
Content-Disposition: attachment; filename="smime.p7m"
Content-Type: application/x-pkcs7-mime; smime-type=enveloped-data; name="smime.p7m"
Content-Transfer-Encoding: base64

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

`;

/* openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 7300 -nodes \
 *   -subj "/CN=Bob" -addext "subjectAltName=email:bob@example.com" \
 *   -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
 *   -addext "extendedKeyUsage=emailProtection"
 * Test key only. Do not use it for anything else. */
const kBobKey = `
-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCMKgS25Gdvex4p
Bgn3KRjfkslLJCet+UXq8Ih8ipTKQEm/m8XkYj0oF6FFjJFC2ApjpCtGa/RvqUO5
uCCS96xZNL+ykPMRCGq7hb3FaYIvxDuP5bGI3ArW9vK5a8MNTXiVflR5a0NiFnDi
Sk/90SREBNNnjUQZlB9HbGwFiJH2px131odtoYg/tSxbCZsUAIsKxGGj1vLuOadX
HPuY3KkeL4eBFzMS5+U4rdWdJN1sSehT61y5B2R2Kauz+F0hPAZD+MpFjTe5k0M5
SilXKT6oZt5rVrnC/N1lBqR132079k5TU04fpL6B6ym/Dg57YRk4Ev0L/ILSQH10
/1xIk+dTAgMBAAECggEABVcggNto+X1mY8fAH3OoZ/ROyRcij+VcfZwWhzA8hQw4
Ax3rR01a6SklUuINMs/KbYt2vqMkWBDJ7MyQKSlYnrl8yE/vgumgL27kER55AFro
rg3hWsaPfys/ikMJ1nrqKj/69flZQuZ5/JU6QQBz8keAyoQ+YP8cxfrijr9qWExt
ShHqdORVg9aD1B8p1yPHmXZlgXCREtbpLdTxTO75imVQtzItYhnEe3U17oZqSMxu
llQLywyT0+yYsH2RuiFl6qmZrGgyBiobMO6KdEPJPYWc4E/8FOL/7Ddno4lfHtEV
aqMU5FeaTg66RTLLgef2mf59R0cAvflu/tWeNBVfAQKBgQDBBtIjsBxGKjPcm+RO
bMccXBlVexYEcf1asB6lQ8za6qmo5w7Oden7DDSNvmZzZ1R/YAHGBIgqBKCSKHcB
/QEwO38SD1JiQN0fHsaw5LpoCfun+6SGmPdImMCc3rd/AZRUsNd6sQKmA4wMF5u8
1i6/62juN4TUt02ftgKZgAkk0wKBgQC55Dtj9w6zJjabPajxYGt9hfeIbxO3skRL
WI0JJSe/TCSqkfHHUH6FeRcGE9Cuylgz3tSPG81dC3tMfW7hK38CURx94B+5PaUV
85UQnHFZglexRD2XPWPsBdugJpWqVqh8sBF0jg6Z6Zt34caFPrpYR1Liqpv4pE/B
UdcHTKKjgQKBgDNxV+u+8aoZcTzoJw5nmyEJwo6vgQyqPHVA3sn4qc3mIFUtTxri
/fq0JAVqqu8yqKhRs+dMKeXY2dpaAm17Oifak2ECyFf7JXM3xog6TRuRHYqFXDGq
7qxgWWT1Tj4A88EmaCcAqc4Iv/gxCoZnJopreMmT7kiqmXtpDIRQRR+VAoGAIsqu
uvUAkVMzoTaXKiYruCCcxbJUdGsvERMPwohruggcTLhoEi/knkKdpouK4UwJ2ht4
mRhRBXsippxLZmVnrh1UQdLy3Q7GmScv3R4KsQAOPaVSCb55tzEZfA38sRbrDfs+
KRx1ayUn7fYZ29JzuhYPU1EvRAgszTfuEPWs8wECgYEAhc5B2D1XACwTyuhht1tv
PcEwvcoSul0UtBY79K2P8s3B8E05XR0mJhEHJaV54poTFNDx6BKLB1fH7yL+PcWn
Tjd1TwOQC9grGxpb5BgpDLcVuiVCGXfhEFhCqRseiAVn0kpCNVH4hb8hxSZq7oX8
H7rcr64uyHERw2PjhIP5teQ=
-----END PRIVATE KEY-----
`;

const kBobCert = `
-----BEGIN CERTIFICATE-----
MIIDQDCCAiigAwIBAgIUR1y+gd/vMo3Jefdqh9xJSZ9XsIwwDQYJKoZIhvcNAQEL
BQAwDjEMMAoGA1UEAwwDQm9iMB4XDTI2MTAyMjExNDYzOFoXDTQ2MTAxNzExNDYz
OFowDjEMMAoGA1UEAwwDQm9iMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKC
AQEAjCoEtuRnb3seKQYJ9ykY35LJSyQnrflF6vCIfIqUykBJv5vF5GI9KBehRYyR
QtgKY6QrRmv0b6lDubggkvesWTS/spDzEQhqu4W9xWmCL8Q7j+WxiNwK1vbyuWvD
DU14lX5UeWtDYhZw4kpP/dEkRATTZ41EGZQfR2xsBYiR9qcdd9aHbaGIP7UsWwmb
FACLCsRho9by7jmnVxz7mNypHi+HgRczEuflOK3VnSTdbEnoU+tcuQdkdimrs/hd
ITwGQ/jKRY03uZNDOUopVyk+qGbea1a5wvzdZQakdd9tO/ZOU1NOH6S+gespvw4O
e2EZOBL9C/yC0kB9dP9cSJPnUwIDAQABo4GVMIGSMB0GA1UdDgQWBBRso3GRZK61
Oo4SMGKQL3LIIuZRwzAfBgNVHSMEGDAWgBRso3GRZK61Oo4SMGKQL3LIIuZRwzAP
BgNVHRMBAf8EBTADAQH/MBoGA1UdEQQTMBGBD2JvYkBleGFtcGxlLmNvbTAOBgNV
HQ8BAf8EBAMCBaAwEwYDVR0lBAwwCgYIKwYBBQUHAwQwDQYJKoZIhvcNAQELBQAD
ggEBAD3GYoVzsIXRFlVcK+KxBUxQAyDKz5t2IiOptHUG8UWsRaiyyCKy1A4UhYzt
ifcuf/NLuI03eL4650sruz+s2+Mu4PDhsyklu/woO83tP5fapUYgOh5RV09HInIb
bPaEV0Sg4ppTjlWGMT/28UDyXXjePZWO4x5txw+KYLGoiP1Vf8mnym40Wx4uszLW
so7PU/MDIyDk1qtdogmsrPkzFAJis5d/OUGJimX1E1gTqXLtadegWebqVoZ6NWgR
ydHgOYnFseafqBoAVLLutfNSutmP767D1FLmps+ax/q8iPut5LOxTeUmy1TLgT11
nFLNbqBl0u5ZF6ziP5sXPqvwrbg=
-----END CERTIFICATE-----
`;

/** `openssl cms -encrypt -des3 -recip cert.pem`, as older Outlook versions sent by default */
const kDES3 = `
MIIBqQYJKoZIhvcNAQcDoIIBmjCCAZYCAQAxggFCMIIBPgIBADAmMA4xDDAKBgNV
BAMMA0JvYgIUR1y+gd/vMo3Jefdqh9xJSZ9XsIwwDQYJKoZIhvcNAQEBBQAEggEA
bndbKEsTiFQ8ubsclU1ZItXy/ooMjqHE+nAv+4+JeQ70kUkwXIlaX/HkAAVNjiVR
p8Ao5O/fY9XtSpu9fymnVgeLdSbEibHSGB69tJoHGVQZbH+BRd2dYC1sNAXyV3ui
y087Sp8SOZk9Oswot+JtZ6AFLREBuL8KwdqW7cPxoljjUpr2afkaTj6ndihoZbZ0
YBQm4rit0mQLBhKaIeiX/3ysEwofuDFGQmcWyZfW0mqGd0TBDIXkqd+jjIXMu0c4
tI82LDn79LHcdlbd2nep651ctXkcmw84rNusVUiep3O8nL8Qd5yU5STebwT2SJH+
X88iNpTNYUD7cKWL7J8YRDBLBgkqhkiG9w0BBwEwFAYIKoZIhvcNAwcECC02l+XV
sKnwgCgGl9Qho4xYTx9tfopWdzuW10PcXFCQIEcCxpxYrhj3j+m201GO3y8M
`;

/** `openssl cms -encrypt -aes-256-gcm -recip cert.pem -outform DER`, with the cipher OID
 * changed to AES-256-CCM (2.16.840.1.101.3.4.1.47, RFC 5084), which has the same parameters.
 * OpenSSL can't write AES-CCM itself. */
const kAESCCM = `
MIIBxgYLKoZIhvcNAQkQARegggG1MIIBsQIBADGCAUIwggE+AgEAMCYwDjEMMAoG
A1UEAwwDQm9iAhRHXL6B3+8yjcl592qH3ElJn1ewjDANBgkqhkiG9w0BAQEFAASC
AQAZ2wnvb8lQZi6T8T+kH9IoVSvCiSC+9Faf08Qc+uIHNXGMnD9MqDzoz/4LP2zt
6/z1sfBTbfLT+4gxnxGX6ROzsIgFFoaCDZ3wShKmz34/kuHeV9Wl3DvfUVcuupv8
NurMlr2laCZMsr1Zx0pOSJSFQQsrscx60XQMEmXvU4E8LiN05lTtX7L2C058tull
8dc5Eh5Qh/czzKxN5n49RG2A75jDQoGaYVkZwnZLpF3HqQ+APlUwmcZ0BKn0sLea
+RSJXYRFZKA9DKXKGTePME3L2jd7cSQSNTCIFlKE1OUMLua95sw5CvutryFTeZps
KhSbek7zTcxKM8lj07ePPapfMFQGCSqGSIb3DQEHATAeBglghkgBZQMEAS8wEQQM
fw2BDm/Bxdr9fDejAgEQgCciaMA9DQG6G/Hc2cjBxZGypsR39Aa2sokkfPh21WKy
yB6ZR+7OBkwEENnbI5Yb8ATYPUYONTnK1KM=
`;
