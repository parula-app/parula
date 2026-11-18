// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../../logic/app";
import { setupTestFolder, newTestEMail } from "../../SQL/setup";
import { findOrCreatePersonUID } from "../../../../../logic/Abstract/PersonUID";
import { Addressbook } from "../../../../../logic/Contacts/Addressbook";
import { SQLAddressbookStorage } from "../../../../../logic/Contacts/SQL/SQLAddressbookStorage";
import { SQLPerson } from "../../../../../logic/Contacts/SQL/SQLPerson";
import { getDatabase as getContactsDatabase } from "../../../../../logic/Contacts/SQL/SQLDatabase";
import { removeSecretKeysOfContacts } from "../../../../../logic/Contacts/SQL/SQLPersonMigrate";
import { SQLEMail } from "../../../../../logic/Mail/SQL/SQLEMail";
import { getDatabase as getMailDatabase } from "../../../../../logic/Mail/SQL/SQLDatabase";
import { removeSecretKeyOfSigner } from "../../../../../logic/Mail/SQL/SQLEMailMigrate";
import { PGPPrivateKey } from "../../../../../logic/Mail/Encryption/PGP/PGPPrivateKey";
import { PGPPublicKey } from "../../../../../logic/Mail/Encryption/PGP/PGPPublicKey";
import type { Folder } from "../../../../../logic/Mail/Folder";
import sql from "../../../../../../lib/rs-sqlite";
import { expect, test, beforeAll } from "vitest";

let folder: Folder;
/** Our own key, which the database should not have outside of the identity */
let myKey: PGPPrivateKey;

beforeAll(async () => {
  ({ folder } = await setupTestFolder());
  myKey = await PGPPrivateKey.createNewPrivateKey({ realname: "User", emailAddress: "user@example.com" });
});

test("A mail that we signed, saved before #1916, no longer has our secret key", async () => {
  let email = newTestEMail(folder, "signed-by-us@example.com");
  email.from = findOrCreatePersonUID("user@example.com", "User");
  email.rememberSigner(myKey); // as the signature check did before #1916
  await SQLEMail.save(email);
  let database = await getMailDatabase();
  let before = await database.get(sql`SELECT json FROM email WHERE id = ${email.dbID}`) as any;
  expect(before.json).toContain("PGP PRIVATE KEY BLOCK");

  await database.execute(removeSecretKeyOfSigner);

  let after = await database.get(sql`SELECT json FROM email WHERE id = ${email.dbID}`) as any;
  expect(after.json).not.toContain("PGP PRIVATE KEY BLOCK");
  expect(after.json).not.toContain(myKey.passphrase);
  expect(JSON.parse(after.json).encryption.signedPublicKey.fingerprint).toBe(myKey.fingerprint);
  expect(after.json).toContain("PGP PUBLIC KEY BLOCK");
});

test("A contact, saved before #1916, no longer has our secret key, and keeps its keys", async () => {
  let database = await getContactsDatabase();
  let addressbook = new Addressbook();
  addressbook.storage = new SQLAddressbookStorage();
  let row = await database.run(sql`
    INSERT INTO addressbook (idStr, protocol) VALUES (${addressbook.id}, ${"test"})`);
  addressbook.dbID = row.lastInsertRowid;
  let person = addressbook.newPerson();
  person.name = "User";
  person.addEncryptionPublicKey(myKey); // as "Add to address book" did before #1916
  let otherKey = await PGPPublicKey.importPublicKey((await PGPPrivateKey.createNewPrivateKey({ realname: "User", emailAddress: "user@example.com" })).publicKeyArmored);
  person.addEncryptionPublicKey(otherKey);
  await SQLPerson.save(person);
  let before = await database.get(sql`SELECT json FROM person WHERE id = ${person.dbID}`) as any;
  expect(before.json).toContain("PGP PRIVATE KEY BLOCK");

  await database.execute(removeSecretKeysOfContacts);

  let after = await database.get(sql`SELECT json FROM person WHERE id = ${person.dbID}`) as any;
  expect(after.json).not.toContain("PGP PRIVATE KEY BLOCK");
  expect(after.json).not.toContain(myKey.passphrase);
  expect(JSON.parse(after.json).encryptionPublicKeys.map(key => key.fingerprint)).toEqual([myKey.fingerprint, otherKey.fingerprint]);
});
