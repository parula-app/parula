// @vitest-environment happy-dom
import { defaultSearchOptions, hasRefiners, scopeLabel, scopeShortLabel, SearchScope } from "../../../Mail/Search/MailSearch";
import { SizeRange } from "../../../Mail/Search/SearchRanges";
import { expect, test } from "vitest";

test("Any refiner starts a search, like in Outlook", () => {
  let options = defaultSearchOptions();
  expect(hasRefiners(options)).toBe(false);
  expect(hasRefiners({ ...options, isRead: false })).toBe(true);
  expect(hasRefiners({ ...options, hasAttachment: true })).toBe(true);
  expect(hasRefiners({ ...options, person: {} as any })).toBe(true);
  expect(hasRefiners({ ...options, isOutgoing: true })).toBe(true);
  expect(hasRefiners({ ...options, size: SizeRange.Large })).toBe(true);
  expect(hasRefiners({ ...options, threadID: "<thread@example.com>" })).toBe(true);
  // The scope alone is no criterion
  expect(hasRefiners({ ...options, scope: SearchScope.AllAccounts })).toBe(false);
});

test("Scopes are named after accounts and folders", () => {
  expect(scopeLabel(SearchScope.AllAccounts)).toBe("All Accounts");
  expect(scopeLabel(SearchScope.CurrentAccount)).toBe("Current Account");
  expect(scopeLabel(SearchScope.CurrentFolder)).toBe("Current Folder");
  expect(scopeShortLabel(SearchScope.AllAccounts)).toBe("All");
  expect(scopeShortLabel(SearchScope.CurrentAccount)).toBe("Account");
  expect(scopeShortLabel(SearchScope.CurrentFolder)).toBe("Folder");
});
