// @vitest-environment happy-dom
// The key classes use the app singleton. Importing it first breaks the
// import cycle, which would otherwise leave the base classes undefined.
import "../../../../logic/app";
import { PersonUID } from "../../../../logic/Abstract/PersonUID";
import { setUpAccount, type TestMailAccount } from "../TestMailAccount";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { getEncryptionSystem, getPublicKeyForPerson, getPublicKeyForPersonUID } from "../../../../logic/Mail/Encryption/KeyUtils";
import { EncryptionSystem } from "../../../../logic/Mail/Encryption/enums";
import { SMIMEPublicKey } from "../../../../logic/Mail/Encryption/SMIME/SMIMEPublicKey";
import { SMIMEPrivateKey } from "../../../../logic/Mail/Encryption/SMIME/SMIMEPrivateKey";
import { PGPPublicKey } from "../../../../logic/Mail/Encryption/PGP/PGPPublicKey";
import { PGPPrivateKey } from "../../../../logic/Mail/Encryption/PGP/PGPPrivateKey";
import type { EMail } from "../../../../logic/Mail/EMail";
import type { PublicKey } from "../../../../logic/Mail/Encryption/PublicKey";
import { Addressbook } from "../../../../logic/Contacts/Addressbook";
import { appGlobal } from "../../../../logic/app";
import { kAlice, kTLSServer, kOldCertificate } from "./SMIME/certificateChains";
import { ArrayColl } from "svelte-collections";
import { expect, test, describe } from "vitest";

/** The sender signed his email, but he is not in our addressbook,
 * so his certificate is only on the `PersonUID`. */
function signerUID(): PersonUID {
  let uid = new PersonUID("signer@example.com", "Test Signer");
  let key = new SMIMEPublicKey();
  key.id = "1234567890abcdef";
  key.obsolete = false;
  uid.encryptionPublicKey = key;
  return uid;
}

describe("Key of a person who is not in the addressbook", () => {
  test("no key", () => {
    let uid = new PersonUID("nobody@example.com", "Nobody");
    expect(getPublicKeyForPersonUID(uid)).toBe(null);
  });

  test("certificate from the signature of his email", () => {
    let uid = signerUID();
    expect(getPublicKeyForPersonUID(uid)).toBe(uid.encryptionPublicKey);
    expect(getPublicKeyForPersonUID(uid, SMIMEPublicKey)).toBe(uid.encryptionPublicKey);
    expect(getPublicKeyForPersonUID(uid, PGPPublicKey)).toBe(null);
  });

  test("expired certificate", () => {
    let uid = signerUID();
    uid.encryptionPublicKey.obsolete = true;
    expect(getPublicKeyForPersonUID(uid)).toBe(null);
  });
});

/** Our identity has this one secret key */
function accountWithMyKey(myKey: PGPPrivateKey | SMIMEPrivateKey): TestMailAccount {
  let account = setUpAccount();
  myKey.id = "1234567890abcdef";
  myKey.obsolete = false;
  myKey.useToSign = true;
  account.identities.first.encryptionPrivateKeys.add(myKey);
  return account;
}

/** The signer sent us this with S/MIME */
function signedMail(account: TestMailAccount): EMail {
  let mail = account.getSpecialFolder(SpecialFolder.Inbox).newEMail();
  mail.from = signerUID();
  mail.sent = mail.received = new Date();
  mail.html = "<p>Please encrypt</p>";
  mail.system = EncryptionSystem.SMIME;
  return mail;
}

describe("Encryption system of the outgoing email", () => {
  test("new email uses our own key", () => {
    expect(getEncryptionSystem(accountWithMyKey(new PGPPrivateKey()).identities.first.newEMailFrom()))
      .toBe(EncryptionSystem.PGP);
    expect(getEncryptionSystem(accountWithMyKey(new SMIMEPrivateKey()).identities.first.newEMailFrom()))
      .toBe(EncryptionSystem.SMIME);
  });

  test("new email, and we have no key", () => {
    expect(getEncryptionSystem(setUpAccount().identities.first.newEMailFrom())).toBe(null);
  });

  test("reply and forward answer S/MIME with S/MIME, even if we prefer PGP", async () => {
    let original = signedMail(accountWithMyKey(new PGPPrivateKey()));
    expect(getEncryptionSystem(original.compose.replyToAuthor())).toBe(EncryptionSystem.SMIME);
    expect(getEncryptionSystem(await original.compose.forwardInline())).toBe(EncryptionSystem.SMIME);
  });
});

