// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { OWAGAL } from "../../../../logic/Contacts/OWA/OWAGAL";
import type { OWAPerson } from "../../../../logic/Contacts/OWA/OWAPerson";
import { SMIMEPublicKey } from "../../../../logic/Mail/Encryption/SMIME/SMIMEPublicKey";
import { kCertificate, kCertificateEmailAddress, kSMIMECertificate, kSMIMECertificateEmailAddress, trustTestCAs } from "../testCertificate";
import { addSMIMEIdentities } from "../smimeIdentities";
import { ArrayColl } from "svelte-collections";
import { expect, test } from "vitest";

trustTestCAs();

const kPersons = [{
  DisplayName: "Ben Bucksch",
  GivenName: "Ben",
  Surname: "Bucksch",
  emailAddress: "Ben@Example.com", // FindPeople and ResolveNames may differ in case
}, {
  DisplayName: "Sally Smith",
  GivenName: "Sally",
  Surname: "Smith",
  emailAddress: "sally@example.com",
}];

/** An account stub which searches the GAL like Exchange does: Without routing type
 * prefix, it matches the start of the names, with an `smtp:` prefix, the start of
 * the email address. It returns the certificates that `certificates` and
 * `smimeCertificates` list per person. */
function fakeAccount(
  certificates: Record<string, string[]> = { "ben@example.com": [kCertificate] },
  smimeCertificates: Record<string, string[]> = {},
): any {
  return {
    errorCallback: (ex: Error) => { throw ex; },
    actions: [] as string[],
    async callOWA(request: any) {
      this.actions.push(request.action);
      this.lastRequest = request;
      if (request.action == "FindPeople") {
        return {
          ResultSet: matching(request.Body.QueryString).map(person => ({
            PersonaId: { Id: person.emailAddress },
            DisplayName: person.DisplayName,
            GivenName: person.GivenName,
            Surname: person.Surname,
            EmailAddresses: [{ EmailAddress: person.emailAddress, RoutingType: "SMTP" }],
          })),
        };
      }
      expect(request.action).toBe("ResolveNames");
      expect(request.Body.ContactDataShape).toBe("AllProperties");
      let matches = matching(request.Body.UnresolvedEntry);
      if (!matches.length) {
        throw { type: "ErrorNameResolutionNoResults" };
      }
      return {
        ResolutionSet: matches.map(person => ({
          Mailbox: {
            Name: person.DisplayName,
            EmailAddress: person.emailAddress.toLowerCase(),
            RoutingType: "SMTP",
          },
          Contact: {
            DisplayName: person.DisplayName,
            UserSMIMECertificate: smimeCertificates[person.emailAddress.toLowerCase()],
            MSExchangeCertificate: certificates[person.emailAddress.toLowerCase()],
          },
        })),
      };
    },
  };
}

function matching(searchTerm: string): typeof kPersons {
  let term = searchTerm.toLowerCase();
  return term.startsWith("smtp:")
    ? kPersons.filter(person => person.emailAddress.toLowerCase().startsWith(term.slice("smtp:".length)))
    : kPersons.filter(person => [person.DisplayName, person.GivenName, person.Surname]
      .some(field => field.toLowerCase().startsWith(term)));
}

/** As the composer and the calendar use it: our identity is in `example.com` and has an S/MIME certificate */
async function search(searchTerm: string, account = fakeAccount()): Promise<ArrayColl<OWAPerson>> {
  addSMIMEIdentities(account, "me@example.com");
  let gal = new OWAGAL(account);
  appGlobal.searchOnlyAddressbooks.clear();
  appGlobal.searchOnlyAddressbooks.add(gal);
  let results = new ArrayColl<OWAPerson>();
  await gal.quickSearchAsync(searchTerm, results);
  return results;
}

test("Find by last name", async () => {
  let results = await search("bucksch");
  expect(results.length).toBe(1);
  expect(results.first.name).toBe("Ben Bucksch");
});

test("Find by the start of the email address", async () => {
  let results = await search("ben@ex");
  expect(results.length).toBe(1);
  expect(results.first.name).toBe("Ben Bucksch");
});

test("Person matching both name and email address is returned only once", async () => {
  let results = await search("sally");
  expect(results.length).toBe(1);
  expect(results.first.name).toBe("Sally Smith");
});

test("The search fetches no certificates", async () => {
  let account = fakeAccount();
  let results = await search("bucksch", account);
  expect(account.actions).not.toContain("ResolveNames");
  expect(results.first.encryptionPublicKeys.length).toBe(0);
});

test("Read the `userCertificate` of the person that the user picked", async () => {
  let account = fakeAccount();
  let person = (await search("bucksch", account)).first;
  account.actions = [];
  await person.fetchEncryptionKeys();
  expect(account.actions).toEqual(["ResolveNames"]);
  let key = person.encryptionPublicKeys.first;
  expect(key).toBeInstanceOf(SMIMEPublicKey);
  expect(key.userIDs.first).toBe(kCertificateEmailAddress);
});

test("Prefer `userSMIMECertificate` over `userCertificate`, as RFC 2798 says", async () => {
  let account = fakeAccount(
    { "ben@example.com": [kCertificate] },
    { "ben@example.com": [kSMIMECertificate] });
  let person = (await search("bucksch", account)).first;
  await person.fetchEncryptionKeys();
  expect(person.encryptionPublicKeys.length).toBe(1);
  let key = person.encryptionPublicKeys.first as SMIMEPublicKey;
  expect(key.userIDs.first).toBe(kSMIMECertificateEmailAddress);
  expect(key.chain.length).toBe(1); // the CA which issued the certificate
});

test("Person without a certificate in the GAL", async () => {
  let person = (await search("smith")).first;
  expect(person.name).toBe("Sally Smith");
  await person.fetchEncryptionKeys();
  expect(person.encryptionPublicKeys.length).toBe(0);
});

test("Search term which matches no GAL entry at all", async () => {
  let account = fakeAccount();
  account.callOWA = async () => ({ ResultSet: [] });
  expect((await search("nobody", account)).length).toBe(0);
});

test("Certificates are optional, and their failure does not disturb the user", async () => {
  let errors: Error[] = [];
  let account = fakeAccount();
  let findPeople = account.callOWA;
  account.errorCallback = (ex: Error) => errors.push(ex);
  account.callOWA = async function(request: any) {
    if (request.action == "ResolveNames") {
      throw new Error("The operation is not supported");
    }
    return await findPeople.call(this, request);
  };
  let person = (await search("bucksch", account)).first;
  await person.fetchEncryptionKeys();
  expect(person.encryptionPublicKeys.length).toBe(0);
  expect(errors.map(ex => ex.message)).toEqual(["The operation is not supported"]);
});

test("The person is no longer in the GAL", async () => {
  let account = fakeAccount();
  let findPeople = account.callOWA;
  account.callOWA = async function(request: any) {
    if (request.action == "ResolveNames") {
      throw { type: "ErrorNameResolutionNoResults" }; // expected, and not an error for us
    }
    return await findPeople.call(this, request);
  };
  let person = (await search("bucksch", account)).first;
  await person.fetchEncryptionKeys(); // the error callback would throw
  expect(person.encryptionPublicKeys.length).toBe(0);
});
