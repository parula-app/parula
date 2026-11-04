import { assignKeyTips, keyTipLetters, keyTipWords, quickAccessKeyTip } from "../../../Shared/Ribbon/KeyTips";
import { expect, test } from "vitest";

function isPrefixFree(tips: string[]): boolean {
  return tips.every((tip, i) => tips.every((otherTip, j) => i == j || !otherTip.startsWith(tip)));
}

test("Tabs get single letters like Office, avoiding the reserved File key", () => {
  let tips = assignKeyTips(["Home", "Send / Receive", "Folder", "View"], ["F"], true);
  expect(tips).toEqual(["H", "S", "O", "V"]);
});

test("Commands with a unique first letter get it, the others get two letters", () => {
  let labels = ["New Email", "Delete", "Reply", "Reply All", "Rules", "Junk"];
  let tips = assignKeyTips(labels);
  expect(tips[0]).toBe("N");
  expect(tips[1]).toBe("D");
  expect(tips[5]).toBe("J");
  expect(tips[3]).toBe("RA");
  expect(tips[2]).toMatch(/^R[A-Z]$/);
  expect(tips[4]).toMatch(/^R[A-Z]$/);
  expect(new Set(tips).size).toBe(labels.length);
  expect(isPrefixFree(tips)).toBe(true);
});

test("Tips are unique and prefix-free also for many similar labels", () => {
  let labels = ["Move", "Move", "Move to Folder", "More", "Mark", "Mail", "M", "", "Ünread", "Übersicht"];
  let tips = assignKeyTips(labels);
  expect(new Set(tips).size).toBe(labels.length);
  expect(isPrefixFree(tips)).toBe(true);
  expect(tips.every(tip => /^[A-Z][A-Z0-9]?$/.test(tip))).toBe(true);
});

test("Labels are reduced to their Latin letters, accents removed", () => {
  expect(keyTipLetters("Ünread 2")).toEqual(["U", "N", "R", "E", "A", "D"]);
  expect(keyTipWords("Send / Receive")).toEqual([["S", "E", "N", "D"], ["R", "E", "C", "E", "I", "V", "E"]]);
});

test("Quick Access Toolbar tips count 1 to 9, then 09 down to 01, then 0A", () => {
  expect([0, 1, 8, 9, 10, 17, 18].map(i => quickAccessKeyTip(i))).toEqual(["1", "2", "9", "09", "08", "01", "0A"]);
});

