import { showMessageBox, askYesNo, messageBoxQuestion } from "../../../Shared/Dialog/MessageBox";
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
