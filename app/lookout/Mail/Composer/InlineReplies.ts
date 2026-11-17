import type { EMail } from "../../../logic/Mail/EMail";
import { hasOwnText } from "../../../frontend/Mail/Composer/CloseButton.svelte";
import { askYesNo } from "../../Shared/Dialog/MessageBox";
import { inlineReplies, inlineRibbon } from "../Selected";
import { AppWindow } from "../../../frontend/MainWindow/AppWindow";
import { get } from "svelte/store";
import { gt } from "../../../l10n/l10n";
import type { RecipientField } from "./SelectNamesDialog.svelte";
import type { EditorTool } from "../../Shared/Editor/EditorTool";
import type { Editor } from "@tiptap/core";

export class InlineReply {
  readonly original: EMail;
  readonly draft: EMail;
  isNew = true;

  constructor(original: EMail, draft: EMail) {
    this.original = original;
    this.draft = draft;
  }
}

export interface InlineRibbon {
  draft: EMail;
  editor: Editor | null;
  onSelectNames: (field: RecipientField) => void;
  onCheckNames: () => Promise<void>;
  onOpenTool: (tool: EditorTool) => void;
  onEditSignatures: () => void;
}

export async function startInlineReply(original: EMail, draft: EMail) {
  let appWindow = AppWindow.current();
  let replies = appWindow.uiState(inlineReplies);
  let existing = replies.find(reply => reply.original == original) ?? null;
  if (existing && hasOwnText(existing.draft) &&
      !await askYesNo(gt`Discard Draft`, gt`You already started a response to this message. Do you want to discard it and start a new one?`)) {
    return;
  }
  if (existing) {
    removeInlineReply(existing.draft, appWindow);
  }
  replies.add(new InlineReply(original, draft));
}

export function removeInlineReply(draft: EMail, appWindow = AppWindow.current()) {
  let replies = appWindow.uiState(inlineReplies);
  let reply = replies.find(existing => existing.draft == draft);
  if (reply) {
    replies.remove(reply);
  }
  let ribbon = appWindow.uiState(inlineRibbon);
  if (get(ribbon)?.draft == draft) {
    ribbon.set(null);
  }
}
