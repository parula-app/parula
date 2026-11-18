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

function setup() {
  let account = new JMAPAccount();
  account.accountID = "a";
  account.login = async () => {};
  let addressbook = new JMAPAddressbook();
  addressbook.initFromMainAccount(account);
  addressbook.jmapID = "c";
  addressbook.storage = { savePerson: async () => {}, saveAddressbook: async () => {} } as any;
  addressbook.readContactsFromDB = async () => {};
  account.makeCombinedCall = async () => ({
    persons: {
      accountId: "a", state: "s9", notFound: [],
      list: [{ "@type": "Card", version: "1.0", uid: "urn:uuid:3b1e5a7c-0d2f-4a8e-9b6c-1f2e3d4c5b6a", name: { full: "In C" }, id: "x", addressBookIds: { c: true } } as any as TJMAPContact],
    },
  });
  return { account, addressbook };
}

test("Listing a second address book keeps the older state of the account", async () => {
  // A new contact in the first address book since "s1" would otherwise never be fetched
  let { account, addressbook } = setup();
  account.syncState.set("ContactCard", "s1");
  await (addressbook as any).listAllPersons();
  expect(addressbook.persons.contents.map(p => p.name)).toEqual(["In C"]);
  expect(account.syncState.get("ContactCard")).toBe("s1");
});

test("Listing the first address book sets the state", async () => {
  let { account, addressbook } = setup();
  await (addressbook as any).listAllPersons();
  expect(account.syncState.get("ContactCard")).toBe("s9");
});
