// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import type { ChatAccountStorage } from "../../../../logic/Chat/ChatAccount";
import { SQLChatStorage } from "../../../../logic/Chat/SQL/SQLChatStorage";
import { makeTestDatabase } from "../../../../logic/Chat/SQL/SQLDatabase";
import { SQLAccount } from "../../../../logic/Mail/SQL/Account/SQLAccount";
import { SQLPerson } from "../../../../logic/Contacts/SQL/SQLPerson";
import { SQLGroup } from "../../../../logic/Contacts/SQL/SQLGroup";
import { Addressbook } from "../../../../logic/Contacts/Addressbook";
import { DummyAddressbookStorage } from "../../../../logic/Contacts/SQL/DummyAddressbookStorage";
import { InProcessSQLiteDatabase } from "../../util/inProcessSQLite";
import type { Person } from "../../../../logic/Abstract/Person";
import type { Group } from "../../../../logic/Abstract/Group";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** The backend's own SQLite. Its native module loads only when the system Node
 * ABI matches the one it was built for (the Electron backend build), so it may
 * be unavailable. Only for the tests that set up their own `remoteApp`;
 * `setupChatTestEnv()` uses Node's built-in SQLite, which always loads. */
export let Database: any = null;
try {
  // @ts-ignore No types for the .mjs build
  ({ Database } = await import("../../../../../desktop/backend/node_modules/@radically-straightforward/sqlite/build/index.mjs"));
  new Database(":memory:").close(); // the native module loads lazily, on first use
} catch (ex) {
  Database = null; // the tests that need it skip themselves
}

/** Sets up DB, address book, and stubs for things not under test. */
export async function setupChatTestEnv(): Promise<void> {
  let tempDir = mkdtempSync(path.join(tmpdir(), "xmpp-test-"));
  appGlobal.remoteApp = {
    getSQLiteDatabase: (filename: string) =>
      new InProcessSQLiteDatabase(path.join(tempDir, filename)),
  };
  await makeTestDatabase();

  // Contacts and the accounts DB are not part of these tests
  let personDbID = 0;
  let groupDbID = 0;
  SQLPerson.save = async (person: Person) => { person.dbID ??= ++personDbID; };
  SQLGroup.save = async (group: Group) => { group.dbID ??= ++groupDbID; };
  SQLAccount.save = async () => {};

  let addressbook = new Addressbook();
  addressbook.name = "Test addressbook";
  addressbook.storage = new DummyAddressbookStorage();
  addressbook.dbID = 1;
  appGlobal.addressbooks.add(addressbook);
  appGlobal.personalAddressbook = addressbook;
  appGlobal.collectedAddressbook = addressbook;
}

export function newChatStorage(): ChatAccountStorage {
  return new SQLChatStorage();
}
