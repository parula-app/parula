import { highlightParts } from "../../../Mail/3pane/TextHighlight";
import { expect, test } from "vitest";

test("Marks every match, case-insensitive, and keeps the original case", () => {
  expect(highlightParts("Report: the REPORT for Q3", "report")).toEqual([
    { text: "Report", isMatch: true },
    { text: ": the ", isMatch: false },
    { text: "REPORT", isMatch: true },
    { text: " for Q3", isMatch: false },
  ]);
});

test("Without a term, the whole text is one unmarked part", () => {
  expect(highlightParts("Quarterly report", null)).toEqual([{ text: "Quarterly report", isMatch: false }]);
  expect(highlightParts("Quarterly report", "  ")).toEqual([{ text: "Quarterly report", isMatch: false }]);
  expect(highlightParts("", "report")).toEqual([]);
});

test("Spaces around the term are ignored, and matches don't overlap", () => {
  expect(highlightParts("aaaa", " aa ")).toEqual([
    { text: "aa", isMatch: true },
    { text: "aa", isMatch: true },
  ]);
  expect(highlightParts("no hit here", "report")).toEqual([{ text: "no hit here", isMatch: false }]);
});