describe("Certificate to which we encrypt", () => {
  /** We have this certificate of the recipient, e.g. from the signature of his email */
  async function recipientWith(certificate: string): Promise<PersonUID> {
    let uid = new PersonUID("victor@example.com", "Victor");
    uid.encryptionPublicKey = await SMIMEPublicKey.importPublicKey(certificate);
    return uid;
  }

  test("only for signing is not used", async () => {
    expect(getPublicKeyForPersonUID(await recipientWith(kVictorSigning))).toBe(null);
  });

  test("of a TLS server is not used", async () => {
    expect(getPublicKeyForPersonUID(await recipientWith(kTLSServer))).toBe(null);
  });

  test("that allows encryption, or has no key usage extensions, is used", async () => {
    for (let certificate of [kVictorEncryption, kAlice, kOldCertificate]) {
      let uid = await recipientWith(certificate);
      expect(getPublicKeyForPersonUID(uid)).toBe(uid.encryptionPublicKey);
    }
  });

  // Some CAs issue one certificate for signing and another one for encrypting
  test("of a contact who has one for signing and one for encrypting", async () => {
    let person = new Addressbook().newPerson();
    let encryption = await SMIMEPublicKey.importPublicKey(kVictorEncryption);
    person.addEncryptionPublicKey(await SMIMEPublicKey.importPublicKey(kVictorSigning));
    person.addEncryptionPublicKey(encryption);
    expect(getPublicKeyForPerson(person)).toBe(encryption);
  });

  test("from a company directory that has one for signing and one for encrypting", async () => {
    let encryption = await SMIMEPublicKey.importPublicKey(kVictorEncryption);
    let signing = await SMIMEPublicKey.importPublicKey(kVictorSigning);
    let directory = new Addressbook();
    directory.fetchEncryptionKeys = async () => new ArrayColl<PublicKey>([signing, encryption]);
    appGlobal.searchOnlyAddressbooks.add(directory);
    try {
      let recipient = new PersonUID("victor@example.com", "Victor");
      await recipient.fetchEncryptionKeys();
      expect(getPublicKeyForPersonUID(recipient)).toBe(encryption);
    } finally {
      appGlobal.searchOnlyAddressbooks.remove(directory);
    }
  });
});

/* openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 7300 \
 *   -subj "/CN=Victor/emailAddress=victor@example.com" \
 *   -addext "basicConstraints=critical,CA:FALSE" \
 *   -addext "keyUsage=critical,digitalSignature,nonRepudiation" \
 *   -addext "extendedKeyUsage=emailProtection" -addext "subjectAltName=email:victor@example.com" */
const kVictorSigning = `
-----BEGIN CERTIFICATE-----
MIIDjDCCAnSgAwIBAgIUGBHq4ckQpBycjJHVCGdiAkkVyMkwDQYJKoZIhvcNAQEL
BQAwNDEPMA0GA1UEAwwGVmljdG9yMSEwHwYJKoZIhvcNAQkBFhJ2aWN0b3JAZXhh
bXBsZS5jb20wHhcNMjYxMTA2MTM1NTIyWhcNNDYxMTAxMTM1NTIyWjA0MQ8wDQYD
VQQDDAZWaWN0b3IxITAfBgkqhkiG9w0BCQEWEnZpY3RvckBleGFtcGxlLmNvbTCC
ASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAOey1yEShLRxuql7yEXbZMQW
G/bIvHjxZVHBu7d7qaJMTWuIp5nES5+gVqOzMu56JYf49ocnsfpaI7Kgpe4acNTp
pd+DGyQ8pkbQ58XfseQasOwnnmm4ims4/r2+pJEpkbqfzQe6kN6Gvt1pdJsKmV5S
94CIuzTlITj0vL+LqaVx7QXYe7F3nDxs5twfKlBCvNktG0MNTesrFzMvAw8JNtdq
66qAijFl3QKKJA1j4ubPItbI3Zw5SxI8yUvkuqdH3u2angXV2u2caK47wZ+HV3F5
nxm9Z8ymZLG+d8ZtFpC6cdXOFfhL5tSgvGxMZEGK76SpsQr+t+y2zswPF0LZfokC
AwEAAaOBlTCBkjAdBgNVHQ4EFgQUFF3H1st6ZC/lnDYwcSn4gHYl7cgwHwYDVR0j
BBgwFoAUFF3H1st6ZC/lnDYwcSn4gHYl7cgwDAYDVR0TAQH/BAIwADAOBgNVHQ8B
Af8EBAMCBsAwEwYDVR0lBAwwCgYIKwYBBQUHAwQwHQYDVR0RBBYwFIESdmljdG9y
QGV4YW1wbGUuY29tMA0GCSqGSIb3DQEBCwUAA4IBAQC22eyA+O+IlAmeaW85SKP7
X+JruvMZIbMwoQYaRKRdnm75pmRPAflYkMsecgUIBPym3h+Z6LM3bRyeu+LEzqJP
LGvqdLdse4tmbAbrZMHiOiRM5Tgfv88LHejIUbO7wFkShL0DQbYENj9XN49GD1t1
CjIgZaRMb/EH8DGi/EP0QgJ0Z4HPheXx0c1KRvfYHFmO89czVIrMx8NihZ1mqMB4
oRWYwB+f2AmpCvgHgRshJffxjSP2Fr+5E99TBuE8TEM/kDQ78bfLsHFgnOp7fbD0
etp13JaRRRPvmoMYii24+N3ZquhDXO/sxsIROJXExiT33ZFoWukkAsebewC+Uqb4
-----END CERTIFICATE-----
`;

