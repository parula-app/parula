{#if editor}
  <Toolbar>
    <slot name="start" />

    <Button
      label={$t`Bold`}
      shortCutInfo={$t`*bold* or **bold**`}
      onClick={() => editor.chain().focus().toggleMarkOnWord('bold').run()}
      disabled={!editor.can().chain().focus().toggleBold().run()}
      selected={editor.isActive('bold')}
      iconOnly
      >
      <hbox slot="icon" class="bold-icon font-normal">B</hbox>
    </Button>
    <Button
      label={$t`Italic`}
      shortCutInfo={$t`/italic/ or _italic_`}
      onClick={() => editor.chain().focus().toggleMarkOnWord('italic').run()}
      disabled={!editor.can().chain().focus().toggleItalic().run()}
      selected={editor.isActive('italic')}
      icon={ItalicIcon}
      iconSize="16px"
      iconOnly
      />
    <Button
      label={$t`Strike-through`}
      onClick={() => editor.chain().focus().toggleMarkOnWord('strike').run()}
      disabled={!editor.can().chain().focus().toggleStrike().run()}
      selected={editor.isActive('strike')}
      iconOnly
      >
      <hbox slot="icon" class="strike-through-icon">s</hbox>
    </Button>
    <Button
      label={$t`Code word, within a phrase`}
      shortCutInfo={$t`\`code\``}
      onClick={() => editor.chain().focus().toggleMarkOnWord('code').run()}
      disabled={!editor.can().chain().focus().toggleCode().run()}
      selected={editor.isActive('code')}
      icon={CodeWordIcon}
      iconSize="16px"
      iconOnly
      />
    <Button
      label="Code block with multiple lines"
      shortCutInfo="
```
code
block
3xENTER"
      onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      disabled={!editor.can().chain().focus().toggleCodeBlock().run()}
      selected={editor.isActive('codeBlock')}
      icon={CodeBlockIcon}
      iconSize="16px"
      iconOnly
      />
    <Button
      label={$t`Quote of the original email`}
      shortCutInfo={$t`> Quote`}
      onClick={() => editor.chain().focus().toggleBlockquote().run()}
      disabled={!editor.can().chain().focus().toggleBlockquote().run()}
      selected={editor.isActive('blockquote')}
      icon={QuoteMailIcon}
      iconSize="16px"
      iconOnly
      />
    <!--
    <Button
      label="Third party quote"
      onClick={() => editor.chain().focus().toggleBlockquote().run()}
      disabled={!editor.can().chain().focus().toggleBlockquote().run()}
      selected={editor.isActive('blockquote')}
      icon={QuoteIcon}
      iconSize="16px"
      iconOnly
      />
    -->
    <Button
      label={$t`Bulleted list`}
      shortCutInfo={$t`* Item`}
      onClick={() => editor.chain().focus().toggleBulletList().run()}
      disabled={!editor.can().chain().focus().toggleBulletList().run()}
      selected={editor.isActive('bulletList')}
      icon={ListBulletedIcon}
      iconOnly
      />
    <Button
      label={$t`Ordered list`}
      shortCutInfo={$t`1. Item`}
      onClick={() => editor.chain().focus().toggleOrderedList().run()}
      disabled={!editor.can().chain().focus().toggleOrderedList().run()}
      selected={editor.isActive('orderedList')}
      icon={ListNumberedIcon}
      iconOnly
      />

    <Button
      label={$t`Title`}
      shortCutInfo={$t`# Big title`}
      onClick={() => editor.chain().focus().toggleHeading({ level: 1}).run()}
      disabled={!editor.can().chain().focus().toggleHeading({ level: 1}).run()}
      selected={editor.isActive('heading', { level: 1 })}
      iconOnly
      >
      <hbox slot="icon" class="header-icon">H1</hbox>
    </Button>
    <Button
      label={$t`Heading, hierarchy level 2`}
      shortCutInfo={$t`## Sub header`}
      onClick={() => editor.chain().focus().toggleHeading({ level: 2}).run()}
      disabled={!editor.can().chain().focus().toggleHeading({ level: 2}).run()}
      selected={editor.isActive('heading', { level: 2 })}
      iconOnly
      >
      <hbox slot="icon" class="header-icon">H2</hbox>
    </Button>
    <Button
      label={$t`Heading, hierarchy level 3`}
      shortCutInfo={$t`### Sub sub header`}
      onClick={() => editor.chain().focus().toggleHeading({ level: 3}).run()}
      disabled={!editor.can().chain().focus().toggleHeading({ level: 3}).run()}
      selected={editor.isActive('heading', { level: 3 })}
      iconOnly
      >
      <hbox slot="icon" class="header-icon">H3</hbox>
    </Button>
    <Button
      label={$t`Link to webpage`}
      onClick={onLinkOpen}
      selected={editor.isActive('link')}
      icon={LinkIcon}
      iconOnly
      />
    <Button
      label={$t`Remove link`}
      onClick={() => { editor.chain().focus().unsetLink().run(); isEditingLink = false; }}
      disabled={!editor.can().chain().focus().unsetLink().run()}
      icon={LinkRemoveIcon}
      iconOnly
      />
    <Button
      label={$t`Insert image`}
      onClick={() => isEditingImage = true}
      icon={ImageIcon}
      iconOnly
      />
    <Button
      label={$t`Clear formatting`}
      onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
      icon={ClearIcon}
      iconSize="16px"
      iconOnly
      />
    <slot name="before-undo" />

    <Button
      label={$t`Undo the last change`}
      shortCutInfo={$t`Ctrl-Z`}
      onClick={() => editor.chain().focus().undo().run()}
      disabled={!editor.can().chain().focus().undo().run()}
      icon={UndoIcon}
      iconOnly
      />
    <Button
      label={$t`Redo the change that was undone before`}
      shortCutInfo={$t`Ctrl-Y`}
      onClick={() => editor.chain().focus().redo().run()}
      disabled={!editor.can().chain().focus().redo().run()}
      icon={RedoIcon}
      iconOnly
      />
      <slot name="last" />

      <hbox flex />
      <slot name="end" />
  </Toolbar>
{/if}

{#if isEditingLink}
  <Toolbar>
    <hbox flex class="link-dialog">
      <!-- <label for="linktext">Link text</label>
      <input type="text" bind:value={linkText} id="linktext" /> -->
      <label for="linktargeturl">Link target URL</label>
      <input type="url" bind:value={linkTargetURL} bind:this={linkTargetInput}
        on:keydown={onLinkKey} id="linktargeturl" />
      <Button
        onClick={onLinkOK}
        label={$t`OK`}
        icon={OKIcon}
        iconOnly
        />
      <Button
        label={$t`Remove link`}
        onClick={() => { editor.chain().focus().unsetLink().run(); isEditingLink = false; }}
        disabled={!editor.can().chain().focus().unsetLink().run()}
        icon={LinkRemoveIcon}
        iconOnly
        />
    </hbox>
  </Toolbar>
{/if}
{#if isEditingImage}
  <Toolbar>
    <hbox flex class="link-dialog">
      <label for="imageurl">Image URL</label>
      <input type="url" bind:value={imageURL} id="imageurl" />
      <Button
        onClick={onImageOK}
        label={$t`OK`}
        icon={OKIcon}
        iconOnly
        />
    </hbox>
  </Toolbar>
{/if}

<script lang="ts">
  import Toolbar from '../../Shared/Toolbar/Toolbar.svelte';
  import Button from '../../Shared/Button.svelte';
  import ItalicIcon from "lucide-svelte/icons/italic";
  import CodeWordIcon from "lucide-svelte/icons/code";
  import CodeBlockIcon from "lucide-svelte/icons/code-xml";
  import QuoteMailIcon from "lucide-svelte/icons/text-quote";
  import QuoteIcon from "lucide-svelte/icons/quote";
  import LinkIcon from "lucide-svelte/icons/link";
  import LinkRemoveIcon from "lucide-svelte/icons/unlink";
  import ImageIcon from "lucide-svelte/icons/image-plus";
  import OKIcon from "lucide-svelte/icons/check";
  import ListBulletedIcon from "lucide-svelte/icons/list";
  import ListNumberedIcon from "lucide-svelte/icons/list-ordered";
  import ClearIcon from "lucide-svelte/icons/remove-formatting";
  import UndoIcon from "lucide-svelte/icons/undo";
  import RedoIcon from "lucide-svelte/icons/redo";
  import type { Editor } from '@tiptap/core';
  import { onKeyEnter } from '../../Util/util';
  import { catchErrors } from '../../Util/error';
  import { tick } from 'svelte';
  import { t } from '../../../l10n/l10n';

  /* in only */
  export let editor: Editor;

  let isEditingLink = false;
  let linkTargetURL: string = null;
  let linkTargetInput: HTMLInputElement;
  async function onLinkOpen() {
    isEditingLink = true;
    linkTargetURL = editor.getAttributes('link').href
    await tick();
    linkTargetInput?.focus();
  }
  function onLinkOK() {
    editor.chain().focus().applyLink(linkTargetURL?.trim()).run();
    isEditingLink = false;
  }
  function onLinkKey(event: KeyboardEvent) {
    if (event.key == "Escape") {
      event.preventDefault();
      event.stopPropagation();
      isEditingLink = false;
      editor.commands.focus();
      return;
    }
    onKeyEnter(event, onLinkOK);
  }
  $: if (editor) {
    editor.storage.linkEditing.openLinkEditor = () => catchErrors(onLinkOpen);
  }

  let isEditingImage = false;
  let imageURL: string = null;
  function onImageOK() {
    imageURL = "";
    editor.chain().focus().setImage({ src: imageURL }).run();
    isEditingImage = false;
  }
</script>

<style>
  .bold-icon {
    font-weight: bold;
    height: 16px;
    align-items: center;
  }
  .strike-through-icon {
    text-decoration: line-through;
    font-size: 18px;
    height: 16px;
    align-items: center;
  }
  .header-icon {
    font-weight: bold;
  }
  .link-dialog {
    align-items: baseline;
  }
  .link-dialog input {
    max-width: 30em;
    margin-inline-end: 32px;
  }
  .link-dialog label {
    margin-inline-end: 8px;
  }
</style>
