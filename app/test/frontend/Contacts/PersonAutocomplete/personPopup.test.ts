// @vitest-environment happy-dom
import { appGlobal } from "../../../../logic/app";
import { PersonUID } from "../../../../logic/Abstract/PersonUID";
import { Addressbook } from "../../../../logic/Contacts/Addressbook";
import { getDatabase } from "../../../../logic/Contacts/SQL/SQLDatabase";
import { SQLAddressbookStorage } from "../../../../logic/Contacts/SQL/SQLAddressbookStorage";
import PersonEntry from "../../../../frontend/Contacts/PersonAutocomplete/PersonEntry.svelte";
import { InProcessSQLiteDatabase } from "../../../logic/util/inProcessSQLite";
import { flushSync, mount, unmount } from "svelte";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import sql from "../../../../../lib/rs-sqlite";

const kEMailAddress = "fred@example.com";
const kGuessedName = "Fred";
const kRealName = "Frederic Smith";

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  let tempDir = mkdtempSync(path.join(tmpdir(), "person-popup-test-"));
  appGlobal.remoteApp = {
    getSQLiteDatabase: (filename: string) =>
      new InProcessSQLiteDatabase(path.join(tempDir, filename)),
  } as any;
});

beforeEach(async () => {
  appGlobal.addressbooks.clear();
  appGlobal.personalAddressbook = await createAddressbook("Personal");
  appGlobal.collectedAddressbook = await createAddressbook("Collected");
});

async function createAddressbook(name: string): Promise<Addressbook> {
  let addressbook = new Addressbook();
  addressbook.name = name;
  addressbook.storage = new SQLAddressbookStorage();
  let row = await (await getDatabase()).run(sql`
    INSERT INTO addressbook (idStr, protocol) VALUES (${addressbook.id}, ${"test"})`);
  addressbook.dbID = row.lastInsertRowid;
  appGlobal.addressbooks.add(addressbook);
  return addressbook;
}

/** What the collected address book has on disk */
async function savedName(): Promise<string> {
  let rows = await (await getDatabase()).all(sql`
    SELECT name FROM person WHERE addressbookID = ${appGlobal.collectedAddressbook.dbID}`);
  return rows.map(row => row.name).join(", ");
}

let entry: Record<string, any> | null = null;
let target: HTMLElement;

/** A recipient who is not in any address book yet */
async function addNewRecipient(): Promise<PersonUID> {
  let personUID = new PersonUID(kEMailAddress, kGuessedName);
  target = document.createElement("div");
  document.body.append(target);
  entry = mount(PersonEntry, { target, props: { person: personUID, onRemovePerson: () => {} } });
  flushSync();
  await settle();
  return personUID;
}

afterEach(() => {
  entry && unmount(entry);
  entry = null;
  document.body.innerHTML = "";
});

async function settle() {
  await new Promise(resolve => setTimeout(resolve, 0));
  flushSync();
}

function typeName(name: string) {
  let nameInputEl = document.body.querySelector<HTMLInputElement>(".person-popup input.name");
  nameInputEl.value = name;
  nameInputEl.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
}

async function clickElsewhere() {
  window.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await settle();
}

async function clickPill() {
  target.querySelector(".person").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await settle();
}

test("Saves the name that the user typed, when the popup closes", async () => {
  let personUID = await addNewRecipient();
  await clickPill();
  typeName(kRealName);

  await clickElsewhere();
  await settle();

  expect(personUID.person.name).toEqual(kRealName);
  expect(await savedName()).toEqual(kRealName);
});

test("Saves the name that the user typed after re-opening the popup", async () => {
  let personUID = await addNewRecipient();
  await clickPill();
  await clickElsewhere();
  await settle();

  await clickPill();
  typeName(kRealName);
  await clickElsewhere();
  await settle();

  expect(personUID.person.name).toEqual(kRealName);
  expect(await savedName()).toEqual(kRealName);
});

test("Saves the name that the user confirmed with ENTER", async () => {
  let personUID = await addNewRecipient();
  await clickPill();
  typeName(kRealName);

  document.body.querySelector(".person-popup input.name")
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await settle();

  expect(personUID.person.name).toEqual(kRealName);
  expect(await savedName()).toEqual(kRealName);
});
