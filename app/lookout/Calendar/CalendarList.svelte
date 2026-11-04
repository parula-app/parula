<vbox class="calendar-list">
  {#each groups as group (group.id)}
    {@const allShown = group.calendars.every(calendar => $shownCalendars.contains(calendar))}
    {@const someShown = group.calendars.some(calendar => $shownCalendars.contains(calendar))}
    <hbox class="group-header">
      <button class="expander"
        aria-expanded={!collapsed.has(group.id)}
        title={collapsed.has(group.id) ? $t`Expand` : $t`Collapse`}
        on:click={() => toggleGroup(group.id)}>
        <ChevronIcon size={14} class="chevron {collapsed.has(group.id) ? 'collapsed' : ''}" />
      </button>
      <Checkbox classes="group-checkbox"
        checked={allShown && group.calendars.length > 0}
        indeterminate={someShown && !allShown}
        disabled={!group.calendars.length}
        tooltip={$t`Show all calendars of this group`}
        on:change={event => showGroup(group, event.detail)} />
      <button class="group-label" on:click={() => toggleGroup(group.id)}>{group.label}</button>
    </hbox>
    {#if !collapsed.has(group.id)}
      {#each group.calendars as calendar (calendar.id)}
        <CalendarListItem {calendar}
          isShown={$shownCalendars.contains(calendar)}
          isSelected={$selectedCalendar == calendar}
          on:contextmenu={event => contextMenu.openFor(event, calendar)} />
      {/each}
    {/if}
  {/each}
</vbox>

<CalendarMenu bind:this={contextMenu} />

<script lang="ts">
  import { CalendarGroups, type CalendarGroup } from "./CalendarGroups";
  import { selectedCalendar, shownCalendars } from "../../frontend/Calendar/selected";
  import { appGlobal } from "../../logic/app";
  import { getLocalStorage } from "../../frontend/Util/LocalStorage";
  import CalendarListItem from "./CalendarListItem.svelte";
  import Checkbox from "../Shared/Form/Checkbox.svelte";
  import CalendarMenu from "./CalendarMenu.svelte";
  import ChevronIcon from "lucide-svelte/icons/chevron-down";
  import { t } from "../../l10n/l10n";

  let calendars = appGlobal.calendars;
  let contextMenu: CalendarMenu;

  const order = getLocalStorage<string[]>("lookout.calendar.order", []);
  $: groups = new CalendarGroups($calendars.contents, $order.value).groups;

  let collapsed = new Set<string>();
  function toggleGroup(id: string) {
    if (collapsed.has(id)) {
      collapsed.delete(id);
    } else {
      collapsed.add(id);
    }
    collapsed = collapsed;
  }

  function showGroup(group: CalendarGroup, show: boolean) {
    for (let calendar of group.calendars) {
      shownCalendars.show(calendar, show);
    }
  }
</script>

<style>
  .calendar-list {
    padding: 4px 4px 8px 8px;
  }
  .group-header {
    align-items: center;
    gap: 2px;
    margin-block-start: 8px;
    height: 32px;
  }
  .expander {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg-secondary);
    cursor: pointer;
  }
  .expander:hover {
    background-color: var(--lo-hover-bg);
  }
  .expander :global(.chevron) {
    transition: transform 0.1s;
  }
  .expander :global(.chevron.collapsed) {
    transform: rotate(-90deg);
  }
  .group-header :global(.group-checkbox) {
    margin: 0 4px 0 2px;
  }
  .group-label {
    flex: 1 1 0;
    min-width: 0;
    padding: 4px;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg);
    font: inherit;
    font-weight: 600;
    text-align: start;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  .group-label:hover {
    background-color: var(--lo-hover-bg);
  }
</style>
