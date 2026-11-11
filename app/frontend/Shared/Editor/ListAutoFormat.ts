import { Extension, InputRule, type Range } from '@tiptap/core';
import type { Node, NodeType } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { canJoin, findWrapping } from '@tiptap/pm/transform';

export const ListAutoFormat = Extension.create({
  name: 'listAutoFormat',
  priority: 1000,

  addInputRules() {
    let { bulletList, orderedList } = this.editor.schema.nodes;
    return [
      new InputRule({
        find: /(?:^|(?<=\n))[^\S\n]*([-+*])\s$/,
        handler: ({ state, range }) => ListLine.wrap(state.tr, range, bulletList, {}),
      }),
      new InputRule({
        find: /(?:^|(?<=\n))[^\S\n]*(\d+)[.)]\s$/,
        handler: ({ state, range, match }) => ListLine.wrap(state.tr, range, orderedList, { start: parseInt(match[1]) }),
      }),
      new InputRule({
        find: /(?:^|(?<=\n))[^\S\n]*([aAiI])[.)]\s$/,
        handler: ({ state, range, match }) => ListLine.wrap(state.tr, range, orderedList, { type: match[1] }),
      }),
    ];
  },
});

class ListLine {
  static wrap(tr: Transaction, trigger: Range, listType: NodeType, attributes: Record<string, any>): void | null {
    let $trigger = tr.doc.resolve(trigger.from);
    if ($trigger.parent.type.name != 'paragraph') {
      return null;
    }
    let lineEnd = ListLine.nextLineBreak(tr.doc, trigger.to, $trigger.end());
    if (lineEnd != null) {
      tr.delete(lineEnd, lineEnd + 1);
      tr.split(lineEnd);
    }
    let lineStart = trigger.from;
    let isAfterLineBreak = $trigger.nodeBefore?.type.name == 'hardBreak';
    if (isAfterLineBreak) {
      lineStart--;
    }
    tr.delete(lineStart, trigger.to);
    if (isAfterLineBreak) {
      tr.split(lineStart);
      lineStart += 2;
    }
    let lineRange = tr.doc.resolve(lineStart).blockRange();
    let wrapping = lineRange && findWrapping(lineRange, listType, attributes);
    if (!wrapping) {
      return null;
    }
    tr.wrap(lineRange, wrapping);
    let listBefore = tr.doc.resolve(lineRange.start).nodeBefore;
    if (listBefore && ListLine.continues(listBefore, listType, attributes) && canJoin(tr.doc, lineRange.start)) {
      tr.join(lineRange.start);
    }
    // TrailingNode's paragraph after a list at the end would come in an extra transaction,
    // which clears the input rule's undo, so Backspace could not undo the list. It comes with the next change.
    tr.setMeta('skipTrailingNode', true);
  }

  protected static nextLineBreak(doc: Node, from: number, to: number): number | null {
    let lineBreak: number = null;
    doc.nodesBetween(from, to, (node, pos) => {
      if (lineBreak == null && node.type.name == 'hardBreak') {
        lineBreak = pos;
      }
    });
    return lineBreak;
  }

  protected static continues(list: Node, listType: NodeType, attributes: Record<string, any>): boolean {
    if (list.type != listType) {
      return false;
    }
    if (listType.name != 'orderedList') {
      return true;
    }
    return (list.attrs.type ?? null) == (attributes.type ?? null) &&
      list.attrs.start + list.childCount == (attributes.start ?? 1);
  }
}
