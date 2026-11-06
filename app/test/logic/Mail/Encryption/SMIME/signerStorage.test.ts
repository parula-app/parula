import "../../../../../logic/app";
import { setupTestFolder } from "../../SQL/setup";
import { appGlobal } from "../../../../../logic/app";
import { getPublicKeyByKeyID } from "../../../../../logic/Mail/Encryption/KeyUtils";
import { SQLEMail } from "../../../../../logic/Mail/SQL/SQLEMail";
import { Addressbook } from "../../../../../logic/Contacts/Addressbook";
import { SMIMEPublicKey } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEPublicKey";
import type { EMail } from "../../../../../logic/Mail/EMail";
import type { Folder } from "../../../../../logic/Mail/Folder";
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

/** Keeps the MIME source, as `MailDir` does on disk */
class TestMailStore {
  supportsAttachments = true;
  protected readonly mime = new Map<number, Uint8Array>();
  async save(email: EMail) {
    this.mime.set(email.dbID, email.mime);
  }
  async read(email: EMail) {
    email.mime = this.mime.get(email.dbID);
  }
  async deleteIt() {
  }
}

async function readAndSaveSignedMessage(folder: Folder, received = new Date()): Promise<EMail> {
  let email = folder.newEMail();
  email.received = received;
  email.mime = new TextEncoder().encode(kClearSigned.replace(/\n/g, "\r\n"));
  await email.parseMIME();
  await SQLEMail.save(email);
  return email;
}

/** The message as the reader gets it after a restart */
async function reread(email: EMail): Promise<EMail> {
  let fromDB = email.folder.newEMail();
  await SQLEMail.read(email.dbID, fromDB);
  expect(fromDB.mime).toBeFalsy();
  return fromDB;
}

describe("The key of a sender who is not in the addressbook", () => {
  test("is stored with the message, and read back on demand", async () => {
    let { folder } = await setupTestFolder({ getCACertificates: async () => [] });
    let email = await readAndSaveSignedMessage(folder);
    expect(email.signedKey).toBeTruthy();

    let fromDB = await reread(email);
    expect(fromDB.signedByKeyID).toBe(email.signedByKeyID);
    expect(fromDB.signedKey).toBe(null); // not parsed while merely reading
    expect(fromDB.signedKeyJSON).toBeTruthy();

    let signingKey = await getPublicKeyByKeyID(fromDB.signedByKeyID, fromDB);
    expect(signingKey.id).toBe(email.signedKey.id);
    expect(signingKey.userIDs.contents).toEqual(["alice@example.com"]);
    expect(fromDB.signedKey).toBe(signingKey); // parsed only once
  });

  test("is read from the message itself, for messages that predate this", async () => {
    let { folder } = await setupTestFolder({ getCACertificates: async () => [] });
    folder.account.contentStorage.add(new TestMailStore());
    let email = await readAndSaveSignedMessage(folder);
    await folder.account.contentStorage.first.save(email);

    let fromDB = await reread(email);
    fromDB.signedKeyJSON = null; // an older message, stored without the key

    let signingKey = await getPublicKeyByKeyID(fromDB.signedByKeyID, fromDB);
    expect(signingKey.id).toBe(email.signedKey.id);
    // stored now, so that we do not read the message again
    expect(await reread(email)).toHaveProperty("signedKeyJSON.id", signingKey.id);
  });

  test("is not duplicated, once the contact has it", async () => {
    let { folder } = await setupTestFolder({ getCACertificates: async () => [] });
    let addressbook = new Addressbook();
    appGlobal.addressbooks.add(addressbook);
    let email = await readAndSaveSignedMessage(folder);

    // As "Add to addressbook" does it
    let alice = email.from.createPerson(addressbook);
    alice.addEncryptionPublicKey(email.signedKey);
    await SQLEMail.save(email);

    let fromDB = await reread(email);
    expect(fromDB.signedKeyJSON).toBe(null);
    let signingKey = await getPublicKeyByKeyID(fromDB.signedByKeyID, fromDB);
    expect(signingKey).toBe(alice.encryptionPublicKeys.first);
  });
});

