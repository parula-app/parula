// @vitest-environment happy-dom
import { fitGroupStages, isOverflowStage, computeStageWidths, columnsWidth, itemLook, largeLabelLines, type RibbonGroupInfo } from "../../../Shared/Ribbon/RibbonGroup";
import { expect, test } from "vitest";

function makeGroup(label: string, expandedWidth: number, collapsedWidth = 82): RibbonGroupInfo {
  return makeStagedGroup(label, [expandedWidth, collapsedWidth]);
}

function makeStagedGroup(label: string, stageWidths: number[], hasOverflowStage = false): RibbonGroupInfo {
  return { label, el: null, bodyEl: null, stageWidths, hasOverflowStage, setStage: () => {} };
}

function collapsedStates(groups: RibbonGroupInfo[], stages: number[]): boolean[] {
  return groups.map((group, i) => stages[i] > 0 && stages[i] == group.stageWidths.length - 1);
}

function fit(groups: RibbonGroupInfo[], availableWidth: number, overflowWidth = 0): number[] {
  return fitGroupStages(groups, availableWidth, overflowWidth);
}

test("All groups fit: nothing collapses", () => {
  let groups = [makeGroup("New", 154), makeGroup("Delete", 226)];
  expect(collapsedStates(groups, fit(groups, 1000))).toEqual([false, false]);
});

test("Groups collapse from the end until the rest fits", () => {
  let groups = [makeGroup("New", 154), makeGroup("Delete", 226), makeGroup("Respond", 226), makeGroup("Tags", 226)];
  // total 832. Collapsing "Tags" saves 144 -> 688
  expect(collapsedStates(groups, fit(groups, 700))).toEqual([false, false, false, true]);
  // Collapsing "Respond" too saves another 144 -> 544
  expect(collapsedStates(groups, fit(groups, 600))).toEqual([false, false, true, true]);
  // Growing again expands them again
  expect(collapsedStates(groups, fit(groups, 900))).toEqual([false, false, false, false]);
});

test("Groups with one button never collapse, because it saves no space", () => {
  let groups = [makeGroup("New", 154), makeGroup("Delete", 226), makeGroup("Find", 82)];
  expect(collapsedStates(groups, fit(groups, 400))).toEqual([false, true, false]);
});

test("Fewer groups: the others expand again", () => {
  let groups = [makeGroup("New", 154), makeGroup("Delete", 226), makeGroup("Big", 600)];
  // total 980. Collapsing "Big" saves 518 -> 462
  expect(collapsedStates(groups, fit(groups, 500))).toEqual([false, false, true]);
  // Collapsing "Delete" too saves 144 -> 318
  expect(collapsedStates(groups, fit(groups, 350))).toEqual([false, true, true]);
  // Without "Big": 380, "Delete" stays collapsed until there are 380 pixels
  groups.pop();
  expect(collapsedStates(groups, fit(groups, 350))).toEqual([false, true]);
  expect(collapsedStates(groups, fit(groups, 400))).toEqual([false, false]);
});

function makeSimplifiedGroup(label: string, labelsWidth: number, iconsWidth: number): RibbonGroupInfo {
  return makeStagedGroup(label, [labelsWidth, iconsWidth, 0], true);
}

test("Simplified: groups first show only icons, from the end", () => {
  let groups = [makeSimplifiedGroup("New", 250, 86), makeSimplifiedGroup("Respond", 300, 110), makeSimplifiedGroup("Tags", 280, 120)];
  // total 830
  expect(fit(groups, 900)).toEqual([0, 0, 0]);
  // Icons only for "Tags" saves 160 -> 670
  expect(fit(groups, 700)).toEqual([0, 0, 1]);
  expect(collapsedStates(groups, fit(groups, 700))).toEqual([false, false, false]);
  // Icons only for "Respond" too saves 190 -> 480
  expect(fit(groups, 500)).toEqual([0, 1, 1]);
});

