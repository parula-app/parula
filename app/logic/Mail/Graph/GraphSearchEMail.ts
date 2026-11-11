import { SearchEMail } from "../Store/SearchEMail";
import { type GraphAccount, kMaxFetchCount } from "./GraphAccount";
import type { GraphFolder } from "./GraphFolder";
import { type TGraphEMail, TGraphEMailHeaderProperties } from "./TGraphMail";
import type { EMail } from "../EMail";
import { booleanHasValue } from "../../util/util";
import { ArrayColl } from "svelte-collections";

/**
 * Lets the MS Graph server search, using `$search` on the messages of the
 * account, which covers all folders at once.
 * <https://learn.microsoft.com/en-us/graph/search-query-parameter>
 *
 * Graph has no restrictions like EWS @see `ExchangeSearchEMail`, and it accepts
 * either `$search` or `$filter`, never both. Only `$search` matches the message
 * body, so that is the one we use, and criteria that its query syntax does not
 * know are left to the database search.
 */
export class GraphSearchEMail extends SearchEMail {
  declare account: GraphAccount;

  async startSearch(limit?: number): Promise<ArrayColl<EMail>> {
    let results = new ArrayColl<EMail>();
    let query = this.searchQuery();
    if (!query) {
      return results;
    }
    let searchedFolder = this.folder as GraphFolder;
    let properties = TGraphEMailHeaderProperties.concat("parentFolderId");
    let messagesJSON = await this.account.graphGet<TGraphEMail>(
      `${searchedFolder ? searchedFolder.path + "/" : ""}messages` +
      `?$search=${encodeURIComponent(`"${query}"`)}` +
      `&$select=${properties.join(",")}`,
      { top: limit ?? kMaxFetchCount });

    let folders = this.account.getAllFolders() as ArrayColl<GraphFolder>;
    for (let json of messagesJSON) {
      let folder = searchedFolder ?? folders.find(folder => folder.id == json.parentFolderId);
      if (!folder) {
        continue; // in a folder that we do not know
      }
      let { newMessages, updatedMessages } = folder.parseMessageList([json]);
      results.addAll(updatedMessages);
      results.addAll(newMessages);
    }
    return results;
  }

  /** Translates our search criteria into a `$search` query.
   * @returns null, if none of the criteria fits the query syntax */
  protected searchQuery(): string | null {
    // Graph knows neither the read, flagged and answered state nor the categories
    if (booleanHasValue(this.isOutgoing) || booleanHasValue(this.isRead) ||
        booleanHasValue(this.isStarred) || booleanHasValue(this.isReplied) ||
        this.threadID || this.messageID || this.inReplyTo ||
        this.tags.hasItems || this.hasAttachmentMIMETypes.hasItems) {
      this.unsupportedFilters = true;
    }
    let terms: string[] = [];
    let bodyText = this.bodyText ? searchText(this.bodyText) : null;
    if (bodyText) {
      terms.push(`(subject:${bodyText} OR body:${bodyText})`);
    }
    if (this.includesPerson) {
      let addresses = this.includesPerson.emailAddresses.contents;
      if (!addresses.length) {
        return null; // Without an email address, the person has no emails
      }
      terms.push("(" + addresses
        .map(address => `participants:${searchText(address.value)}`)
        .join(" OR ") + ")");
    }
    if (booleanHasValue(this.hasAttachment)) {
      terms.push(`hasattachment:${this.hasAttachment}`);
    }
    if (this.sizeMin) {
      terms.push(`size:>=${this.sizeMin}`);
    }
    if (this.sizeMax) {
      terms.push(`size:<=${this.sizeMax}`);
    }
    if (this.sentDateMin) {
      terms.push(`sent:>=${searchDate(this.sentDateMin)}`);
    }
    if (this.sentDateMax) {
      terms.push(`sent:<=${searchDate(this.sentDateMax)}`);
    }
    return terms.length
      ? terms.join(" AND ") // The operators must be uppercase, or they are search words
      : null; // Listing the newest emails is not a search
  }
}

/** `$search` puts the whole query in double quotes, and the syntax has no escape
 * character, so quotes and parens in the user's text would end the query early
 * and the server rejects it. A `word:` would silently turn into a property
 * restriction. Drop them all, rather than search for something else than asked. */
function searchText(value: string): string {
  return value.replace(/["\\:()\s]+/g, " ").trim();
}

/** Dates are compared without the time of day */
function searchDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
