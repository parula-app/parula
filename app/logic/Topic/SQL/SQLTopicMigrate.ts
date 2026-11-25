import sql, { type Database } from "../../../../lib/rs-sqlite";

/** Add `topic.lastMod` to a pre-existing topic.db. The topics count as changed now. */
export async function addTopicLastMod(database: Database): Promise<void> {
  let columns = await database.all(sql`SELECT name FROM pragma_table_info('topic')`) as any[];
  if (columns.some(column => column.name == "lastMod")) {
    return;
  }
  await database.execute(sql`
    ALTER TABLE topic ADD COLUMN "lastMod" INTEGER default null;
    UPDATE topic SET lastMod = strftime('%s', 'now') * 1000;
  `);
}
