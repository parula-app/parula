import { get, writable } from "svelte/store";
import { gt } from "../../../l10n/l10n";

export interface MessageBoxQuestion {
  title: string;
  message: string;
  okLabel: string;
  cancelLabel: string;
  answer: (ok: boolean) => void;
}

export const messageBoxQuestion = writable<MessageBoxQuestion | null>(null);

export function showMessageBox(title: string, message: string, okLabel = gt`OK`, cancelLabel = gt`Cancel`): Promise<boolean> {
  get(messageBoxQuestion)?.answer(false);
  return new Promise(resolve => {
    let question: MessageBoxQuestion = {
      title,
      message,
      okLabel,
      cancelLabel,
      answer: ok => {
        if (get(messageBoxQuestion) != question) {
          return;
        }
        messageBoxQuestion.set(null);
        resolve(ok);
      },
    };
    messageBoxQuestion.set(question);
  });
}

export function askYesNo(title: string, message: string): Promise<boolean> {
  return showMessageBox(title, message, gt`Yes`, gt`No`);
}
