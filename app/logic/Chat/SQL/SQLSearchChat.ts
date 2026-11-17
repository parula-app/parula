import { SearchChat } from "../SearchChat";
import { ChatMessage } from "../ChatMessage";
import { SQLChatMessage } from "./SQLChatMessage";
import { getDatabase } from "./SQLDatabase";
import { dataError } from "../../util/error";
import { ArrayColl } from "svelte-collections";
import sql from "../../../../lib/rs-sqlite";

export class SQLSearchChat extends SearchChat {
  /** Start a database search based on the critera set on this object */
  async startSearch(limit?: number): Promise<ArrayColl<ChatMessage>> {
    let parseError = dataError;

    // Search matching chat messages directly in the SQL database
    let query = sql`
      SELECT
        message.id as id
      FROM message
      $${this.hasAttachment === true || this.hasAttachment === false ? sql` LEFT JOIN chatAttachment ON (message.id = chatAttachment.messageID) ` : sql``}
      $${this.account ? sql` LEFT JOIN chatRoom ON (message.chatID = chatRoom.id) ` : sql``}
      WHERE 1=1
        $${this.account?.dbID ? sql` AND chatRoom.accountID = ${this.account.dbID} ` : sql``}
        $${typeof (this.isOutgoing) == "boolean" ? sql` AND outgoing = ${this.isOutgoing ? 1 : 0} ` : sql``}
        $${typeof (this.messageID) == "string" ? sql` AND id = ${this.messageID} ` : sql``}
        $${this.includesPerson ? sql` AND fromPersonID = ${this.includesPerson.dbID} ` : sql``}
        $${this.hasAttachment === true ? sql` AND chatAttachment.id IS NOT NULL ` : sql``}
        $${this.hasAttachment === false ? sql` AND chatAttachment.id IS NULL ` : sql``}
        $${this.hasAttachmentMIMETypes?.hasItems ? sql` AND chatAttachment.mimeType IN ${this.hasAttachmentMIMETypes.contents} ` : sql``}
        $${this.bodyText ? sql` AND LOWER(plaintext) LIKE ${'%' + this.bodyText.toLowerCase() + '%'}) ` : sql``}
      GROUP BY message.id
      ORDER BY dateSent DESC
      $${limit ? sql` LIMIT ${limit} ` : sql``}
      `;
    //console.log("query string", queryString(query));
    let rows = await (await getDatabase()).all(query) as any;

    let msgs = new ArrayColl<ChatMessage>();
    for (let row of rows) {
      let msg = new ChatMessage(null); // TODO Chat
      try {
        await SQLChatMessage.read(row.id, msg); // TODO: Get metadata with query above first, then the email contents?
        // Do *not* add this temp `email` object to `folder.messages`
      } catch (ex) {
        parseError(ex);
      }
      msgs.add(msg);
    }
    return msgs;
  }
}
