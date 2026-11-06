// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { EWSGAL } from "../../../../logic/Contacts/EWS/EWSGAL";
import type { EWSPerson } from "../../../../logic/Contacts/EWS/EWSPerson";
import { SMIMEPublicKey } from "../../../../logic/Mail/Encryption/SMIME/SMIMEPublicKey";
import { kCertificate, kCertificateEmailAddress, kSMIMECertificate, kSMIMECertificateEmailAddress, trustTestCAs } from "../testCertificate";
import { addSMIMEIdentities } from "../smimeIdentities";
import { errorsForServer } from "../../../../logic/util/error";
import { ArrayColl } from "svelte-collections";
import { expect, test, vi } from "vitest";

trustTestCAs();

const kPersons = [{
  name: "Ben Bucksch",
  firstName: "Ben",
  lastName: "Bucksch",
  emailAddresses: ["ben@example.com", "sales@example.com"],
  smimeCertificates: [kSMIMECertificate],
  certificates: [kCertificate],
}, {
  name: "Sally Smith",
  firstName: "Sally",
  lastName: "Smith",
  emailAddresses: ["sally@example.com"],
  smimeCertificates: [],
  certificates: [],
}, {
  name: "Cathy Chen",
  firstName: "Cathy",
  lastName: "Chen",
  emailAddresses: ["cathy@example.com"],
  smimeCertificates: [],
  certificates: [kCertificate],
}];

/** An account stub which resolves names like Exchange does:
 * Without routing type prefix, it matches only the names, like a directory which
 * does not search the `mail` attribute. With an `smtp:` prefix, it matches all
 * email addresses. Both match only the start. */
function fakeAccount(persons = kPersons): any {
  return {
    errorCallback: (ex: Error) => { throw ex; },
    queries: [] as any[],
    async callEWS(query: any) {
      this.queries.push(query);
      this.lastQuery = query;
      let entry = query.m$ResolveNames.m$UnresolvedEntry.toLowerCase();
      let matches = entry.startsWith("smtp:")
        ? persons.filter(person => person.emailAddresses.some(email => email.startsWith(entry.slice("smtp:".length))))
        : persons.filter(person => [person.name, person.firstName, person.lastName]
          .some(field => field.toLowerCase().startsWith(entry)));
      if (!matches.length) {
        throw { type: "ErrorNameResolutionNoResults" };
      }
      return { ResolutionSet: { Resolution: matches.map(resolutionXML) } };
    },
  };
}

function resolutionXML(person: typeof kPersons[0]): any {
  return {
    Mailbox: {
      Name: person.name,
      EmailAddress: person.emailAddresses[0],
      RoutingType: "SMTP",
    },
    Contact: {
      DisplayName: person.name,
      GivenName: person.firstName,
      Surname: person.lastName,
      EmailAddresses: {
        Entry: person.emailAddresses.map((email, i) => ({
          Key: "EmailAddress" + (i + 1),
          Value: (i == 0 ? "SMTP:" : "smtp:") + email, // the primary one in capitals
        })),
      },
      UserSMIMECertificate: person.smimeCertificates.length ? { Base64Binary: person.smimeCertificates } : undefined,
      MSExchangeCertificate: person.certificates.length ? { Base64Binary: person.certificates } : undefined,
    },
  };
}

/** As the composer and the calendar use it: our identity is in `example.com` and has an S/MIME certificate */
async function search(searchTerm: string, account = fakeAccount()): Promise<ArrayColl<EWSPerson>> {
  addSMIMEIdentities(account, "me@example.com");
  let gal = new EWSGAL(account);
  appGlobal.searchOnlyAddressbooks.clear();
  appGlobal.searchOnlyAddressbooks.add(gal);
  let results = new ArrayColl<EWSPerson>();
  await gal.quickSearchAsync(searchTerm, results);
  return results;
}

test("Find by last name", async () => {
  let results = await search("bucksch");
  expect(results.length).toBe(1);
  expect(results.first.name).toBe("Ben Bucksch");
  expect(results.first.emailAddresses.first.value).toBe("ben@example.com");
});

test("Find by the start of the email address", async () => {
  let results = await search("cathy@ex");
  expect(results.length).toBe(1);
  expect(results.first.name).toBe("Cathy Chen");
});

test("Find by an email address which is not the primary one", async () => {
  let results = await search("sales");
  expect(results.length).toBe(1);
  expect(results.first.name).toBe("Ben Bucksch");
});

test("Person matching both name and email address is returned only once", async () => {
  let results = await search("ben");
  expect(results.length).toBe(1);
  expect(results.first.name).toBe("Ben Bucksch");
});

test("No match", async () => {
  let results = await search("nobody");
  expect(results.length).toBe(0);
});

test("Server errors are logged, not thrown", async () => {
  let account = fakeAccount();
  account.callEWS = async () => {
    throw { type: "ErrorAccessDenied" };
  };
  errorsForServer.clear();
  let consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  let results = await search("ben", account);
  expect(results.length).toBe(0);
  // Both the name search and the email address search
  expect(errorsForServer.contents).toEqual([{ type: "ErrorAccessDenied" }, { type: "ErrorAccessDenied" }]);
  consoleError.mockRestore();
});

test("If one search fails, the other search still finds the person", async () => {
  let account = fakeAccount();
  let callEWS = account.callEWS;
  account.callEWS = async function (query: any) {
    if (query.m$ResolveNames.m$UnresolvedEntry.startsWith("smtp:")) {
      throw { type: "ErrorServerBusy" };
    }
    return await callEWS.call(this, query);
  };
  errorsForServer.clear();
  let consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  let results = await search("bucksch", account);
  expect(results.length).toBe(1);
  expect(results.first.name).toBe("Ben Bucksch");
  expect(errorsForServer.contents).toEqual([{ type: "ErrorServerBusy" }]);
  consoleError.mockRestore();
});

