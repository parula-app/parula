import type { Editor } from "@tiptap/core";
import type { Message } from "../../../logic/Abstract/Message";
import { Attachment, ContentDisposition } from "../../../logic/Abstract/Attachment";
import { blobToDataURL } from "../../../logic/util/blob";

export async function insertImage(editor: Editor, file: File, message: Message) {
  // let url = URL.createObjectURL(file);
  let url = await blobToDataURL(file);
  console.log("inline image drop", url);
  // TODO TipTap silently drops the src="blob:...". No idea why, or how to allow it.
  editor.chain().focus().setImage({ src: url }).run();
  // On send or save, need to convert to proper attachment and cid: URL
  let attachment = message.newAttachment();
  attachment.fromFile(file);
  attachment.disposition = ContentDisposition.inline;
  attachment.related = true;
  // attachment.blobURL = url;
  attachment.dataURL = url;
  message.attachments.add(attachment);
}

export function isImageMimetype(type: string) {
  return type == "image/png" ||
    type == "image/jpeg" ||
    type == "image/gif";
}
