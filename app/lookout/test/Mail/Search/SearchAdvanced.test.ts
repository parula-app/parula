// @vitest-environment happy-dom
import { defaultSearchOptions, hasRefiners, SearchScope } from "../../../Mail/Search/MailSearch";
import { AdvancedSearchDraft, ReadStatus } from "../../../Mail/Search/AdvancedSearchDraft";
import { SizeRange } from "../../../Mail/Search/SearchRanges";
import { hasSearchCriteria, isQuickFilterActive, toggleQuickFilter, searchInFolder, QuickFilter } from "../../../Mail/MailFilters";
import { searchOptions } from "../../../Mail/Selected";
import { globalSearchTerm } from "../../../../frontend/AppsBar/selectedApp";
import { quickSearch } from "../../../../frontend/Mail/Selected";
import { expect, test, beforeEach } from "vitest";
import { get } from "svelte/store";

beforeEach(() => {
  searchOptions.set(defaultSearchOptions());
  globalSearchTerm.set(null);
  quickSearch.reset();
});

test("The draft shows the current search and gives it back unchanged", () => {
  let options = { ...defaultSearchOptions(), isRead: false, size: SizeRange.Large };
  let draft = new AdvancedSearchDraft(options, "report");
  expect(draft.keywords).toBe("report");
  expect(draft.readStatus).toBe(ReadStatus.Unread);
  let result = draft.toOptions();
  expect(result).toEqual(options);
  expect(result.isRead).toBe(false);
  expect(result.size).toBe(SizeRange.Large);
});

test("From and To are one person with a direction", () => {
  let draft = new AdvancedSearchDraft(defaultSearchOptions(), null);
  let nick = { name: "Nick" } as any;
  draft.setFrom(nick);
  expect(draft.person).toBe(nick);
  expect(draft.isOutgoing).toBe(false);
  draft.setTo(nick);
  expect(draft.person).toBe(nick);
  expect(draft.toOptions().isOutgoing).toBe(true);
  // Removing the empty From field keeps the To person
  draft.setFrom(null);
  expect(draft.person).toBe(nick);
  expect(draft.isOutgoing).toBe(true);
  draft.setTo(null);
  expect(draft.toOptions().person).toBeNull();
  expect(draft.toOptions().isOutgoing).toBeNull();
});

test("Clear filters empties everything except the scope", () => {
  let options = { ...defaultSearchOptions(), scope: SearchScope.AllAccounts, flagged: true, threadID: "<t>" };
  let draft = new AdvancedSearchDraft(options, "report");
  draft.clear();
  let result = draft.toOptions();
  expect(draft.keywords).toBe("");
  expect(result.scope).toBe(SearchScope.AllAccounts);
  expect(hasRefiners(result)).toBe(false);
});

test("Quick filters filter the folder, or refine a running search", () => {
  toggleQuickFilter(QuickFilter.Unread);
  expect(quickSearch.isRead).toBe(false);
  expect(isQuickFilterActive(QuickFilter.Unread)).toBe(true);
  expect(hasSearchCriteria()).toBe(false);

  globalSearchTerm.set("report");
  expect(isQuickFilterActive(QuickFilter.Unread)).toBe(false);
  toggleQuickFilter(QuickFilter.Flagged);
  expect(get(searchOptions).flagged).toBe(true);
  expect(quickSearch.isStarred).toBeNull();
});

test("Filters start a search in the current folder and take over the quick filters", () => {
  toggleQuickFilter(QuickFilter.Attachments);
  searchInFolder({ size: SizeRange.Large });
  let options = get(searchOptions);
  expect(options.scope).toBe(SearchScope.CurrentFolder);
  expect(options.size).toBe(SizeRange.Large);
  expect(options.hasAttachment).toBe(true);
  expect(quickSearch.hasAttachment).toBeNull();
  expect(hasSearchCriteria()).toBe(true);
});
