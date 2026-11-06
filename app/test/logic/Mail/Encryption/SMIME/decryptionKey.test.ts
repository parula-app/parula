import "../../../../../logic/app";
import { setupTestFolder } from "../../SQL/setup";
import { appGlobal } from "../../../../../logic/app";
import { MailIdentity } from "../../../../../logic/Mail/MailIdentity";
import { SMIMEPrivateKey } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEPrivateKey";
import { Certificate } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEASN1";
import type { Folder } from "../../../../../logic/Mail/Folder";
import type { MailAccount } from "../../../../../logic/Mail/MailAccount";
import type { EMail } from "../../../../../logic/Mail/EMail";
import { expect, test, beforeEach } from "vitest";

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

beforeEach(() => {
  appGlobal.emailAccounts.clear();
});

test("A message that we got as Bcc to our second identity decrypts", async () => {
  // The headers do not name us, and the first identity of the account has no key
  let folder = await addAccount("info@example.com");
  await addIdentity(folder.account, "dana@example.com", kDanaKey, kDanaCert);
  let { email, errors } = await read(folder, "undisclosed-recipients:;", kBcc);
  expect(errors).toEqual([]);
  expect(email.text.trim()).toBe("Hello Dana");
});

test("A message for the subject key identifier of our certificate decrypts", async () => {
  let folder = await addAccount("dana@example.com", kDanaKey, kDanaCert);
  let { email, errors } = await read(folder, "Dana <dana@example.com>", kSKI);
  expect(errors).toEqual([]);
  expect(email.text.trim()).toBe("Hello Dana");
});

test("A message for the subject key identifier of a certificate that is not ours does not decrypt", async () => {
  let folder = await addAccount("dana@example.com", kDanaKey, kDanaCert);
  let { errors } = await read(folder, "Dana <dana@example.com>", kSKINotOurs);
  expect(errors).toEqual(["This message is encrypted, and the key is not available"]);
});

test("An old message to a distribution list decrypts with the expired key of another account", async () => {
  let folder = await addAccount("dana@example.com", kDanaKey, kDanaCert);
  let oldAccountFolder = await addAccount("dana@example.net", kOldKey, kOldCert);
  expect(oldAccountFolder.account.identities.first.encryptionPrivateKeys.first.obsolete).toBe(true);
  let { email, errors } = await read(folder, "Team <team@example.org>", kOld);
  expect(errors).toEqual([]);
  expect(email.text.trim()).toBe("Hello Dana");
});

test("A message for our renewed certificate decrypts, after we added the certificate to our key", async () => {
  let folder = await addAccount("dana@example.com", kDanaKey, kDanaCert);
  // Decrypt with the old certificate first, as before the renewal
  await read(folder, "Dana <dana@example.com>", kBcc);
  let key = folder.account.identities.first.encryptionPrivateKeys.first as SMIMEPrivateKey;
  await key.addCertificates(kDanaRenewedCert);
  let { email, errors } = await read(folder, "Dana <dana@example.com>", kRenewed);
  expect(errors).toEqual([]);
  expect(email.text.trim()).toBe("Hello Dana");
});

test("A message for our certificate from a CA whose name has DC= parts, as Windows company CAs have, decrypts", async () => {
  let folder = await addAccount("dana@example.com", kDanaKey, kDanaCompanyCert);
  let { email, errors } = await read(folder, "Dana <dana@example.com>", kCompany);
  expect(errors).toEqual([]);
  expect(email.text.trim()).toBe("Hello Dana");
});

test("A recipient identifier of an unknown type does not match our certificate", async () => {
  let key = await SMIMEPrivateKey.importPrivateKey(kDanaKey + "\n" + kDanaCert);
  let cert = Certificate.decodePEM(kDanaCert, { label: "CERTIFICATE" });
  let value = { issuer: cert.tbsCertificate.issuer, serialNumber: cert.tbsCertificate.serialNumber };
  expect(key.isRecipient({ type: "issuerAndSerialNumber", value })).toBe(true);
  expect(key.isRecipient({ type: "unknown", value })).toBe(false);
});

/** @returns the INBOX of a new account with this identity */
async function addAccount(emailAddress: string, privateKey?: string, certificate?: string): Promise<Folder> {
  let { folder } = await setupTestFolder();
  appGlobal.emailAccounts.add(folder.account);
  await addIdentity(folder.account, emailAddress, privateKey, certificate);
  return folder;
}

