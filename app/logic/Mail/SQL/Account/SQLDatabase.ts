import sql, { type Database } from "../../../../../lib/rs-sqlite/index";
import { accountsDatabaseSchema } from "./createDatabase";
import { migrateToAccountsDB } from "./SQLAccountsMigrate";
import { getSQLiteDatabase } from "../../../util/backend-wrapper";
import { RunOnce } from "../../../util/flow/RunOnce";

let accountsDatabase: Database;
let openRunOnce = new RunOnce<Database>();

// Lib docs:
// https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
// https://github.com/radically-straightforward/radically-straightforward/tree/main/sqlite
// https://www.sqlite.org/lang.html

export async function getDatabase(): Promise<Database> {
  return accountsDatabase ?? await openRunOnce.runOnce(async () => {
    await migrateToAccountsDB();
    let db = await getSQLiteDatabase("account.db");
    await db.migrate(accountsDatabaseSchema);
    await db.pragma('foreign_keys = true');
    await db.pragma('journal_mode = DELETE');
    return accountsDatabase = db;
  });
}

/**
 * Creates a new database for testing only, in a different file,
 * and lets getDatabase() from now on return that test database,
 * until the process is shut down.
 */
export async function makeTestDatabase(): Promise<Database> {
  accountsDatabase = await getSQLiteDatabase("test-account.db");
  await deleteDatabase();
  await accountsDatabase.migrate(accountsDatabaseSchema);
  await accountsDatabase.pragma('foreign_keys = true');
  return accountsDatabase;
}

export async function deleteDatabase(): Promise<void> {
  let tables = await accountsDatabase.all(sql`SELECT name FROM sqlite_schema WHERE type='table'`) as any[];
  for (let row of tables) {
    let table = row.name;
    if (table?.startsWith("sqlite_")) {
      continue;
    }
    await accountsDatabase.execute(sql`DROP TABLE IF EXISTS ${table};`);
  }
  await accountsDatabase.pragma('user_version = 0');
  (accountsDatabase as any).close(); // any, because function exists, but not in TypeScript definitions
  accountsDatabase = null;
}
