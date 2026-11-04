import { getWeekStart } from "../../../logic/util/date";
import { getDateTimeLocale, gt } from "../../../l10n/l10n";

export enum ArrangeBy {
  Date = "date",
  From = "from",
  Subject = "subject",
  Size = "size",
  Importance = "importance",
  Flag = "flag",
}

export interface ArrangeableMessage {
  sent: Date;
  size: number;
  baseSubject: string;
  isImportant: boolean;
  isStarred: boolean;
  threadID?: string | null;
}

export interface MessageGroup<T> {
  id: string;
  label: string;
  messages: T[];
  threads?: Map<T, T[]>;
}

export interface GroupKey {
  id: string;
  label: string;
}

export class DateGroups {
  protected readonly tomorrowStart: Date;
  protected readonly todayStart: Date;
  protected readonly yesterdayStart: Date;
  protected readonly weekStart: Date;
  protected readonly lastWeekStart: Date;
  protected readonly twoWeeksAgoStart: Date;
  protected readonly threeWeeksAgoStart: Date;
  protected readonly monthStart: Date;
  protected readonly lastMonthStart: Date;

  constructor(now = new Date()) {
    this.todayStart = new Date(now);
    this.todayStart.setHours(0, 0, 0, 0);
    this.tomorrowStart = DateGroups.addDays(this.todayStart, 1);
    this.yesterdayStart = DateGroups.addDays(this.todayStart, -1);
    this.weekStart = getWeekStart(now);
    this.lastWeekStart = DateGroups.addDays(this.weekStart, -7);
    this.twoWeeksAgoStart = DateGroups.addDays(this.weekStart, -14);
    this.threeWeeksAgoStart = DateGroups.addDays(this.weekStart, -21);
    this.monthStart = new Date(this.todayStart);
    this.monthStart.setDate(1);
    this.lastMonthStart = new Date(this.monthStart);
    this.lastMonthStart.setMonth(this.lastMonthStart.getMonth() - 1);
  }

  groupOf(date: Date): GroupKey {
    if (!date) {
      return { id: "none", label: gt`No date` };
    } else if (date >= this.tomorrowStart) {
      return { id: "future", label: gt`Future *=> Group of emails with a date in the future` };
    } else if (date >= this.todayStart) {
      return { id: "today", label: gt`Today` };
    } else if (date >= this.yesterdayStart) {
      return { id: "yesterday", label: gt`Yesterday *=> The day before today` };
    } else if (date >= this.weekStart) {
      return {
        id: "weekday-" + date.getDay(),
        label: date.toLocaleDateString(getDateTimeLocale(), { weekday: "long" }),
      };
    } else if (date >= this.lastWeekStart) {
      return { id: "last-week", label: gt`Last Week` };
    } else if (date >= this.twoWeeksAgoStart) {
      return { id: "two-weeks-ago", label: gt`Two Weeks Ago` };
    } else if (date >= this.threeWeeksAgoStart) {
      return { id: "three-weeks-ago", label: gt`Three Weeks Ago` };
    } else if (date >= this.monthStart) {
      return { id: "earlier-this-month", label: gt`Earlier this Month` };
    } else if (date >= this.lastMonthStart) {
      return { id: "last-month", label: gt`Last Month` };
    } else {
      return { id: "older", label: gt`Older *=> Group of emails older than last month` };
    }
  }

  static addDays(date: Date, days: number): Date {
    let result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }
}

export class MessageGrouping<T extends ArrangeableMessage> {
  readonly arrangeBy: ArrangeBy;
  readonly reversed: boolean;
  readonly showInGroups: boolean;
  readonly asConversations: boolean;
  readonly groupBy: ArrangeBy | null;
  readonly groupReversed: boolean;
  protected readonly nameOf: (message: T) => string;
  protected readonly dateGroups: DateGroups;

