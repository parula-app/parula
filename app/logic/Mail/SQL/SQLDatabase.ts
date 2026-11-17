import { mailDatabaseSchema, emailPIDIndex } from "./createDatabase";
import { createFolderIDDateSentIndex, addEMailStatusColumns } from "./SQLEMailMigrate";
import sql, { type Database } from "../../../../lib/rs-sqlite/index";
import { getSQLiteDatabase } from "../../util/backend-wrapper";
import { RunOnce } from "../../util/flow/RunOnce";

// <copied from="Mail/SQL/Account/SQLDatabase.ts">

let mailDatabase: Database;
let openRunOnce = new RunOnce<Database>();

export async function getDatabase(): Promise<Database> {
  return mailDatabase ?? await openRunOnce.runOnce(async () => {
    let db = await getSQLiteDatabase("mail.db");
    await db.migrate(mailDatabaseSchema, createFolderIDDateSentIndex, addEMailStatusColumns, emailPIDIndex);
    await db.pragma('foreign_keys = true');
    await db.pragma('journal_mode = WAL');
    return mailDatabase = db;
  });
}

/**
 * Creates a new database for testing only, in a different file,
 * and lets getDatabase() from now on return that test database,
 * until the process is shut down.
 */
export async function makeTestDatabase(): Promise<Database> {
  mailDatabase = await getSQLiteDatabase("test-mail.db");
  await deleteDatabase();
  await mailDatabase.migrate(mailDatabaseSchema);
  await mailDatabase.pragma('foreign_keys = true');
  await mailDatabase.pragma('journal_mode = WAL');
  return mailDatabase;
}

export async function deleteDatabase(): Promise<void> {
  let tables = await mailDatabase.all(sql`SELECT name FROM sqlite_schema WHERE type='table'`) as any[];
  for (let row of tables) {
    let table = row.name;
    if (table?.startsWith("sqlite_")) {
      continue;
    }
    await mailDatabase.execute(sql`DROP TABLE IF EXISTS ${table};`);
  }
  await mailDatabase.pragma('user_version = 0');
  (mailDatabase as any).close();
  mailDatabase = null;
}
