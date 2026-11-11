import { Extension, isMacOS, type KeyboardShortcutCommand } from '@tiptap/core';
import { canJoin } from '@tiptap/pm/transform';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    listKeys: {
      joinListItemBackward: () => ReturnType,
    }
  }
}

export const ListKeys = Extension.create({
  name: 'listKeys',
  priority: 1000,

  addCommands() {
    return {
      joinListItemBackward: () => ({ state, tr, dispatch }) => {
        let { empty, $from } = state.selection;
        if (!empty || $from.parentOffset > 0 || $from.depth < 3 ||
            $from.node(-1).type.name != 'listItem' ||
            $from.index(-1) > 0 || $from.index(-2) == 0) {
          return false;
        }
        let itemStart = $from.before(-1);
        if (!canJoin(state.doc, itemStart)) {
          return false;
        }
        if (dispatch) {
          tr.join(itemStart);
        }
        return true;
      },
    };
  },

  addKeyboardShortcuts() {
    let sink = () => this.editor.commands.sinkListItem('listItem');
    let lift = () => this.editor.commands.liftListItem('listItem');
    let bullets = () => this.editor.commands.toggleBulletList();
    let keys: Record<string, KeyboardShortcutCommand> = {
      'Backspace': () => this.editor.commands.first(({ commands }) => [
        () => commands.undoInputRule(),
        () => commands.joinListItemBackward(),
      ]),
      'Mod-Shift-l': bullets,
      'Mod-Shift-L': bullets,
      'Mod-.': bullets,
      'Mod-/': () => this.editor.commands.toggleOrderedList(),
      'Mod-t': sink,
      'Mod-Shift-t': lift,
      'Mod-Shift-T': lift,
    };
    if (!isMacOS()) {
      keys['Alt-Shift-ArrowRight'] = sink;
      keys['Alt-Shift-ArrowLeft'] = lift;
    }
    return keys;
  },
});