/** Adds an identity to the account, with this S/MIME key, if given */
async function addIdentity(account: MailAccount, emailAddress: string, privateKey?: string, certificate?: string) {
  let identity = new MailIdentity(account);
  identity.emailAddress = emailAddress;
  identity.realname = "Dana";
  if (privateKey) {
    identity.encryptionPrivateKeys.add(await SMIMEPrivateKey.importPrivateKey(privateKey + "\n" + certificate));
  }
  account.identities.add(identity);
}

/** Reads the CMS blob as a message in this folder
 * @returns the message and the errors that the user sees */
async function read(folder: Folder, to: string, cms: string): Promise<{ email: EMail, errors: string[] }> {
  let errors: string[] = [];
  folder.account.errorCallback = (ex) => errors.push(ex.message);
  let email = folder.newEMail();
  email.mime = new TextEncoder().encode(`From: Alice <alice@example.com>
To: ${to}
Subject: Encrypted
Date: Tue, 14 Jul 2026 10:00:00 +0000
Message-ID: <encrypted@example.com>
MIME-Version: 1.0
Content-Disposition: attachment; filename="smime.p7m"
Content-Type: application/pkcs7-mime; smime-type=enveloped-data; name="smime.p7m"
Content-Transfer-Encoding: base64

${cms}
`.replace(/\n/g, "\r\n"));
  await email.parseMIME();
  return { email, errors };
}

/* openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 7300 -nodes \
 *   -subj "/CN=Dana" -addext "subjectAltName=email:dana@example.com" \
 *   -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
 *   -addext "extendedKeyUsage=emailProtection"
 * Test key only. Do not use it for anything else. */
const kDanaKey = `
-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDPRO15iQDJ6d1O
as8LsIQD6i5xb5N61UCdU/A0bNLbTmlFvkcgFnf3WP6G5ZvnK1vz4fw1TRTkn7RJ
Igk6MjA21N82TVm4jQXMzCigSievrQQm9fpNhN5YK9cur3uRCf3wy2BG9U4h2BT2
iyE7a/61dsF2V07/xnlhsMPeQtZ8DCkA6Oi4tEJMbFIuz8Ij2E14gpZKzA6DRyHU
TJgXtNCCZwcO0Yh4MLgBJvb22V6Im3JODkxPJUfO4J6p9piAoY0OwH2shhhAWnEO
bJZqizZK3v9I4qsrmFI4vLffsAM1n5cuXda+3JcIWbd6M17cAf8c8CZPhivtyd4m
N7bVewMtAgMBAAECggEAA4465aoWP6B5qan25cwwI5INnGgN115XpqtFNF0Gi/kP
IMFoHnKMOcvGyAEh2MgbYnZmuXJaUKa1tMh28I7iWVpy/s86YgpXRmFdNAy5nA+j
gdiX4+MK3mfYH+amP8F0YABZJTZ5keaPS4BtAEQ0wR+pp3JNemFI/UZHQeWTINsb
pIsB1TXyEPnQ6C3tGna1zKgP3bgwddPQtvUug8RsRH3UEoHt7XbKtroE8F8fMX46
BPQi+8ZqhZVXwBl4jk6xWiicTdOoKcIIqaoM7K9T5E56ufrczKkmYQpFWHHJT5JI
pS2fk73UYeXnRc8xTuHsXm2xvCr+nANS9N2THv9D2QKBgQDpt8BB35rN2jYliwRu
NlvnfnYWE4ng6g7oAB6os9KFosfRbc9FQtGdx/g9Y3zYi9hWWP+k7ecRjVs3P2yx
Qh3gN3oE0fBb0e0xVdobp2maIqhNdw4q+jwEKdPWMCtnWVkvKXN5sc4BN2Apw5LD
1MlZlVna3CBEWDCIPkX2+NR31QKBgQDjB6imzGX1WK2iMd1dvoG/GP3dkZa7AEBb
Wn5SdFmaa3gkpSoDIhSLcldGqkoB5BL5iEqcsp1E4uHyrB/75vYP0Eghp/xgoLSK
FEoph+1G2aCDmrRjJ6M6CJ0UwcLxSHiuKWa/VmZlJiEULt1gbvI6UC7SSO9vAvh3
ntfZzeAh+QKBgELWb77m6WhxPQbjiLLUDNhZDAAoOkf956FlV187fbsF4Er+MkZG
Y5fRtiYoK23qIEYhUYqjFm+okytrkfPnSo/yjYyPVUOM914ihStfZw3TV3o/z+du
hHdUVuZsBB2cKasZGZL1zEoAwhlveqtSUPqzgWzbgsbIyahM1slYQ7q5AoGAKOwH
fVFYi3nZimPcl/ov3uc9U0Pb3Ic2EoFkRa6NPCVk+Y3/3aK1+1C35JfrUR3wQaRM
dqRHbtRKj/hwp3JBJiaP6ekit7Qf9sejeoryvRObOD2ZiEnrxRkqX0RxxBYhEpuJ
1rFXMaJG0iGEa85zwQkU93iIGAV8DevG0o6meNkCgYA0mqZEooqFfnHzZvd+YDEv
JQ4w7mvV5o6Xqps0of8AJHhWwxbeuBtV0sZinDmaVmn5JxztRfbqLN2J6fjanpHo
z675rIttFbMWjU2eeTn9OYj94UyGNzlYILfKVBazWO/j3OVgDm4SrJa8xPlB/Pzz
QE2zm8gpjfoAPy6WGjxOqw==
-----END PRIVATE KEY-----
`;

