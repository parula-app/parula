// @vitest-environment happy-dom
import { ApplyScope, Column, folderViews, shownViewType, viewSettingsOf, changeViewSettings, resetViewSettings, replaceViewSettings, applyViewSettingsToFolders, ViewType, defaultViewSettings } from "../../../Mail/ViewSettings/ViewSettings";
import { ArrangeBy } from "../../../Mail/3pane/MessageGrouping";
import { beforeEach, expect, test } from "vitest";

// Minimal stand-ins for `Folder`
function folder(id: string): any {
  return { id, account: { id: "acc" } };
}

beforeEach(() => {
  localStorage.clear();
});

test("Defaults: compact view by date, in groups", () => {
  let settings = viewSettingsOf(folder("inbox"));
  expect(settings.type).toBe(ViewType.Compact);
  expect(settings.arrangeBy).toBe(ArrangeBy.Date);
  expect(settings.showInGroups).toBe(true);
  expect(settings.columns).toContain(Column.Subject);
});

test("A change for this folder doesn't affect other folders", () => {
  let inbox = folder("inbox");
  let sent = folder("sent");
  changeViewSettings(inbox, { type: ViewType.Single, arrangeBy: ArrangeBy.Size });
  expect(viewSettingsOf(inbox).type).toBe(ViewType.Single);
  expect(viewSettingsOf(inbox).arrangeBy).toBe(ArrangeBy.Size);
  expect(viewSettingsOf(sent).type).toBe(ViewType.Compact);
});

test("A change for all folders overrides the folders' own value for that setting only", () => {
  let inbox = folder("inbox");
  let sent = folder("sent");
  changeViewSettings(inbox, { showAsConversations: false, type: ViewType.Preview });
  changeViewSettings(sent, { showAsConversations: false });
  changeViewSettings(inbox, { showAsConversations: true }, ApplyScope.AllFolders);
  expect(viewSettingsOf(inbox).showAsConversations).toBe(true);
  expect(viewSettingsOf(sent).showAsConversations).toBe(true);
  expect(viewSettingsOf(folder("other-folder")).showAsConversations).toBe(true);
  expect(viewSettingsOf(inbox).type).toBe(ViewType.Preview);
});

test("Reset View: the folder goes back to the original view", () => {
  let inbox = folder("inbox");
  changeViewSettings(inbox, { type: ViewType.Single });
  changeViewSettings(inbox, { previewLines: 3 }, ApplyScope.AllFolders);
  resetViewSettings(inbox);
  expect(viewSettingsOf(inbox).type).toBe(ViewType.Compact);
  expect(viewSettingsOf(inbox).previewLines).toBe(1);
});

test("Apply the current view to other folders", () => {
  let inbox = folder("inbox");
  let work = folder("work");
  let family = folder("family");
  changeViewSettings(inbox, { type: ViewType.Single, columns: [Column.From, Column.Subject] });
  applyViewSettingsToFolders(inbox, [work]);
  expect(viewSettingsOf(work).type).toBe(ViewType.Single);
  expect(viewSettingsOf(work).columns).toEqual([Column.From, Column.Subject]);
  expect(viewSettingsOf(family).type).toBe(ViewType.Compact);
});

test("Replace stores only the differences from the shared view", () => {
  let inbox = folder("inbox");
  let settings = { ...viewSettingsOf(inbox), arrangeBy: ArrangeBy.From };
  replaceViewSettings(inbox, settings);
  expect(folderViews.value["acc/inbox"]).toEqual({ arrangeBy: ArrangeBy.From });
});

test("Single and Preview views use the compact layout in narrow lists, like Outlook", () => {
  let single = { ...defaultViewSettings(), type: ViewType.Single };
  // 100 characters of 7 pixels: narrower than 700 pixels shows the compact layout
  expect(shownViewType(single, 420, 7)).toBe(ViewType.Compact);
  expect(shownViewType(single, 900, 7)).toBe(ViewType.Single);
  // Width not known yet
  expect(shownViewType(single, 0, 7)).toBe(ViewType.Single);
  // Turned off in Other Settings
  expect(shownViewType({ ...single, useCompactLayout: false }, 420, 7)).toBe(ViewType.Single);
  // Another number of characters
  expect(shownViewType({ ...single, compactLayoutChars: 50 }, 420, 7)).toBe(ViewType.Single);
  expect(shownViewType({ ...single, type: ViewType.Preview }, 420, 7)).toBe(ViewType.Compact);
});
