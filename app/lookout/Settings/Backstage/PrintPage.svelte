<hbox flex class="print-page">
  <vbox class="options">
    <h1>{$t`Print`}</h1>
    <hbox class="print-row">
      <button class="print-button" disabled={!message} title={message ? $t`Print` : $t`Select a message first`}
        on:click={onPrint}>
        <PrintIcon size={32} strokeWidth={1.25} />
        <span>{$t`Print`}</span>
      </button>
      <span class="hint">{$t`Specify how you want the item to be printed and then click Print. You choose the printer in the next step.`}</span>
    </hbox>
    <h2>{$t`Settings`}</h2>
    <vbox class="styles" role="listbox" aria-label={$t`Print style`}>
      <hbox class="style selected" role="option" aria-selected="true">
        <hbox class="style-icon"><MemoStyleIcon size={28} strokeWidth={1.25} /></hbox>
        <span>{$t`Memo Style *=> Print layout with the header fields and the text of the email`}</span>
      </hbox>
    </vbox>
  </vbox>
  <vbox flex class="preview-area">
    {#if message}
      <vbox class="sheet">
        <hbox class="sheet-header">{$message.subject ?? ""}</hbox>
        <vbox flex class="sheet-body">
          {#await message.loadBody()}
            <span class="lo-secondary">{$t`Loading…`}</span>
          {:then}
            <!-- <copied from="../../../frontend/Mail/Message/HTMLDisplay.svelte">, without the dark colors of content-body.css, because paper is white -->
            <WebView html={$message.html} headHTML={kHeadHTML} allowServerCalls={false} title={$t`Print Preview`} />
            <!-- </copied> -->
          {:catch ex}
            <span class="lo-secondary">{ex?.message ?? ex}</span>
          {/await}
        </vbox>
      </vbox>
    {:else}
      <vbox flex class="empty lo-secondary">{$t`Select a message to see how it will be printed`}</vbox>
    {/if}
  </vbox>
</hbox>

<script lang="ts">
  import { selectedMessage } from "../../../frontend/Mail/Selected";
  import { printMessage } from "../../Mail/Message/MessagePrint.svelte";
  import { isBackstageOpen } from "./selected";
  import WebView from "../../../frontend/Shared/WebView.svelte";
  import cssContent from "../../../frontend/Mail/Message/content.css?inline";
  import PrintIcon from "lucide-svelte/icons/printer";
  import MemoStyleIcon from "lucide-svelte/icons/file-text";
  import { t } from "../../../l10n/l10n";

  const kHeadHTML = `<style>\nbody { margin: 0; font-family: system-ui, sans-serif; line-height: 1.5; }\n${cssContent}\n</style>`;

  $: message = $selectedMessage;

  function onPrint() {
    $isBackstageOpen = false;
    $printMessage = message;
  }
</script>

<style>
  .print-page {
    min-height: 0;
  }
  .options {
    flex: 0 0 auto;
    width: 340px;
    padding: 24px 24px 24px 40px;
    border-inline-end: 1px solid var(--lo-divider);
  }
  h1 {
    margin: 0 0 16px 0;
    font-size: 28px;
    font-weight: 300;
  }
  h2 {
    margin: 24px 0 8px 0;
    font-size: 18px;
    font-weight: 400;
  }
  .print-row {
    align-items: start;
    gap: 16px;
  }
  .print-button {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 104px;
    height: 96px;
    padding: 8px 4px;
    border: 1px solid var(--lo-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-pane-bg);
    color: var(--lo-accent-text);
    font: inherit;
    cursor: pointer;
  }
  .print-button span {
    color: var(--lo-fg);
    font-weight: 600;
  }
  .print-button:hover:not(:disabled) {
    border-color: var(--lo-border-strong);
    background-color: var(--lo-hover-bg);
  }
  .print-button:disabled,
  .print-button:disabled span {
    color: var(--lo-fg-disabled);
    cursor: default;
  }
  .hint {
    color: var(--lo-fg-secondary);
  }
  .styles {
    border: 1px solid var(--lo-border);
    border-radius: var(--lo-radius-small);
  }
  .style {
    align-items: center;
    gap: 16px;
    height: 48px;
    padding: 0 12px;
  }
  .style.selected {
    background-color: var(--lo-selected-bg);
  }
  .style-icon {
    color: var(--lo-fg-secondary);
  }
  .preview-area {
    min-width: 0;
    align-items: center;
    padding: 24px;
    overflow: auto;
    background-color: var(--lo-pane-alt-bg);
  }
  .sheet {
    flex: 1 0 auto;
    width: min(100%, 640px);
    min-height: 600px;
    padding: 40px 48px;
    border: 1px solid var(--lo-border);
    background-color: white;
    color: black;
    box-shadow: var(--lo-shadow-popup);
  }
  .sheet-header {
    padding-block-end: 8px;
    margin-block-end: 16px;
    border-block-end: 2px solid black;
    font-weight: 600;
  }
  .sheet-body {
    min-height: 480px;
  }
  .empty {
    justify-content: center;
  }
</style>