const kDanaCert = `
-----BEGIN CERTIFICATE-----
MIIDQzCCAiugAwIBAgIUdI0BbSryfRZvWmhJRNF14wFppgowDQYJKoZIhvcNAQEL
BQAwDzENMAsGA1UEAwwERGFuYTAeFw0yNjEwMjIxMTU1NDBaFw00NjEwMTcxMTU1
NDBaMA8xDTALBgNVBAMMBERhbmEwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEK
AoIBAQDPRO15iQDJ6d1Oas8LsIQD6i5xb5N61UCdU/A0bNLbTmlFvkcgFnf3WP6G
5ZvnK1vz4fw1TRTkn7RJIgk6MjA21N82TVm4jQXMzCigSievrQQm9fpNhN5YK9cu
r3uRCf3wy2BG9U4h2BT2iyE7a/61dsF2V07/xnlhsMPeQtZ8DCkA6Oi4tEJMbFIu
z8Ij2E14gpZKzA6DRyHUTJgXtNCCZwcO0Yh4MLgBJvb22V6Im3JODkxPJUfO4J6p
9piAoY0OwH2shhhAWnEObJZqizZK3v9I4qsrmFI4vLffsAM1n5cuXda+3JcIWbd6
M17cAf8c8CZPhivtyd4mN7bVewMtAgMBAAGjgZYwgZMwHQYDVR0OBBYEFDGPkhcv
NJyaKi8FAq6vgFuh4fbdMB8GA1UdIwQYMBaAFDGPkhcvNJyaKi8FAq6vgFuh4fbd
MA8GA1UdEwEB/wQFMAMBAf8wGwYDVR0RBBQwEoEQZGFuYUBleGFtcGxlLmNvbTAO
BgNVHQ8BAf8EBAMCBaAwEwYDVR0lBAwwCgYIKwYBBQUHAwQwDQYJKoZIhvcNAQEL
BQADggEBAMn3Dl2zZAVhw5F8IH7u2W/TInhiKefvQLVDzJUUw87oeweHsjSLqvzZ
0/jGqyDljMrkN9wPjGatn8R69AKL8scluvwcdUWTOqlwoJckBDmEPJWOeDIAxTKG
nBjj5IseODmCKOfWuPfL7ahofb06AKJBx62GUVjtETqDcIUT4xm4kU60Bao/7cg3
k5SaLG7wxWBYCHz/EwK+CYtWFKtFIu1Btc+ETfRkl2muhAIVKpzVNxKjEE6VpDZE
fy8zYmYYg0BBa0lhJ9rvylNInKRZ0ze1xs54MUJu9qTlSHQOmHEKghbFPxULaSv3
H30qvGhIvkUekDVhiFGZCnPVlO9A8ow=
-----END CERTIFICATE-----
`;

/** `openssl req -x509 -key key.pem`, with the key of kDanaKey and the same
 * options, so it has another serial number */
