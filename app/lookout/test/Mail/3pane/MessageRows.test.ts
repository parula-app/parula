import { MessageRows } from "../../../Mail/3pane/MessageRows";
import type { MessageGroup } from "../../../Mail/3pane/MessageGrouping";
import { expect, test } from "vitest";

const today: MessageGroup<string> = { id: "today", label: "Today", messages: ["a", "b", "c"] };
const older: MessageGroup<string> = { id: "older", label: "Older", messages: ["d", "e"] };

test("Rows with group headers: positions and lookup", () => {
  let rows = new MessageRows([today, older], new Set(), true, 30, 70);
  expect(rows.length).toBe(7);
  expect(rows.rows.map(row => row.kind == "header" ? row.group.id : row.message))
    .toEqual(["today", "a", "b", "c", "older", "d", "e"]);
  expect(rows.messages).toEqual(["a", "b", "c", "d", "e"]);
  expect(rows.totalHeight).toBe(2 * 30 + 5 * 70);
  expect(rows.topOf(0)).toBe(0);
  expect(rows.topOf(1)).toBe(30);
  expect(rows.topOf(4)).toBe(30 + 3 * 70);
  expect(rows.heightOf(0)).toBe(30);
  expect(rows.heightOf(1)).toBe(70);
  expect(rows.indexAt(0)).toBe(0);
  expect(rows.indexAt(29)).toBe(0);
  expect(rows.indexAt(30)).toBe(1);
  expect(rows.indexAt(30 + 70 * 3)).toBe(4);
  expect(rows.indexAt(30 + 70 * 3 + 29)).toBe(4);
  expect(rows.indexAt(30 + 70 * 3 + 30)).toBe(5);
  expect(rows.indexAt(100000)).toBe(6);
  expect(rows.indexAt(-5)).toBe(0);
  expect(rows.indexOfMessage("d")).toBe(5);
  expect(rows.indexOfMessage("x")).toBe(-1);
});

test("Collapsed groups have only their header row", () => {
  let rows = new MessageRows([today, older], new Set(["today"]), true, 30, 70);
  expect(rows.rows.map(row => row.kind == "header" ? row.group.id : row.message))
    .toEqual(["today", "older", "d", "e"]);
  expect(rows.rows[0].kind == "header" && rows.rows[0].isCollapsed).toBe(true);
  expect(rows.hasMessage("a")).toBe(false);
  expect(rows.messages).toEqual(["d", "e"]);
  expect(rows.totalHeight).toBe(2 * 30 + 2 * 70);
});

test("Without headers: only messages, collapse state ignored", () => {
  let rows = new MessageRows([today, older], new Set(["today"]), false, 30, 70);
  expect(rows.length).toBe(5);
  expect(rows.totalHeight).toBe(5 * 70);
  expect(rows.indexAt(140)).toBe(2);
});

test("Empty list", () => {
  let rows = new MessageRows<string>([], new Set(), true, 30, 70);
  expect(rows.length).toBe(0);
  expect(rows.indexAt(10)).toBe(-1);
  expect(rows.totalHeight).toBe(0);
});

test("Conversations: collapsed show the lead only, expanded add the other messages", () => {
  let group: MessageGroup<string> = {
    id: "today",
    label: "Today",
    messages: ["a", "x"],
    threads: new Map([["a", ["a", "b", "c"]]]),
  };
  let collapsed = new MessageRows([group], new Set(), true, 30, 70);
  expect(collapsed.messages).toEqual(["a", "x"]);
  let lead = collapsed.rows[1];
  expect(lead.kind == "message" && lead.thread).toEqual(["a", "b", "c"]);
  expect(lead.kind == "message" && lead.isThreadExpanded).toBe(false);

  let expanded = new MessageRows([group], new Set(), true, 30, 70, new Set(["a"]));
  expect(expanded.messages).toEqual(["a", "b", "c", "x"]);
  expect(expanded.rows.map(row => row.kind == "message" && row.isThreadChild)).toEqual([false, false, true, true, false]);
  expect(expanded.totalHeight).toBe(30 + 4 * 70);
  expect(expanded.indexOfMessage("c")).toBe(3);
});
