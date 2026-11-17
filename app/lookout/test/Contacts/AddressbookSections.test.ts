import { AddressbookSections } from "../../Contacts/AddressbookSections";
import type { Addressbook } from "../../../logic/Contacts/Addressbook";
import type { Account } from "../../../logic/Abstract/Account";
import { expect, test } from "vitest";

// Only `name` and `mainAccount` matter, so plain objects stand in for the accounts
function account(name: string): Account {
  return { name } as Account;
}
function addressbook(name: string, mainAccount: Account | null = null): Addressbook {
  return { name, mainAccount } as Addressbook;
}

test("Groups address books by their account", () => {
  let work = account("work@example.com");
  let home = account("home@example.com");
  let personal = addressbook("Personal");
  let collected = addressbook("Collected addresses");
  let workContacts = addressbook("Contacts", work);
  let workShared = addressbook("Shared", work);
  let homeContacts = addressbook("Contacts", home);
  let { sections } = new AddressbookSections([personal, workContacts, homeContacts, collected, workShared]);

  expect(sections.map(section => section.mainAccount)).toEqual([null, work, home]);
  expect(sections[0].addressbooks).toEqual([personal, collected]);
  expect(sections[1].addressbooks).toEqual([workContacts, workShared]);
  expect(sections[2].addressbooks).toEqual([homeContacts]);
});

test("No section for address books without account, if there are none", () => {
  let work = account("work@example.com");
  let { sections } = new AddressbookSections([addressbook("Contacts", work)]);
  expect(sections.length).toBe(1);
  expect(sections[0].mainAccount).toBe(work);
});

test("No address books", () => {
  expect(new AddressbookSections([]).sections).toEqual([]);
});