test("Simplified: when a wide group on the left must show only icons, the groups on its right get their labels back", () => {
  let groups = [
    makeSimplifiedGroup("Refine", 920, 330),
    makeSimplifiedGroup("Scope", 340, 130),
    makeSimplifiedGroup("Options", 340, 130),
    makeSimplifiedGroup("Close", 115, 45),
  ];
  // total 1715. Icons only from the end: Close, Options, Scope -> 1225, still too wide, Refine -> 635.
  // Then Scope (845) and Options (1055) fit with labels again, Close (1125) doesn't.
  expect(fit(groups, 1100)).toEqual([1, 0, 0, 1]);
});

test("Simplified: groups move into the More menu only when all of them show only icons", () => {
  let groups = [makeSimplifiedGroup("New", 250, 86), makeSimplifiedGroup("Respond", 300, 110), makeSimplifiedGroup("Tags", 280, 120)];
  let overflowLabels = (stages: number[]) => groups
    .filter((group, i) => isOverflowStage(group, stages[i]))
    .map(group => group.label);
  // All icons only: 316. "Tags" into the More menu saves 120, but the More button takes 50 -> 246
  expect(fit(groups, 300, 50)).toEqual([1, 1, 2]);
  expect(collapsedStates(groups, fit(groups, 300, 50))).toEqual([false, false, true]);
  expect(overflowLabels(fit(groups, 300, 50))).toEqual(["Tags"]);
  // 250 still fits: 196 for the icons of "New" and "Respond", plus 50 for the More button
  expect(fit(groups, 250, 50)).toEqual([1, 1, 2]);
  // 240: also "Respond" into the More menu
  expect(fit(groups, 240, 50)).toEqual([1, 2, 2]);
  expect(overflowLabels(fit(groups, 240, 50))).toEqual(["Respond", "Tags"]);
  // Growing again shows the labels again
  expect(fit(groups, 1000, 50)).toEqual([0, 0, 0]);
  expect(overflowLabels(fit(groups, 1000, 50))).toEqual([]);
});

const metrics = { largeWidth: 80, smallWidth: 120, smallIconWidth: 36, simplifiedWidth: 110, simplifiedIconWidth: 40, gap: 2, groupChrome: 10 };

test("Classic: large buttons become small, then icons only, before any group collapses", () => {
  let newGroup = makeStagedGroup("New", computeStageWidths("classic", [{ size: "large" }, { size: "large" }], metrics));
  let respond = makeStagedGroup("Respond", computeStageWidths("classic", [{ size: "small" }, { size: "small" }, { size: "small" }, { size: "small" }], metrics));
  let groups = [newGroup, respond];
  expect(newGroup.stageWidths).toEqual([172, 130, 46, 90]);
  expect(respond.stageWidths).toEqual([252, 252, 84, 90]);
  // 424 fits
  expect(fit(groups, 424)).toEqual([0, 0]);
  // "Respond" has no large buttons, so "New" gets small buttons first: 382
  expect(fit(groups, 400)).toEqual([1, 0]);
  // Then icons only, from the end: 130 + 84 = 214
  expect(fit(groups, 300)).toEqual([1, 2]);
  // Collapsing saves nothing here, icons only is narrower
  expect(fit(groups, 100)).toEqual([2, 2]);
  expect(collapsedStates(groups, fit(groups, 100))).toEqual([false, false]);
});

test("Classic: a group with a text box collapses after its buttons show only icons", () => {
  let widths = computeStageWidths("classic", [{ size: "small", fixedWidth: 160 }, { size: "small" }, { size: "small" }], metrics);
  // One column of 3 rows, as wide as the text box
  expect(widths).toEqual([170, 170, 170, 90]);
  let groups = [makeStagedGroup("Find", widths)];
  expect(fit(groups, 120)).toEqual([3]);
  expect(collapsedStates(groups, fit(groups, 120))).toEqual([true]);
});

