import { SearchEMail } from "../Store/SearchEMail";
import type { ExchangeMailAccount } from "./ExchangeMailAccount";
import { FlagStatusPidTag } from "./ExchangeEMail";
import { booleanHasValue } from "../../util/util";

/**
 * Lets the Exchange server search, using a `Restriction` in `FindItem`.
 * <https://learn.microsoft.com/en-us/exchange/client-developer/exchange-web-services/how-to-use-search-filters-with-ews-in-exchange>
 *
 * The alternative would be a `QueryString` with Advanced Query Syntax, which
 * uses the content index and knows `from:` and `participants:`. But it can
 * search only 1 folder per request, whereas a restriction searches all folders
 * of the mailbox at once, and that is what we need: The emails that the user
 * cannot find locally are exactly those in the folders that were never opened.
 *
 * EWS and OWA send the same conditions in different notations,
 * @see `EWSSearchEMail` and `OWASearchEMail`.
 */
export class ExchangeSearchEMail extends SearchEMail {
  declare account: ExchangeMailAccount;

  /** Translates our search criteria into Exchange restriction conditions, to be ANDed.
   * @returns null, if none of the criteria fits a restriction */
  protected conditions(): ExchangeCondition[] | null {
    if (booleanHasValue(this.isOutgoing) || booleanHasValue(this.isReplied) || this.threadID ||
        this.includesPerson || this.hasAttachmentMIMETypes.hasItems) {
      this.unsupportedFilters = true; // Exchange has no property for these
    }
    let conditions: ExchangeCondition[] = [];
    if (this.bodyText) {
      conditions.push(new ExchangeCondition("Or", null, null, [
        new ExchangeCondition("Contains", "item:Subject", this.bodyText),
        new ExchangeCondition("Contains", "item:Body", this.bodyText),
      ]));
    }
    for (let tag of this.tags) {
      let tagged = new ExchangeCondition("Contains", "item:Categories", tag.name);
      // A tag is one entry of the list, not a part of one, otherwise "Work"
      // would also find the emails tagged "Workshop"
      tagged.containmentMode = "FullString";
      conditions.push(tagged);
    }
    if (this.messageID) {
      conditions.push(new ExchangeCondition("IsEqualTo", "message:InternetMessageId", this.messageID));
    }
    if (booleanHasValue(this.isRead)) {
      conditions.push(new ExchangeCondition("IsEqualTo", "message:IsRead", this.isRead));
    }
    if (booleanHasValue(this.hasAttachment)) {
      conditions.push(new ExchangeCondition("IsEqualTo", "item:HasAttachments", this.hasAttachment));
    }
    if (booleanHasValue(this.isStarred)) {
      let flagged = new ExchangeCondition("IsEqualTo", null, 2);
      flagged.propertyTag = FlagStatusPidTag;
      conditions.push(this.isStarred
        ? flagged
        : new ExchangeCondition("Not", null, null, [flagged]));
    }
    if (this.sizeMin) {
      conditions.push(new ExchangeCondition("IsGreaterThanOrEqualTo", "item:Size", this.sizeMin));
    }
    if (this.sizeMax) {
      conditions.push(new ExchangeCondition("IsLessThanOrEqualTo", "item:Size", this.sizeMax));
    }
    if (this.sentDateMin) {
      conditions.push(new ExchangeCondition("IsGreaterThanOrEqualTo", "item:DateTimeSent", this.sentDateMin.toISOString()));
    }
    if (this.sentDateMax) {
      conditions.push(new ExchangeCondition("IsLessThanOrEqualTo", "item:DateTimeSent", this.sentDateMax.toISOString()));
    }
    // Listing the newest emails is not a search
    return conditions.length ? conditions : null;
  }

  /** The server sorts and limits each folder separately, so it returns up to
   * `limit` items *per folder*. We load the headers only of the newest of all of them. */
  protected newestFirst(items: any[], limit?: number): any[] {
    let now = Date.now(); // An unsent draft has no date, and counts as new, like in `EWSEMail`
    items.sort((a, b) =>
      (Date.parse(b.DateTimeSent) || now) - (Date.parse(a.DateTimeSent) || now));
    return items.slice(0, limit);
  }
}

/** One condition of an Exchange `Restriction` */
export class ExchangeCondition {
  constructor(
    /** `Contains`, `IsEqualTo`, `IsGreaterThanOrEqualTo`, `IsLessThanOrEqualTo`, `Or` or `Not` */
    readonly operator: string,
    /** The property to compare, e.g. `item:Subject`. Null for `Or` and `Not`. */
    readonly fieldURI: string | null = null,
    readonly value: string | number | boolean | null = null,
    /** Only for `Or` and `Not` */
    readonly conditions: ExchangeCondition[] = [],
  ) {
  }

  /** MAPI property tag, for the properties that have no `fieldURI` */
  propertyTag: string | null = null;
  /** Only for `Contains`: `Substring` finds the value anywhere in the property,
   * `FullString` only when the whole property equals it. */
  containmentMode: "Substring" | "FullString" = "Substring";
}
