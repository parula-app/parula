import { searchRibbonCommands } from "../../../Shared/Ribbon/RibbonCommands";
import { expect, test } from "vitest";

const entries = [
  { label: "New Email", tooltip: "", tabLabel: "Home", groupLabel: "New" },
  { label: "Reply All", tooltip: "", tabLabel: "Home", groupLabel: "Respond" },
  { label: "Reply", tooltip: "", tabLabel: "Home", groupLabel: "Respond" },
  { label: "Send/Receive All Folders", tooltip: "", tabLabel: "Home", groupLabel: "Send/Receive" },
  { label: "New Folder", tooltip: "", tabLabel: "Folder", groupLabel: "New" },
  { label: "Send/Receive All Folders", tooltip: "", tabLabel: "Send / Receive", groupLabel: "Send & Receive" },
  { label: "Unread/ Read", tooltip: "Mark as Read", tabLabel: "Home", groupLabel: "Tags" },
  { label: "Delete All", tooltip: "", tabLabel: "Folder", groupLabel: "Clean Up" },
];

test("An empty search finds nothing", () => {
  expect(searchRibbonCommands(entries, "")).toEqual([]);
  expect(searchRibbonCommands(entries, "  ")).toEqual([]);
});

test("Exact and prefix matches come first, then word starts, then substrings", () => {
  let labels = searchRibbonCommands(entries, "reply").map(entry => entry.label);
  expect(labels).toEqual(["Reply", "Reply All"]);
  labels = searchRibbonCommands(entries, "folder").map(entry => entry.label);
  expect(labels).toEqual(["Send/Receive All Folders", "New Folder", "Delete All"]);
});

test("The same command on two tabs is listed once", () => {
  let found = searchRibbonCommands(entries, "receive");
  expect(found.length).toBe(1);
  expect(found[0].tabLabel).toBe("Home");
});

test("Tooltips and group names match, too, with lower rank", () => {
  expect(searchRibbonCommands(entries, "mark as").map(entry => entry.label)).toEqual(["Unread/ Read"]);
  expect(searchRibbonCommands(entries, "clean").map(entry => entry.label)).toEqual(["Delete All"]);
});

test("The number of results is limited", () => {
  expect(searchRibbonCommands(entries, "e", 3).length).toBe(3);
});
