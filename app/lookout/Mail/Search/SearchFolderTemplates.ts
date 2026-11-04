import type { Person } from "../../../logic/Abstract/Person";
import type { Tag } from "../../../logic/Abstract/Tag";
import type { SearchEMail } from "../../../logic/Mail/Store/SearchEMail";
import { gt } from "../../../l10n/l10n";

export enum SearchFolderTemplateID {
  Unread = "unread",
  Flagged = "flagged",
  Person = "person",
  Categorized = "categorized",
  Large = "large",
  Attachments = "attachments",
  Words = "words",
  Custom = "custom",
}

export interface SearchFolderValues {
  person: Person | null;
  tags: Tag[];
  sizeMin: number | null;
  sizeMax: number | null;
  words: string | null;
  customName: string | null;
  customSearch: SearchEMail | null;
}

export class SearchFolderTemplate {
  readonly id: SearchFolderTemplateID;
  readonly label: string;
  readonly section: string | null;

  constructor(id: SearchFolderTemplateID, label: string, section: string | null = null) {
    this.id = id;
    this.label = label;
    this.section = section;
  }

  static all(): SearchFolderTemplate[] {
    return [
      new SearchFolderTemplate(SearchFolderTemplateID.Unread, gt`Unread mail`, gt`Reading Mail *=> Group of search folder templates for reading emails`),
      new SearchFolderTemplate(SearchFolderTemplateID.Flagged, gt`Mail flagged for follow up`),
      new SearchFolderTemplate(SearchFolderTemplateID.Person, gt`Mail from and to specific people`, gt`Mail from People and Lists`),
      new SearchFolderTemplate(SearchFolderTemplateID.Categorized, gt`Categorized mail`, gt`Organizing Mail *=> Group of search folder templates for organizing emails`),
      new SearchFolderTemplate(SearchFolderTemplateID.Large, gt`Large mail`),
      new SearchFolderTemplate(SearchFolderTemplateID.Attachments, gt`Mail with attachments`),
      new SearchFolderTemplate(SearchFolderTemplateID.Words, gt`Mail with specific words`),
      new SearchFolderTemplate(SearchFolderTemplateID.Custom, gt`Create a custom Search Folder`, gt`Custom`),
    ];
  }

  static emptyValues(): SearchFolderValues {
    const kDefaultLargeSize = 100 * 1024;
    return {
      person: null,
      tags: [],
      sizeMin: kDefaultLargeSize,
      sizeMax: null,
      words: null,
      customName: null,
      customSearch: null,
    };
  }

  get canChoose(): boolean {
    return [SearchFolderTemplateID.Person, SearchFolderTemplateID.Categorized, SearchFolderTemplateID.Large,
      SearchFolderTemplateID.Words, SearchFolderTemplateID.Custom].includes(this.id);
  }

  description(values: SearchFolderValues): string {
    switch (this.id) {
      case SearchFolderTemplateID.Person:
        return gt`Show mail from and to: ${values.person?.name ?? gt`(choose a person)`}`;
      case SearchFolderTemplateID.Categorized:
        return gt`Show mail categorized as: ${values.tags.map(tag => tag.name).join(", ") || gt`(choose categories)`}`;
      case SearchFolderTemplateID.Large:
        return SearchFolderTemplate.sizeDescription(values.sizeMin, values.sizeMax);
      case SearchFolderTemplateID.Words:
        return gt`Show mail with these words: ${values.words || gt`(choose words)`}`;
      case SearchFolderTemplateID.Custom:
        return values.customName ? gt`Search Folder: ${values.customName}` : gt`Choose a name and the criteria`;
      default:
        return "";
    }
  }

  static sizeDescription(sizeMin: number | null, sizeMax: number | null): string {
    let min = sizeMin ? Math.round(sizeMin / 1024) : null;
    let max = sizeMax ? Math.round(sizeMax / 1024) : null;
    if (min && max) {
      return gt`Show mail between ${min} KB and ${max} KB`;
    } else if (max) {
      return gt`Show mail smaller than ${max} KB`;
    }
    return gt`Show mail greater than ${min ?? 0} KB`;
  }

  missingValue(values: SearchFolderValues): string | null {
    switch (this.id) {
      case SearchFolderTemplateID.Person:
        return values.person ? null : gt`Choose a person first`;
      case SearchFolderTemplateID.Categorized:
        return values.tags.length ? null : gt`Choose the categories first`;
      case SearchFolderTemplateID.Large:
        return values.sizeMin || values.sizeMax ? null : gt`Choose the size first`;
      case SearchFolderTemplateID.Words:
        return values.words?.trim() ? null : gt`Choose the words first`;
      case SearchFolderTemplateID.Custom:
        return values.customName?.trim() && values.customSearch ? null : gt`Choose a name and the criteria first`;
      default:
        return null;
    }
  }

  name(values: SearchFolderValues): string {
    switch (this.id) {
      case SearchFolderTemplateID.Unread:
        return gt`Unread Mail`;
      case SearchFolderTemplateID.Flagged:
        return gt`For Follow Up`;
      case SearchFolderTemplateID.Person:
        return gt`Mail from and to ${values.person?.name ?? ""}`;
      case SearchFolderTemplateID.Categorized:
        return gt`Categorized Mail`;
      case SearchFolderTemplateID.Large:
        return gt`Large Mail`;
      case SearchFolderTemplateID.Attachments:
        return gt`Mail with Attachments`;
      case SearchFolderTemplateID.Words:
        return gt`Containing ${values.words?.trim() ?? ""}`;
      case SearchFolderTemplateID.Custom:
        return values.customName?.trim() ?? "";
    }
  }

  apply(search: SearchEMail, values: SearchFolderValues) {
    switch (this.id) {
      case SearchFolderTemplateID.Unread:
        search.isRead = false;
        break;
      case SearchFolderTemplateID.Flagged:
        search.isStarred = true;
        break;
      case SearchFolderTemplateID.Person:
        search.includesPerson = values.person;
        break;
      case SearchFolderTemplateID.Categorized:
        search.tags.addAll(values.tags);
        break;
      case SearchFolderTemplateID.Large:
        search.sizeMin = values.sizeMin;
        search.sizeMax = values.sizeMax;
        break;
      case SearchFolderTemplateID.Attachments:
        search.hasAttachment = true;
        break;
      case SearchFolderTemplateID.Words:
        search.bodyText = values.words?.trim() || null;
        break;
      case SearchFolderTemplateID.Custom:
        search.copyFrom(values.customSearch);
        break;
    }
  }
}