const kDanaRenewedCert = `
-----BEGIN CERTIFICATE-----
MIIDQzCCAiugAwIBAgIUNg7sk3kcjJPd6g5gcVrziIrW5mEwDQYJKoZIhvcNAQEL
BQAwDzENMAsGA1UEAwwERGFuYTAeFw0yNjEwMjIxMjE5NTdaFw00NjEwMTcxMjE5
NTdaMA8xDTALBgNVBAMMBERhbmEwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEK
AoIBAQDPRO15iQDJ6d1Oas8LsIQD6i5xb5N61UCdU/A0bNLbTmlFvkcgFnf3WP6G
5ZvnK1vz4fw1TRTkn7RJIgk6MjA21N82TVm4jQXMzCigSievrQQm9fpNhN5YK9cu
r3uRCf3wy2BG9U4h2BT2iyE7a/61dsF2V07/xnlhsMPeQtZ8DCkA6Oi4tEJMbFIu
z8Ij2E14gpZKzA6DRyHUTJgXtNCCZwcO0Yh4MLgBJvb22V6Im3JODkxPJUfO4J6p
9piAoY0OwH2shhhAWnEObJZqizZK3v9I4qsrmFI4vLffsAM1n5cuXda+3JcIWbd6
M17cAf8c8CZPhivtyd4mN7bVewMtAgMBAAGjgZYwgZMwHQYDVR0OBBYEFDGPkhcv
NJyaKi8FAq6vgFuh4fbdMB8GA1UdIwQYMBaAFDGPkhcvNJyaKi8FAq6vgFuh4fbd
MA8GA1UdEwEB/wQFMAMBAf8wGwYDVR0RBBQwEoEQZGFuYUBleGFtcGxlLmNvbTAO
BgNVHQ8BAf8EBAMCBaAwEwYDVR0lBAwwCgYIKwYBBQUHAwQwDQYJKoZIhvcNAQEL
BQADggEBAAqibX3qA28WFupZORX5SzooCAOBkZGmSln0e8587nG5bjk3KBY9hfrk
aIQNjtcuwGKcBf14GE9hZgZnttm7sUVjBYMuQJM/F+tpIJk/9XdZ2HreofPY4A8s
mIthXYyaqu9ZPrJltVTcj9mviX5on1KREaZBXRr++KyhW5oY1GeTgSN1prixHNjo
QMt9VZ3aTzvpZHQz+ViuXxL48yAAKaP7t3VHA5w6e9R5adJPqUJ/kRSWBNRKRJQT
jD1+3i2omyGV4RnXn6qO24S4rv0/bGOwpQ6EHzXChibfc3FeZFN//fHTTGFa0CZc
ESkeBhDwRTFCW3//6VxIKmqd1FS9Ydg=
-----END CERTIFICATE-----
`;

/** For the key of kDanaKey, issued by a CA whose name has DC= parts, as Windows company CAs (AD CS) have,
 * and the organizationIdentifier of eIDAS CAs:
 * -subj "/DC=com/DC=example/organizationIdentifier=VATDE-123456789/CN=Test Company CA"
 * Extensions as kDanaCert, and basicConstraints = critical, CA:FALSE */
const kDanaCompanyCert = `
-----BEGIN CERTIFICATE-----
MIIDhzCCAm+gAwIBAgIIJD1Ljnsivu0wDQYJKoZIhvcNAQELBQAwYjETMBEGCgmS
JomT8ixkARkWA2NvbTEXMBUGCgmSJomT8ixkARkWB2V4YW1wbGUxGDAWBgNVBGEM
D1ZBVERFLTEyMzQ1Njc4OTEYMBYGA1UEAwwPVGVzdCBDb21wYW55IENBMB4XDTI2
MTEwNjEzMzkyN1oXDTQ2MTEwMTEzMzkyN1owDzENMAsGA1UEAwwERGFuYTCCASIw
DQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAM9E7XmJAMnp3U5qzwuwhAPqLnFv
k3rVQJ1T8DRs0ttOaUW+RyAWd/dY/oblm+crW/Ph/DVNFOSftEkiCToyMDbU3zZN
WbiNBczMKKBKJ6+tBCb1+k2E3lgr1y6ve5EJ/fDLYEb1TiHYFPaLITtr/rV2wXZX
Tv/GeWGww95C1nwMKQDo6Li0QkxsUi7PwiPYTXiClkrMDoNHIdRMmBe00IJnBw7R
iHgwuAEm9vbZXoibck4OTE8lR87gnqn2mIChjQ7AfayGGEBacQ5slmqLNkre/0ji
qyuYUji8t9+wAzWfly5d1r7clwhZt3ozXtwB/xzwJk+GK+3J3iY3ttV7Ay0CAwEA
AaOBkzCBkDAMBgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIFoDATBgNVHSUEDDAK
BggrBgEFBQcDBDAbBgNVHREEFDASgRBkYW5hQGV4YW1wbGUuY29tMB0GA1UdDgQW
BBQxj5IXLzScmiovBQKur4BboeH23TAfBgNVHSMEGDAWgBQBvHNdyrFzZaScoAdZ
Hul73B/qLTANBgkqhkiG9w0BAQsFAAOCAQEAMMGH7dv8dvnEYYxhWVVuX9vzHyj2
uJsC5W/S2od+jHTKPzBYDXftCQsFkGx65ZJA2Z5BfI8TTAbiyFxiPtV/lFVJlo6u
kOucs2Rlki0W6+4s65grOD54DH12SymYhWoq8y9LGdC/KiSZ8SN5ZR8RvWlCLnhf
+C1Ec/FrX8YaQDWXMpxnEknZU3MnN424hBMAM1eUClLn1hvx9iX6QFM2UuEgTupb
uWXD7ihK+4z+n4AQlxomySAz3SxfDFnL8JLGm99yx/bL564DN7eolxVkf0w1vEr9
1aGcbJlEYmqVw31kWSRSXmdhH7yy+Kbp3FJqiAZoY40K3CCRNecP61XiQA==
-----END CERTIFICATE-----
`;

