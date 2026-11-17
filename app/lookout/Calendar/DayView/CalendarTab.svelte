<div class="calendar-tab" class:selected={$selectedCalendar == calendar}
  style="grid-column: {firstColumn} / span {span}; --calendar-color: {$calendar.color}">
  {#if !isFirst}
    <button class="tab-button" title={$t`View in overlay mode`} on:click={() => splitViewSetting.value = false}>
      <OverlayIcon size="14" />
    </button>
  {/if}
  <button class="name" title={$calendar.name} on:click={() => $selectedCalendar = calendar}>
    {$calendar.name}
  </button>
  <button class="tab-button" title={$t`Close calendar`} on:click={() => shownCalendars.show(calendar, false)}>
    <CloseIcon size="14" />
  </button>
</div>

<script lang="ts">
  import type { Calendar } from "../../../logic/Calendar/Calendar";
  import { selectedCalendar, shownCalendars } from "../../../frontend/Calendar/selected";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import OverlayIcon from "lucide-svelte/icons/arrow-left";
  import CloseIcon from "lucide-svelte/icons/x";
  import { t } from "../../../l10n/l10n";

  export let calendar: Calendar;
  export let firstColumn: number;
  export let span: number;
  export let isFirst = false;

  const splitViewSetting = getLocalStorage<boolean>("lookout.calendar.splitView", false);
</script>

<style>
  .calendar-tab {
    display: flex;
    flex-direction: row;
    align-items: center;
    min-width: 0;
    height: 28px;
    margin-block-start: 4px;
    padding-inline: 4px;
    border-radius: 6px 6px 0 0;
    background-color: color-mix(in srgb, var(--calendar-color) 30%, var(--lo-pane-bg));
    color: var(--lo-fg);
  }
  .calendar-tab.selected {
    background-color: color-mix(in srgb, var(--calendar-color) 55%, var(--lo-pane-bg));
  }
  .name {
    flex: 1 1 0;
    min-width: 0;
    padding: 0 6px;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    font-weight: 400;
    text-align: start;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  .selected .name {
    font-weight: 600;
  }
  .tab-button {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: inherit;
    cursor: pointer;
  }
  .tab-button:hover {
    background-color: color-mix(in srgb, var(--lo-fg) 10%, transparent);
  }
</style>
