<Dialog title={$t`Find and Replace`} on:close={onClose} width="520px">
  <DialogTabs tabs={[{ id: "find", label: $t`Find *=> Find a word in the text` }, { id: "replace", label: $t`Replace *=> Replace a word in the text with another one` }]}
    bind:selected={tab} />
  <grid class="fields">
    <span>{$t`Find what`}</span>
    <TextField label={$t`Find what`} bind:value={term}
      on:input={() => status = ""} on:keydown={onEnter} />
    {#if tab == "replace"}
      <span>{$t`Replace with`}</span>
      <TextField label={$t`Replace with`} bind:value={replacement} on:keydown={onEnter} />
    {/if}
  </grid>
  {#if showOptions}
    <vbox class="options">
      <hbox class="caption">{$t`Search Options`}</hbox>
      <Checkbox label={$t`Match case *=> Search option: only find text with the same upper and lower case`} bind:checked={matchCase} />
    </vbox>
  {/if}
  <hbox class="status" role="status">{status}</hbox>
  <svelte:fragment slot="footer">
    <DialogButton label={showOptions ? $t`<< Less *=> Show fewer search options` : $t`More >> *=> Show more search options`} onClick={toggleOptions} />
    <hbox flex />
    {#if tab == "replace"}
      <DialogButton label={$t`Replace *=> Replace the found text`} disabled={!term} onClick={onReplace} />
      <DialogButton label={$t`Replace All`} disabled={!term} onClick={onReplaceAll} />
    {/if}
    <DialogButton label={$t`Find Next`} primary disabled={!term} onClick={onFindNext} />
    <DialogButton label={$t`Cancel`} onClick={onClose} />
  </svelte:fragment>
</Dialog>

<script lang="ts">
  import { findNext, clearFound, replaceMatch, replaceAllMatches } from "./EditorFind";
  import Dialog from "../Dialog/Dialog.svelte";
  import DialogButton from "../Dialog/DialogButton.svelte";
  import DialogTabs from "../Dialog/DialogTabs.svelte";
  import TextField from "../Form/TextField.svelte";
  import Checkbox from "../Form/Checkbox.svelte";
  import { AppWindow } from "../../../frontend/MainWindow/AppWindow";
  import type { Editor } from "@tiptap/core";
  import { createEventDispatcher, onDestroy } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let editor: Editor;
  export let replaceMode = false;

  const appWindow = AppWindow.current();
  const dispatch = createEventDispatcher<{ close: void }>();

  let tab = replaceMode ? "replace" : "find";
  let { from, to } = editor.state.selection;
  let term = editor.state.doc.textBetween(from, to, " ").slice(0, 255);
  let replacement = "";
  let matchCase = false;
  let showOptions = false;
  let status = "";

  onDestroy(() => clearFound(appWindow.window.document));

  function toggleOptions() {
    showOptions = !showOptions;
  }

  function onFindNext() {
    status = findNext(editor, term, matchCase) ? "" : $t`The search item was not found`;
  }

  function onReplace() {
    status = replaceMatch(editor, term, replacement, matchCase) ? "" : $t`The search item was not found`;
  }

  function onReplaceAll() {
    clearFound(appWindow.window.document);
    let count = replaceAllMatches(editor, term, replacement, matchCase);
    status = count ? $t`All done. ${count} replacements were made.` : $t`The search item was not found`;
  }

  function onEnter(event: KeyboardEvent) {
    if (event.key == "Enter" && term) {
      event.preventDefault();
      onFindNext();
    }
  }

  function onClose() {
    dispatch("close");
  }
</script>

<style>
  :global(::highlight(lookout-find)) {
    background-color: var(--lo-selected-bg);
    color: var(--lo-fg);
  }
  .fields {
    grid-template-columns: max-content 1fr;
    align-items: center;
    gap: 8px 12px;
    padding-block-start: 16px;
  }
  .options {
    gap: 6px;
    margin-block-start: 12px;
  }
  .caption {
    align-items: center;
    gap: 8px;
    font-weight: 600;
  }
  .caption::after {
    content: "";
    flex: 1 1 auto;
    border-block-start: 1px solid var(--lo-divider);
  }
  .status {
    min-height: 20px;
    margin-block-start: 8px;
    color: var(--lo-fg-secondary);
  }
</style>