/* Another key of Dana, for dana@example.net, with a certificate from
 * `openssl ca -selfsign -startdate 20200101000000Z -enddate 20210101000000Z`,
 * so it expired long ago.
 * Test key only. Do not use it for anything else. */
const kOldKey = `
-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDvm7wESA/2WrFB
z0i9xxG4KjahSBRDocRbDPviYanuOiVMzpMhCZ3ITvKK7khVJKBEb7kqQa2gVwku
calcYTeswvoTa5uF3RGVfzkyPJKPjExDwasjBYlNjd8ASQVQCVar2NA2yh9soaNQ
5C0EynTVGJpKiecNvHC2YxZuTcXf6PdQMIuvctI96w0CLWCQ38Ws6p1cEXg+BVy/
6BV0khRftMtSRfdXnWbT3+0f6QtAfAZp+nPq/i5GSfUm7++mvP6sh2bJFWrl6Zx+
GHgKlXucSF0PDo0HPe9Oq5CmRqWP+AC+E1Wo+1jOP62al5ZldLy22PBCpsnk3UHg
CVGkUcKVAgMBAAECggEADolcNsZIcaG+70csGpdhM9MbzV0aHaBK0VtQTMOwE4vj
h21g77gtomFnxZX/PWsjbgN5MF8bsYaWQAMVS016mziZA2Sb4tsunetCBRI3sg3I
8rNlNpK3acUZqmLDt79ZSsO0nh5VGboUtmuhb5D41ZTQh4UmR2cPT4Fjcv2064iQ
qJmIhHenEbwbOKgJg7c0fb72wiN/uxBRj0I4E6/NQQxds97HxQUxctyOqhIPUR/V
SIo+bg+pF9ouEtn6lAC/EAfUtVcbTFqM6iHosRI9v3pOHRjgtij4L6ZCRPZsaDuR
GfcJdLzl/Dmj2ZLTRQhLMSi36K/rz6qNKApKVUv7AQKBgQD+VYlbnNYYcs4VhiiN
KWnFDbwCUUvL5NX0+Zc6azP8w217yzJFvBy6ZJ0gypw9YpKR8b1//zYf2Y0L/jEP
+ZX+g00UFXyCrjKkPkfr0/gBIIdwY+n6q8bAPYat18OC/dZ58mzwuUgCIF27qfQk
4YwkyvhadLaAdy4qzUc55hcbCQKBgQDxLYGDpWbtum0Acw1xS5mHxZdk4vcAZpMJ
BnV4RifyeB4vD81oOEkkcnrYRMU++1Oqh7ikD/X0L78azIp//94s7IS0wDqauzOK
O8UIrGHN0UFWTPI74k+g3LR5AXYrafSgtX3/OG8r2rg3yQ/Q0PFV5XHFngvP5MZ5
SeiSXHhyLQKBgQDRgeCuiNmMNjYxYNxSvESWwKOZPSK1CQJ+1IOQ6fJfSxULHu2A
qF755BvTgVOG9YZLltlFcRRC1FDuCiycPjsi90ItQy3X8GtjBLL2PxxSwVsQaB28
Enicr5Ib7lrtsvBUcDDxc48vwT21c2DcaLerL0+6I96aoJJ1S7hap4FtEQKBgB6c
Rfntfljh9n++GpCspbnjzElTvUHhwvu8RCCV1vAhasNSYCHAMxhbJ1hXsilCQOY9
/6NjGzZ48Op314RTd2GAS3+dflKxO+NpnqJxLqCu1HodngkXuj+Sg51wIA12j0Pu
hSVlhkaspgD+lfFM87SRQJVyb9FdGgu+47Pf5LGpAoGBAIBhmTvCn5zCyapYbpKL
bIpN2lEnkPrY8fnhp6PqOF8arLsqeY1PipAyY61oXU5+IQH4sif3FKa6s6uE7G8R
bder7DKNeZdpe9RG8QK8ofM3lNv2dbCoqhJrbk2eC++pO6wUaNwxqUAZfa/vJbZw
ilcw9yyEpL10YeP1KLI0QQXp
-----END PRIVATE KEY-----
`;

