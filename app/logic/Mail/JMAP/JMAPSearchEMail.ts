import { SearchEMail } from "../Store/SearchEMail";
import type { JMAPAccount } from "./JMAPAccount";
import type { JMAPFolder } from "./JMAPFolder";
import { JMAPEMail } from "./JMAPEMail";
import type { TJMAPEMailHeaders } from "./TJMAPMail";
import type { TJMAPGetResponse } from "./TJMAPGeneric";
import type { EMail } from "../EMail";
import { booleanHasValue } from "../../util/util";
import { ArrayColl } from "svelte-collections";

/** Lets the JMAP server search, using `Email/query`.
 * <https://www.rfc-editor.org/rfc/rfc8621.html#section-4.4> */
export class JMAPSearchEMail extends SearchEMail {
  declare account: JMAPAccount;

  async startSearch(limit?: number): Promise<ArrayColl<EMail>> {
    let results = new ArrayColl<EMail>();
    if (booleanHasValue(this.isOutgoing) || this.threadID || this.hasAttachmentMIMETypes.hasItems) {
      this.unsupportedFilters = true; // JMAP has no filter condition for these
    }
    if (this.includesPerson && this.includesPerson.emailAddresses.isEmpty) {
      return results; // Without an email address, the person has no emails
    }
    let conditions = this.filterConditions();
    if (!conditions.length) {
      return results; // Listing the newest emails is not a search
    }
    if (this.folder) {
      conditions.push({ inMailbox: this.folder.id });
    }

    let response = await this.account.makeCombinedCall([
      [
        "Email/query", {
          accountId: this.account.accountID,
          filter: conditions.length == 1 ? conditions[0] : { operator: "AND", conditions },
          sort: [
            { property: "receivedAt", isAscending: false }
          ],
          limit: limit,
        },
        "list",
      ], [
        "Email/get", {
          accountId: this.account.accountID,
          "#ids": {
            name: "Email/query",
            path: "/ids",
            resultOf: "list",
          },
          properties: JMAPEMail.listProperties,
        },
        "emails",
      ],
    ]);

    let folders = this.account.getAllFolders() as ArrayColl<JMAPFolder>;
    for (let json of (response["emails"] as TJMAPGetResponse<TJMAPEMailHeaders>).list) {
      // An email can be in several mailboxes, but should appear only once in the results
      let folder = this.folder as JMAPFolder ??
        folders.find(folder => json.mailboxIds?.[folder.id]);
      if (!folder) {
        continue; // in a mailbox that we do not know
      }
      let { newMessages, updatedMessages } = folder.parseMessageList([json]);
      results.addAll(updatedMessages);
      results.addAll(newMessages);
    }
    return results;
  }

  /** Translates our search criteria into JMAP `FilterCondition`s, to be ANDed */
  protected filterConditions(): any[] {
    let conditions: any[] = [];
    if (this.bodyText) {
      conditions.push({ operator: "OR", conditions: [
        { subject: this.bodyText },
        { body: this.bodyText },
      ]});
    }
    if (this.includesPerson) {
      conditions.push({ operator: "OR", conditions:
        this.includesPerson.emailAddresses.contents.flatMap(email =>
          [{ from: email.value }, { to: email.value }, { cc: email.value }, { bcc: email.value }]),
      });
    }
    if (this.messageID) {
      conditions.push({ header: [ "Message-ID", this.messageID ] });
    }
    if (this.inReplyTo) {
      conditions.push({ header: [ "In-Reply-To", this.inReplyTo ] });
    }
    if (booleanHasValue(this.isRead)) {
      conditions.push(this.isRead ? { hasKeyword: "$seen" } : { notKeyword: "$seen" });
    }
    if (booleanHasValue(this.isStarred)) {
      conditions.push(this.isStarred ? { hasKeyword: "$flagged" } : { notKeyword: "$flagged" });
    }
    if (booleanHasValue(this.isReplied)) {
      conditions.push(this.isReplied ? { hasKeyword: "$answered" } : { notKeyword: "$answered" });
    }
    for (let tag of this.tags) {
      conditions.push({ hasKeyword: tag.name });
    }
    if (booleanHasValue(this.hasAttachment)) {
      conditions.push({ hasAttachment: this.hasAttachment });
    }
    if (this.sizeMin) {
      conditions.push({ minSize: this.sizeMin });
    }
    if (this.sizeMax) {
      conditions.push({ maxSize: this.sizeMax + 1 }); // `maxSize` excludes the size itself
    }
    // JMAP filters by the received date, whereas we search for the sent date.
    // They differ only by the time that the email spent in transit.
    if (this.sentDateMin) {
      conditions.push({ after: this.sentDateMin.toISOString() });
    }
    if (this.sentDateMax) {
      conditions.push({ before: this.sentDateMax.toISOString() });
    }
    return conditions;
  }
}
