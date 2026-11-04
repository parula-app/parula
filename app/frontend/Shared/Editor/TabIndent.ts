import { Extension } from "@tiptap/core";
import { BulletList, ListItem, OrderedList } from '@tiptap/extension-list';
import Blockquote from '@tiptap/extension-blockquote';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      indent: () => ReturnType,
      unindent: () => ReturnType,
    }
  }
}

/**
 * Performs actions based on the parent nodeType
 * when Tab or Shift-Tab are pressed.
 *
 * Tab:
 * - BulletList or OrderedList: sinks the list item,
 *   or inserts 4 spaces when the cursor is within the text
 * - Blockquote: wraps content in blockquote
 * - Other nodeType: inserts 4 spaces
 *
 * Shift-Tab:
 * - BulletList or OrderedList: lifts the list item
 * - Blockquote: unwraps content in blockquote
 * - Other nodeType: removes 4 spaces or less if cursor is at start of line
 */
export const TabIndent = Extension.create({
  addExtensions() {
    return [Indent];
  },
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        this.editor.chain().focus().indent().run();
        // Always return true to keep focus
        // because sinkListItem returns false
        // for nested listItems and doesn't work
        // for them
        return true;
      },
      'Shift-Tab': () => {
        return this.editor.chain().focus().unindent().run();
      },
    };
  },
});

/**
 * Performs indent actions based on the parent nodeType.
 *
 * indent:
 * - BulletList or OrderedList: sinks the list item,
 *   or inserts 4 spaces when the cursor is within the text
 * - Blockquote: wraps content in blockquote
 * - Other nodeType: inserts 4 spaces
 *
 * unindent:
 * - BulletList or OrderedList: lifts the list item
 * - Blockquote: unwraps content in blockquote
 * - Other nodeType: removes 4 spaces or less if cursor is at start of line
 */
export const Indent = Extension.create({
  addCommands() {
    return {
      indent: () => ({ state, commands }) => {
        let nodeType = state.selection.$from.node(1).type.name;
        if (nodeType == BulletList.name || nodeType == OrderedList.name) {
          if (state.selection.empty && state.selection.$from.parentOffset > 0) {
            return commands.insertContent('    ');
          }
          return commands.sinkListItem(ListItem.name);
        }
        if (nodeType == Blockquote.name) {
          return commands.setBlockquote();
        }
        return commands.insertContent('    ');
      },
      unindent: () => ({ state, commands }) => {
        let nodeType = state.selection.$from.node(1).type.name;
        if (nodeType == BulletList.name || nodeType == OrderedList.name) {
          return commands.liftListItem(ListItem.name);
        }
        if (nodeType == Blockquote.name) {
          return commands.unsetBlockquote();
        }

        let $from = state.selection.$from;
        let textBefore = $from.parent.textBetween(0, $from.parentOffset);
        if (/^ +$/.test(textBefore)) {
          let spacesToRemove = textBefore.length % 4 || 4;
          let spaceStartPos = $from.pos - spacesToRemove;
          return commands.deleteRange({ from: spaceStartPos, to: $from.pos });
        }
        return true;
      }
    }
  },
});