const kOldCert = `
-----BEGIN CERTIFICATE-----
MIIC/TCCAeWgAwIBAgICEAAwDQYJKoZIhvcNAQELBQAwDzENMAsGA1UEAwwERGFu
YTAeFw0yMDAxMDEwMDAwMDBaFw0yMTAxMDEwMDAwMDBaMA8xDTALBgNVBAMMBERh
bmEwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDvm7wESA/2WrFBz0i9
xxG4KjahSBRDocRbDPviYanuOiVMzpMhCZ3ITvKK7khVJKBEb7kqQa2gVwkucalc
YTeswvoTa5uF3RGVfzkyPJKPjExDwasjBYlNjd8ASQVQCVar2NA2yh9soaNQ5C0E
ynTVGJpKiecNvHC2YxZuTcXf6PdQMIuvctI96w0CLWCQ38Ws6p1cEXg+BVy/6BV0
khRftMtSRfdXnWbT3+0f6QtAfAZp+nPq/i5GSfUm7++mvP6sh2bJFWrl6Zx+GHgK
lXucSF0PDo0HPe9Oq5CmRqWP+AC+E1Wo+1jOP62al5ZldLy22PBCpsnk3UHgCVGk
UcKVAgMBAAGjYzBhMBsGA1UdEQQUMBKBEGRhbmFAZXhhbXBsZS5uZXQwDgYDVR0P
AQH/BAQDAgWgMBMGA1UdJQQMMAoGCCsGAQUFBwMEMB0GA1UdDgQWBBQcKyzR9ThT
oDxD65SfEFSHnGNl4TANBgkqhkiG9w0BAQsFAAOCAQEARybjQpZ/1kWSJmO4iN29
yHYKGrYd/keA7sdQWGUsEkTBsRJEHfw5Tj1HW6DYzNOBLy+nsLIUq2gCesMAUNpY
5ipcu8+/zm98rR7u2LBq08G3qe0ZNq80VW0vITM4Nx0LJQGzKi8yzXwb3Y/KWWWR
eC7OYRbWK07jR9fecS2UQ63XO5yZ9pqMLIMo4cDqxfodp/DnkmPvXkHr2RPk5jmu
loUP6so5RsaOXxBqV8c8c8i95Hs+Wu6heB2yi5yc8mC0/JB6tAnjVzFLq8ltkp4O
FzxEZBFqsdUrChhIoPH4sa/BjoeN/Shj+ohO51Z1jQWhHOb+SWggmauvn4eEI+or
ZQ==
-----END CERTIFICATE-----
`;

/** `openssl cms -encrypt -aes-256-cbc` to kDanaCert, which names the
 * recipient by issuer and serial number */
const kBcc = `
MIIBywYJKoZIhvcNAQcDoIIBvDCCAbgCAQAxggFDMIIBPwIBADAnMA8xDTALBgNV
BAMMBERhbmECFHSNAW0q8n0Wb1poSUTRdeMBaaYKMA0GCSqGSIb3DQEBAQUABIIB
AKY1eNzch9o6boPq779gYU4OI82ocMhE53ts0AGWCNiKOavHOdfYapQ57fvpeIkj
Imix8F4SnWP/DPMbGoqhH6jZdkegmWN13r71T+BwYe/lTKSKP9OsHbUsYbffHtc3
rOJx+kP4nJBP8qDMuNQemEL7Ub6ty31cDo6w3bd1MJ70Eqx4AILnw18PJBwgLBsP
Hx+DP18xQQ6qAfbggLAShokVD4T2EC44qK/6g9ZLTpmM1Srg29CKXyCMYIIGQff8
n0BFnT/1jydnpLWLDOTv492qfrsDjDw5fB+IyawUnogocc++Q70Rof1vkacj1bsW
V+X9oWnhvAtn0rsAKYf827QwbAYJKoZIhvcNAQcBMB0GCWCGSAFlAwQBKgQQoENd
QGmqsVtapipQ/kjFq4BAue8cbhDmtS5uOCGS7I2CheWr+S4InRZPbqPAPll5wWaR
2JW5Xjwid/12CIUXy9kQXWdGUuGtYgknzc1V/4Lwrw==
`;

