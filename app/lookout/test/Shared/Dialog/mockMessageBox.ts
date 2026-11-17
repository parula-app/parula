import { messageBoxQuestion } from "../../../Shared/Dialog/MessageBox";
import { vi } from "vitest";

/** Answers every message box with what the returned mock resolves to.
 * Create it once per test file, because each one stays subscribed. */
export function mockMessageBox() {
  let messageBox = vi.fn<(title: string, message: string, okLabel: string, cancelLabel: string) => Promise<boolean>>();
  messageBoxQuestion.subscribe(async question => {
    if (question) {
      question.answer(await messageBox(question.title, question.message, question.okLabel, question.cancelLabel));
    }
  });
  return messageBox;
}