test("Classic: small buttons fill columns of 3, a large button starts a new column", () => {
  // small, large, small, small, small, small
  let cells = [
    { rows: 1, width: 100 },
    { rows: 3, width: 80 },
    { rows: 1, width: 100 },
    { rows: 1, width: 120 },
    { rows: 1, width: 100 },
    { rows: 1, width: 100 },
  ];
  // Columns: [100] [80] [100, 120, 100] [100]
  expect(columnsWidth(cells, 2)).toBe(100 + 80 + 120 + 100 + 3 * 2);
  expect(columnsWidth([], 2)).toBe(0);
});

test("Simplified: one row, uniform widths", () => {
  let widths = computeStageWidths("simplified", [{ size: "large" }, { size: "small" }, { size: "small", fixedWidth: 150 }], metrics);
  expect(widths).toEqual([110 + 110 + 150 + 4 + 10, 40 + 40 + 150 + 4 + 10, 0]);
});

test("Button look depends on layout, stage and size", () => {
  expect(itemLook("classic", 0, false, "large")).toBe("large");
  expect(itemLook("classic", 0, false, "small")).toBe("small");
  expect(itemLook("classic", 1, false, "large")).toBe("small");
  expect(itemLook("classic", 2, false, "large")).toBe("small-icon");
  // The popup of a collapsed group shows the buttons as designed
  expect(itemLook("classic", 3, true, "large")).toBe("large");
  expect(itemLook("simplified", 0, false, "large")).toBe("simplified");
  expect(itemLook("simplified", 1, false, "small")).toBe("simplified-icon");
  expect(itemLook("simplified", 2, true, "small")).toBe("list");
});

test("Classic: a group is never narrower than its label", () => {
  // One large button: large 80, small 120, icons only 36. The label "Send/Receive" needs 70.
  let widths = computeStageWidths("classic", [{ size: "large" }], metrics, 70);
  expect(widths).toEqual([90, 130, 80, 90]);
  // The simplified ribbon shows no group labels
  expect(computeStageWidths("simplified", [{ size: "large" }], metrics, 70)).toEqual([120, 50, 0]);
});

test("Classic: a group that rendered wider than computed gets small buttons first, so the last group stays inside the ribbon", () => {
  let share = makeStagedGroup("Share", [140, 140, 50, 80]);
  let find = makeStagedGroup("Find", [190, 190, 190, 80]);
  expect(fit([share, find], 340)).toEqual([0, 0]);
  // Rendered 170 pixels wide with large buttons
  share.stageWidths = [170, 140, 50, 80];
  expect(fit([share, find], 340)).toEqual([1, 0]);
  // Small buttons are as wide as their long labels, too
  share.stageWidths = [170, 170, 50, 80];
  expect(fit([share, find], 340)).toEqual([2, 0]);
});

test("Classic: large labels with several words always take 2 lines, split where both lines are about equally long", () => {
  expect(largeLabelLines("Delete", false)).toEqual(["Delete", ""]);
  expect(largeLabelLines("New Calendar", false)).toEqual(["New", "Calendar"]);
  expect(largeLabelLines("Rename Calendar", false)).toEqual(["Rename", "Calendar"]);
  expect(largeLabelLines("New Contact Group", false)).toEqual(["New Contact", "Group"]);
  expect(largeLabelLines("Mark All as Read", false)).toEqual(["Mark All", "as Read"]);
  expect(largeLabelLines("Send/Receive All Folders", false)).toEqual(["Send/Receive", "All Folders"]);
  // The menu arrow counts on the second line
  expect(largeLabelLines("New Items", true)).toEqual(["New", "Items"]);
  // "&" stays with the word before it
  expect(largeLabelLines("Spelling & Grammar", false)).toEqual(["Spelling &", "Grammar"]);
  expect(largeLabelLines("Date & Time", false)).toEqual(["Date &", "Time"]);
});
