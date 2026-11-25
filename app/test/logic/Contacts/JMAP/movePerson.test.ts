// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { JMAPAddressbook } from "../../../../logic/Contacts/JMAP/JMAPAddressbook";
import type { JMAPPerson } from "../../../../logic/Contacts/JMAP/JMAPPerson";
import type { TJMAPContact } from "../../../../logic/Contacts/JMAP/TJSContact";
import { beforeAll, expect, test } from "vitest";

beforeAll(() => {
  appGlobal.remoteApp ??= {
    kyCreate: () => { throw new Error("The test should not talk to a real server"); },
  } as any;
});

/** A card as Stalwart returns it, from a vCard with birthday */
function serverCard(): TJMAPContact {
  return {
    "@type": "Card",
    version: "1.0",
    uid: "urn:uuid:3b1e5a7c-0d2f-4a8e-9b6c-1f2e3d4c5b6a",
    name: { full: "Jane Doe", isOrdered: true },
    anniversaries: { k1: { kind: "birth", date: { "@type": "PartialDate", year: 1980, month: 3, day: 15 } } },
    id: "cardID",
    addressBookIds: { b: true },
  } as any as TJMAPContact;
}

function newAddressbook(account: JMAPAccount, jmapID: string): JMAPAddressbook {
  let addressbook = new JMAPAddressbook();
  addressbook.initFromMainAccount(account);
  addressbook.jmapID = jmapID;
  addressbook.dbID = jmapID.charCodeAt(0);
  addressbook.storage = { savePerson: async () => {}, deletePerson: async () => {} } as any;
  return addressbook;
}

function newAccount(accountID: string, calls: [string, any][]): JMAPAccount {
  let account = new JMAPAccount();
  account.accountID = accountID;
  account.makeSingleCall = async (method: string, args: any) => {
    calls.push([method, args]);
    if (args.create) {
      return { accountId: accountID, created: { [Object.keys(args.create)[0]]: { id: "newCardID" } } };
    }
    if (method == "ContactCard/get") {
      return { accountId: accountID, state: "s1", list: [serverCard()], notFound: [] };
    }
    return { accountId: accountID, updated: { cardID: null }, destroyed: args.destroy };
  };
  return account;
}

/** The card's address books on the server after our `ContactCard/set` calls */
function addressBookIdsAfter(calls: [string, any][], addressBookIds: Record<string, boolean>): Record<string, boolean> {
  let result = { ...addressBookIds };
  for (let [method, args] of calls.filter(([method]) => method == "ContactCard/set")) {
    let patch = args.update?.cardID ?? {};
    if (patch.addressBookIds) {
      result = { ...patch.addressBookIds };
    }
    for (let [path, value] of Object.entries(patch)) {
      if (path.startsWith("addressBookIds/")) {
        let id = path.slice("addressBookIds/".length);
        value ? result[id] = true : delete result[id];
      }
    }
  }
  return result;
}

test("Moving a contact to another address book of the same account keeps the card", async () => {
  let calls: [string, any][] = [];
  let account = newAccount("a", calls);
  let from = newAddressbook(account, "b");
  let to = newAddressbook(account, "c");
  let person = from.newPerson();
  person.fromJMAP(serverCard());
  from.persons.add(person);

  let moved = await person.moveToAddressbook(to) as JMAPPerson;

  // The same card, not a copy: nothing created, nothing destroyed
  expect(calls.some(([, args]) => args.create || args.destroy?.length)).toBe(false);
  expect(addressBookIdsAfter(calls, { b: true })).toEqual({ c: true });
  expect(moved.jmapID).toBe("cardID");
  expect(from.persons.contents).toEqual([]);
  expect(to.persons.contents.map(p => (p as JMAPPerson).jmapID)).toEqual(["cardID"]);

  // A later save must not put it back into the old address book
  await moved.saveToServer();
  expect(addressBookIdsAfter(calls, { b: true })).toEqual({ c: true });
});

test("Moving a contact to another account copies it", async () => {
  let calls: [string, any][] = [];
  let from = newAddressbook(newAccount("a", calls), "b");
  let to = newAddressbook(newAccount("x", calls), "c");
  let person = from.newPerson();
  person.fromJMAP(serverCard());
  from.persons.add(person);

  let moved = await person.moveToAddressbook(to);

  expect(calls.map(([method, args]) => [method, args.accountId])).toContainEqual(["ContactCard/set", "x"]);
});
