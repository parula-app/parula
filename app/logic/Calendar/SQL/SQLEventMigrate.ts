import { eventAttachmentSchema, eventPIDIndex } from "./createDatabase";
import sql, { type Database } from "../../../../lib/rs-sqlite";

/** Add table `eventAttachment` to pre-existing calendar.db.
 * Pattern: read source-of-truth via `sqlite_schema`, create on miss. */
export async function addEventAttachmentTable(database: Database): Promise<void> {
  let existing = await database.get(sql`
    SELECT name FROM sqlite_schema
    WHERE type = 'table' AND name = 'eventAttachment'
    `) as any;
  if (existing) {
    return;
  }
  await database.execute(eventAttachmentSchema);
}

/** Older versions saved the same event twice, and nothing ever removed the
 * second copy again. Delete the copies and add the unique index that prevents
 * them, @see `eventPIDIndex`.
 *
 * `migrate()` runs with foreign keys off, so the `ON DELETE CASCADE`s do not
 * fire, and the rows that referenced a deleted copy have to go explicitly. */
export async function removeDuplicateEvents(database: Database): Promise<void> {
  let existing = await database.get(sql`
    SELECT name FROM sqlite_schema
    WHERE type = 'index' AND name = 'index_event_pID'
    `) as any;
  if (existing) {
    return;
  }
  // CalDAV kept the URL of the event, which is its server ID, in the JSON,
  // so first move it where the copies below and the index can see it
  await database.run(sql`
    UPDATE event SET pID = json_extract(json, '$.url'), json = json_remove(json, '$.url')
    WHERE pID IS NULL AND json_extract(json, '$.url') IS NOT NULL AND
      calendarID IN (SELECT id FROM calendar WHERE protocol = 'caldav')
    `);
  // 2 syncs at the same time each wrote a full set of rows. Keep the oldest copy,
  // which is the one that the sync has been updating since. Masters first, so that
  // the exceptions of the kept master survive, whichever sync wrote them first.
  await database.run(sql`
    DELETE FROM event
    WHERE pID IS NOT NULL AND recurrenceMasterEventID IS NULL AND id NOT IN (
      SELECT MIN(id) FROM event
      WHERE pID IS NOT NULL AND recurrenceMasterEventID IS NULL
      GROUP BY calendarID, pID
    )
    `);
  // A new event was saved before the server assigned its ID, and the ID was
  // never saved. The next sync did not recognize the event and added it again.
  await database.run(sql`
    DELETE FROM event
    WHERE pID IS NULL AND recurrenceMasterEventID IS NULL AND EXISTS (
      SELECT 1 FROM event copy
      WHERE copy.calendarID = event.calendarID AND copy.calUID = event.calUID AND copy.pID IS NOT NULL
    )
    `);
  // The exceptions of the deleted copies
  await database.run(sql`
    DELETE FROM event
    WHERE recurrenceMasterEventID IS NOT NULL AND
      recurrenceMasterEventID NOT IN (SELECT id FROM event)
    `);
  // The exceptions that a sync saw twice
  await database.run(sql`
    DELETE FROM event
    WHERE pID IS NOT NULL AND id NOT IN (
      SELECT MIN(id) FROM event WHERE pID IS NOT NULL GROUP BY calendarID, pID
    )
    `);
  await database.run(sql`
    DELETE FROM eventExclusion WHERE recurrenceMasterEventID NOT IN (SELECT id FROM event)
    `);
  await database.run(sql`
    DELETE FROM eventParticipant WHERE eventID NOT IN (SELECT id FROM event)
    `);
  await database.run(sql`
    DELETE FROM eventAttachment WHERE eventID NOT IN (SELECT id FROM event)
    `);
  await database.execute(eventPIDIndex);
}
