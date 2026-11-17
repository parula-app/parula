import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { JMAPAddressbook } from "../../../../logic/Contacts/JMAP/JMAPAddressbook";
import type { TJMAPContact } from "../../../../logic/Contacts/JMAP/JMAPPerson";
import { beforeAll, expect, test } from "vitest";

beforeAll(() => {
  appGlobal.remoteApp ??= {
    kyCreate: () => { throw new Error("The test should not talk to a real server") },
  } as any;
});

const kOldState = "stateFromLastTime";
const kNewState = "stateNow";

/** A method error, as `makeCalls()` reports it */
function serverError(code: string): Error {
  let ex = new Error("The server cannot calculate the changes between the old and new states.");
  Object.assign(ex, { code });
  return ex;
}

function serverCard(): TJMAPContact {
  return {
    "@type": "Card",
    version: "1.0",
    id: "cardID",
    uid: "server-uid",
    name: { full: "Jane Doe" },
    emails: { "0": { address: "jane@example.com" } },
    addressBookIds: { addressbookID: true },
  } as any as TJMAPContact;
}

/** A JMAP address book whose `ContactCard/changes` call fails with `failWith` */
function setup(failWith: Error) {
  let account = new JMAPAccount();
  account.accountID = "jmapAccount";
  account.syncState.set("ContactCard", kOldState);
  account.save = async () => {};
  let addressbook = new JMAPAddressbook();
  addressbook.initFromMainAccount(account);
  addressbook.jmapID = "addressbookID";
  addressbook.storage = { savePerson: async () => {}, saveAddressbook: async () => {} } as any;
  addressbook.errorCallback = ex => { throw ex };

  let methodsCalled: string[] = [];
  account.makeCombinedCall = async (calls: [string, Record<string, any>, string?][]) => {
    methodsCalled.push(calls[0][0]);
    if (calls[0][0] == "ContactCard/changes") {
      throw failWith;
    }
    return {
      persons: {
        accountId: account.accountID,
        state: kNewState,
        list: [serverCard()],
        notFound: [],
      },
    };
  };
  return { addressbook, account, methodsCalled };
}

test("A sync state that the server cannot use starts a full listing", async () => {
  let { addressbook, account, methodsCalled } = setup(serverError("cannotCalculateChanges"));

  let persons = await (addressbook as any).listChangedPersons();

  expect(methodsCalled).toEqual(["ContactCard/changes", "ContactCard/query"]);
  expect(persons.length).toBe(1);
  expect(account.syncState.get("ContactCard")).toBe(kNewState);
});

test("Another server error is reported, and the sync state kept", async () => {
  let { addressbook, account, methodsCalled } = setup(serverError("accountNotFound"));

  await expect((addressbook as any).listChangedPersons()).rejects.toThrow();

  expect(methodsCalled).toEqual(["ContactCard/changes"]);
  expect(account.syncState.get("ContactCard")).toBe(kOldState);
});
