<vbox flex class="event-table" style:--columns={gridColumns}>
  <div class="column-headers" role="row">
    <span class="column-header icon-column" role="columnheader" aria-label={$t`Icon *=> Column with the icon of the event type`}>
      <CalendarIcon size="14" />
    </span>
    {#each columns as column (column)}
      <button class="column-header" role="columnheader"
        aria-sort={table.sortColumn == column ? (table.ascending ? "ascending" : "descending") : "none"}
        title={$t`Sort by ${EventTable.columnLabel(column)}`}
        on:click={() => onSort(column)}>
        <span class="label">{EventTable.columnLabel(column)}</span>
        {#if table.sortColumn == column}
          <svelte:component this={table.ascending ? SortUpIcon : SortDownIcon} size="12" />
        {/if}
      </button>
    {/each}
  </div>
  <vbox flex class="rows" role="grid" aria-label={label} tabindex="0" bind:this={rowsEl} on:keydown={onKeyDown}>
    {#each groups as group (group.id)}
      {#if group.label}
        <button class="group-header" aria-expanded={!collapsed.has(group.id)} on:click={() => toggleGroup(group.id)}>
          <ChevronIcon size="14" class="chevron {collapsed.has(group.id) ? 'collapsed' : ''}" />
          <span class="group-label">{group.label}</span>
          <span class="group-count">{$t`${group.events.length} item(s)`}</span>
        </button>
      {/if}
      {#if !collapsed.has(group.id)}
        {#each group.events as event (event.id)}
          <ListViewLine {event} {columns} on:click={() => rowsEl.focus()} />
        {/each}
      {/if}
    {:else}
      <vbox class="empty">{emptyText}</vbox>
    {/each}
  </vbox>
</vbox>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { EventTable, EventTableColumn, EventTableGrouping } from "./EventTable";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import { calendarSearchOptions, CalendarCurrentView, CalendarSearchScope } from "../selected";
  import { globalSearchTerm } from "../../../frontend/AppsBar/selectedApp";
  import { selectedEvent } from "../../../frontend/Calendar/selected";
  import ListViewLine from "./ListViewLine.svelte";
  import CalendarIcon from "lucide-svelte/icons/calendar";
  import SortUpIcon from "lucide-svelte/icons/chevron-up";
  import SortDownIcon from "lucide-svelte/icons/chevron-down";
  import ChevronIcon from "lucide-svelte/icons/chevron-down";
  import type { Collection } from "svelte-collections";
  import { tick } from "svelte";
  import { derived } from "svelte/store";
  import { t } from "../../../l10n/l10n";

  export let events: Collection<Event>;

  const listColumns = getLocalStorage<EventTableColumn[]>("lookout.calendar.list.columns", EventTable.defaultColumns);
  const sortColumn = getLocalStorage<EventTableColumn>("lookout.calendar.list.sortColumn", EventTableColumn.Start);
  const sortAscending = getLocalStorage<boolean>("lookout.calendar.list.sortAscending", true);
  const grouping = getLocalStorage<EventTableGrouping>("lookout.calendar.list.grouping", EventTableGrouping.Recurrence);

  const currentView = getLocalStorage<CalendarCurrentView>("lookout.calendar.currentView", CalendarCurrentView.Calendar);
  $: isSearch = !!$globalSearchTerm?.trim();
  $: label = isSearch ? $t`Search results` : $currentView.value == CalendarCurrentView.Active ? $t`Active appointments` : $t`All appointments`;
  $: emptyText = isSearch ? $t`We didn't find anything to show here` : $t`There are no items to show in this view`;
  $: showCalendarColumn = isSearch && $calendarSearchOptions.scope == CalendarSearchScope.AllCalendarItems;

  let rowsEl: HTMLElement;
  let collapsed = new Set<string>();

  $: table = new EventTable($sortColumn.value, $sortAscending.value, $grouping.value);
  $: columns = withCalendarColumn($listColumns.value, showCalendarColumn);
  $: gridColumns = "28px " + columns.map(columnWidth).join(" ");
  $: listedEvents = derived($events.contents, () => events.contents);
  $: groups = table.groups($listedEvents);
  $: shownEvents = groups.filter(group => !collapsed.has(group.id)).flatMap(group => group.events);

  function withCalendarColumn(listed: EventTableColumn[], showCalendar: boolean): EventTableColumn[] {
    return showCalendar && !listed.includes(EventTableColumn.Calendar)
      ? [...listed, EventTableColumn.Calendar]
      : listed;
  }

  function columnWidth(column: EventTableColumn): string {
    switch (column) {
    case EventTableColumn.Subject:
      return "minmax(160px, 2fr)";
    case EventTableColumn.Start:
    case EventTableColumn.End:
      return "minmax(200px, 1.1fr)";
    case EventTableColumn.Recurrence:
      return "minmax(140px, 1.6fr)";
    default:
      return "minmax(100px, 1fr)";
    }
  }

  function onSort(column: EventTableColumn) {
    table.toggleSort(column);
    $sortColumn.value = table.sortColumn;
    $sortAscending.value = table.ascending;
  }

  function toggleGroup(id: string) {
    if (collapsed.has(id)) {
      collapsed.delete(id);
    } else {
      collapsed.add(id);
    }
    collapsed = collapsed;
  }

  async function onKeyDown(keyEvent: KeyboardEvent) {
    if (keyEvent.key != "ArrowDown" && keyEvent.key != "ArrowUp" || keyEvent.ctrlKey || keyEvent.altKey || !shownEvents.length) {
      return;
    }
    keyEvent.preventDefault();
    let index = shownEvents.indexOf($selectedEvent);
    let next = index < 0
      ? 0
      : Math.max(0, Math.min(shownEvents.length - 1, index + (keyEvent.key == "ArrowDown" ? 1 : -1)));
    $selectedEvent = shownEvents[next];
    await tick();
    rowsEl.querySelector(".event-row.selected")?.scrollIntoView({ block: "nearest" });
  }
</script>

<style>
  .event-table {
    min-height: 0;
  }
  .column-headers {
    display: grid;
    grid-template-columns: var(--columns);
    flex-shrink: 0;
    border-block-end: 1px solid var(--lo-divider);
  }
  .column-header {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 32px;
    padding: 0 8px;
    border: none;
    border-inline-start: 1px solid var(--lo-divider);
    background: none;
    color: var(--lo-fg-secondary);
    font: inherit;
    font-size: var(--lo-font-size-small);
    font-weight: 600;
    text-align: start;
    white-space: nowrap;
    overflow: hidden;
    cursor: pointer;
  }
  .column-header:hover {
    background-color: var(--lo-hover-bg);
  }
  .column-header.icon-column {
    justify-content: center;
    padding: 0;
    border-inline-start: none;
    cursor: default;
  }
  .column-header.icon-column:hover {
    background: none;
  }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rows {
    min-height: 0;
    overflow-y: auto;
    outline: none;
  }
  .rows:focus-visible :global(.event-row.selected) {
    outline: 1px solid var(--lo-focus-ring);
    outline-offset: -1px;
  }
  .group-header {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 6px;
    height: 32px;
    padding: 0 8px;
    border: none;
    border-block-end: 1px solid var(--lo-divider);
    background: none;
    color: var(--lo-fg);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .group-header:hover {
    background-color: var(--lo-hover-bg);
  }
  .group-header :global(.chevron) {
    color: var(--lo-fg-secondary);
    transition: transform 0.1s;
  }
  .group-header :global(.chevron.collapsed) {
    transform: rotate(-90deg);
  }
  .group-label {
    font-weight: 600;
    color: var(--lo-accent-text);
  }
  .group-count {
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
  }
  .empty {
    align-items: center;
    padding: 32px 16px;
    color: var(--lo-fg-secondary);
  }
</style>