  constructor(arrangeBy: ArrangeBy, reversed: boolean, showInGroups: boolean, nameOf: (message: T) => string, now = new Date(), asConversations = false,
      groupBy: ArrangeBy | null = null, groupReversed = false) {
    this.arrangeBy = arrangeBy;
    this.reversed = reversed;
    this.showInGroups = showInGroups;
    this.asConversations = asConversations;
    this.groupBy = groupBy;
    this.groupReversed = groupReversed;
    this.nameOf = nameOf;
    this.dateGroups = new DateGroups(now);
  }

  get groupField(): ArrangeBy {
    return this.groupBy ?? this.arrangeBy;
  }

  get changesWithMessages(): boolean {
    let changingFields = [ArrangeBy.Flag, ArrangeBy.Importance];
    return changingFields.includes(this.arrangeBy) || changingFields.includes(this.groupBy);
  }

  arrange(messages: T[], isSortedNewestFirst = false): MessageGroup<T>[] {
    let sorted = this.sort(messages, isSortedNewestFirst);
    let threads = this.asConversations ? MessageGrouping.threadsOf(sorted) : null;
    let leads = threads ? sorted.filter(message => !threads.followers.has(message)) : sorted;
    if (!this.showInGroups) {
      return [{ id: "all", label: "", messages: leads, threads: threads?.byLead }];
    }
    let groups: MessageGroup<T>[] = [];
    let byID = new Map<string, MessageGroup<T>>();
    for (let message of leads) {
      let key = this.groupOf(message);
      let group = byID.get(key.id);
      if (!group) {
        group = { id: key.id, label: key.label, messages: [], threads: threads ? new Map() : undefined };
        byID.set(key.id, group);
        groups.push(group);
      }
      group.messages.push(message);
      let thread = threads?.byLead.get(message);
      if (thread) {
        group.threads.set(message, thread);
      }
    }
    if (this.groupBy && this.groupBy != this.arrangeBy) {
      let compare = this.compareFor(this.groupBy);
      let direction = this.groupReversed ? -1 : 1;
      groups.sort((a, b) => direction * compare(a.messages[0], b.messages[0]));
    }
    return groups;
  }

  static threadsOf<M extends ArrangeableMessage>(sorted: M[]): { byLead: Map<M, M[]>, followers: Set<M> } {
    let byThreadID = new Map<string, M[]>();
    for (let message of sorted) {
      if (!message.threadID) {
        continue;
      }
      let thread = byThreadID.get(message.threadID);
      if (thread) {
        thread.push(message);
      } else {
        byThreadID.set(message.threadID, [message]);
      }
    }
    let byLead = new Map<M, M[]>();
    let followers = new Set<M>();
    for (let thread of byThreadID.values()) {
      if (thread.length < 2) {
        continue;
      }
      byLead.set(thread[0], thread);
      for (let follower of thread.slice(1)) {
        followers.add(follower);
      }
    }
    return { byLead, followers };
  }

  sort(messages: T[], isSortedNewestFirst = false): T[] {
    if (this.arrangeBy == ArrangeBy.Date && isSortedNewestFirst) {
      return this.reversed ? messages.slice().reverse() : messages;
    }
    let primary = this.compareFor(this.arrangeBy);
    let direction = this.reversed ? -1 : 1;
    return messages.slice().sort((a, b) =>
      direction * primary(a, b) || MessageGrouping.compareDateNewestFirst(a, b));
  }

  groupOf(message: T, field = this.groupField): GroupKey {
    switch (field) {
      case ArrangeBy.From: {
        let name = this.nameOf(message)?.trim();
        return name
          ? { id: "from:" + name.toLowerCase(), label: name }
          : { id: "from:", label: gt`(none) *=> Group of emails without a sender` };
      }
      case ArrangeBy.Subject: {
        let subject = message.baseSubject?.trim();
        return subject
          ? { id: "subject:" + subject.toLowerCase(), label: subject }
          : { id: "subject:", label: gt`(no subject)` };
      }
      case ArrangeBy.Size:
        return MessageGrouping.sizeGroupOf(message.size);
      case ArrangeBy.Importance:
        return message.isImportant
          ? { id: "importance-high", label: gt`Importance: High` }
          : { id: "importance-normal", label: gt`Importance: Normal` };
      case ArrangeBy.Flag:
        return message.isStarred
          ? { id: "flagged", label: gt`Flagged *=> State of the email that has been flagged for follow-up` }
          : { id: "unflagged", label: gt`Unflagged *=> State of the email that is not flagged` };
      default:
        return this.dateGroups.groupOf(message.sent);
    }
  }

