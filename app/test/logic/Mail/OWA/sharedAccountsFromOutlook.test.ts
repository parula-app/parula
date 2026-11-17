// @vitest-environment happy-dom
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { expect, test } from "vitest";

/** Outlook on the web reads the accounts that the user added with
 * `GetOtherMailboxConfiguration`. The request is an empty JSON object. */
class TestOWAAccount extends OWAAccount {
  readonly requests: any[] = [];
  response: any;

  async callOWA(request: any): Promise<any> {
    this.requests.push({ action: request.action, body: JSON.stringify(request) });
    return this.response;
  }
}

function newTestAccount(response: any): TestOWAAccount {
  appGlobal.remoteApp ??= { OWA: {} } as any; // `OWAAccount` needs the backend only for the login
  let account = new TestOWAAccount();
  account.username = "alice@example.com";
  account.emailAddress = account.username;
  account.response = response;
  return account;
}

test("OWA: Offer the accounts that the user added in Outlook on the web", async () => {
  let account = newTestAccount({
    OtherMailboxEntries: [{
      DisplayName: "Shared Mailbox",
      PrincipalSMTPAddress: "shared@example.onmicrosoft.com",
    }, {
      DisplayName: "Bob Builder",
      PrincipalSMTPAddress: "Bob@Example.onmicrosoft.com",
    }],
  });

  let persons = await account.availableSharedAccounts();

  expect(persons.contents.map(person => person.emailAddress)).toEqual(["shared@example.onmicrosoft.com", "bob@example.onmicrosoft.com"]);
  expect(persons.contents.map(person => person.name)).toEqual(["Shared Mailbox", "Bob Builder"]);
  expect(account.requests).toEqual([{ action: "GetOtherMailboxConfiguration", body: "{}" }]);
});

test("OWA: Skip our own account and broken entries", async () => {
  let account = newTestAccount({
    OtherMailboxEntries: [{
      DisplayName: "Alice",
      PrincipalSMTPAddress: "alice@example.com",
    }, {
      DisplayName: "No address",
    }, {
      DisplayName: "Broken",
      PrincipalSMTPAddress: "not an address",
    }, {
      PrincipalSMTPAddress: "bob@example.com",
    }],
  });

  let persons = await account.availableSharedAccounts();

  expect(persons.contents.map(person => person.emailAddress)).toEqual(["bob@example.com"]);
  expect(persons.first.name).toBeUndefined();
});

test("OWA: The user never added an account in Outlook on the web", async () => {
  for (let response of [{ OtherMailboxEntries: [] }, {}]) {
    let account = newTestAccount(response);

    let persons = await account.availableSharedAccounts();

    expect(persons.length).toBe(0);
  }
});
