import Paragraph from '@tiptap/extension-paragraph';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphNewLine: {
      /**
       * Adds standard enter key behavior on paragraphs `<p>`
       * 1. If there's a `<br>` before or after the cursor
       * create a new paragraph
       * 2. Else insert a `<br>`
       */
      onParagraphEnter: () => ReturnType;
    }
  }
}

export const ParagraphNewLine = Paragraph.extend({
  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.onParagraphEnter(),
      'Mod-Shift-n': () => this.editor.commands.setParagraph(),
      'Mod-Shift-N': () => this.editor.commands.setParagraph(),
    }
  },
  addCommands() {
    return {
      onParagraphEnter: () => ({ tr, commands, chain }) => {
        let { $from, $to } = tr.selection;
        if ($from.parent.type.name != 'paragraph' || $from.depth > 1) {
          return false;
        }
        /*
         * Deletes the <br> then splits the paragraph into two paragraphs
         * This is becauase just splitting creates <p><br></br><p></p>
         * instead of <p></p><p></p>
         */
        if ($from.nodeBefore?.type.name == "hardBreak") {
          return chain()
            .deleteRange({
              from: $from.pos - $from.nodeBefore.nodeSize,
              to: $from.pos
            }).splitBlock().scrollIntoView().run();
        }
        if ($to.nodeAfter?.type.name == "hardBreak") {
          return chain()
            .deleteRange({
              from: $to.pos,
              to: $to.pos + $to.nodeAfter.nodeSize
            }).splitBlock().scrollIntoView().run();
        }
        return commands.setHardBreak();
      },
    }
  },
});