/** `openssl cms -encrypt -aes-256-cbc -keyid` to kDanaCert, which names the
 * recipient by subject key identifier */
const kSKI = `
MIIBuAYJKoZIhvcNAQcDoIIBqTCCAaUCAQIxggEwMIIBLAIBAoAUMY+SFy80nJoq
LwUCrq+AW6Hh9t0wDQYJKoZIhvcNAQEBBQAEggEAWG1AYQGUAKO2C4ThqSGx3oIK
rBB0V8SeXw4EAvbvYTGv/11CAq0mejzpJqSSEev6Ry6MANwv1qKwXjnoO7TtDt6e
haiFPxHZ9nVMPbk3jGrB+8DxPIBkQLd+Wyud3HfoWCyPFOSasXljuQ4SfIsVh6A2
3AlxFgjYDbTtYrewhwuFvolSLkNDTY6jdVdKr2nU5bF9aeCB4IFrF+nP2Nl3/1UV
NeZG2gPvTsKhh8EbT3EzKNQrPzxkKiuz33J7uu5MM3isncfpwhxZBza297T9FZvO
dEN1rrR0jKmaFsB4zgw9psx2CWzFeS9yOyifzlzCAEbPF82jtNNVIofTVPkjqDBs
BgkqhkiG9w0BBwEwHQYJYIZIAWUDBAEqBBCj6FCTF1KbIPb+jbxhvtSTgECecK4H
0AgQ2i0i+eas9oiNI9TeB0CZ+yb8BOKTQvfygCPwi/FkE+xKMXGPWCDPWXoBMcsj
mT60msX/ObEut+XM
`;

/** `openssl cms -encrypt -aes-256-cbc -keyid` to kOldCert */
const kSKINotOurs = `
MIIBuAYJKoZIhvcNAQcDoIIBqTCCAaUCAQIxggEwMIIBLAIBAoAUHCss0fU4U6A8
Q+uUnxBUh5xjZeEwDQYJKoZIhvcNAQEBBQAEggEAYJvIV32K/+7NAEdBjRUXu+qv
gQLahSNI7Y5RteOyKBGeFQVXDYfY7a8Omrell2wutpwhvR1h5J0t43AITfR336J6
OLk8nD/TB7Rjh1TokswGzy886VTyL+j9dNiwWXbXv2so4ZO37aF7lMinV9hAlxjn
zcDCKxlK6xORb4wZAPVbI1iGyHXQSGCnvNMR+6XQiHpoILloVRz03Og71xxM54tL
5bw3HWJm1M+/yVUBv3l/7NPMUPxdkq3ENc1+e056BhzlNtUDDfpObIZQvS+VjZmY
W8wvums7KaN4gwArGmiD0PxvAqV5gTs712nxl9tLBaQMCq8JekVSDamUwe6JnTBs
BgkqhkiG9w0BBwEwHQYJYIZIAWUDBAEqBBAxeYBUZyQGae06ftcCCmdmgEAFag7d
9+JLlxWKqpy6nV7rqQQ8DMDvrGkHIZDT3PjMfYIxCjBrzdfr5REKNRfi8zOblmBa
+6/O1CUi4BerGp1I
`;

