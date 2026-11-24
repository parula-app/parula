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

/** Until #1916, a PGP mail that we signed kept our secret key and its
 * passphrase as its signer. Removes them, and keeps the public key.
 * `migrate()` runs it only once.
 * `octet_length()` comes from the row header, so most mails, whose JSON is
 * smaller than a secret and a public key together, are skipped without
 * reading their HTML to get to the JSON: 33 ms instead of 263 ms for 100000 mails. */
export const removeSecretKeyOfSigner = sql`
  UPDATE email
  SET json = json_remove(json, '$.encryption.signedPublicKey.privateKeyArmored', '$.encryption.signedPublicKey.passphrase')
  WHERE octet_length(json) > 1000 AND instr(json, '"privateKeyArmored"') AND json_valid(json);
`;

/** IMAP, EWS, OWA, Graph, ActiveSync and POP3 used to store Message-IDs with <>, JMAP and the composer without.
 * Now all store them without, @see `msgIDWithoutBrackets()`. `threadID` can be an `inReplyTo`, @see `EMail.findThread()`.
 * Rewrites each matching row, with its body: 1 s for 256 MB of mails. */
export const removeMessageIDBrackets = sql`
  UPDATE email
  SET messageID = trim(messageID, '<>'), parentMsgID = trim(parentMsgID, '<>'), threadID = trim(threadID, '<>')
  WHERE messageID LIKE '<%>' OR parentMsgID LIKE '<%>' OR threadID LIKE '<%>';
`;
