// @vitest-environment happy-dom
import { ArrangeBy, DateGroups, MessageGrouping, type ArrangeableMessage } from "../../../Mail/3pane/MessageGrouping";
import { getDateTimeLocale } from "../../../../l10n/l10n";
import { expect, test } from "vitest";

interface TestMessage extends ArrangeableMessage {
  name: string;
}

function msg(sent: Date, props: Partial<TestMessage> = {}): TestMessage {
  return {
    sent,
    size: 1000,
    baseSubject: "Subject",
    isImportant: false,
    isStarred: false,
    name: "Alice",
    ...props,
  };
}

// Wednesday, 2026-10-14, 15:00 local time. Week starts on Monday 2026-10-12.
const now = new Date(2026, 9, 14, 15, 0, 0);

function at(year: number, month: number, day: number, hour = 12): Date {
  return new Date(year, month - 1, day, hour);
}

test("Date groups: today, yesterday, weekdays, weeks, months, older", () => {
  let groups = new DateGroups(now);
  expect(groups.groupOf(at(2026, 10, 14, 9)).id).toBe("today");
  expect(groups.groupOf(at(2026, 10, 14, 0)).id).toBe("today");
  expect(groups.groupOf(at(2026, 10, 13, 23)).id).toBe("yesterday");
  // Monday of this week, before yesterday: shown with the weekday name
  expect(groups.groupOf(at(2026, 10, 12)).id).toBe("weekday-1");
  expect(groups.groupOf(at(2026, 10, 12)).label).toBe(at(2026, 10, 12).toLocaleDateString(getDateTimeLocale(), { weekday: "long" }));
  expect(groups.groupOf(at(2026, 10, 11)).id).toBe("last-week");
  expect(groups.groupOf(at(2026, 10, 5)).id).toBe("last-week");
  expect(groups.groupOf(at(2026, 10, 4)).id).toBe("two-weeks-ago");
  expect(groups.groupOf(at(2026, 9, 28)).id).toBe("two-weeks-ago");
  expect(groups.groupOf(at(2026, 9, 27)).id).toBe("three-weeks-ago");
  expect(groups.groupOf(at(2026, 9, 21)).id).toBe("three-weeks-ago");
  expect(groups.groupOf(at(2026, 9, 20)).id).toBe("last-month");
  expect(groups.groupOf(at(2026, 9, 1)).id).toBe("last-month");
  expect(groups.groupOf(at(2026, 8, 31)).id).toBe("older");
  expect(groups.groupOf(at(2026, 10, 15, 8)).id).toBe("future");
});

test("Date groups: 'Earlier this Month' only late in the month", () => {
  // Saturday, 2026-10-31. Week starts Monday 2026-10-26, three weeks ago starts 2026-10-05.
  let groups = new DateGroups(new Date(2026, 9, 31, 12));
  expect(groups.groupOf(at(2026, 10, 5)).id).toBe("three-weeks-ago");
  expect(groups.groupOf(at(2026, 10, 4)).id).toBe("earlier-this-month");
  expect(groups.groupOf(at(2026, 10, 1)).id).toBe("earlier-this-month");
  expect(groups.groupOf(at(2026, 9, 30)).id).toBe("last-month");
});

test("Date groups: Monday, yesterday is still 'Yesterday'", () => {
  let groups = new DateGroups(new Date(2026, 9, 12, 10));
  expect(groups.groupOf(at(2026, 10, 11)).id).toBe("yesterday");
  expect(groups.groupOf(at(2026, 10, 10)).id).toBe("last-week");
});

test("Arrange by date, newest first: keeps the order and groups contiguously", () => {
  let messages = [
    msg(at(2026, 10, 14, 10)),
    msg(at(2026, 10, 14, 9)),
    msg(at(2026, 10, 13)),
    msg(at(2026, 9, 1)),
  ];
  let grouping = new MessageGrouping<TestMessage>(ArrangeBy.Date, false, true, m => m.name, now);
  let groups = grouping.arrange(messages, true);
  expect(groups.map(group => group.id)).toEqual(["today", "yesterday", "last-month"]);
  expect(groups[0].messages).toEqual([messages[0], messages[1]]);
  expect(groups.flatMap(group => group.messages)).toEqual(messages);
});

