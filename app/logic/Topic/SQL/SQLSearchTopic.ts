import { SearchNotes } from "../SearchNotes";
import { getDatabase } from "./SQLDatabase";
import { dataError } from "../../util/error";
import { ArrayColl } from "svelte-collections";
import sql from "../../../../lib/rs-sqlite";
import { Topic } from "../Topic";
import { NotImplemented } from "../../util/util";

/** TODO Not implemented */
export class SQLSearchTopic extends SearchNotes {
  /** Start a database search based on the critera set on this object */
  async startSearch(limit?: number): Promise<ArrayColl<Topic>> {
    throw new NotImplemented();
    let parseError = dataError;

    // Search notes in the SQL database
    let query = sql`
      SELECT
        note.id as id
      FROM note
      $${this.account ? sql` LEFT JOIN chat ON (message.chatID = chat.id) ` : sql``}
      WHERE 1=1
        $${this.account?.dbID ? sql` AND chat.accountID = ${this.account.dbID} ` : sql``}
        $${this.topic ? sql` AND LOWER(name) LIKE ${'%' + this.topic.toLowerCase() + '%'}) ` : sql``}
        $${this.bodyText ? sql` AND LOWER(plaintext) LIKE ${'%' + this.bodyText.toLowerCase() + '%'}) ` : sql``}
        $${typeof (this.messageID) == "string" ? sql` AND id = ${this.messageID} ` : sql``}
      GROUP BY note.id
      $${limit ? sql` LIMIT ${limit} ` : sql``}
      `;
    //console.log("query string", queryString(query));
    let rows = await (await getDatabase()).all(query) as any;

    let notes = new ArrayColl<Topic>();
    for (let row of rows) {
      let msg = new Topic();
      try {
        await SQLTopic.read(row.id, msg); // TODO: Get metadata with query above first, then the email contents?
      } catch (ex) {
        parseError(ex);
      }
      notes.add(msg);
    }
    return notes;
  }
}
