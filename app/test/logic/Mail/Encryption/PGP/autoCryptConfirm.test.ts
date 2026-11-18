import "../../../../../logic/app";
import { setupTestFolder } from "../../SQL/setup";
import { appGlobal } from "../../../../../logic/app";
import { MailIdentity } from "../../../../../logic/Mail/MailIdentity";
import { findOrCreatePersonUID } from "../../../../../logic/Abstract/PersonUID";
import { ContactEntry, type Person } from "../../../../../logic/Abstract/Person";
import { Addressbook } from "../../../../../logic/Contacts/Addressbook";
import { DummyAddressbookStorage } from "../../../../../logic/Contacts/SQL/DummyAddressbookStorage";
import { importAutoCryptKeys, sendAutoCryptHeader } from "../../../../../logic/Mail/Encryption/PGP/AutoCrypt";
import { getPublicKeyForPerson } from "../../../../../logic/Mail/Encryption/KeyUtils";
import { PGPPrivateKey } from "../../../../../logic/Mail/Encryption/PGP/PGPPrivateKey";
import { PGPPublicKey } from "../../../../../logic/Mail/Encryption/PGP/PGPPublicKey";
import { TrustLevel } from "../../../../../logic/Mail/Encryption/enums";
import type { EMail } from "../../../../../logic/Mail/EMail";
import type { Folder } from "../../../../../logic/Mail/Folder";
import { expect, test, beforeAll } from "vitest";

let folder: Folder;
let addressbook: Addressbook;

beforeAll(async () => {
  ({ folder } = await setupTestFolder());
  addressbook = new Addressbook();
  addressbook.storage = new DummyAddressbookStorage();
  appGlobal.addressbooks.add(addressbook);
  appGlobal.collectedAddressbook = addressbook;
});

/** A contact with a key that the user confirmed, and who prefers encrypted mail */
async function contactWithConfirmedKey(emailAddress: string): Promise<{ person: Person, key: PGPPrivateKey }> {
  let key = await PGPPrivateKey.createNewPrivateKey({ realname: "Bob", emailAddress });
  let confirmed = await PGPPublicKey.importPublicKey(key.publicKeyArmored);
  confirmed.trustLevel = TrustLevel.Personal;
  confirmed.encryptByDefault = true;
  let person = addressbook.newPerson();
  person.name = "Bob";
  person.emailAddresses.add(new ContactEntry(emailAddress));
  person.addEncryptionPublicKey(confirmed);
  addressbook.persons.add(person);
  return { person, key };
}

/** A mail that anybody could send, with `From:` and an AutoCrypt header with this key */
function mailWithAutoCryptHeader(emailAddress: string, key: PGPPrivateKey): EMail {
  let identity = new MailIdentity(folder.account);
  identity.emailAddress = emailAddress;
  let mail = folder.newEMail();
  mail.from = findOrCreatePersonUID(emailAddress, "Bob");
  mail.mime = new TextEncoder().encode([
    sendAutoCryptHeader(identity, key),
    `From: Bob <${emailAddress}>`,
    "To: User <user@example.com>",
    "Subject: Hello",
    "",
    "Hello",
    "",
  ].join("\r\n"));
  return mail;
}

test("The key in the AutoCrypt header is added to a contact with a confirmed key, for the user to confirm, but not used", async () => {
  let { person } = await contactWithConfirmedKey("bob@example.com");
  let confirmed = person.encryptionPublicKeys.first;
  let mallory = await PGPPrivateKey.createNewPrivateKey({ realname: "Bob", emailAddress: "bob@example.com" });
  mallory.encryptByDefault = true; // prefer-encrypt=mutual
  await importAutoCryptKeys(mailWithAutoCryptHeader("bob@example.com", mallory));
  expect(person.encryptionPublicKeys.contents.map(key => key.fingerprint)).toEqual([confirmed.fingerprint, mallory.fingerprint]);
  expect(getPublicKeyForPerson(person)).toBe(confirmed);
  expect(getPublicKeyForPerson(person, PGPPublicKey)).toBe(confirmed);
});

test("The contact's own key in the AutoCrypt header, but without prefer-encrypt, doesn't turn off encryption of the confirmed key", async () => {
  let { person, key } = await contactWithConfirmedKey("bob2@example.com");
  await importAutoCryptKeys(mailWithAutoCryptHeader("bob2@example.com", key));
  expect(person.encryptionPublicKeys.first.encryptByDefault).toBe(true);
});