test("Arrange by date, reversed: oldest on top", () => {
  let messages = [
    msg(at(2026, 10, 14, 10)),
    msg(at(2026, 10, 13)),
    msg(at(2026, 9, 1)),
  ];
  let grouping = new MessageGrouping<TestMessage>(ArrangeBy.Date, true, true, m => m.name, now);
  let groups = grouping.arrange(messages, true);
  expect(groups.map(group => group.id)).toEqual(["last-month", "yesterday", "today"]);
  // Input is not modified
  expect(messages[0].sent).toEqual(at(2026, 10, 14, 10));
});

test("Arrange by date: unsorted input gets sorted", () => {
  let older = msg(at(2026, 9, 1));
  let newer = msg(at(2026, 10, 14, 10));
  let grouping = new MessageGrouping<TestMessage>(ArrangeBy.Date, false, true, m => m.name, now);
  let groups = grouping.arrange([older, newer]);
  expect(groups.flatMap(group => group.messages)).toEqual([newer, older]);
});

test("Arrange by sender: A to Z, case-insensitive, newest first within a sender, empty names last", () => {
  let bobOld = msg(at(2026, 10, 1), { name: "bob" });
  let alice = msg(at(2026, 10, 2), { name: "Alice" });
  let bobNew = msg(at(2026, 10, 3), { name: "Bob" });
  let nobody = msg(at(2026, 10, 4), { name: "" });
  let grouping = new MessageGrouping<TestMessage>(ArrangeBy.From, false, true, m => m.name, now);
  let groups = grouping.arrange([bobOld, alice, nobody, bobNew]);
  expect(groups.map(group => group.label)).toEqual(["Alice", "Bob", "(none)"]);
  expect(groups[1].messages).toEqual([bobNew, bobOld]);
});

test("Arrange by size: largest first, Outlook size groups", () => {
  let tiny = msg(now, { size: 2000 });
  let large = msg(now, { size: 200 * 1024 });
  let huge = msg(now, { size: 2 * 1024 * 1024 });
  let grouping = new MessageGrouping<TestMessage>(ArrangeBy.Size, false, true, m => m.name, now);
  let groups = grouping.arrange([tiny, huge, large]);
  expect(groups.map(group => group.id)).toEqual(["size-huge", "size-large", "size-tiny"]);
  let reversed = new MessageGrouping<TestMessage>(ArrangeBy.Size, true, true, m => m.name, now);
  expect(reversed.arrange([tiny, huge, large]).map(group => group.id)).toEqual(["size-tiny", "size-large", "size-huge"]);
});

test("Arrange by flag and importance: flagged / important first", () => {
  let plain = msg(at(2026, 10, 14, 10));
  let flagged = msg(at(2026, 10, 1), { isStarred: true, isImportant: true });
  let byFlag = new MessageGrouping<TestMessage>(ArrangeBy.Flag, false, true, m => m.name, now);
  expect(byFlag.arrange([plain, flagged]).map(group => group.id)).toEqual(["flagged", "unflagged"]);
  let byImportance = new MessageGrouping<TestMessage>(ArrangeBy.Importance, false, true, m => m.name, now);
  expect(byImportance.arrange([plain, flagged]).map(group => group.id)).toEqual(["importance-high", "importance-normal"]);
});

test("Arranging by flag or importance changes when a message changes", () => {
  expect(new MessageGrouping<TestMessage>(ArrangeBy.Date, false, true, m => m.name, now).changesWithMessages).toBe(false);
  expect(new MessageGrouping<TestMessage>(ArrangeBy.From, false, true, m => m.name, now, false, ArrangeBy.Size).changesWithMessages).toBe(false);
  expect(new MessageGrouping<TestMessage>(ArrangeBy.Flag, false, true, m => m.name, now).changesWithMessages).toBe(true);
  expect(new MessageGrouping<TestMessage>(ArrangeBy.Importance, false, false, m => m.name, now).changesWithMessages).toBe(true);
  expect(new MessageGrouping<TestMessage>(ArrangeBy.Date, false, true, m => m.name, now, false, ArrangeBy.Flag).changesWithMessages).toBe(true);
});

test("Without groups: one group with all messages, sorted", () => {
  let a = msg(now, { baseSubject: "beta" });
  let b = msg(now, { baseSubject: "Alpha" });
  let grouping = new MessageGrouping<TestMessage>(ArrangeBy.Subject, false, false, m => m.name, now);
  let groups = grouping.arrange([a, b]);
  expect(groups.length).toBe(1);
  expect(groups[0].messages).toEqual([b, a]);
});

