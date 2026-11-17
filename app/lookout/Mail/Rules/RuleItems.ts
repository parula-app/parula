import type { FilterRuleAction } from "../../../logic/Mail/FilterRules/FilterRuleAction";
import type { Tag } from "../../../logic/Abstract/Tag";
import { getFormattedDateString } from "../../../logic/util/date";
import { getUILocale, gt } from "../../../l10n/l10n";
import type { Collection } from "svelte-collections";

export enum RulePicker {
  Person = "person",
  Words = "words",
  Category = "category",
  Size = "size",
  Date = "date",
  Folder = "folder",
}

export interface RuleItemSpec {
  id: string;
  phrase: (value: string) => string;
  placeholder?: string;
  picker?: RulePicker;
  value?: (rule: FilterRuleAction) => string | null;
  isActive: (rule: FilterRuleAction) => boolean;
  check?: (rule: FilterRuleAction) => void;
  uncheck: (rule: FilterRuleAction) => void;
  excludes?: string[];
  onlyWhenActive?: boolean;
}

export interface RulePhrasePart {
  text: string;
  isValue: boolean;
  isPlaceholder?: boolean;
}

export class RuleItem {
  constructor(protected readonly spec: RuleItemSpec, readonly isAction: boolean) {
  }

  get id(): string {
    return this.spec.id;
  }

  get picker(): RulePicker | null {
    return this.spec.picker ?? null;
  }

  get onlyWhenActive(): boolean {
    return !!this.spec.onlyWhenActive;
  }

  isActive(rule: FilterRuleAction): boolean {
    return this.spec.isActive(rule);
  }

  value(rule: FilterRuleAction): string | null {
    return this.spec.value?.(rule) ?? null;
  }

  isMissingValue(rule: FilterRuleAction): boolean {
    return !!this.spec.picker && this.value(rule) == null;
  }

  check(rule: FilterRuleAction) {
    this.spec.check?.(rule);
  }

  uncheck(rule: FilterRuleAction) {
    this.spec.uncheck(rule);
  }

  excludes(item: RuleItem): boolean {
    return item != this &&
      (!!this.spec.excludes?.includes(item.id) || !!item.spec.excludes?.includes(this.id));
  }

  listParts(): RulePhrasePart[] {
    if (!this.spec.placeholder) {
      return [{ text: this.spec.phrase(""), isValue: false }];
    }
    return this.withValue(this.spec.placeholder, true, true);
  }

  descriptionParts(rule: FilterRuleAction): RulePhrasePart[] {
    let value = this.value(rule);
    if (this.spec.picker) {
      return this.withValue(value ?? this.spec.placeholder, true, value == null);
    }
    return [{ text: this.spec.phrase(value ?? ""), isValue: false }];
  }

  text(rule: FilterRuleAction): string {
    return this.descriptionParts(rule).map(part => part.text).join("");
  }

  protected withValue(value: string, isValue: boolean, isPlaceholder: boolean): RulePhrasePart[] {
    const kMarker = "\u0001";
    let pos = this.spec.phrase(kMarker).split(kMarker);
    let parts: RulePhrasePart[] = [];
    if (pos[0]) {
      parts.push({ text: pos[0], isValue: false });
    }
    parts.push({ text: value, isValue, isPlaceholder });
    let rest = pos.slice(1).join("");
    if (rest) {
      parts.push({ text: rest, isValue: false });
    }
    return parts;
  }
}

export function ruleConditions(): RuleItem[] {
  return conditionSpecs().map(spec => new RuleItem(spec, false));
}

export function ruleActions(): RuleItem[] {
  return actionSpecs().map(spec => new RuleItem(spec, true));
}

export function allRuleItems(): RuleItem[] {
  return [...ruleConditions(), ...ruleActions()];
}

