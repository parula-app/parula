// @vitest-environment happy-dom
import { SplitBlockquote } from "../../../../frontend/Shared/Editor/SplitBlockquote";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { expect, test } from "vitest";

function newEditor(content: string): Editor {
  let element = document.createElement("div");
  document.body.append(element);
  return new Editor({
    element,
    extensions: [StarterKit, SplitBlockquote],
    content,
  });
}

test("Enter on a selected top-level node is not a blockquote split", () => {
  let editor = newEditor("<blockquote><p>Quoted</p></blockquote><p>My reply</p>");
  editor.commands.setNodeSelection(0); // e.g. an image that the user clicked
  expect(editor.state.selection.$from.depth).toBe(0);

  expect(editor.commands.splitBlockquote()).toBe(false);
});

test("Enter in the middle of a blockquote splits it", () => {
  let editor = newEditor("<blockquote><p>Quoted</p></blockquote>");
  editor.commands.setTextSelection(5);

  expect(editor.commands.splitBlockquote()).toBe(true);
  expect(editor.getHTML()).toBe("<blockquote><p>Quo</p></blockquote><p></p><blockquote><p>ted</p></blockquote><p></p>");
});
