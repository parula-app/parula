import type { EMail } from "../../../logic/Mail/EMail";
import { hasUserText } from "./DraftContent";
import { askYesNo } from "../../Shared/Dialog/MessageBox";
import { inlineReplies, inlineRibbon } from "../Selected";
import { get } from "svelte/store";
import { gt } from "../../../l10n/l10n";
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
}

export async function startInlineReply(original: EMail, draft: EMail) {
  let existing = inlineReplies.find(reply => reply.original == original) ?? null;
  if (existing && hasUserText(existing.draft.html) &&
      !await askYesNo(gt`Discard Draft`, gt`You already started a response to this message. Do you want to discard it and start a new one?`)) {
    return;
  }
  if (existing) {
    removeInlineReply(existing.draft);
  }
  inlineReplies.add(new InlineReply(original, draft));
}

export function removeInlineReply(draft: EMail) {
  let reply = inlineReplies.find(existing => existing.draft == draft);
  if (reply) {
    inlineReplies.remove(reply);
  }
  if (get(inlineRibbon)?.draft == draft) {
    inlineRibbon.set(null);
  }
}
