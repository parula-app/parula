// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { JMAPAddressbook } from "../../../../logic/Contacts/JMAP/JMAPAddressbook";
import type { TJMAPContact } from "../../../../logic/Contacts/JMAP/TJSContact";
import { ArrayColl } from "svelte-collections";
import { beforeAll, expect, test } from "vitest";

beforeAll(() => {
  appGlobal.remoteApp ??= {
    kyCreate: () => { throw new Error("The test should not talk to a real server"); },
  } as any;
});

function card(id: string): TJMAPContact {
  return {
    "@type": "Card", version: "1.0", uid: "urn:uuid:" + id, name: { full: "Contact " + id },
    id, addressBookIds: { b: true },
  } as any as TJMAPContact;
}

/** An address book on a server that answers every `ContactCard/query` + `get` with `page(position, limit)` */
function setup(page: (position: number, limit: number) => TJMAPContact[]) {
  let account = new JMAPAccount();
  account.accountID = "a";
  account.login = async () => {};
  let addressbook = new JMAPAddressbook();
  addressbook.initFromMainAccount(account);
  addressbook.name = "Hostile";
  addressbook.jmapID = "b";
  addressbook.storage = { savePerson: async () => {}, saveGroup: async () => {}, saveAddressbook: async () => {} } as any;
  addressbook.readContactsFromDB = async () => {};
  let errors: Error[] = [];
  addressbook.errorCallback = ex => errors.push(ex);
  let requests = 0;
  account.makeCombinedCall = async (calls: [string, Record<string, any>, string?][]) => {
    requests++;
    let { position, limit } = calls[0][1];
    return { persons: { accountId: "a", state: "s1", list: page(position, limit), notFound: [] } };
  };
  return { addressbook, errors, requests: () => requests };
}

test("A server that always returns a full page doesn't make us loop forever", async () => {
  // Always new contacts, always one more than a page, so there's always "more"
  let { addressbook, errors, requests } = setup((position, limit) =>
    Array.from({ length: limit }, (_, i) => card("c" + (position + i))));
  // Not the 200,000 persons, only the loop is tested here
  (addressbook as any).parsePersonsList = () => ({ newPersons: new ArrayColl(), updatedPersons: new ArrayColl() });

  await addressbook.listContacts();

  // Stops at some sane limit, and says so
  expect(requests()).toBeLessThanOrEqual(10000);
  expect(errors.length).toBeGreaterThan(0);
});

test("A server that ignores the position and returns the same page again", async () => {
  let { addressbook, errors, requests } = setup((position, limit) =>
    Array.from({ length: limit }, (_, i) => card("c" + i)));

  await addressbook.listContacts();

  expect(requests()).toBeLessThan(10);
  expect(errors.length).toBeGreaterThan(0);
});

test("A normal address book is listed completely, also an empty one", async () => {
  let all = Array.from({ length: 450 }, (_, i) => card("c" + i));
  let { addressbook, errors, requests } = setup((position, limit) => all.slice(position, position + limit));
  await addressbook.listContacts();
  expect(addressbook.persons.length).toBe(450);
  expect(errors).toEqual([]);

  let empty = setup(() => []);
  await empty.addressbook.listContacts();
  expect(empty.addressbook.persons.length).toBe(0);
  expect(empty.errors).toEqual([]);
});
