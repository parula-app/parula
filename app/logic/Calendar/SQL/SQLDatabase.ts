import sql, { type Database } from "../../../../lib/rs-sqlite/index";
import { calendarDatabaseSchema } from "./createDatabase";
import { addEventAttachmentTable, removeDuplicateEvents } from "./SQLEventMigrate";
import { getSQLiteDatabase } from "../../util/backend-wrapper";
import { RunOnce } from "../../util/flow/RunOnce";

// <copied from="Mail/SQL/Account/SQLDatabase.ts">

let calendarDatabase: Database;
let openRunOnce = new RunOnce<Database>();

export async function getDatabase(): Promise<Database> {
  return calendarDatabase ?? await openRunOnce.runOnce(async () => {
    let db = await getSQLiteDatabase("calendar.db");
    await db.migrate(calendarDatabaseSchema, addEventAttachmentTable, removeDuplicateEvents);
    await db.pragma('foreign_keys = true');
    await db.pragma('journal_mode = WAL');
    return calendarDatabase = db;
  });
}

/**
 * Creates a new database for testing only, in a different file,
 * and lets getDatabase() from now on return that test database,
 * until the process is shut down.
 */
export async function makeTestDatabase(): Promise<Database> {
  calendarDatabase = await getSQLiteDatabase("test-calendar.db");
  await deleteDatabase();
  await calendarDatabase.migrate(calendarDatabaseSchema, addEventAttachmentTable, removeDuplicateEvents);
  await calendarDatabase.pragma('foreign_keys = true');
  return calendarDatabase;
}

export async function deleteDatabase(): Promise<void> {
  let tables = await calendarDatabase.all(sql`SELECT name FROM sqlite_schema WHERE type='table'`) as any[];
  for (let row of tables) {
    let table = row.name;
    if (table?.startsWith("sqlite_")) {
      continue;
    }
    await calendarDatabase.execute(sql`DROP TABLE IF EXISTS ${table};`);
  }
  await calendarDatabase.pragma('user_version = 0');
  (calendarDatabase as any).close();
  calendarDatabase = null;
}
