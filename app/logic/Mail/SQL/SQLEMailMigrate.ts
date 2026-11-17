import sql, { type Database } from "../../../../lib/rs-sqlite";

// <copied from="createDatabase.ts">
export const createFolderIDDateSentIndex = sql`
  CREATE INDEX IF NOT EXISTS index_email_folderID_dateSent
  ON email (folderID, dateSent DESC);
`;

/** Add the message status columns to a pre-existing mail.db.
 * Pattern: read source-of-truth via `table_info`, create on miss. */
export async function addEMailStatusColumns(database: Database): Promise<void> {
  let columns = await database.all(sql`PRAGMA table_info("email")`) as any[];
  if (!columns.some(column => column.name == "isForwarded")) {
    await database.execute(sql`ALTER TABLE email ADD COLUMN "isForwarded" BOOLEAN default false;`);
  }
  if (!columns.some(column => column.name == "isImportant")) {
    await database.execute(sql`ALTER TABLE email ADD COLUMN "isImportant" BOOLEAN default false;`);
  }
}