  compareFor(field: ArrangeBy): (a: T, b: T) => number {
    switch (field) {
      case ArrangeBy.From:
        return (a, b) => MessageGrouping.compareText(this.nameOf(a), this.nameOf(b));
      case ArrangeBy.Subject:
        return (a, b) => MessageGrouping.compareText(a.baseSubject, b.baseSubject);
      case ArrangeBy.Size:
        return (a, b) => (b.size ?? 0) - (a.size ?? 0);
      case ArrangeBy.Importance:
        return (a, b) => Number(b.isImportant) - Number(a.isImportant);
      case ArrangeBy.Flag:
        return (a, b) => Number(b.isStarred) - Number(a.isStarred);
      default:
        return MessageGrouping.compareDateNewestFirst;
    }
  }

  static sortOrders(arrangeBy: ArrangeBy): { label: string, reversed: boolean }[] {
    let [normal, reversed] = MessageGrouping.sortOrderLabels(arrangeBy);
    let orders = [{ label: normal, reversed: false }, { label: reversed, reversed: true }];
    return MessageGrouping.isDescendingByDefault(arrangeBy) ? orders.reverse() : orders;
  }

  static sortOrderLabels(arrangeBy: ArrangeBy): [string, string] {
    switch (arrangeBy) {
      case ArrangeBy.From:
      case ArrangeBy.Subject:
        return [gt`A on top`, gt`Z on top`];
      case ArrangeBy.Size:
        return [gt`Largest on top`, gt`Smallest on top`];
      case ArrangeBy.Importance:
        return [gt`High on top`, gt`Normal on top`];
      case ArrangeBy.Flag:
        return [gt`Flagged on top`, gt`Unflagged on top`];
      default:
        return [gt`Newest on top`, gt`Oldest on top`];
    }
  }

  static replyDepth<M extends { messageID?: string, references?: string[] | null }>(message: M, thread: M[]): number {
    let ids = new Set(thread.filter(candidate => candidate != message).map(candidate => candidate.messageID));
    return (message.references ?? []).filter(id => ids.has(id)).length;
  }

  static isDescendingByDefault(field: ArrangeBy): boolean {
    return field != ArrangeBy.From && field != ArrangeBy.Subject;
  }

  static compareDateNewestFirst(a: ArrangeableMessage, b: ArrangeableMessage): number {
    return (b.sent?.getTime() ?? 0) - (a.sent?.getTime() ?? 0);
  }

  static compareText(a: string, b: string): number {
    let aEmpty = !a?.trim();
    let bEmpty = !b?.trim();
    if (aEmpty || bEmpty) {
      return Number(aEmpty) - Number(bEmpty);
    }
    return a.trim().localeCompare(b.trim(), undefined, { sensitivity: "base" });
  }

  static sizeGroupOf(size: number): GroupKey {
    const kKB = 1024;
    const kMB = 1024 * kKB;
    size ??= 0;
    if (size > 5 * kMB) {
      return { id: "size-enormous", label: gt`Enormous (> 5 MB)` };
    } else if (size > kMB) {
      return { id: "size-huge", label: gt`Huge (1 - 5 MB)` };
    } else if (size > 500 * kKB) {
      return { id: "size-very-large", label: gt`Very Large (500 KB - 1 MB)` };
    } else if (size > 100 * kKB) {
      return { id: "size-large", label: gt`Large (100 - 500 KB)` };
    } else if (size > 25 * kKB) {
      return { id: "size-medium", label: gt`Medium (25 - 100 KB)` };
    } else if (size > 10 * kKB) {
      return { id: "size-small", label: gt`Small (10 - 25 KB)` };
    } else {
      return { id: "size-tiny", label: gt`Tiny (< 10 KB)` };
    }
  }
}