test("Conversations: the newest message of a thread leads it, in its date group", () => {
  let newest = msg(at(2026, 10, 14, 10), { threadID: "t1" });
  let secondThread = msg(at(2026, 10, 13), { threadID: "t2" });
  let older = msg(at(2026, 9, 1), { threadID: "t1" });
  let single = msg(at(2026, 9, 1, 8));
  let grouping = new MessageGrouping<TestMessage>(ArrangeBy.Date, false, true, m => m.name, now, true);
  let groups = grouping.arrange([newest, secondThread, older, single], true);
  expect(groups.map(group => group.id)).toEqual(["today", "yesterday", "last-month"]);
  expect(groups[0].messages).toEqual([newest]);
  expect(groups[0].threads.get(newest)).toEqual([newest, older]);
  expect(groups[1].threads.size).toBe(0);
  expect(groups[2].messages).toEqual([single]);
});

test("Without conversations, messages of a thread are listed separately", () => {
  let newest = msg(at(2026, 10, 14, 10), { threadID: "t1" });
  let older = msg(at(2026, 9, 1), { threadID: "t1" });
  let grouping = new MessageGrouping<TestMessage>(ArrangeBy.Date, false, false, m => m.name, now);
  let groups = grouping.arrange([newest, older], true);
  expect(groups[0].messages).toEqual([newest, older]);
  expect(groups[0].threads).toBeUndefined();
});

test("Group By a different field than the sort: groups ordered by the group field, sorted inside", () => {
  let bigOld = msg(at(2026, 9, 1), { size: 2 * 1024 * 1024, name: "Zoe" });
  let bigNew = msg(at(2026, 10, 14, 10), { size: 3 * 1024 * 1024, name: "Anna" });
  let tiny = msg(at(2026, 10, 13), { size: 100, name: "Mia" });
  // Sorted by From (A on top), grouped by Size (largest group first)
  let grouping = new MessageGrouping<TestMessage>(ArrangeBy.From, false, true, m => m.name, now, false, ArrangeBy.Size, false);
  let groups = grouping.arrange([bigOld, bigNew, tiny]);
  expect(groups.map(group => group.id)).toEqual(["size-huge", "size-tiny"]);
  expect(groups[0].messages).toEqual([bigNew, bigOld]);
  // Reversed group order: smallest group first
  let reversed = new MessageGrouping<TestMessage>(ArrangeBy.From, false, true, m => m.name, now, false, ArrangeBy.Size, true);
  expect(reversed.arrange([bigOld, bigNew, tiny]).map(group => group.id)).toEqual(["size-tiny", "size-huge"]);
});

test("Ascending / descending default per field", () => {
  expect(MessageGrouping.isDescendingByDefault(ArrangeBy.Date)).toBe(true);
  expect(MessageGrouping.isDescendingByDefault(ArrangeBy.Size)).toBe(true);
  expect(MessageGrouping.isDescendingByDefault(ArrangeBy.Importance)).toBe(true);
  expect(MessageGrouping.isDescendingByDefault(ArrangeBy.Flag)).toBe(true);
  expect(MessageGrouping.isDescendingByDefault(ArrangeBy.From)).toBe(false);
  expect(MessageGrouping.isDescendingByDefault(ArrangeBy.Subject)).toBe(false);
});

test("Reply depth counts the ancestors that are in the conversation", () => {
  let root = { messageID: "a", references: [] };
  let reply = { messageID: "b", references: ["a"] };
  let replyToReply = { messageID: "c", references: ["a", "b"] };
  let replyToMissing = { messageID: "d", references: ["x", "a"] };
  let thread = [root, reply, replyToReply, replyToMissing];
  expect(MessageGrouping.replyDepth(root, thread)).toBe(0);
  expect(MessageGrouping.replyDepth(reply, thread)).toBe(1);
  expect(MessageGrouping.replyDepth(replyToReply, thread)).toBe(2);
  expect(MessageGrouping.replyDepth(replyToMissing, thread)).toBe(1);
});

test("Sort orders list the ascending order first, like Outlook's Sort order menu", () => {
  // Date is newest first by default, so "Oldest on top" is the reversed order and comes first
  expect(MessageGrouping.sortOrders(ArrangeBy.Date)).toEqual([
    { label: "Oldest on top", reversed: true },
    { label: "Newest on top", reversed: false },
  ]);
  expect(MessageGrouping.sortOrders(ArrangeBy.From)).toEqual([
    { label: "A on top", reversed: false },
    { label: "Z on top", reversed: true },
  ]);
  expect(MessageGrouping.sortOrders(ArrangeBy.Size)).toEqual([
    { label: "Smallest on top", reversed: true },
    { label: "Largest on top", reversed: false },
  ]);
});
