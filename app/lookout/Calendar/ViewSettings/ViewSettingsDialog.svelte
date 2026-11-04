<Dialog title={isTable ? $t`Advanced View Settings: List` : $t`Advanced View Settings: Calendar`}
  okLabel={$t`OK`} onOK={save} width="600px" on:close>
  <GroupBox label={$t`Description`}>
    <div class="rows">
      <DialogButton label={$t`Columns… *=> Choose the columns of the list`} classes="settings-button" onClick={() => { open = "columns"; }}
        disabled={!isTable && tableOnly} />
      <span class="summary" class:disabled={!isTable} title={columnsSummary}>{columnsSummary}</span>
      <DialogButton label={$t`Group By…`} classes="settings-button" onClick={() => { open = "group-by"; }}
        disabled={!isTable && tableOnly} />
      <span class="summary" class:disabled={!isTable}>{groupSummary}</span>
      <DialogButton label={$t`Sort… *=> Choose how the items are sorted`} classes="settings-button" onClick={() => { open = "sort"; }}
        disabled={!isTable && tableOnly} />
      <span class="summary" class:disabled={!isTable}>{sortSummary}</span>
      <DialogButton label={$t`Other Settings…`} classes="settings-button" onClick={() => { open = "other"; }} />
      <span class="summary">{$t`Time scale, week numbers and declined meetings`}</span>
    </div>
  </GroupBox>
  <svelte:fragment slot="buttons-start">
    <DialogButton label={$t`Reset Current View`} onClick={reset} />
  </svelte:fragment>
</Dialog>
{#if open == "columns"}
  <ShowColumnsDialog {columns} allColumns={EventTable.allColumns} labelOf={EventTable.columnLabel}
    requiredColumn={EventTableColumn.Subject} requiredReason={$t`The list needs the Subject column`}
    on:change={event => columns = event.detail} on:close={closeSub} />
{:else if open == "group-by"}
  <GroupByDialog bind:grouping on:close={closeSub} />
{:else if open == "sort"}
  <SortDialog columnOptions={EventTable.allColumns.map(column => ({ value: column, label: EventTable.columnLabel(column) }))}
    column={sortColumn} ascending={sortAscending}
    on:change={event => { sortColumn = event.detail.column; sortAscending = event.detail.ascending; }} on:close={closeSub} />
{:else if open == "other"}
  <OtherSettingsDialog bind:timeScale bind:weekNumbers bind:showDeclined on:close={closeSub} />
{/if}

<script lang="ts">
  import { CalendarCurrentView } from "../selected";
  import { EventTable, EventTableColumn, EventTableGrouping } from "../ListView/EventTable";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import GroupBox from "../../Shared/Form/GroupBox.svelte";
  import ShowColumnsDialog from "../../Shared/ViewSettings/ShowColumnsDialog.svelte";
  import GroupByDialog from "./GroupByDialog.svelte";
  import SortDialog from "../../Shared/ViewSettings/SortDialog.svelte";
  import OtherSettingsDialog from "./OtherSettingsDialog.svelte";
  import { t } from "../../../l10n/l10n";

  const currentView = getLocalStorage<CalendarCurrentView>("lookout.calendar.currentView", CalendarCurrentView.Calendar);
  const timeScaleSetting = getLocalStorage<number>("lookout.calendar.timeScale", 30);
  const weekNumbersSetting = getLocalStorage<boolean>("lookout.calendar.weekNumbers", false);
  const showDeclinedSetting = getLocalStorage<boolean>("lookout.calendar.showDeclined", true);
  const columnsSetting = getLocalStorage<EventTableColumn[]>("lookout.calendar.list.columns", EventTable.defaultColumns);
  const sortColumnSetting = getLocalStorage<EventTableColumn>("lookout.calendar.list.sortColumn", EventTableColumn.Start);
  const sortAscendingSetting = getLocalStorage<boolean>("lookout.calendar.list.sortAscending", true);
  const groupingSetting = getLocalStorage<EventTableGrouping>("lookout.calendar.list.grouping", EventTableGrouping.Recurrence);
  $: isTable = $currentView.value == CalendarCurrentView.List || $currentView.value == CalendarCurrentView.Active;

  let timeScale = timeScaleSetting.value;
  let weekNumbers = weekNumbersSetting.value;
  let showDeclined = showDeclinedSetting.value;
  let columns = [...columnsSetting.value];
  let sortColumn = sortColumnSetting.value;
  let sortAscending = sortAscendingSetting.value;
  let grouping = groupingSetting.value;
  let open: "columns" | "group-by" | "sort" | "other" | null = null;
  $: tableOnly = $t`Available in the List and Active views`;
  $: columnsSummary = columns.map(column => EventTable.columnLabel(column)).join(", ");
  $: groupSummary = grouping == EventTableGrouping.Recurrence ? $t`Recurrence (ascending)` : $t`None *=> No grouping of the items`;
  $: sortLabel = EventTable.columnLabel(sortColumn);
  $: sortSummary = sortAscending ? $t`${sortLabel} (ascending)` : $t`${sortLabel} (descending)`;

  function closeSub() {
    open = null;
  }

  function reset() {
    timeScale = timeScaleSetting.defaultValue;
    weekNumbers = weekNumbersSetting.defaultValue;
    showDeclined = showDeclinedSetting.defaultValue;
    columns = [...columnsSetting.defaultValue];
    sortColumn = sortColumnSetting.defaultValue;
    sortAscending = sortAscendingSetting.defaultValue;
    grouping = groupingSetting.defaultValue;
  }

  function save() {
    timeScaleSetting.value = timeScale;
    weekNumbersSetting.value = weekNumbers;
    showDeclinedSetting.value = showDeclined;
    columnsSetting.value = [...columns];
    sortColumnSetting.value = sortColumn;
    sortAscendingSetting.value = sortAscending;
    groupingSetting.value = grouping;
  }
</script>

<style>
  .rows {
    display: grid;
    grid-template-columns: 168px minmax(0, 1fr);
    align-items: center;
    gap: 8px 12px;
  }
  .rows :global(.settings-button) {
    justify-content: start;
    width: 100%;
  }
  .summary {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }
  .summary.disabled {
    color: var(--lo-fg-secondary);
  }
</style>
