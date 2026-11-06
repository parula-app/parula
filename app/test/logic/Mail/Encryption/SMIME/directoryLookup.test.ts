// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../../logic/app";
import { appGlobal } from "../../../../../logic/app";
import type { MailIdentity } from "../../../../../logic/Mail/MailIdentity";
import { EWSGAL } from "../../../../../logic/Contacts/EWS/EWSGAL";
import { Addressbook } from "../../../../../logic/Contacts/Addressbook";
import { ContactEntry, type Person } from "../../../../../logic/Abstract/Person";
import { PersonUID } from "../../../../../logic/Abstract/PersonUID";
import { getPublicKeyForPersonUID } from "../../../../../logic/Mail/Encryption/KeyUtils";
import { SMIMEPublicKey } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEPublicKey";
import { PGPPrivateKey } from "../../../../../logic/Mail/Encryption/PGP/PGPPrivateKey";
import { Certificate, SignedData } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEASN1";
import { kSMIMECertificate, kUntrustedSMIMECertificate, trustTestCAs } from "../../../Contacts/testCertificate";
import { addSMIMEIdentities } from "../../../Contacts/smimeIdentities";
import { ArrayColl } from "svelte-collections";
import { beforeEach, expect, test } from "vitest";

/** The certificates that the company directory has, by email address */
const kDirectory: Record<string, string> = {
  "colleague@example.com": kSMIMECertificate,
  "colleague@sales.example.com": kSMIMECertificate,
  "partner@other.org": kSMIMECertificate,
  // E.g. a certificate that the server made itself, to read the mail
  "untrusted@example.com": kUntrustedSMIMECertificate,
};

trustTestCAs();

/** An Exchange account, which resolves names with an `smtp:` prefix,
 * and its GAL. Its identities have S/MIME certificates. */
function fakeAccount(...identityAddresses: string[]): any {
  let account: any = {
    errorCallback: (ex: Error) => { throw ex; },
    queries: [] as string[],
    async callEWS(query: any) {
      let entry = query.m$ResolveNames.m$UnresolvedEntry.toLowerCase();
      this.queries.push(entry);
      let matches = Object.keys(kDirectory).filter(emailAddress => "smtp:" + emailAddress == entry);
      if (!matches.length) {
        throw { type: "ErrorNameResolutionNoResults" };
      }
      return {
        ResolutionSet: {
          Resolution: matches.map(emailAddress => ({
            Mailbox: { EmailAddress: emailAddress, RoutingType: "SMTP" },
            Contact: { UserSMIMECertificate: { Base64Binary: [kDirectory[emailAddress]] } },
          })),
        },
      };
    },
  };
  addSMIMEIdentities(account, ...identityAddresses);
  appGlobal.searchOnlyAddressbooks.add(new EWSGAL(account));
  return account;
}

let account: any;
let gal: EWSGAL;

beforeEach(() => {
  appGlobal.searchOnlyAddressbooks.clear();
  appGlobal.addressbooks.clear();
  account = fakeAccount("me@example.com");
  gal = appGlobal.searchOnlyAddressbooks.first as EWSGAL;
});

function personInAddressbook(...emailAddresses: string[]): Person {
  let addressbook = new Addressbook();
  appGlobal.addressbooks.add(addressbook);
  let person = addressbook.newPerson();
  person.name = "Contact";
  for (let emailAddress of emailAddresses) {
    person.emailAddresses.add(new ContactEntry(emailAddress, "work", "mailto"));
  }
  addressbook.persons.add(person);
  return person;
}

/** The user picked this person from the GAL search results */
function galEntry(emailAddress: string): PersonUID {
  let person = gal.newPerson();
  person.emailAddresses.add(new ContactEntry(emailAddress, "work", "mailto"));
  return PersonUID.fromPerson(person);
}

function canEncryptTo(recipient: PersonUID): boolean {
  return !!getPublicKeyForPersonUID(recipient, SMIMEPublicKey);
}