test("The results of the faster search show before the slower search returns", async () => {
  let account = fakeAccount();
  let callEWS = account.callEWS;
  let finishEmailSearch: () => void;
  let emailSearchFinished = new Promise<void>(resolve => finishEmailSearch = resolve);
  account.callEWS = async function (query: any) {
    if (query.m$ResolveNames.m$UnresolvedEntry.startsWith("smtp:")) {
      await emailSearchFinished;
    }
    return await callEWS.call(this, query);
  };
  let gal = new EWSGAL(account);
  let results = new ArrayColl<EWSPerson>();
  // The name matches Sally, the email address matches Sally and Ben's `sales@`
  let searching = gal.quickSearchAsync("sa", results);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(results.contents.map(person => person.name)).toEqual(["Sally Smith"]);
  finishEmailSearch();
  await searching;
  expect(results.contents.map(person => person.name).sort()).toEqual(["Ben Bucksch", "Sally Smith"]);
});

test("The search fetches no certificates", async () => {
  let account = fakeAccount();
  let results = await search("bucksch", account);
  for (let query of account.queries) {
    expect(query.m$ResolveNames.ContactDataShape).toBeUndefined();
  }
  expect(results.first.encryptionPublicKeys.length).toBe(0);
});

test("Read the `userCertificate` of the person that the user picked", async () => {
  let account = fakeAccount();
  let person = (await search("cathy", account)).first;
  account.queries = [];
  await person.fetchEncryptionKeys();
  expect(account.queries.length).toBe(1);
  expect(account.lastQuery.m$ResolveNames.ContactDataShape).toBe("AllProperties");
  expect(person.encryptionPublicKeys.length).toBe(1);
  let key = person.encryptionPublicKeys.first;
  expect(key).toBeInstanceOf(SMIMEPublicKey);
  expect(key.userIDs.first).toBe(kCertificateEmailAddress);
  expect((key as SMIMEPublicKey).certificate).toContain("-----BEGIN CERTIFICATE-----");
});

test("Ask the directory only once for the same person", async () => {
  let account = fakeAccount();
  let person = (await search("cathy", account)).first;
  account.queries = [];
  // The composer asks when the user picks the person, and again when they encrypt
  await Promise.all([person.fetchEncryptionKeys(), person.fetchEncryptionKeys()]);
  await person.fetchEncryptionKeys();
  expect(account.queries.length).toBe(1);
  expect(person.encryptionPublicKeys.length).toBe(1);
});

test("Prefer `userSMIMECertificate` over `userCertificate`, as RFC 2798 says", async () => {
  let person = (await search("bucksch")).first;
  await person.fetchEncryptionKeys();
  expect(person.encryptionPublicKeys.length).toBe(1);
  let key = person.encryptionPublicKeys.first as SMIMEPublicKey;
  expect(key.userIDs.first).toBe(kSMIMECertificateEmailAddress);
});

test("Read the certificate chain from `userSMIMECertificate`", async () => {
  let person = (await search("bucksch")).first;
  await person.fetchEncryptionKeys();
  let key = person.encryptionPublicKeys.first as SMIMEPublicKey;
  expect(key.chain.length).toBe(1); // the CA which issued the certificate
  expect(key.chain.first.commonName).toBe("Test SMIME CA");
});

test("Person without a certificate in the GAL", async () => {
  let person = (await search("sally")).first;
  expect(person.name).toBe("Sally Smith");
  await person.fetchEncryptionKeys();
  expect(person.encryptionPublicKeys.length).toBe(0);
});

test("Certificates are optional, and their failure does not disturb the user", async () => {
  let errors: Error[] = [];
  let account = fakeAccount();
  account.errorCallback = (ex: Error) => errors.push(ex);
  let person = (await search("bucksch", account)).first;
  account.callEWS = async () => {
    throw new Error("The operation is not supported");
  };
  await person.fetchEncryptionKeys();
  expect(person.encryptionPublicKeys.length).toBe(0);
  expect(errors.map(ex => ex.message)).toEqual(["The operation is not supported"]);
});

test("The person is no longer in the GAL", async () => {
  let account = fakeAccount();
  let person = (await search("bucksch", account)).first;
  account.callEWS = async () => {
    throw { type: "ErrorNameResolutionNoResults" }; // expected, and not an error for us
  };
  await person.fetchEncryptionKeys(); // the error callback would throw
  expect(person.encryptionPublicKeys.length).toBe(0);
});

test("Broken certificates are skipped", async () => {
  let account = fakeAccount([{
    name: "Ben Bucksch",
    firstName: "Ben",
    lastName: "Bucksch",
    emailAddresses: ["ben@example.com"],
    smimeCertificates: [],
    certificates: ["Not a certificate"],
  }]);
  account.errorCallback = () => undefined; // the error is reported, not thrown
  let person = (await search("bucksch", account)).first;
  await person.fetchEncryptionKeys();
  expect(person.encryptionPublicKeys.length).toBe(0);
});

test("Broken `userSMIMECertificate` falls back to `userCertificate`", async () => {
  let account = fakeAccount([{
    name: "Ben Bucksch",
    firstName: "Ben",
    lastName: "Bucksch",
    emailAddresses: ["ben@example.com"],
    smimeCertificates: ["Not a PKCS#7 blob"],
    certificates: [kCertificate],
  }]);
  account.errorCallback = () => undefined; // the error is reported, not thrown
  let person = (await search("bucksch", account)).first;
  await person.fetchEncryptionKeys();
  expect(person.encryptionPublicKeys.length).toBe(1);
  expect(person.encryptionPublicKeys.first.userIDs.first).toBe(kCertificateEmailAddress);
});
