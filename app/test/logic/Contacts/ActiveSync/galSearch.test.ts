// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { ActiveSyncGAL } from "../../../../logic/Contacts/ActiveSync/ActiveSyncGAL";
import type { ActiveSyncPerson } from "../../../../logic/Contacts/ActiveSync/ActiveSyncPerson";
import { request2WBXML, WBXML2JSON } from "../../../../logic/Mail/ActiveSync/WBXML";
import { SMIMEPublicKey } from "../../../../logic/Mail/Encryption/SMIME/SMIMEPublicKey";
import { kCertificate, kCertificateEmailAddress } from "../testCertificate";
import { addSMIMEIdentities } from "../smimeIdentities";
import { ArrayColl } from "svelte-collections";
import { expect, test } from "vitest";

const kPersons = [{
  DisplayName: "Ben Bucksch",
  FirstName: "Ben",
  LastName: "Bucksch",
  EmailAddress: "Ben@Example.com", // the GAL and the resolver may differ in case
  Company: "Beonex",
}, {
  DisplayName: "Sally Smith",
  FirstName: "Sally",
  LastName: "Smith",
  EmailAddress: "sally@example.com",
}];

/** An account stub which searches the GAL like Exchange does: Without routing type
 * prefix, it matches the start of the names, with an `smtp:` prefix, the start of
 * the email address. It returns the certificates for the recipients listed in
 * `certificates`. */
function fakeAccount(certificates: Record<string, string[]> = { "ben@example.com": [kCertificate] }): any {
  return {
    errorCallback: (ex: Error) => { throw ex; },
    commands: [] as string[],
    async callEAS(command: string, query: any) {
      this.commands.push(command);
      this.lastQuery = query;
      if (command == "Search") {
        return {
          Status: "1",
          Response: {
            Store: {
              Status: "1",
              Result: matching(query.Store.Query).map(person => ({ Properties: { ...person } })),
              Total: String(matching(query.Store.Query).length),
            },
          },
        };
      }
      expect(command).toBe("ResolveRecipients");
      return {
        Status: "1",
        Response: {
          To: query.To,
          Status: "1",
          RecipientCount: String(kPersons.length),
          Recipient: kPersons.map(person => ({
            Type: "1",
            DisplayName: person.DisplayName,
            EmailAddress: person.EmailAddress.toLowerCase(),
            Certificates: certificates[person.EmailAddress.toLowerCase()]
              ? {
                Status: "1",
                CertificateCount: String(certificates[person.EmailAddress.toLowerCase()].length),
                Certificate: certificates[person.EmailAddress.toLowerCase()],
              }
              // Status 7 means that the recipient has no certificate
              : { Status: "7", CertificateCount: "0" },
          })),
        },
      };
    },
  };
}

function matching(searchTerm: string): typeof kPersons {
  let term = searchTerm.toLowerCase();
  return term.startsWith("smtp:")
    ? kPersons.filter(person => person.EmailAddress.toLowerCase().startsWith(term.slice("smtp:".length)))
    : kPersons.filter(person => [person.DisplayName, person.FirstName, person.LastName]
      .some(field => field.toLowerCase().startsWith(term)));
}

/** As the composer and the calendar use it: our identity is in `example.com` and has an S/MIME certificate */
async function search(searchTerm: string, account = fakeAccount()): Promise<ArrayColl<ActiveSyncPerson>> {
  addSMIMEIdentities(account, "me@example.com");
  let gal = new ActiveSyncGAL(account);
  appGlobal.searchOnlyAddressbooks.clear();
  appGlobal.searchOnlyAddressbooks.add(gal);
  let results = new ArrayColl<ActiveSyncPerson>();
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
  expect(account.commands).not.toContain("ResolveRecipients");
  expect(results.first.encryptionPublicKeys.length).toBe(0);
});

test("Read the S/MIME certificate of the person that the user picked", async () => {
  let account = fakeAccount();
  let person = (await search("bucksch", account)).first;
  account.commands = [];
  await person.fetchEncryptionKeys();
  expect(account.commands).toEqual(["ResolveRecipients"]);
  expect(account.lastQuery.To).toBe(person.emailAddresses.first.value);
  expect(account.lastQuery.Options.CertificateRetrieval).toBe("2");
  let key = person.encryptionPublicKeys.first;
  expect(key).toBeInstanceOf(SMIMEPublicKey);
  expect(key.userIDs.first).toBe(kCertificateEmailAddress);
});

test("Person without a certificate in the GAL", async () => {
  let person = (await search("smith")).first;
  expect(person.name).toBe("Sally Smith");
  await person.fetchEncryptionKeys();
  expect(person.encryptionPublicKeys.length).toBe(0);
});

test("Certificates are optional, and their failure does not disturb the user", async () => {
  let errors: Error[] = [];
  let account = fakeAccount();
  account.errorCallback = (ex: Error) => errors.push(ex);
  account.callEAS = async function(command: string, query: any) {
    if (command == "ResolveRecipients") {
      throw new Error("Command not supported");
    }
    return await fakeAccount().callEAS.call(this, command, query);
  };
  let person = (await search("bucksch", account)).first;
  await person.fetchEncryptionKeys();
  expect(person.encryptionPublicKeys.length).toBe(0);
  expect(errors.map(ex => ex.message)).toEqual(["Command not supported"]);
});

test("ResolveRecipients survives the WBXML round trip", async () => {
  let request = {
    ResolveRecipients: {
      To: "ben@example.com",
      Options: {
        CertificateRetrieval: "2",
        MaxCertificates: "10",
        MaxAmbiguousRecipients: "10",
      },
    },
  };
  expect(WBXML2JSON(new Uint8Array(await request2WBXML(request)))).toEqual(request.ResolveRecipients);

  let response = {
    ResolveRecipients: {
      Status: "1",
      Response: {
        To: "ben@example.com",
        Status: "1",
        RecipientCount: "1",
        Recipient: {
          Type: "1",
          DisplayName: "Ben Bucksch",
          EmailAddress: "ben@example.com",
          Certificates: {
            Status: "1",
            CertificateCount: "1",
            Certificate: kCertificate,
          },
        },
      },
    },
  };
  expect(WBXML2JSON(new Uint8Array(await request2WBXML(response)))).toEqual(response.ResolveRecipients);
});
