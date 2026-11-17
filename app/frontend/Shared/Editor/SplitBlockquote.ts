import Blockquote from '@tiptap/extension-blockquote';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    splitBlockquote: {
      /**
       * Split a blockquote node
       */
      splitBlockquote: () => ReturnType,
      /**
       * Split first parent node at the given position
       */
      splitFirstParent: (pos: number) => ReturnType,
    }
  }
}

/** On Enter key, the blockquote is split into 2 blockquotes, at the place where the cursor was.
 * New text appears in the middle of the 2 blockquotes. It is not part of any blockquote. */
export const SplitBlockquote = Blockquote.extend({
  // removed `name: 'split-blockquote'` because it causes `tr.split()` to name the
  // NodeType to `split-blockquote` instead of `blockquote`
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        return this.editor.commands.splitBlockquote();
      },
    }
  },
  addCommands() {
    return {
      splitBlockquote: () => ({ chain, tr }) => {
        let {$from, $to} = tr.selection;
        // if not in blockquote. depth 0 = gap cursor or a selected top-level node
        if ($from.depth < 1 || $from.node(1).type.name !== 'blockquote') {
          return false;
        }
        // if at start of blockquote
        if ($from.before(1) + $from.depth === $from.pos) {
          return chain().insertContentAt($from.before(1), '<p></p>').scrollIntoView().run();
        }
        // if at end of blockquote
        if ($to.after(1) - $to.depth === $to.pos) {
          return chain().insertContentAt($to.after(1), '<p></p>').scrollIntoView().run();
        }
        // default split in middle of blockquote
        return chain().setTextSelection($to.pos).splitFirstParent($to.pos)
        .insertContentAt($to.pos + $to.depth, '<p></p>').scrollIntoView().run();
      },
      splitFirstParent: (pos: number) => ({ tr, dispatch }) => {
        let node = this.editor.$pos(pos);
        if (dispatch && node) {
          tr.split(node.pos, node.depth);
          return true;
        }
        return false;
      }
    }
  },
});
