import { quickSearch } from "../../frontend/Mail/Selected";
import { globalSearchTerm } from "../../frontend/AppsBar/selectedApp";
import { hasRefiners, SearchScope, defaultSearchOptions, type SearchOptions } from "./Search/MailSearch";
import { searchOptions } from "./Selected";
import { get } from "svelte/store";

export enum QuickFilter {
  Unread = "unread",
  Flagged = "flagged",
  Attachments = "attachments",
}

export function hasSearchCriteria(): boolean {
  return !!get(globalSearchTerm)?.trim() || hasRefiners(get(searchOptions));
}

export function isQuickFilterActive(filter: QuickFilter): boolean {
  if (hasSearchCriteria()) {
    let options = get(searchOptions);
    switch (filter) {
      case QuickFilter.Unread: return options.isRead === false;
      case QuickFilter.Flagged: return options.flagged;
      case QuickFilter.Attachments: return options.hasAttachment;
    }
  }
  switch (filter) {
    case QuickFilter.Unread: return quickSearch.isRead === false;
    case QuickFilter.Flagged: return quickSearch.isStarred === true;
    case QuickFilter.Attachments: return quickSearch.hasAttachment === true;
  }
}

export function toggleQuickFilter(filter: QuickFilter) {
  let isActive = isQuickFilterActive(filter);
  if (hasSearchCriteria()) {
    switch (filter) {
      case QuickFilter.Unread:
        return searchOptions.update(options => ({ ...options, isRead: isActive ? null : false }));
      case QuickFilter.Flagged:
        return searchOptions.update(options => ({ ...options, flagged: !isActive }));
      case QuickFilter.Attachments:
        return searchOptions.update(options => ({ ...options, hasAttachment: !isActive }));
    }
  }
  switch (filter) {
    case QuickFilter.Unread:
      quickSearch.isRead = isActive ? null : false;
      break;
    case QuickFilter.Flagged:
      quickSearch.isStarred = isActive ? null : true;
      break;
    case QuickFilter.Attachments:
      quickSearch.hasAttachment = isActive ? null : true;
      break;
  }
}

export function searchInFolder(change: Partial<SearchOptions>) {
  if (hasSearchCriteria()) {
    searchOptions.update(options => ({ ...options, ...change }));
    return;
  }
  let carried: Partial<SearchOptions> = {
    isRead: quickSearch.isRead === false ? false : null,
    flagged: quickSearch.isStarred === true,
    hasAttachment: quickSearch.hasAttachment === true,
  };
  quickSearch.reset();
  globalSearchTerm.set(null);
  searchOptions.set({ ...defaultSearchOptions(), scope: SearchScope.CurrentFolder, ...carried, ...change });
}
