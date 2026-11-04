<Dialog title={$t`Word Count`} on:close={onClose} width="360px" cancelLabel={$t`Close`}>
  <vbox class="statistics">
    <hbox class="caption">{$t`Statistics *=> Heading of the counts of words and characters`}</hbox>
    <grid class="rows">
      <span>{$t`Words *=> Number of words in the text`}</span>
      <span class="value">{statistics.words.toLocaleString(getDateTimeLocale())}</span>
      <span>{$t`Characters (no spaces)`}</span>
      <span class="value">{statistics.charactersWithoutSpaces.toLocaleString(getDateTimeLocale())}</span>
      <span>{$t`Characters (with spaces)`}</span>
      <span class="value">{statistics.charactersWithSpaces.toLocaleString(getDateTimeLocale())}</span>
      <span>{$t`Paragraphs *=> Number of paragraphs in the text`}</span>
      <span class="value">{statistics.paragraphs.toLocaleString(getDateTimeLocale())}</span>
    </grid>
    {#if isSelection}
      <hbox class="note lo-secondary">{$t`Counted in the selected text`}</hbox>
    {/if}
  </vbox>
</Dialog>

<script lang="ts">
  import { TextStatistics } from "./TextStatistics";
  import Dialog from "../Dialog/Dialog.svelte";
  import type { Editor } from "@tiptap/core";
  import { createEventDispatcher } from "svelte";
  import { getDateTimeLocale, t } from "../../../l10n/l10n";

  export let editor: Editor;

  const dispatch = createEventDispatcher<{ close: void }>();

  let statistics = TextStatistics.ofEditor(editor);
  let isSelection = !editor.state.selection.empty;

  function onClose() {
    dispatch("close");
  }
</script>

<style>
  .statistics {
    gap: 8px;
  }
  .caption {
    font-weight: 600;
  }
  .rows {
    grid-template-columns: 1fr max-content;
    gap: 6px 24px;
    padding-inline-start: 12px;
  }
  .value {
    text-align: end;
    font-variant-numeric: tabular-nums;
  }
  .note {
    font-size: var(--lo-font-size-small);
  }
</style>
