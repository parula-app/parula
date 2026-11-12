import { AppWindow } from "../../../frontend/MainWindow/AppWindow";
import { get, writable } from "svelte/store";
import { gt } from "../../../l10n/l10n";

export interface MessageBoxQuestion {
  title: string;
  message: string;
  okLabel: string;
  cancelLabel: string;
  answer: (ok: boolean) => void;
}

export const messageBoxQuestion = AppWindow.perWindow(() => writable<MessageBoxQuestion | null>(null));

export function showMessageBox(title: string, message: string, okLabel = gt`OK`, cancelLabel = gt`Cancel`): Promise<boolean> {
  let windowQuestion = AppWindow.current().uiState(messageBoxQuestion);
  get(windowQuestion)?.answer(false);
  return new Promise(resolve => {
    let question: MessageBoxQuestion = {
      title,
      message,
      okLabel,
      cancelLabel,
      answer: ok => {
        if (get(windowQuestion) != question) {
          return;
        }
        windowQuestion.set(null);
        resolve(ok);
      },
    };
    windowQuestion.set(question);
  });
}

export function askYesNo(title: string, message: string): Promise<boolean> {
  return showMessageBox(title, message, gt`Yes`, gt`No`);
}
