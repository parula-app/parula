import sql, { type Database } from "../../../../lib/rs-sqlite/index";
import { chatDatabaseSchema } from "./createDatabase";
import { getSQLiteDatabase } from "../../util/backend-wrapper";
import { RunOnce } from "../../util/flow/RunOnce";

// <copied from="Mail/SQL/Account/SQLDatabase.ts">

let chatDatabase: Database;
let openRunOnce = new RunOnce<Database>();

export async function getDatabase(): Promise<Database> {
  return chatDatabase ?? await openRunOnce.runOnce(async () => {
    let database = await getSQLiteDatabase("chat.db");
    await database.migrate(chatDatabaseSchema);
    await database.pragma('foreign_keys = true');
    await database.pragma('journal_mode = WAL');
    return chatDatabase = database;
  });
}

/**
 * Creates a new database for testing only, in a different file,
 * and lets getDatabase() from now on return that test database,
 * until the process is shut down.
 */
export async function makeTestDatabase(): Promise<Database> {
  chatDatabase = await getSQLiteDatabase("test-chat.db");
  await deleteDatabase(); // closes the database
  chatDatabase = await getSQLiteDatabase("test-chat.db");
  await chatDatabase.migrate(chatDatabaseSchema);
  await chatDatabase.pragma('foreign_keys = true');
  return chatDatabase;
}

export async function deleteDatabase(): Promise<void> {
  let tables = await chatDatabase.all(sql`SELECT name FROM sqlite_schema WHERE type='table'`) as any[];
  for (let row of tables) {
    let table = row.name;
    if (table?.startsWith("sqlite_")) {
      continue;
    }
    await chatDatabase.execute(sql`DROP TABLE IF EXISTS ${table};`);
  }
  await chatDatabase.pragma('user_version = 0');
  (chatDatabase as any).close();
  chatDatabase = null;
}
