import { SearchEMail } from "../Store/SearchEMail";
import type { IMAPAccount } from "./IMAPAccount";
import type { IMAPFolder } from "./IMAPFolder";
import type { EMail } from "../EMail";
import { booleanHasValue } from "../../util/util";
import { ArrayColl } from "svelte-collections";
import type { SearchObject } from "../../../../desktop/backend/node_modules/imapflow";

/** Lets the IMAP server search, using the `SEARCH` command.
 * <https://datatracker.ietf.org/doc/html/rfc3501#section-6.4.4>
 * `SEARCH` runs in the selected mailbox, so we search the folders one by one. */
export class IMAPSearchEMail extends SearchEMail {
  declare account: IMAPAccount;

  async startSearch(limit?: number): Promise<ArrayColl<EMail>> {
    let results = new ArrayColl<EMail>();
    if (booleanHasValue(this.isOutgoing) || this.threadID ||
        booleanHasValue(this.hasAttachment) || this.hasAttachmentMIMETypes.hasItems) {
      this.unsupportedFilters = true; // IMAP has no search key for these
    }
    if (this.includesPerson && this.includesPerson.emailAddresses.isEmpty) {
      return results; // Without an email address, the person has no emails
    }
    let query = this.imapQuery();
    if (!Object.keys(query).length) {
      return results; // `SEARCH` needs at least 1 search key
    }
    let folders = this.folder
      ? [this.folder as IMAPFolder]
      : this.account.getAllFolders().contents as IMAPFolder[];
    for (let folder of folders) {
      if (!folder.countTotal) {
        continue;
      }
      let emails = await folder.searchMessages(query, limit);
      results.addAll(this.tags.hasItems
        // The server silently drops `KEYWORD` for flags that the folder doesn't list
        ? emails.filterOnce(email => this.tags.contents.every(tag => email.tags.has(tag)))
        : emails);
    }
    return results;
  }

  /** Translates our search criteria into IMAP search keys.
   * The `or` groups come last, so that the simple keys stay in the top level. */
  protected imapQuery(): SearchObject {
    let conditions: SearchObject[] = [];
    if (this.messageID) {
      conditions.push({ header: { "message-id": this.messageID } });
    }
    if (booleanHasValue(this.isRead)) {
      conditions.push({ seen: this.isRead });
    }
    if (booleanHasValue(this.isStarred)) {
      conditions.push({ flagged: this.isStarred });
    }
    if (booleanHasValue(this.isReplied)) {
      conditions.push({ answered: this.isReplied });
    }
    for (let tag of this.tags) {
      conditions.push({ keyword: tag.name });
    }
    if (this.sizeMin) {
      conditions.push({ larger: this.sizeMin - 1 }); // `LARGER` excludes the size itself
    }
    if (this.sizeMax) {
      conditions.push({ smaller: this.sizeMax + 1 }); // `SMALLER` excludes the size itself
    }
    if (this.sentDateMin) {
      conditions.push({ sentSince: this.sentDateMin });
    }
    if (this.sentDateMax) {
      conditions.push({ sentBefore: this.sentDateMax });
    }
    if (this.bodyText) {
      conditions.push({ or: [{ subject: this.bodyText }, { body: this.bodyText }] });
    }
    if (this.includesPerson) {
      conditions.push({
        or: this.includesPerson.emailAddresses.contents.flatMap(address =>
          [{ from: address.value }, { to: address.value }, { cc: address.value }, { bcc: address.value }]),
      });
    }

    let query: SearchObject = {};
    let current: any = query;
    for (let condition of conditions) {
      for (let key in condition) {
        if (key in current) {
          // Each search key may appear only once per object, e.g. only one `or`.
          // `NOT (NOT x)` means the same as `x`, and gives us a fresh object.
          current.not = { not: {} };
          current = current.not.not;
        }
        current[key] = condition[key];
      }
    }
    return query;
  }
}
