<hbox class="editor-toolbar">
  <button type="button" class="tool" class:pressed={isActive("bold")} title={$t`Bold`} aria-label={$t`Bold`}
    disabled={!editor || disabled} on:click={() => run(chain => chain.toggleBold())}>
    <BoldIcon size={16} />
  </button>
  <button type="button" class="tool" class:pressed={isActive("italic")} title={$t`Italic`} aria-label={$t`Italic`}
    disabled={!editor || disabled} on:click={() => run(chain => chain.toggleItalic())}>
    <ItalicIcon size={16} />
  </button>
  <button type="button" class="tool" class:pressed={isActive("underline")} title={$t`Underline *=> Text formatting: underlined text`} aria-label={$t`Underline *=> Text formatting: underlined text`}
    disabled={!editor || disabled} on:click={() => run(chain => chain.toggleUnderline())}>
    <UnderlineIcon size={16} />
  </button>
  <hbox class="tool-separator" />
  <button type="button" class="tool" class:pressed={isActive("link")} title={$t`Hyperlink *=> Insert or edit a link in the text`} aria-label={$t`Hyperlink *=> Insert or edit a link in the text`}
    disabled={!editor || disabled} on:click={() => showLinkDialog = true}>
    <LinkIcon size={16} />
  </button>
</hbox>
{#if showLinkDialog && editor}
  <LinkDialog {editor} on:close={() => showLinkDialog = false} />
{/if}

<script lang="ts">
  import LinkDialog from "./LinkDialog.svelte";
  import BoldIcon from "lucide-svelte/icons/bold";
  import ItalicIcon from "lucide-svelte/icons/italic";
  import UnderlineIcon from "lucide-svelte/icons/underline";
  import LinkIcon from "lucide-svelte/icons/link";
  import type { ChainedCommands, Editor } from "@tiptap/core";
  import { t } from "../../../l10n/l10n";

  export let editor: Editor;
  export let disabled = false;

  let showLinkDialog = false;

  function isActive(mark: string): boolean {
    return !!editor?.isActive(mark);
  }

  function run(command: (chain: ChainedCommands) => ChainedCommands) {
    command(editor.chain().focus()).run();
  }
</script>

<style>
  .editor-toolbar {
    align-items: center;
    gap: 2px;
    padding: 2px;
  }
  .tool {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg);
  }
  .tool:hover:not(:disabled) {
    background-color: var(--lo-hover-bg);
  }
  .tool:disabled {
    color: var(--lo-fg-disabled);
  }
  .tool.pressed {
    background-color: var(--lo-selected-bg);
    border-color: var(--lo-border-strong);
  }
  .tool-separator {
    width: 1px;
    height: 20px;
    margin: 0 4px;
    background-color: var(--lo-divider);
  }
</style>