test("Recipient in our domain, who is in no address book", async () => {
  let recipient = new PersonUID("colleague@example.com", "Colleague");
  await recipient.fetchEncryptionKeys();
  expect(account.queries).toEqual(["smtp:colleague@example.com"]);
  expect(canEncryptTo(recipient)).toBe(true);
});

test("Recipient in our domain, who is in a local address book", async () => {
  personInAddressbook("colleague@example.com");
  let recipient = new PersonUID("colleague@example.com", "Colleague");
  await recipient.fetchEncryptionKeys();
  expect(account.queries).toEqual(["smtp:colleague@example.com"]);
  expect(canEncryptTo(recipient)).toBe(true);
});

test("Contact whose first email address is a private one", async () => {
  personInAddressbook("colleague@private.example.org", "colleague@example.com");
  let recipient = new PersonUID("colleague@private.example.org", "Colleague");
  await recipient.fetchEncryptionKeys();
  expect(account.queries).toEqual(["smtp:colleague@example.com"]);
  expect(canEncryptTo(recipient)).toBe(true);
});

test("Recipient in a subdomain of our domain", async () => {
  let recipient = new PersonUID("colleague@sales.example.com", "Colleague");
  await recipient.fetchEncryptionKeys();
  expect(account.queries).toEqual(["smtp:colleague@sales.example.com"]);
  expect(canEncryptTo(recipient)).toBe(true);
});

test("Recipient in another domain is not sent to our server", async () => {
  personInAddressbook("partner@other.org");
  let recipient = new PersonUID("partner@other.org", "Partner");
  await recipient.fetchEncryptionKeys();
  expect(account.queries).toEqual([]);
  expect(canEncryptTo(recipient)).toBe(false);
});

test("GAL entry in our domain", async () => {
  let recipient = galEntry("colleague@example.com");
  await recipient.fetchEncryptionKeys();
  expect(account.queries).toEqual(["smtp:colleague@example.com"]);
  expect(canEncryptTo(recipient)).toBe(true);
});

test("GAL entry in another domain", async () => {
  await galEntry("partner@other.org").fetchEncryptionKeys();
  expect(account.queries).toEqual([]);
});

test("Without our own S/MIME certificate, we ask nothing, also not about GAL entries", async () => {
  let identity = account.identities.first as MailIdentity;
  identity.encryptionPrivateKeys.clear();
  let pgpKey = new PGPPrivateKey();
  pgpKey.id = "fedcba0987654321";
  pgpKey.obsolete = false;
  identity.encryptionPrivateKeys.add(pgpKey);
  await galEntry("colleague@example.com").fetchEncryptionKeys();
  await new PersonUID("colleague@sales.example.com", "Colleague").fetchEncryptionKeys();
  expect(account.queries).toEqual([]);
});

test("Account with identities in two domains", async () => {
  appGlobal.searchOnlyAddressbooks.clear();
  account = fakeAccount("me@example.com", "me@other.org");
  let recipient = new PersonUID("partner@other.org", "Partner");
  await recipient.fetchEncryptionKeys();
  expect(account.queries).toEqual(["smtp:partner@other.org"]);
  expect(canEncryptTo(recipient)).toBe(true);
});

test("The identity in the domain of the recipient needs an S/MIME certificate", async () => {
  appGlobal.searchOnlyAddressbooks.clear();
  account = fakeAccount("me@example.com", "me@other.org");
  (account.identities.get(1) as MailIdentity).encryptionPrivateKeys.clear();
  await new PersonUID("partner@other.org", "Partner").fetchEncryptionKeys();
  expect(account.queries).toEqual([]);
});

test("With two Exchange accounts, only the directory of the domain of the recipient is asked", async () => {
  let otherAccount = fakeAccount("me@other.org");
  let recipient = new PersonUID("partner@other.org", "Partner");
  await recipient.fetchEncryptionKeys();
  expect(account.queries).toEqual([]);
  expect(otherAccount.queries).toEqual(["smtp:partner@other.org"]);
  expect(canEncryptTo(recipient)).toBe(true);
});

