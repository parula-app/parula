<!-- TODO Jail content into an iframe -->

<div bind:this={rootEl} class="html-editor" />

<script lang="ts">
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import LinkFeature from '@tiptap/extension-link';
  import CodeWordFeature from '@tiptap/extension-code';
  import ImageResize from 'tiptap-extension-resize-image';
  import { SplitBlockquote } from './SplitBlockquote';
  import { Footer } from './Footer';
  import { BoldStar, ItalicSlash, StrikeDoubleTidle } from './StdConventions';
  import { ParagraphNewLine } from './ParagraphNewLine';
  import { TabIndent } from './TabIndent';
  import { CharacterFormat } from './CharacterFormat';
  import { TextAlign } from './TextAlign';
  import { ListKeys } from './ListKeys';
  import { ListAutoFormat } from './ListAutoFormat';
  import { LinkEditing } from './LinkEditing';
  // import CodeBlockLowlightFeature from '@tiptap/extension-code-block-lowlight';
  // import { common as lowlightCommon, createLowlight } from 'lowlight'
  import { onMount, onDestroy } from 'svelte';
  import { createEventDispatcher } from 'svelte';
  const dispatchEvent = createEventDispatcher<{ change: string }>();

  /** in/out */
  export let html: string;
  /** out only */
  export let editor: Editor;
  export let tabindex = null;
  /** Additional TipTap extensions to include alongside the defaults */
  export let extraExtensions: any[] = [];

  let rootEl: HTMLDivElement;
  let lastHTML: string = null;

  onMount(onLoad);

  function onLoad() {
    editorElementCreatedMutationObserver.observe(rootEl, {childList: true});
    createEditor();
  }

  function createEditor() {
    editor = new Editor({
      element: rootEl,
      extensions: [
        // Disable some extensions because you cannot override the default
        // input/mark rules
        StarterKit.configure({
          bold: false,
          italic: false,
          strike: false,
          link: false,
        }),
        LinkFeature.configure({
          // Not part of the document. `sanitizeHTML()` adds them when rendering.
          HTMLAttributes: { target: null, rel: null },
          openOnClick: false,
          shouldAutoLink: url => /^[a-z][a-z0-9+.-]*:\/\/|^www\.|@/i.test(url),
        }),
        LinkEditing,
        CodeWordFeature,
        SplitBlockquote,
        Footer,
        ImageResize.configure({
          allowBase64: true,
          inline: false,
          HTMLAttributes: {
            style: "max-width: 90%; height: auto; margin: 10px;"
          },
        }),
        BoldStar,
        ItalicSlash,
        StrikeDoubleTidle,
        ParagraphNewLine,
        TabIndent,
        CharacterFormat,
        TextAlign,
        ListKeys,
        ListAutoFormat,
        // CodeBlockLowlightFeature.configure({
        //  lowlight: createLowlight(lowlightCommon),
        // }),
        ...extraExtensions,
      ],
      content: html,
      onTransaction: () => {
        // force re-render so `editor.isActive` works as expected
        editor = editor;
      },
      onUpdate: ({ editor }) => {
        html = lastHTML = editor.getHTML();
        dispatchEvent("change", html);
      },
    });
    lastHTML = html;
  }

  export function forceReload() {
    if (editor) {
      editor.destroy();
    }
    createEditor();
  }

  // html changed by caller, not editor
  $: html != lastHTML && forceReload();

  onDestroy(() => {
    if (editor) {
      editor.destroy();
    }
    editorElementCreatedMutationObserver.disconnect();
  });

  const editorElementCreatedMutationObserver = new MutationObserver((mutationList, observer) => {
    for (let mutation of mutationList) {
      for (let element of mutation.addedNodes) {
        onEditorElementCreated(element as HTMLDivElement);
      }
    }
  });
  function onEditorElementCreated(el: HTMLDivElement) {
    if (tabindex) {
      el.tabIndex = tabindex;
    }
  }
</script>

<style>
  /** Fix app.css, see .value */
  .html-editor :global(*) {
    user-select: text;
  }
  .html-editor {
    height: 100%;
  }
  .html-editor :global(.ProseMirror) {
    height: 100%;
  }
  .html-editor :global(.ProseMirror:focus-visible) {
    outline: none;
  }


  /* Content styles
     TODO @import url(../Message/content.css); into iframe */

  .html-editor :global(blockquote) {
    border-left: 3px solid #20AE9E;
    padding-inline-start: 20px;
    margin-inline-start: 0px;
  }
  .html-editor :global(img) {
    max-width: 100%;
  }

  /** Undo the default margin of first/last <p> */
  .html-editor :global(.tiptap) {
    margin-top: -1em;
    margin-bottom: -1em;
  }
</style>