describe("The key that the mail viewer shows", () => {
  test("is the certificate that signed the message, not the contact's other certificate for the same key", async () => {
    let { folder } = await setupTestFolder({ getCACertificates: async () => [] });
    let addressbook = new Addressbook();
    appGlobal.addressbooks.add(addressbook);
    let email = await readAndSaveSignedMessage(folder, new Date("2026-09-15T12:00:00Z"));

    // Alice's certificate in the message is valid from 2026-08-31, the contact's only from 2026-11-06
    let alice = email.from.createPerson(addressbook);
    alice.encryptionPublicKeys.replaceAll([await SMIMEPublicKey.importPublicKey(kAliceRenewedCertificate)]);
    expect(alice.encryptionPublicKeys.first.id).toBe(email.signedByKeyID);
    await SQLEMail.save(email);

    for (let message of [email, await reread(email)]) {
      let signingKey = await getPublicKeyByKeyID(message.signedByKeyID, message) as SMIMEPublicKey;
      expect(signingKey.fingerprint).toBe(email.signedKey.fingerprint);
      expect(signingKey.isValidAt(message.received)).toBe(true);
    }
  });
});

/** Alice's key from `kClearSigned`, in a second certificate from another CA:
 * `openssl x509 -in alice.pem -CA ca.pem -CAkey ca.key -set_serial 0x2a -days 3650` */
const kAliceRenewedCertificate = `
-----BEGIN CERTIFICATE-----
MIIDOzCCAiOgAwIBAgIBKjANBgkqhkiG9w0BAQsFADAdMRswGQYDVQQDDBJFeGFt
cGxlIFJlbmV3YWwgQ0EwHhcNMjYxMTA2MTQzMDEzWhcNMzYxMTAzMTQzMDEzWjAy
MQ4wDAYDVQQDDAVBbGljZTEgMB4GCSqGSIb3DQEJARYRYWxpY2VAZXhhbXBsZS5j
b20wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDhiTP6zkvYuJdTKIFl
N/Jt55zRLvAGOjOe3dZ84lgI9O3ActyDsJekVas7GR4bjPPBK99d8Uauhw1+r2F5
0q10OePZAs2LjDIbcF1IzVICF6pULLwQOTeESbidlbYwX3DgQOvEwPpkILPCzPRY
kmtFbSGgQPdib+x9tUgGXNOHEqz7Rz64wiQfzoKw27FupuBqTCxnKkX9zYHPLMB7
2UQZXhh8nS2kFpWzz/HPXpsh+J2UAh0rdMavWzMEwYul/gJ6cBvY8akzpzuLeyPU
Nw0AAwY9gpk+CkGRiQglhyCzk5smMGtAFD7IQ7QhSYLA/rR4ZN+c3Zu8uPnXWEiN
nnEBAgMBAAGjcTBvMB0GA1UdDgQWBBT6EXd76dOKV5H1MuICbIZn9UpibjAfBgNV
HSMEGDAWgBT6EXd76dOKV5H1MuICbIZn9UpibjAPBgNVHRMBAf8EBTADAQH/MBwG
A1UdEQQVMBOBEWFsaWNlQGV4YW1wbGUuY29tMA0GCSqGSIb3DQEBCwUAA4IBAQCu
JZisqDs4r8kPPZ2mEHisRTtYWTcE98K8jN7mzTx4AMxWYRmMSf2wF4ttp9VtVu1j
j8sP3cyzsYy35WORoy3P4E5xN+g4PCUPdG1Ut1epyY90qhWl0ZdF5BchrBRqmfkw
h6trAvXTUdonoxGcOfqQCuIe8W0PFiBPtu1bQX6SLHL5aFOytqz1qRd3kPkQUvbf
oGuDEiTUmJ2bpkBJPMMVL34j6UTEmx2WTaUYt8jxqs/3Usax1j/ttdctFhgHYFPo
8Wd7rkAm12yFdIorhXD/Rf8KEgQHVl9xLkGPMycQwv6Yk0UHog6TN0sOVyYrw/UI
OzyNl5MifjijE6lj9b8w
-----END CERTIFICATE-----
`;