function conditionSpecs(): RuleItemSpec[] {
  return [
    {
      id: "from",
      phrase: value => gt`from ${value}`,
      placeholder: gt`people or public group *=> Placeholder link to choose a person, as in: from people or public group`,
      picker: RulePicker.Person,
      value: rule => {
        let person = rule.criteria.includesPerson;
        return person ? person.name || person.emailAddresses.first?.value || "?" : null;
      },
      isActive: rule => !!rule.criteria.includesPerson,
      uncheck: rule => { rule.criteria.includesPerson = null; },
    },
    {
      id: "flagged",
      phrase: () => gt`which is flagged for follow up`,
      isActive: rule => rule.criteria.isStarred === true,
      check: rule => { rule.criteria.isStarred = true; },
      uncheck: rule => clearIf(rule.criteria, "isStarred", true),
      excludes: ["not-flagged"],
    },
    {
      id: "words",
      phrase: value => gt`with ${value} in the subject or body`,
      placeholder: gt`specific words *=> Placeholder link to choose words, as in: with specific words in the subject or body`,
      picker: RulePicker.Words,
      value: rule => rule.criteria.bodyText ? `"${rule.criteria.bodyText}"` : null,
      isActive: rule => !!rule.criteria.bodyText,
      uncheck: rule => { rule.criteria.bodyText = null; },
    },
    {
      id: "category",
      phrase: value => gt`assigned to ${value} category`,
      placeholder: gt`category *=> Placeholder link to choose a category in a rule`,
      picker: RulePicker.Category,
      value: rule => tagNames(rule.criteria.tags),
      isActive: rule => rule.criteria.tags.hasItems,
      uncheck: rule => rule.criteria.tags.clear(),
    },
    {
      id: "attachment",
      phrase: value => value
        ? gt`which has an attachment of type ${value}`
        : gt`which has an attachment`,
      value: rule => rule.criteria.hasAttachmentMIMETypes.hasItems
        ? rule.criteria.hasAttachmentMIMETypes.contents.join(", ")
        : null,
      isActive: rule => rule.criteria.hasAttachment === true || rule.criteria.hasAttachmentMIMETypes.hasItems,
      check: rule => { rule.criteria.hasAttachment = true; },
      uncheck: rule => {
        clearIf(rule.criteria, "hasAttachment", true);
        rule.criteria.hasAttachmentMIMETypes.clear();
      },
      excludes: ["no-attachment"],
    },
    {
      id: "size",
      phrase: value => gt`with a size ${value}`,
      placeholder: gt`in a specific range *=> Placeholder link to choose a size, as in: with a size in a specific range`,
      picker: RulePicker.Size,
      value: rule => sizeRangeText(rule.criteria.sizeMin, rule.criteria.sizeMax),
      isActive: rule => !!rule.criteria.sizeMin || !!rule.criteria.sizeMax,
      uncheck: rule => {
        rule.criteria.sizeMin = null;
        rule.criteria.sizeMax = null;
      },
    },
    {
      id: "date",
      phrase: value => gt`received ${value}`,
      placeholder: gt`in a specific date span *=> Placeholder link to choose dates, as in: received in a specific date span`,
      picker: RulePicker.Date,
      value: rule => dateSpanText(rule.criteria.sentDateMin, rule.criteria.sentDateMax),
      isActive: rule => !!rule.criteria.sentDateMin || !!rule.criteria.sentDateMax,
      uncheck: rule => {
        rule.criteria.sentDateMin = null;
        rule.criteria.sentDateMax = null;
      },
    },
    {
      id: "folder",
      phrase: value => gt`in the ${value} folder`,
      placeholder: gt`specified *=> Placeholder link to choose a folder, as in: move it to the specified folder`,
      picker: RulePicker.Folder,
      value: rule => rule.criteria.folderID ? rule.criteria.folder?.name ?? gt`missing *=> The chosen folder no longer exists, as in: move it to the missing folder` : null,
      isActive: rule => !!rule.criteria.folderID,
      uncheck: rule => { rule.criteria.folder = null; },
    },
    {
      id: "unread",
      phrase: () => gt`which is unread`,
      isActive: rule => rule.criteria.isRead === false,
      check: rule => { rule.criteria.isRead = false; },
      uncheck: rule => clearIf(rule.criteria, "isRead", false),
      excludes: ["read"],
    },
    {
      id: "read",
      phrase: () => gt`which is read *=> past tense, the message has been read`,
      isActive: rule => rule.criteria.isRead === true,
      check: rule => { rule.criteria.isRead = true; },
      uncheck: rule => clearIf(rule.criteria, "isRead", true),
    },
    {
      id: "not-flagged",
      phrase: () => gt`which is not flagged`,
      isActive: rule => rule.criteria.isStarred === false,
      check: rule => { rule.criteria.isStarred = false; },
      uncheck: rule => clearIf(rule.criteria, "isStarred", false),
    },
    {
      id: "no-attachment",
      phrase: () => gt`which has no attachment`,
      isActive: rule => rule.criteria.hasAttachment === false && !rule.criteria.hasAttachmentMIMETypes.hasItems,
      check: rule => { rule.criteria.hasAttachment = false; },
      uncheck: rule => clearIf(rule.criteria, "hasAttachment", false),
    },
    {
      id: "replied",
      phrase: () => gt`which I replied to`,
      isActive: rule => rule.criteria.isReplied === true,
      check: rule => { rule.criteria.isReplied = true; },
      uncheck: rule => clearIf(rule.criteria, "isReplied", true),
      excludes: ["not-replied"],
    },
    {
      id: "not-replied",
      phrase: () => gt`which I have not replied to`,
      isActive: rule => rule.criteria.isReplied === false,
      check: rule => { rule.criteria.isReplied = false; },
      uncheck: rule => clearIf(rule.criteria, "isReplied", false),
    },
    {
      id: "sent-by-me",
      phrase: () => gt`which was sent by me`,
      isActive: rule => rule.criteria.isOutgoing === true,
      check: rule => { rule.criteria.isOutgoing = true; },
      uncheck: rule => clearIf(rule.criteria, "isOutgoing", true),
      excludes: ["not-sent-by-me"],
    },
    {
      id: "not-sent-by-me",
      phrase: () => gt`which was not sent by me`,
      isActive: rule => rule.criteria.isOutgoing === false,
      check: rule => { rule.criteria.isOutgoing = false; },
      uncheck: rule => clearIf(rule.criteria, "isOutgoing", false),
    },
    {
      id: "conversation",
      phrase: () => gt`which belongs to a specific conversation`,
      isActive: rule => !!rule.criteria.threadID,
      uncheck: rule => { rule.criteria.threadID = null; },
      onlyWhenActive: true,
    },
  ];
}

