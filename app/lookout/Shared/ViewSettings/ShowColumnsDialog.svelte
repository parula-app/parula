<Dialog title={$t`Show Columns`} okLabel={$t`OK`} onOK={() => { dispatch("change", order.columns); }} width="660px" on:close>
  <vbox class="show-columns">
    {#if columnSets.length}
      <vbox class="column-set">
        <span>{$t`Select available columns from`}</span>
        <ComboBox options={columnSets.map((set, i) => ({ value: i, label: set.label }))} bind:value={columnSet}
          label={$t`Select available columns from`} width="240px" />
      </vbox>
    {/if}
    <hbox class="lists">
      <vbox class="list">
        <span class="list-label">{$t`Available columns`}</span>
        <ListView items={available} bind:selected={availableSelected} label={$t`Available columns`}
          on:open={event => add(event.detail)} height="240px" let:item>
          <span>{labelOf(item)}</span>
        </ListView>
      </vbox>
      <vbox class="middle">
        <DialogButton label={$t`Add -> *=> Add the selected column to the shown columns`} onClick={() => add(availableSelected)}
          disabled={!availableSelected && $t`Choose a column on the left`} />
        <DialogButton label={$t`<- Remove *=> Remove the selected column from the shown columns`} onClick={remove}
          disabled={!order.canRemove(shownSelected) && (shownSelected == requiredColumn && requiredReason || $t`Choose a column on the right`)} />
      </vbox>
      <vbox class="list">
        <span class="list-label">{$t`Show these columns in this order`}</span>
        <ListView items={order.columns} bind:selected={shownSelected} label={$t`Shown columns`}
          on:open={() => remove()} height="240px" let:item>
          <span>{labelOf(item)}</span>
        </ListView>
        <hbox class="order-buttons">
          <DialogButton label={$t`Move Up *=> Move the selected column up in the order`} onClick={() => move(-1)} disabled={!order.canMove(shownSelected, -1)} />
          <DialogButton label={$t`Move Down *=> Move the selected column down in the order`} onClick={() => move(1)} disabled={!order.canMove(shownSelected, 1)} />
        </hbox>
      </vbox>
    </hbox>
  </vbox>
</Dialog>

<script lang="ts">
  import { ColumnOrder } from "./ColumnOrder";
  import Dialog from "../Dialog/Dialog.svelte";
  import DialogButton from "../Dialog/DialogButton.svelte";
  import ComboBox from "../Form/ComboBox.svelte";
  import ListView from "../Form/ListView.svelte";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  type T = $$Generic;
  export let columns: T[];
  export let allColumns: readonly T[];
  export let labelOf: (column: T) => string;
  export let requiredColumn: T | null = null;
  export let requiredReason: string = null;
  export let columnSets: { label: string, columns: readonly T[] }[] = [];
  const dispatch = createEventDispatcher<{ change: T[] }>();

  let order = new ColumnOrder<T>(columns, allColumns, requiredColumn);
  let columnSet = 0;
  let availableSelected: T = null;
  let shownSelected: T = order.columns[0] ?? null;

  $: available = order.columns && order.available(columnSets[columnSet]?.columns ?? allColumns);

  function add(column: T) {
    if (column == null) {
      return;
    }
    order.add(column, shownSelected);
    order = order;
    shownSelected = column;
    availableSelected = null;
  }

  function remove() {
    if (!order.canRemove(shownSelected)) {
      return;
    }
    let pos = order.columns.indexOf(shownSelected);
    let removed = shownSelected;
    order.remove(removed);
    order = order;
    availableSelected = available.includes(removed) ? removed : null;
    shownSelected = order.columns[Math.min(pos, order.columns.length - 1)] ?? null;
  }

  function move(offset: number) {
    order.move(shownSelected, offset);
    order = order;
  }
</script>

<style>
  .show-columns {
    gap: 12px;
  }
  .column-set {
    gap: 4px;
  }
  .lists {
    gap: 12px;
    align-items: stretch;
  }
  .list {
    flex: 1 1 0;
    min-width: 0;
    gap: 4px;
  }
  .list-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .middle {
    justify-content: center;
    gap: 8px;
  }
  .order-buttons {
    gap: 8px;
    justify-content: end;
    margin-block-start: 4px;
  }
</style>
