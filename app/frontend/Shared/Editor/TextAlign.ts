import { Extension } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';

export type TextAlignment = 'left' | 'center' | 'right' | 'justify';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textAlign: {
      toggleTextAlign: (alignment: TextAlignment) => ReturnType,
    }
  }
}

const kAlignedNodes = ['paragraph', 'heading'];

export const TextAlign = Extension.create({
  name: 'textAlign',
  priority: 1000,

  addGlobalAttributes() {
    return [{
      types: kAlignedNodes,
      attributes: {
        textAlign: {
          default: null,
          parseHTML: element => {
            const kAlignments = ['center', 'right', 'justify'];
            let alignment = element.style.textAlign || element.getAttribute('align');
            return kAlignments.includes(alignment) ? alignment : null;
          },
          renderHTML: attributes => attributes.textAlign
            ? { style: `text-align: ${attributes.textAlign}` }
            : {},
        },
      },
    }];
  },

  addCommands() {
    return {
      toggleTextAlign: (alignment) => ({ state, tr, dispatch }) => {
        let { from, to } = state.selection;
        let blocks: { node: Node, pos: number }[] = [];
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (kAlignedNodes.includes(node.type.name)) {
            blocks.push({ node, pos });
          }
        });
        if (!blocks.length) {
          return false;
        }
        let isAligned = blocks.every(block => block.node.attrs.textAlign == alignment);
        let textAlign = alignment == 'left' || isAligned ? null : alignment;
        if (dispatch) {
          for (let block of blocks) {
            tr.setNodeMarkup(block.pos, undefined, { ...block.node.attrs, textAlign });
          }
        }
        return true;
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-e': () => this.editor.commands.toggleTextAlign('center'),
      'Mod-l': () => this.editor.commands.toggleTextAlign('left'),
      'Mod-r': () => this.editor.commands.toggleTextAlign('right'),
      'Mod-j': () => this.editor.commands.toggleTextAlign('justify'),
    };
  },
});
