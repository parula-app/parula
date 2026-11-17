import sql, { type Database } from "../../../../lib/rs-sqlite/index";
import { filesDatabaseSchema } from "./createDatabase";
import { addLastModOnServer } from "./SQLFileMigrate";
import { getSQLiteDatabase } from "../../util/backend-wrapper";
import { RunOnce } from "../../util/flow/RunOnce";

let filesDatabase: Database;
let openRunOnce = new RunOnce<Database>();

export async function getDatabase(): Promise<Database> {
  return filesDatabase ?? await openRunOnce.runOnce(async () => {
    let db = await getSQLiteDatabase("files.db");
    await db.migrate(filesDatabaseSchema, addLastModOnServer);
    await db.pragma('foreign_keys = true');
    await db.pragma('journal_mode = WAL');
    return filesDatabase = db;
  });
}

export async function makeTestDatabase(): Promise<Database> {
  filesDatabase = await getSQLiteDatabase("test-files.db");
  await deleteDatabase();
  await filesDatabase.migrate(filesDatabaseSchema, addLastModOnServer);
  await filesDatabase.pragma('foreign_keys = true');
  return filesDatabase;
}

export async function deleteDatabase(): Promise<void> {
  let tables = await filesDatabase.all(sql`SELECT name FROM sqlite_schema WHERE type='table'`) as any[];
  for (let row of tables) {
    let table = row.name;
    if (table?.startsWith("sqlite_")) {
      continue;
    }
    await filesDatabase.execute(sql`DROP TABLE IF EXISTS ${table};`);
  }
  await filesDatabase.pragma('user_version = 0');
  (filesDatabase as any).close();
  filesDatabase = null;
}
