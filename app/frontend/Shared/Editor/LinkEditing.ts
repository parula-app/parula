import { Extension, getMarkRange } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { WordAtCursor } from './WordAtCursor';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    linkEditing: {
      applyLink: (href: string) => ReturnType,
    }
  }
  interface Storage {
    linkEditing: {
      openLinkEditor: () => void,
    }
  }
}

export const LinkEditing = Extension.create({
  name: 'linkEditing',
  priority: 1000,

  addStorage() {
    return {
      openLinkEditor: null as () => void,
    };
  },

  addCommands() {
    return {
      applyLink: (href) => ({ state, chain, commands }) => {
        if (!href) {
          return chain().extendMarkRange('link').unsetLink().run();
        }
        let { empty, from, $from } = state.selection;
        if (!empty) {
          return commands.setLink({ href });
        }
        if (getMarkRange($from, state.schema.marks.link)) {
          return chain().extendMarkRange('link').setLink({ href }).setTextSelection(from).run();
        }
        let word = WordAtCursor.rangeInside(state);
        if (word) {
          return chain().setTextSelection(word).setLink({ href }).setTextSelection(from).run();
        }
        let end = from + href.length;
        return chain()
          .insertContent({ type: 'text', text: href })
          .setTextSelection({ from, to: end })
          .setLink({ href })
          .setTextSelection(end)
          .unsetMark('link')
          .run();
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        let openLinkEditor = this.storage.openLinkEditor;
        if (!openLinkEditor) {
          return false;
        }
        openLinkEditor();
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('linkEditingClick'),
        props: {
          handleClick: (view, pos, event) => {
            if (event.button != 0 || !(event.ctrlKey || event.metaKey)) {
              return false;
            }
            let link = (event.target as HTMLElement).closest?.('a');
            if (!link?.href || !view.dom.contains(link)) {
              return false;
            }
            window.open(link.href, '_blank');
            return true;
          },
        },
      }),
    ];
  },
});