function actionSpecs(): RuleItemSpec[] {
  const kRemovesMessage = ["move", "copy", "delete", "permanently-delete", "junk"];
  const kNotWithDelete = ["flag", "clear-flag", "assign-category"];
  return [
    {
      id: "move",
      phrase: value => gt`move it to the ${value} folder`,
      placeholder: gt`specified *=> Placeholder link to choose a folder, as in: move it to the specified folder`,
      picker: RulePicker.Folder,
      value: rule => rule.toFolderID ? rule.toFolder?.name ?? gt`missing *=> The chosen folder no longer exists, as in: move it to the missing folder` : null,
      isActive: rule => !!rule.toFolderID && !rule.copy && !isDeleted(rule),
      uncheck: rule => {
        if (!rule.copy) {
          rule.toFolder = null;
        }
      },
      excludes: kRemovesMessage,
    },
    {
      id: "assign-category",
      phrase: value => gt`assign it to the ${value} category`,
      placeholder: gt`category *=> Placeholder link to choose a category in a rule`,
      picker: RulePicker.Category,
      value: rule => tagNames(rule.addTags),
      isActive: rule => rule.addTags.hasItems,
      uncheck: rule => rule.addTags.clear(),
    },
    {
      id: "delete",
      phrase: () => gt`delete it`,
      isActive: rule => !!rule.deleteTrash && !rule.deleteImmediately && rule.markAsSpam !== true,
      check: rule => { rule.deleteTrash = true; },
      uncheck: rule => { rule.deleteTrash = null; },
      excludes: [...kRemovesMessage, ...kNotWithDelete],
    },
    {
      id: "permanently-delete",
      phrase: () => gt`permanently delete it`,
      isActive: rule => !!rule.deleteImmediately && rule.markAsSpam !== true,
      check: rule => { rule.deleteImmediately = true; },
      uncheck: rule => { rule.deleteImmediately = null; },
      excludes: [...kRemovesMessage, ...kNotWithDelete],
    },
    {
      id: "copy",
      phrase: value => gt`move a copy to the ${value} folder`,
      placeholder: gt`specified *=> Placeholder link to choose a folder, as in: move it to the specified folder`,
      picker: RulePicker.Folder,
      value: rule => rule.toFolderID && rule.copy ? rule.toFolder?.name ?? gt`missing *=> The chosen folder no longer exists, as in: move it to the missing folder` : null,
      isActive: rule => !!rule.toFolderID && !!rule.copy && !isDeleted(rule),
      uncheck: rule => {
        if (rule.copy) {
          rule.toFolder = null;
          rule.copy = null;
        }
      },
      excludes: kRemovesMessage,
    },
    {
      id: "flag",
      phrase: () => gt`flag message for follow up`,
      isActive: rule => rule.markAsStarred === true,
      check: rule => { rule.markAsStarred = true; },
      uncheck: rule => clearIf(rule, "markAsStarred", true),
      excludes: ["clear-flag"],
    },
    {
      id: "clear-flag",
      phrase: () => gt`clear the Message Flag`,
      isActive: rule => rule.markAsStarred === false,
      check: rule => { rule.markAsStarred = false; },
      uncheck: rule => clearIf(rule, "markAsStarred", false),
    },
    {
      id: "mark-read",
      phrase: () => gt`mark it as read`,
      isActive: rule => rule.markAsRead === true,
      check: rule => { rule.markAsRead = true; },
      uncheck: rule => clearIf(rule, "markAsRead", true),
      excludes: ["mark-unread"],
    },
    {
      id: "mark-unread",
      phrase: () => gt`mark it as unread`,
      isActive: rule => rule.markAsRead === false,
      check: rule => { rule.markAsRead = false; },
      uncheck: rule => clearIf(rule, "markAsRead", false),
    },
    {
      id: "junk",
      phrase: () => gt`mark it as junk`,
      isActive: rule => rule.markAsSpam === true,
      check: rule => { rule.markAsSpam = true; },
      uncheck: rule => clearIf(rule, "markAsSpam", true),
      excludes: [...kRemovesMessage, ...kNotWithDelete, "not-junk"],
    },
    {
      id: "not-junk",
      phrase: () => gt`mark it as not junk`,
      isActive: rule => rule.markAsSpam === false,
      check: rule => { rule.markAsSpam = false; },
      uncheck: rule => clearIf(rule, "markAsSpam", false),
    },
  ];
}

