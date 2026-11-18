import { mergeAttributes, Node } from "@tiptap/core";
import { MailBody } from "../../../logic/Mail/MailBody";

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footer: {
      /** Changes our signature, not as undo step
       * @param change returns false, if it changed nothing */
      editSignature: (change: (body: MailBody) => boolean) => ReturnType,
      focusBeforeSignature: () => ReturnType,
    }
  }
}

export interface FooterOptions {
  HTMLAttributes: Record<string, any>,
}

/** `<footer>` Node */
export const Footer = Node.create<FooterOptions>({
  name: 'footer',

  group: 'block',

  content: 'block+',

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      signature: {
        default: false,
        parseHTML: el => el.classList.contains("signature"),
        renderHTML: attrs => attrs.signature ? { class: "signature" } : {},
      },
      ownSignature: {
        default: false,
        parseHTML: el => el.hasAttribute("data-own-signature"),
        renderHTML: attrs => attrs.ownSignature ? { "data-own-signature": "" } : {},
      },
    }
  },

  addCommands() {
    return {
      editSignature: (change: (body: MailBody) => boolean) => ({ editor, chain, tr }) => {
        let body = new MailBody(editor.getHTML());
        if (!change(body)) {
          return false;
        }
        // Undo should not bring back the signature of the previous From identity
        tr.setMeta("addToHistory", false);
        let { from } = tr.selection;
        return chain().setContent(body.html).setTextSelection(from).run();
      },
      focusBeforeSignature: () => ({ chain, state }) => {
        let signaturePos: number | null = null;
        state.doc.forEach((node, offset) => {
          if (signaturePos == null && node.type.name == this.name && node.attrs.ownSignature) {
            signaturePos = offset;
          }
        });
        if (!signaturePos) {
          return false;
        }
        return chain().focus().setTextSelection(signaturePos - 1).run();
      },
    }
  },

  parseHTML() {
    return [
      { tag: 'footer', }
    ]
  },


  renderHTML({HTMLAttributes}) {
    return ['footer', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
  },
});