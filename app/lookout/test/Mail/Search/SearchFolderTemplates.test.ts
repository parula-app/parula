// @vitest-environment happy-dom
import { SearchFolderTemplate, SearchFolderTemplateID } from "../../../Mail/Search/SearchFolderTemplates";
import { SearchFolderCriteria } from "../../../Mail/Search/SearchFolderCriteria";
import { ReadStatus } from "../../../Mail/Search/AdvancedSearchDraft";
import { SizeRange } from "../../../Mail/Search/SearchRanges";
import { SearchEMail } from "../../../../logic/Mail/Store/SearchEMail";
import { getTagByName } from "../../../../logic/Abstract/Tag";
import { expect, test } from "vitest";

function template(id: SearchFolderTemplateID): SearchFolderTemplate {
  return SearchFolderTemplate.all().find(candidate => candidate.id == id);
}

test("Templates are grouped in Outlook's sections", () => {
  let all = SearchFolderTemplate.all();
  expect(all.filter(candidate => candidate.section).map(candidate => candidate.section))
    .toEqual(["Reading Mail", "Mail from People and Lists", "Organizing Mail", "Custom"]);
  expect(all[0].id).toBe(SearchFolderTemplateID.Unread);
});

test("Simple templates need no choice and set one criterion", () => {
  let values = SearchFolderTemplate.emptyValues();
  let unread = template(SearchFolderTemplateID.Unread);
  expect(unread.canChoose).toBe(false);
  expect(unread.missingValue(values)).toBeNull();
  let search = new SearchEMail();
  unread.apply(search, values);
  expect(search.isRead).toBe(false);
  expect(unread.name(values)).toBe("Unread Mail");

  let attachments = new SearchEMail();
  template(SearchFolderTemplateID.Attachments).apply(attachments, values);
  expect(attachments.hasAttachment).toBe(true);
});

test("Templates with a choice need the value and name the folder after it", () => {
  let values = SearchFolderTemplate.emptyValues();
  let words = template(SearchFolderTemplateID.Words);
  expect(words.canChoose).toBe(true);
  expect(words.missingValue(values)).toBeTruthy();
  values.words = " invoice ";
  expect(words.missingValue(values)).toBeNull();
  expect(words.name(values)).toBe("Containing invoice");
  let search = new SearchEMail();
  words.apply(search, values);
  expect(search.bodyText).toBe("invoice");

  let large = template(SearchFolderTemplateID.Large);
  expect(large.missingValue(values)).toBeNull();
  expect(large.description(values)).toBe("Show mail greater than 100 KB");
  let largeSearch = new SearchEMail();
  large.apply(largeSearch, values);
  expect(largeSearch.sizeMin).toBe(100 * 1024);

  let categorized = template(SearchFolderTemplateID.Categorized);
  expect(categorized.missingValue(values)).toBeTruthy();
  values.tags = [getTagByName("Blue category")];
  let categorizedSearch = new SearchEMail();
  categorized.apply(categorizedSearch, values);
  expect(categorizedSearch.tags.contents.map(tag => tag.name)).toEqual(["Blue category"]);
});

test("Criteria of a saved search show in the Advanced Search form and are written back", () => {
  let search = new SearchEMail();
  search.bodyText = "report";
  search.isRead = false;
  search.hasAttachment = true;
  search.sizeMin = 100 * 1024;
  search.sizeMax = 500 * 1024 - 1;
  let criteria = new SearchFolderCriteria(search);
  expect(criteria.draft.keywords).toBe("report");
  expect(criteria.draft.readStatus).toBe(ReadStatus.Unread);
  expect(criteria.draft.hasAttachment).toBe(true);
  expect(criteria.draft.size).toBe(SizeRange.Large);

  criteria.draft.keywords = "invoice";
  criteria.draft.readStatus = ReadStatus.All;
  criteria.draft.flagged = true;
  criteria.writeTo(search);
  expect(search.bodyText).toBe("invoice");
  expect(search.isRead).toBeNull();
  expect(search.isStarred).toBe(true);
  expect(search.sizeMin).toBe(100 * 1024);
});

test("A size that is not one of the named ranges stays unless changed", () => {
  let search = new SearchEMail();
  search.sizeMin = 123;
  let criteria = new SearchFolderCriteria(search);
  expect(criteria.draft.size).toBe(SizeRange.Any);
  criteria.writeTo(search);
  expect(search.sizeMin).toBe(123);
  criteria.draft.size = SizeRange.Huge;
  criteria.writeTo(search);
  expect(search.sizeMin).toBe(1024 * 1024);
});
