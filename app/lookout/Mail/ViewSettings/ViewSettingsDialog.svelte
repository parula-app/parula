<Dialog title={$t`Advanced View Settings: ${viewTypeLabel(draft.type)}`}
  okLabel={$t`OK`} onOK={save} width="600px" on:close>
  <GroupBox label={$t`Description`}>
    <div class="rows">
      <DialogButton label={$t`Columns… *=> Choose the columns of the list`} classes="settings-button" onClick={() => { open = "columns"; }} />
      <span class="summary" title={columnsSummary}>{columnsSummary}</span>
      <DialogButton label={$t`Group By…`} classes="settings-button" onClick={() => { open = "group-by"; }} />
      <span class="summary">{groupSummary}</span>
      <DialogButton label={$t`Sort… *=> Choose how the items are sorted`} classes="settings-button" onClick={() => { open = "sort"; }} />
      <span class="summary">{sortSummary}</span>
      <DialogButton label={$t`Filter… *=> Show only some of the emails in the folder`} classes="settings-button" onClick={() => { open = "filter"; }} />
      <span class="summary">{$quickSearch && quickSearch.hasSearch() ? $t`On *=> The filter is turned on` : $t`Off *=> The filter is turned off`}</span>
      <DialogButton label={$t`Other Settings…`} classes="settings-button" onClick={() => { open = "other"; }} />
      <span class="summary">{$t`Groups, spacing, message preview and reading pane`}</span>
    </div>
  </GroupBox>
  <svelte:fragment slot="buttons-start">
    <DialogButton label={$t`Reset Current View`} onClick={resetDraft} />
  </svelte:fragment>
</Dialog>
{#if open == "columns"}
  <ShowColumnsDialog columns={draft.columns} on:change={event => draft = { ...draft, columns: event.detail }} on:close={closeSub} />
{:else if open == "group-by"}
  <GroupByDialog settings={draft} on:change={event => draft = { ...draft, ...event.detail }} on:close={closeSub} />
{:else if open == "sort"}
  <SortDialog settings={draft} on:change={event => draft = { ...draft, ...event.detail }} on:close={closeSub} />
{:else if open == "filter"}
  <FilterDialog on:close={closeSub} />
{:else if open == "other"}
  <OtherSettingsDialog settings={draft} readingPanePosition={readingPane}
    on:change={event => { draft = { ...draft, ...event.detail.changes }; readingPane = event.detail.readingPane; }}
    on:close={closeSub} />
{/if}

<script lang="ts" context="module">
  import type { Folder } from "../../../logic/Mail/Folder";
  import { writable } from "svelte/store";

  export const openViewSettings = writable<{ folder: Folder | null } | null>(null);
</script>

<script lang="ts">
  import { quickSearch } from "../../../frontend/Mail/Selected";
  import { arrangeFieldLabel, ColumnInfo, viewSettingsOf, replaceViewSettings, viewTypeLabel, defaultViewSettings, type ViewSettings } from "./ViewSettings";
  import { MessageGrouping } from "../3pane/MessageGrouping";
  import type { ReadingPanePosition } from "../3pane/3Pane.svelte";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import GroupBox from "../../Shared/Form/GroupBox.svelte";
  import ShowColumnsDialog from "./ShowColumnsDialog.svelte";
  import GroupByDialog from "./GroupByDialog.svelte";
  import SortDialog from "./SortDialog.svelte";
  import FilterDialog from "./FilterDialog.svelte";
  import OtherSettingsDialog from "./OtherSettingsDialog.svelte";
  import { t } from "../../../l10n/l10n";

  export let folder: Folder | null;

  let draft: ViewSettings = viewSettingsOf(folder);
  const readingPaneSetting = getLocalStorage<ReadingPanePosition>("lookout.mail.readingPane", "right");
  let readingPane: ReadingPanePosition = readingPaneSetting.value ?? "right";
  let open: "columns" | "group-by" | "sort" | "filter" | "other" | null = null;

  $: columnsSummary = draft.columns.map(column => ColumnInfo.labelOf(column)).join(", ");
  $: groupSummary = !draft.showInGroups
    ? $t`None *=> The emails are not grouped`
    : $t`${arrangeFieldLabel(draft.groupBy ?? draft.arrangeBy)} (${orderLabel(draft.groupBy ?? draft.arrangeBy, draft.groupBy ? draft.groupReverse : draft.reverseSort)})`;
  $: sortSummary = $t`${arrangeFieldLabel(draft.arrangeBy)} (${orderLabel(draft.arrangeBy, draft.reverseSort)})`;

  function orderLabel(field: ViewSettings["arrangeBy"], reverse: boolean): string {
    return MessageGrouping.isDescendingByDefault(field) == !!reverse ? $t`ascending *=> Sort order, as in: Date (ascending)` : $t`descending *=> Sort order, as in: Date (descending)`;
  }

  function closeSub() {
    open = null;
  }

  function resetDraft() {
    draft = { ...defaultViewSettings(), type: draft.type };
  }

  function save() {
    replaceViewSettings(folder, draft);
    readingPaneSetting.value = readingPane;
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
</style>
