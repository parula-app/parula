import type { EditorState } from '@tiptap/pm/state';

export class WordAtCursor {
  static rangeInside(state: EditorState): { from: number, to: number } | null {
    let { empty, $from } = state.selection;
    if (!empty || !$from.parent.isTextblock) {
      return null;
    }
    let block = $from.parent;
    let text = block.textBetween(0, block.content.size, undefined, "\n");
    let cursor = $from.parentOffset;
    let start = cursor;
    while (start > 0 && WordAtCursor.isWordChar(text, start - 1)) {
      start--;
    }
    let end = cursor;
    while (end < text.length && WordAtCursor.isWordChar(text, end)) {
      end++;
    }
    if (start == cursor || end == cursor) {
      return null;
    }
    let blockStart = $from.start();
    return { from: blockStart + start, to: blockStart + end };
  }

  protected static isWordChar(text: string, index: number): boolean {
    const kLetter = /[\p{L}\p{N}\p{M}_]/u;
    const kApostrophe = /['’]/;
    let char = text[index];
    if (kLetter.test(char)) {
      return true;
    }
    return kApostrophe.test(char) &&
      kLetter.test(text[index - 1] ?? "") &&
      kLetter.test(text[index + 1] ?? "");
  }
}