/** `openssl cms -encrypt -aes-256-cbc` to kOldCert */
const kOld = `
MIIBuQYJKoZIhvcNAQcDoIIBqjCCAaYCAQAxggExMIIBLQIBADAVMA8xDTALBgNV
BAMMBERhbmECAhAAMA0GCSqGSIb3DQEBAQUABIIBACZrFQob04tfVZLfkfkbADox
vPVWErg9f09WzdWYlzcXThL5pSto9l90jXmdvZqX7auPaLlAfgd5ow+H6HLm/hbQ
tjkxW8vROB86kerZTOYKRZtOXHdC4dk5ZxIyatJp3aGjY5PQ2cW8rcomW1JqohrW
Kv9NnqJdt9ItKyS0QR2RDWqWOQKPRWSNsWoWvPP9/uTZTj5nV8zu0XbOzjKVMsqT
axxV8L+uKJDwn15p3oFmjAX9B42teNu89ZzkI6yK+5KkWqU/Bly+CpEh8y2mfiO2
iCWuOcnj+wkw6bXreq//HBd2VFAp8b5prsHc8A2SasoQawugrakwEKc62PkTntUw
bAYJKoZIhvcNAQcBMB0GCWCGSAFlAwQBKgQQlV0w+t8Myhn979Athtus4YBAgtsH
AaTyc13VEJzfsD0plICgYR5dUJkjUNnDHUQomAUQHPfAA5gCZKk3ri0ktwXOjCmG
t8C44f/9yhCK3wVtkw==
`;

/** `openssl cms -encrypt -aes-256-cbc` to kDanaRenewedCert */
const kRenewed = `
MIIBywYJKoZIhvcNAQcDoIIBvDCCAbgCAQAxggFDMIIBPwIBADAnMA8xDTALBgNV
BAMMBERhbmECFDYO7JN5HIyT3eoOYHFa84iK1uZhMA0GCSqGSIb3DQEBAQUABIIB
AM5nbBUAl9VKQq62bteTDTqRAZFGZp5v4IvmpwH5vq6hjTwDjq70fzms1s7gjdbb
BNBSzj84IACmu8sH0ZYBdj7itQ16kjCzGrKxYO7PA4VJu3OqcSrI+WdhL0aoMAan
7n67Yebh4LxGDkzRyvpmpFMTXEfND9ymFEfgODftwy0UY27OgAg7nII7MDcLbERA
dYzLhUUa0aZUsYbeVYiKBXvc/EaVY5GMDgKSvL2/Nd49LQtuApdh/vm8OLn9ML2s
Hvr5/5t4x58ENMp2S0UAtSC2/ifFVqG9z+5DZ2SY2+7NpVqkaqdYJgmwuoFNmBPG
9ccJz95pLm/grbbY1alAxwUwbAYJKoZIhvcNAQcBMB0GCWCGSAFlAwQBKgQQgRbY
9nTpb8qQjJ0arfh8iYBAWRfqATx0ULKazPZF7sxLQlSpgUDTPcXFE6rbW/ox02Zc
i/cnfStdTyhtDkOej7cN+ybucpU0BgcBsM3m0JR2lw==
`;

/** `openssl cms -encrypt -aes-256-cbc` to kDanaCompanyCert, which names the
 * recipient by issuer and serial number */
const kCompany = `
MIICEgYJKoZIhvcNAQcDoIICAzCCAf8CAQAxggGKMIIBhgIBADBuMGIxEzARBgoJ
kiaJk/IsZAEZFgNjb20xFzAVBgoJkiaJk/IsZAEZFgdleGFtcGxlMRgwFgYDVQRh
DA9WQVRERS0xMjM0NTY3ODkxGDAWBgNVBAMMD1Rlc3QgQ29tcGFueSBDQQIIJD1L
jnsivu0wDQYJKoZIhvcNAQEBBQAEggEAddw9S0VNuavFEpQH9LnBxCOw22TGRK5X
PzBQAD27GBGNsHFHbhxcf4YteD2jTi4g0ltP7Xvo0P4Q7dKBSbQSFDutcBNystPz
Dw5f50ixOHqlcQQ1D3M8OhJFBJOdaBsPhZCiUrRXBtX6OdhRZz+bykTYa3QhkMOf
j3snUySS92HrblzOl6z94epVDaJo6x6CAEox4uuewNU/LXiUH7gTmpsCaIG/Mxby
2xcFlJUH/ibtO6NI9/1tEUtBBBFYuldzUHq7ILC40ug4jEtXn5P8k6MBvoZzwbnk
TUQQXurysh12lcPqmYofcyW3MGYpmjp6GCXft88/HO2SpWZFA814lDBsBgkqhkiG
9w0BBwEwHQYJYIZIAWUDBAEqBBBmLu224PMpmmnksuz0CY5RgEAcwbATenYYmoa1
drLY/3F+q/u02t2pIVuNZrVrpCETZXchHKRyjsJ8LN1+sJ2JFH8hD68YmHRqkHZP
A3WqF3ga
`;
