<Dialog title={$t`Search Text *=> Words that the rule searches for`} okLabel={$t`OK`} onOK={onSubmit} on:close={onClose} width="440px">
  <vbox class="search-text">
    <label for="search-text-new">{$t`Specify words or phrases to search for in the subject or body`}</label>
    <hbox class="row">
      <input id="search-text-new" class="lo-text-field" type="text" bind:value={typed} autofocus
        on:keydown={onKey} />
      <DialogButton label={$t`Add`} onClick={onAdd}
        disabled={(!typed.trim() && $t`Type a word or phrase first`) ||
          (!!phrase && $t`A rule can search for one word or phrase. Remove the one in the list first.`)} />
    </hbox>
    <span>{$t`Search list`}</span>
    <hbox class="row list-row">
      <vbox class="list" role="listbox" aria-label={$t`Search list`}>
        {#if phrase}
          <button type="button" class="entry" role="option" class:selected={isSelected} aria-selected={isSelected}
            on:click={() => isSelected = true}>"{phrase}"</button>
        {/if}
      </vbox>
      <DialogButton label={$t`Remove`} onClick={onRemove}
        disabled={!isSelected && $t`Select an entry in the list first`} />
    </hbox>
  </vbox>
</Dialog>

<script lang="ts">
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let text: string | null;
  const dispatch = createEventDispatcher<{ choose: string | null, close: void }>();

  let phrase = text ?? "";
  let typed = "";
  let isSelected = false;

  function onAdd() {
    if (!typed.trim() || phrase) {
      return;
    }
    phrase = typed.trim();
    typed = "";
  }

  function onRemove() {
    phrase = "";
    isSelected = false;
  }

  function onKey(event: KeyboardEvent) {
    if (event.key == "Enter" && typed.trim() && !phrase) {
      event.preventDefault();
      onAdd();
    }
  }

  function onSubmit() {
    dispatch("choose", phrase || typed.trim() || null);
  }

  function onClose() {
    dispatch("close");
  }
</script>

<style>
  .search-text {
    gap: 6px;
  }
  .row {
    align-items: start;
    gap: 8px;
  }
  .row input {
    flex: 1 1 0;
    min-width: 0;
  }
  .list-row {
    margin-block-end: 4px;
  }
  .list {
    flex: 1 1 0;
    height: 120px;
    padding: 2px;
    overflow-y: auto;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
  }
  .entry {
    flex-shrink: 0;
    padding: 2px 6px;
    border: none;
    border-radius: 2px;
    background: none;
    color: var(--lo-fg);
    font: inherit;
    text-align: start;
  }
  .entry.selected {
    background-color: var(--lo-selected-bg);
  }
</style>