function isDeleted(rule: FilterRuleAction): boolean {
  return !!rule.deleteTrash || !!rule.deleteImmediately || rule.markAsSpam === true;
}

function clearIf<T extends object>(object: T, property: keyof T & string, value: boolean) {
  if (object[property] === value) {
    (object as Record<string, unknown>)[property] = null;
  }
}

export function tagNames(tags: Collection<Tag>): string | null {
  if (tags.isEmpty) {
    return null;
  }
  return new Intl.ListFormat(getUILocale(), { type: "conjunction" }).format(tags.contents.map(tag => tag.name));
}

export function kilobytes(bytes: number | null): number | null {
  return bytes ? Math.round(bytes / 1024) : null;
}

export function sizeRangeText(sizeMin: number | null, sizeMax: number | null): string | null {
  let min = kilobytes(sizeMin);
  let max = kilobytes(sizeMax);
  if (min && max) {
    return gt`between ${min} and ${max} KB`;
  } else if (min) {
    return gt`of at least ${min} KB`;
  } else if (max) {
    return gt`of at most ${max} KB`;
  }
  return null;
}

export function afterDayOf(sentDateMin: Date | null): Date | null {
  return sentDateMin ? new Date(sentDateMin.getTime() - 1) : null;
}

export function beforeDayOf(sentDateMax: Date | null): Date | null {
  return sentDateMax ? new Date(sentDateMax.getTime() + 1) : null;
}

export function sentDateMinAfter(afterDay: Date | null): Date | null {
  if (!afterDay) {
    return null;
  }
  return new Date(afterDay.getFullYear(), afterDay.getMonth(), afterDay.getDate() + 1);
}

export function sentDateMaxBefore(beforeDay: Date | null): Date | null {
  if (!beforeDay) {
    return null;
  }
  return new Date(new Date(beforeDay.getFullYear(), beforeDay.getMonth(), beforeDay.getDate()).getTime() - 1);
}

export function dateSpanText(sentDateMin: Date | null, sentDateMax: Date | null): string | null {
  let after = dateText(afterDayOf(sentDateMin));
  let before = dateText(beforeDayOf(sentDateMax));
  if (after && before) {
    return gt`after ${after} and before ${before}`;
  } else if (after) {
    return gt`after ${after}`;
  } else if (before) {
    return gt`before ${before}`;
  }
  return null;
}

function dateText(date: Date | null): string | null {
  if (!date) {
    return null;
  }
  return getFormattedDateString(date, { year: "numeric", month: "2-digit", day: "2-digit" });
}
