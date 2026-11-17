// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { Person, ContactEntry } from "../../../../logic/Abstract/Person";
import { PGPPublicKey } from "../../../../logic/Mail/Encryption/PGP/PGPPublicKey";
import { SMIMEPublicKey } from "../../../../logic/Mail/Encryption/SMIME/SMIMEPublicKey";
import { TrustLevel } from "../../../../logic/Mail/Encryption/enums";
import { allFieldRows } from "../../../Contacts/PersonPage/AllFields";
import { certificateStatus } from "../../../Contacts/PersonPage/ContactCertificates";
import { expect, test } from "vitest";

function key(id: string, userID: string, KeyClass: typeof PGPPublicKey | typeof SMIMEPublicKey = PGPPublicKey): PGPPublicKey | SMIMEPublicKey {
  let result = new KeyClass();
  result.id = id;
  result.userIDs.add(userID);
  return result;
}

test("Certificate status: default, not trusted", () => {
  let smime = key("ef34gh", "fred@example.org", SMIMEPublicKey);
  // A new S/MIME key is obsolete until its certificate is there
  smime.obsolete = false;
  smime.encryptByDefault = true;
  expect(certificateStatus(smime)).toBe("Default");
  let bad = key("ab12cd", "fred@example.org");
  bad.trustLevel = TrustLevel.Distrusted;
  expect(certificateStatus(bad)).toBe("Not trusted");
});

test("All Fields lists the entries of the chosen kind, user-defined fields by name", () => {
  let person = new Person();
  person.emailAddresses.add(new ContactEntry("fred@example.org", "work"));
  person.emailAddresses.add(new ContactEntry("fred@home.example", "home"));
  person.phoneNumbers.add(new ContactEntry("+49 30 1234", "mobile"));
  person.urls.add(new ContactEntry("https://fred.example"));
  person.custom.add(new ContactEntry("Ginger", "cat"));
  expect(allFieldRows(person, "user-defined").map(row => row.name)).toEqual(["cat"]);
  expect(allFieldRows(person, "email").map(row => row.entry.value)).toEqual(["fred@example.org", "fred@home.example"]);
  expect(allFieldRows(person, "internet").map(row => row.name)).toEqual(["Web page"]);
  expect(allFieldRows(person, "all")).toHaveLength(5);
});