test("Recipient who already has an S/MIME certificate", async () => {
  let person = personInAddressbook("colleague@example.com");
  let saved = new SMIMEPublicKey();
  saved.id = "1111111111111111";
  saved.obsolete = false;
  person.addEncryptionPublicKey(saved);
  let recipient = new PersonUID("colleague@example.com", "Colleague");
  await recipient.fetchEncryptionKeys();
  expect(account.queries).toEqual([]);
  expect(getPublicKeyForPersonUID(recipient, SMIMEPublicKey)).toBe(saved);
});

test("Recipient whose saved certificate expired gets the current one", async () => {
  let person = personInAddressbook("colleague@example.com");
  let expired = new SMIMEPublicKey();
  expired.id = "1111111111111111";
  expired.obsolete = true;
  person.addEncryptionPublicKey(expired);
  let recipient = new PersonUID("colleague@example.com", "Colleague");
  await recipient.fetchEncryptionKeys();
  expect(account.queries).toEqual(["smtp:colleague@example.com"]);
  expect(canEncryptTo(recipient)).toBe(true);
});

test("Ask the directory only once per email address", async () => {
  // Picking the recipient and then encrypting, then the same recipient in another email
  let first = new PersonUID("colleague@example.com", "Colleague");
  await Promise.all([first.fetchEncryptionKeys(), first.fetchEncryptionKeys()]);
  let second = new PersonUID("Colleague@example.com", "Colleague");
  await second.fetchEncryptionKeys();
  expect(account.queries.length).toBe(1);
  expect(canEncryptTo(second)).toBe(true);
});

test("Recipient who is not in the directory", async () => {
  let recipient = new PersonUID("newbie@example.com", "Newbie");
  await recipient.fetchEncryptionKeys(); // the error callback would throw
  expect(account.queries).toEqual(["smtp:newbie@example.com"]);
  expect(canEncryptTo(recipient)).toBe(false);
});

test("The composer notices the new certificates", async () => {
  // `EncryptionDetails.svelte` watches the keys of the contacts, and the recipients themselves
  personInAddressbook("colleague@example.com");
  let withContact = new PersonUID("colleague@example.com", "Colleague");
  let withoutContact = new PersonUID("colleague@sales.example.com", "Colleague");
  let contactKeyChanges = 0;
  withContact.findPerson().encryptionPublicKeys.subscribe(() => contactKeyChanges++);
  let withoutKeys = new ArrayColl([withoutContact]).filterObservable(recipient => !getPublicKeyForPersonUID(recipient));
  await withContact.fetchEncryptionKeys();
  await withoutContact.fetchEncryptionKeys();
  expect(contactKeyChanges).toBeGreaterThan(1); // the first call is from `subscribe()` itself
  expect(withoutKeys.length).toBe(0);
});

test("Certificate from the directory without a trusted CA counts as missing", async () => {
  let recipient = new PersonUID("untrusted@example.com", "Untrusted");
  await recipient.fetchEncryptionKeys();
  expect(account.queries).toEqual(["smtp:untrusted@example.com"]);
  expect(canEncryptTo(recipient)).toBe(false);
});

test("Certificate from the directory without a trusted CA counts as missing, also for a contact", async () => {
  personInAddressbook("untrusted@example.com");
  let recipient = new PersonUID("untrusted@example.com", "Untrusted");
  await recipient.fetchEncryptionKeys();
  expect(account.queries).toEqual(["smtp:untrusted@example.com"]);
  expect(canEncryptTo(recipient)).toBe(false);
});

test("Certificate that the user added to the contact needs no trusted CA", async () => {
  let person = personInAddressbook("untrusted@example.com");
  let added = await SMIMEPublicKey.importPublicKey(Certificate.encodePEM(
    SignedData.decodeFromBase64(kUntrustedSMIMECertificate, { berToDER: true }).content.certificates[0],
    { label: "CERTIFICATE" }));
  person.addEncryptionPublicKey(added);
  let recipient = new PersonUID("untrusted@example.com", "Untrusted");
  await recipient.fetchEncryptionKeys();
  expect(getPublicKeyForPersonUID(recipient, SMIMEPublicKey)).toBe(added);
});
