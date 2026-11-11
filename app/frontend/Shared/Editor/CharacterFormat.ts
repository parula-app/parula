import { Extension } from '@tiptap/core';
import type { MarkType } from '@tiptap/pm/model';
import { WordAtCursor } from './WordAtCursor';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    characterFormat: {
      toggleMarkOnWord: (typeOrName: string | MarkType) => ReturnType,
      clearCharacterFormat: () => ReturnType,
    }
  }
}

export const CharacterFormat = Extension.create({
  name: 'characterFormat',
  priority: 1000,

  addCommands() {
    return {
      toggleMarkOnWord: (typeOrName) => ({ state, chain, commands }) => {
        let word = WordAtCursor.rangeInside(state);
        if (!word) {
          return commands.toggleMark(typeOrName);
        }
        let cursor = state.selection.from;
        return chain()
          .setTextSelection(word)
          .toggleMark(typeOrName)
          .setTextSelection(cursor)
          .run();
      },
      clearCharacterFormat: () => ({ state, tr, dispatch }) => {
        let { from, to, empty, $from } = state.selection;
        let word = WordAtCursor.rangeInside(state);
        if (word) {
          ({ from, to } = word);
        }
        if (!dispatch) {
          return true;
        }
        for (let markType of Object.values(state.schema.marks)) {
          if (markType.name != 'link') {
            tr.removeMark(from, to, markType);
          }
        }
        if (empty && !word) {
          tr.setStoredMarks($from.marks().filter(mark => mark.type.name == 'link'));
        }
        return true;
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-b': () => this.editor.commands.toggleMarkOnWord('bold'),
      'Mod-B': () => this.editor.commands.toggleMarkOnWord('bold'),
      'Mod-i': () => this.editor.commands.toggleMarkOnWord('italic'),
      'Mod-I': () => this.editor.commands.toggleMarkOnWord('italic'),
      'Mod-u': () => this.editor.commands.toggleMarkOnWord('underline'),
      'Mod-U': () => this.editor.commands.toggleMarkOnWord('underline'),
      'Mod-Shift-s': () => this.editor.commands.toggleMarkOnWord('strike'),
      'Mod-Shift-S': () => this.editor.commands.toggleMarkOnWord('strike'),
      'Ctrl-Space': () => this.editor.commands.clearCharacterFormat(),
    };
  },
});
