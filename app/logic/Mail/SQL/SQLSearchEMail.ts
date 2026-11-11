import { SearchEMail } from "../Store/SearchEMail";
import { SQLEMail } from "./SQLEMail";
import { getDatabase } from "./SQLDatabase";
import type { EMail } from "../EMail";
import { Folder, SpecialFolder } from "../Folder";
import { appGlobal } from "../../app";
import { dataError } from "../../util/error";
import { assert } from "../../util/util";
import { ArrayColl, MapColl } from "svelte-collections";
import sql, { type Query } from "../../../../lib/rs-sqlite";
import { gt } from "../../../l10n/l10n";

export class SQLSearchEMail extends SearchEMail {
  /** Start a database search based on the critera set on this object */
  async startSearch(limit?: number): Promise<ArrayColl<EMail>> {
    let parseError = dataError;
    if (this.folder && this.account) {
      assert(this.account == this.folder.account, "Folder and account need to match");
    }
    if (this.hasAttachmentMIMETypes?.hasItems) {
      this.hasAttachment = true;
    }
    // TODO 1:n relations attachments and recipients

    // The workspace shows only some of the accounts, so it finds only their emails
    let accountIDs = this.account?.dbID
      ? [this.account.dbID]
      : this.workspace && !this.folder
        ? appGlobal.emailAccounts.filterOnce(acc => acc.workspace == this.workspace).contents.map(acc => acc.dbID)
        : null;

    // Search matching emails directly in the SQL database
    let query = sql`
      SELECT
        email.id as id, folderID
      FROM email
      $${accountIDs ? sql` LEFT JOIN folder ON (email.folderID = folder.id) ` : sql``}
      $${this.includesPerson ? sql` LEFT JOIN emailPersonRel ON (email.id = emailPersonRel.emailID) LEFT JOIN emailPerson ON (emailPersonRel.emailPersonID = emailPerson.id) ` : sql``}
      $${this.hasAttachment === true || this.hasAttachment === false ? sql` LEFT JOIN emailAttachment ON (email.id = emailAttachment.emailID) ` : sql``}
      $${this.tags?.hasItems ? sql` LEFT JOIN emailTag ON (email.id = emailTag.emailID) ` : sql``}
      WHERE 1=1
        $${accountIDs ? sql` AND accountID IN ${accountIDs} ` : sql``}
        $${this.folder?.dbID ? sql` AND folderID = ${this.folder.dbID} ` : sql``}
        $${typeof (this.isOutgoing) == "boolean" ? sql` AND outgoing = ${this.isOutgoing ? 1 : 0} ` : sql``}
        $${typeof (this.isRead) == "boolean" ? sql` AND isRead = ${this.isRead ? 1 : 0} ` : sql``}
        $${typeof (this.isStarred) == "boolean" ? sql` AND isStarred = ${this.isStarred ? 1 : 0} ` : sql``}
        $${typeof (this.isReplied) == "boolean" ? sql` AND isReplied = ${this.isReplied ? 1 : 0} ` : sql``}
        $${typeof (this.threadID) == "string" ? sql` AND threadID = ${this.threadID} ` : sql``}
        $${typeof (this.messageID) == "string" ? sql` AND messageID = ${this.messageID} ` : sql``}
        $${typeof (this.inReplyTo) == "string" ? sql` AND parentMsgID = ${this.inReplyTo} ` : sql``}
        $${this.sizeMin ? sql` AND size >= ${this.sizeMin} ` : sql``}
        $${this.sizeMax ? sql` AND size <= ${this.sizeMax} ` : sql``}
        $${this.includesPerson ? (this.includesPerson?.emailAddresses.hasItems ? sql` AND lower(emailPerson.emailAddress) IN ${this.includesPerson.emailAddresses.contents.map(c => c.value?.toLowerCase())} ` : sql` AND FALSE`) : sql``}
        $${this.hasAttachment === true ? sql` AND emailAttachment.disposition = 'attachment' ` : sql``}
        $${this.hasAttachment === false ? sql` AND emailAttachment.id IS NULL ` : sql``}
        $${this.hasAttachmentMIMETypes?.hasItems ? sql` AND emailAttachment.mimeType IN ${this.hasAttachmentMIMETypes.contents} ` : sql``}
        $${this.tags?.hasItems ? sql` AND emailTag.tagName IN ${this.tags.contents.map(tag => tag.name)} ` : sql``}
        $${this.bodyText ? sql` AND (LOWER(subject) LIKE ${'%' + this.bodyText.toLowerCase() + '%'} OR LOWER(plaintext) LIKE ${'%' + this.bodyText.toLowerCase() + '%'}) ` : sql``}
      GROUP BY email.id
      $${this.tags?.hasItems ? sql` HAVING COUNT(DISTINCT emailTag.tagName) = ${this.tags.length} ` : sql``}
      ORDER BY dateSent DESC
      $${limit ? sql` LIMIT ${limit} ` : sql``}
      `;
    //console.log("query string", queryString(query));
    let rows = await (await getDatabase()).all(query) as any;
    let emails = new ArrayColl<EMail>();
    if (!rows.length) {
      return emails;
    }

    // Find existing email obj in `folder.messages`,
    // or create new temporary `EMail` objects for the results
    let cachedFolders = new MapColl<string | number, Folder>(); // dbID -> folder
    const findFolder = (dbID: number): Folder | null => {
      if (!dbID) {
        return null;
      }
      if (this.folder?.dbID == dbID) {
        return this.folder;
      }
      let cached = cachedFolders.get(dbID);
      if (cached) {
        return cached;
      }
      for (let account of appGlobal.emailAccounts) {
        for (let folder of account.getAllFolders()) {
          if (folder.dbID) {
            cachedFolders.set(folder.dbID, folder);
          }
        }
      }
      return cachedFolders.get(dbID) ?? null;
    }
    let randomFolder = this.folder ??
      this.account?.inbox ??
      appGlobal.emailAccounts.first?.inbox;
    assert(randomFolder, gt`Please set up a mail account first`);
    for (let row of rows) {
      let folder = findFolder(row.folderID);
      let existing = folder?.messages.find(msg => msg.dbID == row.id);
      if (existing) {
        emails.add(existing);
        continue;
      }
      let email = (folder ?? randomFolder).newEMail();
      try {
        await SQLEMail.read(row.id, email); // TODO: Get metadata with query above first, then the email contents?
        // Do *not* add this temp `email` object to `folder.messages`
      } catch (ex) {
        parseError(ex);
      }
      emails.add(email);
    }
    return emails;
  }
}

/** For debugging, returns the rs-sql SQL query as a string */
function queryString(query: Query): string {
  let str = "";
  let params = query.parameters.slice();
  for (let sourcePart of query.sourceParts) {
    str += sourcePart.trim();
    str += params.shift() ?? "";
  }
  return str;
}
