import { withHiddenRibbonParts } from "../../../Shared/Ribbon/RibbonCustomization";
import { expect, test } from "vitest";

test("Hidden tabs and groups are stored per ribbon", () => {
  let all = withHiddenRibbonParts({}, "mail", { tabs: ["Folder"], groups: ["Home/Respond"] });
  expect(all).toEqual({ mail: { tabs: ["Folder"], groups: ["Home/Respond"] } });
});

test("Showing everything again removes the ribbon's entry, other ribbons stay", () => {
  let all = withHiddenRibbonParts({}, "mail", { tabs: ["View"], groups: [] });
  all = withHiddenRibbonParts(all, "calendar", { tabs: [], groups: ["Home/Share"] });
  all = withHiddenRibbonParts(all, "mail", { tabs: [], groups: [] });
  expect(Object.keys(all)).toEqual(["calendar"]);
});

test("Missing settings start empty", () => {
  expect(withHiddenRibbonParts(null, "mail", { tabs: ["View"], groups: [] })).toEqual({ mail: { tabs: ["View"], groups: [] } });
});
