import { appGlobal } from "../../../app";
import type { Database } from "../../../../../lib/rs-sqlite/index";
import { mailSourceDatabaseSchema } from "./createSourceDatabase";
import { addUNIQUEEMailID } from "./SQLSourceEMailMigrate";
import { getConfigDir, getSQLiteDatabase } from "../../../util/backend-wrapper";
import { RunOnce } from "../../../util/flow/RunOnce";

let mailSourceDatabase: Database;
let openRunOnce = new RunOnce<Database>();

export async function getDatabase(): Promise<Database> {
  return mailSourceDatabase ?? await openRunOnce.runOnce(async () => {
    let dir = await appGlobal.remoteApp.path.join(
      await getConfigDir(), "backup");
    await appGlobal.remoteApp.fs.mkdir(dir, { recursive: true, mode: 0o700 });
    let file = await appGlobal.remoteApp.path.join("backup", "mail-backup.db");
    let db = await getSQLiteDatabase(file);
    await db.migrate(mailSourceDatabaseSchema, addUNIQUEEMailID);
    await db.pragma('journal_mode = WAL');
    return mailSourceDatabase = db;
  });
}
