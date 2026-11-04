// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { JMAPAddressbook } from "../../../../logic/Contacts/JMAP/JMAPAddressbook";
import type { TJMAPContact } from "../../../../logic/Contacts/JMAP/JMAPPerson";
import { beforeAll, expect, test } from "vitest";

beforeAll(() => {
  appGlobal.remoteApp ??= {
    kyCreate: () => { throw new Error("The test should not talk to a real server"); },
  } as any;
});

/** A card as Stalwart returns it, created in the address book "empty" by another client */
function newCardInEmpty(): TJMAPContact {
  return {
    "@type": "Card",
    version: "1.0",
    uid: "urn:uuid:3b1e5a7c-0d2f-4a8e-9b6c-1f2e3d4c5b6a",
    name: { full: "In Empty", isOrdered: true },
    id: "x",
    addressBookIds: { empty: true },
  } as any as TJMAPContact;
}

function newAddressbook(account: JMAPAccount, jmapID: string): JMAPAddressbook {
  let addressbook = new JMAPAddressbook();
  addressbook.initFromMainAccount(account);
  addressbook.jmapID = jmapID;
  addressbook.storage = { savePerson: async () => {}, saveAddressbook: async () => {} } as any;
  addressbook.readContactsFromDB = async () => {};
  addressbook.errorCallback = ex => { throw ex; };
  return addressbook;
}

/** An account with an empty address book, both listed before. The server answers like Stalwart. */
function setup() {
  let account = new JMAPAccount();
  account.accountID = "a";
  account.save = async () => {};
  account.login = async () => {};
  account.syncState.set("ContactCard", "s1");
  let empty = newAddressbook(account, "empty");
  empty.syncState = "s1"; // listed: there was nothing in it
  let methodsCalled: string[] = [];
  account.makeCombinedCall = async (calls: [string, Record<string, any>, string?][]) => {
    methodsCalled.push(calls[0][0]);
    if (calls[0][0] == "ContactCard/changes") {
      return {
        changes: { accountId: "a", oldState: "s1", newState: "s2", hasMoreChanges: false, created: ["x"], updated: [], destroyed: [] },
        added: { accountId: "a", state: "s2", list: [newCardInEmpty()], notFound: [] },
        changed: { accountId: "a", state: "s2", list: [], notFound: [] },
      };
    }
    return {
      persons: { accountId: "a", state: "s2", list: [newCardInEmpty()], notFound: [] },
    };
  };
  appGlobal.addressbooks.add(empty);
  return { account, empty, methodsCalled };
}

test("A contact added elsewhere to an empty address book shows up on the next change sync", async () => {
  let { account, empty } = setup();

  await account.sync("ContactCard", "s2"); // what a push does

  expect(empty.persons.contents.map(p => p.name)).toEqual(["In Empty"]);
});

test("An empty address book that was listed before gets only the changes", async () => {
  let { empty, methodsCalled } = setup();

  await empty.listContacts();

  expect(methodsCalled).toEqual(["ContactCard/changes"]);
  expect(empty.persons.contents.map(p => p.name)).toEqual(["In Empty"]);
});

test("An address book that was never listed is listed completely", async () => {
  let { account, methodsCalled } = setup();
  let unlisted = newAddressbook(account, "empty");
  account.syncState.delete("ContactCard");

  await unlisted.listContacts();

  expect(methodsCalled).toEqual(["ContactCard/query"]);
  expect(unlisted.persons.contents.map(p => p.name)).toEqual(["In Empty"]);
  expect(unlisted.syncState).toBe("s2");
});
