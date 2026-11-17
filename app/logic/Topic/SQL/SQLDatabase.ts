import sql, { type Database } from "../../../../lib/rs-sqlite/index";
import { topicDatabaseSchema } from "./createDatabase";
import { getSQLiteDatabase } from "../../util/backend-wrapper";
import { RunOnce } from "../../util/flow/RunOnce";

// <copied from="Chat/SQL/SQLDatabase.ts">

let topicDatabase: Database;
let openRunOnce = new RunOnce<Database>();

export async function getDatabase(): Promise<Database> {
  return topicDatabase ?? await openRunOnce.runOnce(async () => {
    let db = await getSQLiteDatabase("topic.db");
    await db.migrate(topicDatabaseSchema);
    await db.pragma('foreign_keys = true');
    await db.pragma('journal_mode = WAL');
    return topicDatabase = db;
  });
}

/**
 * Creates a new database for testing only, in a different file,
 * and lets getDatabase() from now on return that test database,
 * until the process is shut down.
 */
export async function makeTestDatabase(): Promise<Database> {
  topicDatabase = await getSQLiteDatabase("test-topic.db");
  await deleteDatabase();
  await topicDatabase.migrate(topicDatabaseSchema);
  await topicDatabase.pragma('foreign_keys = true');
  return topicDatabase;
}

export async function deleteDatabase(): Promise<void> {
  let tables = await topicDatabase.all(sql`SELECT name FROM sqlite_schema WHERE type='table'`) as any[];
  for (let row of tables) {
    let table = row.name;
    if (table?.startsWith("sqlite_")) {
      continue;
    }
    await topicDatabase.execute(sql`DROP TABLE IF EXISTS ${table};`);
  }
  await topicDatabase.pragma('user_version = 0');
  (topicDatabase as any).close();
  topicDatabase = null;
}
