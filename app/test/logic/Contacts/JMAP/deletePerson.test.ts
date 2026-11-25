// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { JMAPAddressbook } from "../../../../logic/Contacts/JMAP/JMAPAddressbook";
import type { TJMAPContact } from "../../../../logic/Contacts/JMAP/TJSContact";
import { beforeAll, expect, test } from "vitest";

beforeAll(() => {
  appGlobal.remoteApp ??= {
    kyCreate: () => { throw new Error("The test should not talk to a real server"); },
  } as any;
});

/** A card as Stalwart returns it */
function serverCard(addressBookIds: Record<string, boolean>): TJMAPContact {
  return {
    "@type": "Card",
    version: "1.0",
    uid: "urn:uuid:3b1e5a7c-0d2f-4a8e-9b6c-1f2e3d4c5b6a",
    name: { full: "Jane Doe", isOrdered: true },
    id: "cardID",
    addressBookIds,
  } as any as TJMAPContact;
}

/** The address book "b", with Jane, whose card on the server is in `addressBookIds` */
function setup(addressBookIds: Record<string, boolean>, setResponse: any = null) {
  let account = new JMAPAccount();
  account.accountID = "a";
  let addressbook = new JMAPAddressbook();
  addressbook.initFromMainAccount(account);
  addressbook.jmapID = "b";
  addressbook.storage = { deletePerson: async () => {} } as any;
  let person = addressbook.newPerson();
  person.fromJMAP(serverCard({ b: true }));
  addressbook.persons.add(person);

  let calls: [string, any][] = [];
  account.makeSingleCall = async (method: string, args: any) => {
    calls.push([method, args]);
    if (method == "ContactCard/get") {
      return { accountId: "a", state: "s1", list: [serverCard(addressBookIds)], notFound: [] };
    }
    return setResponse ?? { accountId: "a", oldState: "s1", newState: "s2", updated: { cardID: null }, destroyed: ["cardID"] };
  };
  return { person, calls };
}

/** What the server has after our `ContactCard/set` calls: the card's address books, or null if destroyed */
function onServerAfter(calls: [string, any][], addressBookIds: Record<string, boolean>): Record<string, boolean> | null {
  let result = { ...addressBookIds };
  for (let [method, args] of calls.filter(([method]) => method == "ContactCard/set")) {
    if (args.destroy?.includes("cardID")) {
      return null;
    }
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

test("Deleting a contact that is also in another address book removes it only from this one", async () => {
  let { person, calls } = setup({ b: true, c: true });
  await person.deleteIt();
  expect(onServerAfter(calls, { b: true, c: true })).toEqual({ c: true });
});

test("Deleting a contact that is only in this address book destroys it", async () => {
  let { person, calls } = setup({ b: true });
  await person.deleteIt();
  expect(onServerAfter(calls, { b: true })).toBeNull();
});

test("A deletion that the server refuses is an error", async () => {
  let { person } = setup({ b: true }, {
    accountId: "a", oldState: "s1", newState: "s1",
    notDestroyed: { cardID: { type: "forbidden", description: "You are not allowed to modify this address book." } },
  });
  await expect(person.deleteIt()).rejects.toThrow();
});