/* Another key for Victor, made as `kVictorSigning`, but with
 *   -addext "keyUsage=critical,keyEncipherment" */
const kVictorEncryption = `
-----BEGIN CERTIFICATE-----
MIIDjDCCAnSgAwIBAgIUL/GjNhEH9Z3R7IAz9OaHyA3GOI0wDQYJKoZIhvcNAQEL
BQAwNDEPMA0GA1UEAwwGVmljdG9yMSEwHwYJKoZIhvcNAQkBFhJ2aWN0b3JAZXhh
bXBsZS5jb20wHhcNMjYxMTA2MTM1NTIyWhcNNDYxMTAxMTM1NTIyWjA0MQ8wDQYD
VQQDDAZWaWN0b3IxITAfBgkqhkiG9w0BCQEWEnZpY3RvckBleGFtcGxlLmNvbTCC
ASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAO3wch45Ie5Akw4bUq14Ii7X
CkU4F41wkOieySyX1ay1fDYD1wHC5Ccntfc/Kq3WyJvILvrjZ9z+ShOD3NF+RUTX
qwLU6nNgV3lq2gdRRbV5u9+BwAM5cVkD6PAImRNUGlsdPKDBig7A1y46UH4FxtMO
QPXun9FPduaHjBgUesj/8kdWyuiK/pVYPF6ff+wTZAqydKlwAjJZV4Hkpnivv4yY
Dg3MDCkLODrW4c0CVxmSqXlyMKOPZtQX4pD+V0x5wicVxOk73uiO1GjuAje1CpSm
B+prfFUFXuHuzccCxRLlq6LwjL73KuInWkzqyHk0BYNbb1557rCf7C9cGpxS2RMC
AwEAAaOBlTCBkjAdBgNVHQ4EFgQUu5fkIWqI4xoBxpYFkzG4j7XkifEwHwYDVR0j
BBgwFoAUu5fkIWqI4xoBxpYFkzG4j7XkifEwDAYDVR0TAQH/BAIwADAOBgNVHQ8B
Af8EBAMCBSAwEwYDVR0lBAwwCgYIKwYBBQUHAwQwHQYDVR0RBBYwFIESdmljdG9y
QGV4YW1wbGUuY29tMA0GCSqGSIb3DQEBCwUAA4IBAQDqPbpjxK1SwWBwsEGPR4Gr
ONO56u4wHtpJCtGJnXBO+ckiG7IGZiJk0n8f8y485dNY3FqMxLKxBGS2l24d/6Z3
CmgYn4CAkjI7ABM0izHDAimbPHwfNa4r6uekRsM7g2ovcnGRbdSu+ubKKTlGl+u4
TmNXEbQ/lPxITBI4SMf/hM125hYMNHxwFaYgdBEWqB3QFY+bGvDQUanESM2XHODS
RmIm/DTtDWDVgTqe7u9LwCME/P4giTGFIUSSEQbDnr4m67DjW1gP74qUDyMo+Ru0
61okt+x9f/YTsSBzq9Dy5bgBH7+UggkFYgTuFUTdtY8AN9PreOc3K1jg7Egp+uen
-----END CERTIFICATE-----
`;
