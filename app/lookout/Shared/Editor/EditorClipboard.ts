import type { Editor } from "@tiptap/core";

export function cutSelection(editor: Editor) {
  editor.commands.focus();
  editor.view.dom.ownerDocument.execCommand("cut");
}

export function copySelection(editor: Editor) {
  editor.commands.focus();
  editor.view.dom.ownerDocument.execCommand("copy");
}

export async function pasteClipboard(editor: Editor) {
  editor.commands.focus();
  if (editor.view.dom.ownerDocument.execCommand("paste")) {
    return;
  }
  for (let item of await navigator.clipboard.read()) {
    if (item.types.includes("text/html")) {
      let html = await (await item.getType("text/html")).text();
      editor.view.pasteHTML(html);
      return;
    }
  }
  editor.view.pasteText(await navigator.clipboard.readText());
}

export async function pasteClipboardAsText(editor: Editor) {
  editor.commands.focus();
  editor.view.pasteText(await navigator.clipboard.readText());
}
