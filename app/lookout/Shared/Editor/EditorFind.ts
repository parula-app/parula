import type { Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";

export interface TextRange {
  from: number;
  to: number;
}

const kHighlightName = "lookout-find";
const kLeafText = "\ufffc";

export function findMatches(doc: Node, term: string, matchCase = false): TextRange[] {
  if (!term) {
    return [];
  }
  let needle = matchCase ? term : term.toLowerCase();
  let matches: TextRange[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) {
      return true;
    }
    let text = node.textBetween(0, node.content.size, undefined, kLeafText);
    let haystack = matchCase ? text : text.toLowerCase();
    for (let index = haystack.indexOf(needle); index >= 0; index = haystack.indexOf(needle, index + needle.length)) {
      matches.push({ from: pos + 1 + index, to: pos + 1 + index + needle.length });
    }
    return false;
  });
  return matches;
}

export function findNext(editor: Editor, term: string, matchCase = false): boolean {
  let matches = findMatches(editor.state.doc, term, matchCase);
  if (!matches.length) {
    return false;
  }
  let after = editor.state.selection.empty ? editor.state.selection.from : editor.state.selection.to;
  let next = matches.find(match => match.from >= after) ?? matches[0];
  editor.chain().setTextSelection(next).scrollIntoView().run();
  showFound(editor, next);
  return true;
}

function showFound(editor: Editor, found: TextRange) {
  if (typeof CSS == "undefined" || !CSS.highlights) {
    return;
  }
  let start = editor.view.domAtPos(found.from);
  let end = editor.view.domAtPos(found.to);
  let range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  CSS.highlights.set(kHighlightName, new Highlight(range));
}

export function clearFound() {
  if (typeof CSS == "undefined" || !CSS.highlights) {
    return;
  }
  CSS.highlights.delete(kHighlightName);
}

export function replaceMatch(editor: Editor, term: string, replacement: string, matchCase = false): boolean {
  let { from, to } = editor.state.selection;
  if (isMatch(editor.state.doc.textBetween(from, to, undefined, kLeafText), term, matchCase)) {
    let transaction = replacement
      ? editor.state.tr.insertText(replacement, from, to)
      : editor.state.tr.delete(from, to);
    editor.view.dispatch(transaction);
  }
  return findNext(editor, term, matchCase);
}

export function replaceAllMatches(editor: Editor, term: string, replacement: string, matchCase = false): number {
  let matches = findMatches(editor.state.doc, term, matchCase);
  if (!matches.length) {
    return 0;
  }
  let transaction = editor.state.tr;
  for (let match of matches.reverse()) {
    if (replacement) {
      transaction.insertText(replacement, match.from, match.to);
    } else {
      transaction.delete(match.from, match.to);
    }
  }
  editor.view.dispatch(transaction);
  return matches.length;
}

function isMatch(text: string, term: string, matchCase: boolean): boolean {
  return !!text && (matchCase ? text == term : text.toLowerCase() == term.toLowerCase());
}
