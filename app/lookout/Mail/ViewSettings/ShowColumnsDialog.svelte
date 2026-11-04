<Dialog title={$t`Show Columns`} okLabel={$t`OK`} onOK={() => { dispatch("change", shown); }} width="620px" on:close>
  <hbox class="columns-editor">
    <vbox flex class="list-box">
      <span class="list-label">{$t`Available columns`}</span>
      <ListView items={available} bind:selected={selectedAvailable} on:open={event => add(event.detail)}
        label={$t`Available columns`} height="240px" let:item>
        <span>{ColumnInfo.labelOf(item)}</span>
      </ListView>
    </vbox>
    <vbox class="middle-buttons">
      <DialogButton label={$t`Add ->`} disabled={!selectedAvailable} onClick={() => add(selectedAvailable)} />
      <DialogButton label={$t`<- Remove`}
        disabled={!selectedShown || selectedShown == Column.Subject}
        onClick={() => remove(selectedShown)} />
    </vbox>
    <vbox flex class="list-box">
      <span class="list-label">{$t`Show these columns in this order`}</span>
      <ListView items={shown} bind:selected={selectedShown} on:open={event => remove(event.detail)}
        label={$t`Show these columns in this order`} height="240px" let:item>
        <span>{ColumnInfo.labelOf(item)}</span>
      </ListView>
      <hbox class="order-buttons">
        <DialogButton label={$t`Move Up *=> Move the selected column up in the order`} disabled={!canMove(-1, selectedShown, shown)} onClick={() => move(-1)} />
        <DialogButton label={$t`Move Down *=> Move the selected column down in the order`} disabled={!canMove(1, selectedShown, shown)} onClick={() => move(1)} />
      </hbox>
    </vbox>
  </hbox>
</Dialog>

<script lang="ts" context="module">
  import type { Folder } from "../../../logic/Mail/Folder";
  import { writable } from "svelte/store";

  export const openShowColumns = writable<{ folder: Folder | null } | null>(null);
</script>

<script lang="ts">
  import { Column, ColumnInfo } from "./ViewSettings";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import ListView from "../../Shared/Form/ListView.svelte";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let columns: Column[];
  const dispatch = createEventDispatcher<{ change: Column[] }>();

  let shown = [...columns];
  if (!shown.includes(Column.Subject)) {
    shown.push(Column.Subject);
  }
  let selectedAvailable: Column | null = null;
  let selectedShown: Column | null = shown[0] ?? null;
  $: available = ColumnInfo.all.map(info => info.id).filter(column => !shown.includes(column));

  function add(column: Column) {
    if (!column || shown.includes(column)) {
      return;
    }
    let pos = selectedShown ? shown.indexOf(selectedShown) + 1 : shown.length;
    shown.splice(pos, 0, column);
    shown = shown;
    selectedShown = column;
    selectedAvailable = null;
  }

  function remove(column: Column) {
    if (!column || column == Column.Subject) {
      return;
    }
    let pos = shown.indexOf(column);
    shown = shown.filter(existing => existing != column);
    selectedShown = shown[Math.min(pos, shown.length - 1)] ?? null;
    selectedAvailable = column;
  }

  function canMove(offset: number, column: Column | null, list: Column[]): boolean {
    if (!column) {
      return false;
    }
    let pos = list.indexOf(column);
    return pos >= 0 && pos + offset >= 0 && pos + offset < list.length;
  }

  function move(offset: number) {
    if (!canMove(offset, selectedShown, shown)) {
      return;
    }
    let pos = shown.indexOf(selectedShown);
    shown.splice(pos, 1);
    shown.splice(pos + offset, 0, selectedShown);
    shown = shown;
  }

</script>

<style>
  .columns-editor {
    gap: 12px;
  }
  .list-box {
    flex: 1 1 0;
    gap: 4px;
    min-width: 0;
  }
  .list-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .middle-buttons {
    justify-content: center;
    gap: 8px;
    padding-top: 20px;
  }
  .order-buttons {
    gap: 8px;
    justify-content: end;
    padding-top: 4px;
  }
</style>
