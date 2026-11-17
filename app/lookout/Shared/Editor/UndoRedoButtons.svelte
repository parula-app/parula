<hbox class="undo-redo">
  <button class="quick-access" title={$t`Undo (Ctrl+Z)`} aria-label={$t`Undo *=> Undo the last change in the text`}
    disabled={!editor?.can().undo()}
    on:click={() => editor.chain().focus().undo().run()}>
    <UndoIcon size={16} />
  </button>
  <button class="quick-access" title={$t`Redo (Ctrl+Y)`} aria-label={$t`Redo *=> Redo the last undone change in the text`}
    disabled={!editor?.can().redo()}
    on:click={() => editor.chain().focus().redo().run()}>
    <RedoIcon size={16} />
  </button>
</hbox>

<script lang="ts">
  import UndoIcon from "lucide-svelte/icons/undo-2";
  import RedoIcon from "lucide-svelte/icons/redo-2";
  import { t } from "../../../l10n/l10n";
  import type { Editor } from "@tiptap/core";

  export let editor: Editor | null;
</script>

<style>
  .undo-redo {
    flex-shrink: 0;
    align-items: center;
    gap: 4px;
  }
  .quick-access {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-accent-text);
  }
  .quick-access:hover:not(:disabled) {
    background-color: var(--lo-hover-bg);
  }
  .quick-access:disabled {
    color: var(--lo-fg-disabled);
  }
</style>
