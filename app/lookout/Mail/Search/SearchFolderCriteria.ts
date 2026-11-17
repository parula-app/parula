import type { SearchEMail } from "../../../logic/Mail/Store/SearchEMail";
import { defaultSearchOptions, type SearchOptions } from "./MailSearch";
import { AdvancedSearchDraft } from "./AdvancedSearchDraft";
import { SizeRange, namedSizeRanges, sizeRangeBytes } from "./SearchRanges";

export class SearchFolderCriteria {
  readonly draft: AdvancedSearchDraft;
  protected readonly initialSize: SizeRange;

  constructor(search: SearchEMail) {
    this.draft = new AdvancedSearchDraft(SearchFolderCriteria.optionsOf(search), search.bodyText);
    this.initialSize = this.draft.size;
  }

  static optionsOf(search: SearchEMail): SearchOptions {
    return {
      ...defaultSearchOptions(),
      person: search.includesPerson,
      isOutgoing: search.isOutgoing ?? null,
      isRead: search.isRead ?? null,
      hasAttachment: !!search.hasAttachment,
      flagged: !!search.isStarred,
      replied: !!search.isReplied,
      tags: search.tags.contents,
      size: namedSizeRanges.find(range => {
        let bytes = sizeRangeBytes(range);
        return (bytes.min ?? null) == (search.sizeMin ?? null) && (bytes.max ?? null) == (search.sizeMax ?? null);
      }) ?? SizeRange.Any,
    };
  }

  writeTo(search: SearchEMail) {
    let options = this.draft.toOptions();
    search.bodyText = this.draft.keywords.trim() || null;
    search.includesPerson = options.person;
    search.isOutgoing = options.isOutgoing;
    search.isRead = options.isRead;
    search.hasAttachment = options.hasAttachment ? true : null;
    search.isStarred = options.flagged ? true : null;
    search.isReplied = options.replied ? true : null;
    search.tags.replaceAll(options.tags);
    if (this.draft.size != this.initialSize) {
      let bytes = sizeRangeBytes(this.draft.size);
      search.sizeMin = bytes.min;
      search.sizeMax = bytes.max;
    }
  }
}
