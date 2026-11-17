import type { MailContentStorage } from "../../MailAccount";
import type { EMail } from "../../EMail";
import type { Attachment } from "../../../Abstract/Attachment";
import { getDatabase } from "./SQLSourceDatabase";
import { SQLEMail } from "../SQLEMail";
import { assert } from "../../../util/util";
import sql from "../../../../../lib/rs-sqlite";

/** Stores the RFC822 MIME source of the email,
 * for backup purposes, and for features like
 * "View source", Forward/Redirect etc. */
export class SQLSourceEMail implements MailContentStorage {
  /**
   * Save only fully downloaded emails
   */
  async save(email: EMail) {
    assert(email.mime, "Have no email source that I could save");
    if (!email.dbID) {
      await SQLEMail.save(email);
    }
    await (await getDatabase()).run(sql`
      INSERT OR REPLACE INTO emailMIME (
        emailID, messageID, mime
      ) VALUES (
        ${email.dbID}, ${email.messageID}, ${email.mime}
      )`);
  }

  async read(email: EMail): Promise<void> {
    assert(email.dbID, "Have no email ID");
    let row = await (await getDatabase()).get(sql`
      SELECT
        messageID, mime
      FROM emailMIME
      WHERE emailID = ${email.dbID}
      `) as any;
    if (!row) {
      return;
    }
    /* The other database frees the row ID when the mail goes, and gives it to
     * the next mail: This row can be a stranger's, from any account. */
    if ((row.messageID || null) != (email.messageID || null)) {
      return;
    }
    email.mime = row.mime;
  }

  async deleteIt(email: EMail) {
    if (!email.dbID) {
      return;
    }
    assert(email.dbID, "Need Email DB ID to delete");
    await (await getDatabase()).run(sql`
      DELETE FROM emailMIME
      WHERE emailID = ${email.dbID}
      `);
  }

  supportsAttachments = true;
  async readAttachment(attachment: Attachment): Promise<boolean> {
    let email = attachment.message as EMail;
    if (!email.mime) {
      await this.read(email);
    }
    await email.parseMIME();
    return true;
  }
  async saveAttachment(attachment: Attachment): Promise<void> {
    await this.save(attachment.message as EMail);
  }
  async deleteAttachment(attachment: Attachment): Promise<void> {
  }
}
