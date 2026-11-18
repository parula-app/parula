// @vitest-environment happy-dom
import { showMessageBox, askYesNo, messageBoxQuestion } from "../../../Shared/Dialog/MessageBox";
import { AppWindow } from "../../../../frontend/MainWindow/AppWindow";
import { expect, test } from "vitest";
import { get } from "svelte/store";

test("A message box answers once and closes", async () => {
  let answer = showMessageBox("Delete", "Do you want to permanently delete the selected message?");
  let question = get(messageBoxQuestion);
  expect(question.title).toBe("Delete");
  expect(question.okLabel).toBe("OK");
  expect(question.cancelLabel).toBe("Cancel");
  question.answer(true);
  // A second answer, e.g. the dialog's close event after OK, changes nothing
  question.answer(false);
  expect(await answer).toBe(true);
  expect(get(messageBoxQuestion)).toBeNull();
});

test("Yes / No question", async () => {
  let answer = askYesNo("Delete Folder", "Are you sure?");
  let question = get(messageBoxQuestion);
  expect([question.okLabel, question.cancelLabel]).toEqual(["Yes", "No"]);
  question.answer(false);
  expect(await answer).toBe(false);
});

test("A new message box cancels the one that is still open", async () => {
  let first = showMessageBox("First", "first");
  let second = showMessageBox("Second", "second");
  expect(await first).toBe(false);
  expect(get(messageBoxQuestion).title).toBe("Second");
  get(messageBoxQuestion).answer(true);
  expect(await second).toBe(true);
});

test("A message box shows in the window that asks, and leaves the questions of other windows open", async () => {
  // Stands in for a composer window. `acting` is what `AppWindow.current()` returns first.
  class ComposerWindow extends AppWindow {
    constructor() {
      super(window, "composer", AppWindow.main);
    }
  }
  let composerWindow = new ComposerWindow();
  let mainQuestion = showMessageBox("Main", "main");
  AppWindow["acting"] = composerWindow;
  let composerQuestion: Promise<boolean>;
  try {
    composerQuestion = showMessageBox("Composer", "composer");
  } finally {
    AppWindow["acting"] = null;
  }
  expect(get(messageBoxQuestion).title).toBe("Main");
  expect(get(composerWindow.uiState(messageBoxQuestion)).title).toBe("Composer");
  get(composerWindow.uiState(messageBoxQuestion)).answer(true);
  expect(await composerQuestion).toBe(true);
  expect(get(messageBoxQuestion).title).toBe("Main");
  get(messageBoxQuestion).answer(false);
  expect(await mainQuestion).toBe(false);
});
