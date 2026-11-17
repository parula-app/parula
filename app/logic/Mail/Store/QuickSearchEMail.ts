import { SearchEMail, msgHasSearchTerm } from "../Store/SearchEMail";
import type { EMail } from "../EMail";
import { assert, booleanHasValue } from "../../util/util";
import { ArrayColl, type Collection } from "svelte-collections";

/** Searches messages only in `this.folder.messages` */
export class QuickSearchEMail extends SearchEMail {
  /** Start a local search based on the critera set on this object */
  async startSearch(): Promise<ArrayColl<EMail>> {
    if (!this.hasSearch()) {
      return null;
    }
    assert(this.folder, "Quick search needs a folder");
    return this.filter(this.folder.messages);
  }

  /** @returns those `emails` that match the criteria set on this object.
   * Also used on the server results, which the server filtered only partly.
   * @param alreadySearchedBody Keep the hits whose body we never downloaded */
  filter(emails: Collection<EMail>, alreadySearchedBody = false): ArrayColl<EMail> {
    let searchTerms = this.bodyText ? this.bodyText.split(" ").filter(Boolean) : [];
    return emails.filterOnce(msg =>
      (!booleanHasValue(this.isStarred) || msg.isStarred === this.isStarred) &&
      (!booleanHasValue(this.isRead) || msg.isRead === this.isRead) &&
      (!booleanHasValue(this.hasAttachment) || msg.hasVisibleAttachments === this.hasAttachment) &&
      (!searchTerms.length || alreadySearchedBody && !msg.text ||
        searchTerms.every(term => msgHasSearchTerm(msg, term)))
    ) as ArrayColl<EMail>;
  }

  hasSearch(): boolean {
    return booleanHasValue(this.isStarred) ||
      booleanHasValue(this.isRead) ||
      booleanHasValue(this.hasAttachment) ||
      !!this.bodyText;
  }

  reset() {
    this.isStarred = null;
    this.isRead = null;
    this.hasAttachment = null;
    this.bodyText = null;
  }
}
