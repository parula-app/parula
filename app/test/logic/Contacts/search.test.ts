// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import { appGlobal } from "../../../logic/app";
import { SearchOnlyAddressbook } from "../../../logic/Contacts/Addressbook";
import { searchContacts } from "../../../logic/Contacts/Search";
import type { Person } from "../../../logic/Abstract/Person";
import type { ArrayColl } from "svelte-collections";
import { beforeEach, expect, test } from "vitest";

let searchCount = 0;

/** Stands in for the Exchange GAL: every search costs a server round trip */
class TestGAL extends SearchOnlyAddressbook {
  readonly protocol: string = "gal-test";
  async quickSearchAsync(searchTerm: string, results: ArrayColl<Person>) {
    searchCount++;
  }
}

/** The user typing a name, one search per keypress */
async function typeName(name: string) {
  for (let i = 2; i <= name.length; i++) {
    await searchContacts(name.substring(0, i), () => false);
  }
}

/** The searches are started synchronously, but run async */
async function settle() {
  await new Promise(resolve => setTimeout(resolve, 100));
}

beforeEach(async () => {
  appGlobal.searchOnlyAddressbooks.clear();
  await settle();
  searchCount = 0;
});

test("One server request per keypress", async () => {
  appGlobal.searchOnlyAddressbooks.add(new TestGAL());
  await typeName("Bernhard Krause");
  await settle();
  expect(searchCount).toBe("Bernhard Krause".length - 1);
});

test("Adding or removing a GAL does not re-run the earlier searches", async () => {
  let gal = new TestGAL();
  appGlobal.searchOnlyAddressbooks.add(gal);
  await typeName("Bernhard Krause");
  await settle();

  // E.g. the account logged in again after the network came back
  searchCount = 0;
  appGlobal.searchOnlyAddressbooks.remove(gal);
  appGlobal.searchOnlyAddressbooks.add(new TestGAL());
  await settle();
  expect(searchCount).toBe(0);
});
