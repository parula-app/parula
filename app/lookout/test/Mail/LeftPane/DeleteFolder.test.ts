// @vitest-environment happy-dom
import { RulesTestAccount } from "../Rules/RulesTestAccount";
import { FolderTreeActions } from "../../../Mail/LeftPane/FolderTreeActions";
import { messageBoxQuestion } from "../../../Shared/Dialog/MessageBox";
import { selectedFolder } from "../../../../frontend/Mail/Selected";
import { AppWindow } from "../../../../frontend/MainWindow/AppWindow";
import { get } from "svelte/store";
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  AppWindow["acting"] = null;
  vi.restoreAllMocks();
});

test("After deleting the selected folder, the window where the user deleted it shows the parent folder", async () => {
  // Stands in for a second main window. `acting` is what `AppWindow.current()` returns first.
  class SecondWindow extends AppWindow {
    constructor() {
      super(window, "second");
    }
  }
  let account = RulesTestAccount.create("delete", ["Inbox", "Projects", "Archive"]);
  let projects = RulesTestAccount.folder(account, "Projects");
  let archive = RulesTestAccount.folder(account, "Archive");
  vi.spyOn(projects, "deleteIt").mockImplementation(async () => {});
  let secondWindow = new SecondWindow();
  secondWindow.uiState(selectedFolder).set(projects);
  selectedFolder.set(archive);

  AppWindow["acting"] = secondWindow;
  let deleting = FolderTreeActions.deleteFolder(projects);
  // The user answers after using the main window
  AppWindow["acting"] = null;
  get(secondWindow.uiState(messageBoxQuestion)).answer(true);
  expect(await deleting).toBe(account.inbox);
  expect(get(secondWindow.uiState(selectedFolder))).toBe(account.inbox);
  expect(get(selectedFolder)).toBe(archive);
});
