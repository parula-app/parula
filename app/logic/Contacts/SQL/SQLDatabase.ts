import sql, { type Database } from "../../../../lib/rs-sqlite/index";
import { contactsDatabaseSchema } from "./createDatabase";
import { getSQLiteDatabase } from "../../util/backend-wrapper";
import { RunOnce } from "../../util/flow/RunOnce";

// <copied from="Mail/SQL/Account/SQLDatabase.ts">

let contactsDatabase: Database;
let openRunOnce = new RunOnce<Database>();

export async function getDatabase(): Promise<Database> {
  return contactsDatabase ?? await openRunOnce.runOnce(async () => {
    let db = await getSQLiteDatabase("contacts.db");
    await db.migrate(contactsDatabaseSchema);
    await db.pragma('foreign_keys = true');
    await db.pragma('journal_mode = WAL');
    return contactsDatabase = db;
  });
}

/**
 * Creates a new database for testing only, in a different file,
 * and lets getDatabase() from now on return that test database,
 * until the process is shut down.
 */
export async function makeTestDatabase(): Promise<Database> {
  contactsDatabase = await getSQLiteDatabase("test-contacts.db");
  await deleteDatabase(); // closes the database
  contactsDatabase = await getSQLiteDatabase("test-contacts.db");
  await contactsDatabase.migrate(contactsDatabaseSchema);
  await contactsDatabase.pragma('foreign_keys = true');
  return contactsDatabase;
}

export async function deleteDatabase(): Promise<void> {
  let tables = await contactsDatabase.all(sql`SELECT name FROM sqlite_schema WHERE type='table'`) as any[];

  // REFERENCES causes "Table 'person' does not exist" when deleting table 'groupp',
  // due to groupMember referencing both tables and person being deleted first
  await contactsDatabase.execute(sql`DROP TABLE IF EXISTS groupMember;`);

  for (let row of tables) {
    let table = row.name;
    if (table?.startsWith("sqlite_")) {
      continue;
    }
    await contactsDatabase.execute(sql`DROP TABLE IF EXISTS ${table};`);
  }
  await contactsDatabase.pragma('user_version = 0');
  (contactsDatabase as any).close();
  contactsDatabase = null;
}
