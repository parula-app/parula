<hbox class="calendar-item" class:selected={isSelected}
  style="--calendar-color: {$calendar.color}"
  on:contextmenu>
  <label class="checkbox" title={isShown ? $t`Hide this calendar` : $t`Show this calendar`}>
    <input type="checkbox" checked={isShown}
      on:change={event => shownCalendars.show(calendar, event.currentTarget.checked)} />
    <span class="box" aria-hidden="true">
      {#if isShown}
        <CheckIcon size="12" strokeWidth={3} />
      {/if}
    </span>
  </label>
  <button class="name" title={$calendar.name} on:click={() => $selectedCalendar = calendar}>
    {$calendar.name}
  </button>
</hbox>

<script lang="ts">
  import type { Calendar } from "../../logic/Calendar/Calendar";
  import { selectedCalendar, shownCalendars } from "../../frontend/Calendar/selected";
  import CheckIcon from "lucide-svelte/icons/check";
  import { t } from "../../l10n/l10n";

  export let calendar: Calendar;
  export let isShown: boolean;
  export let isSelected: boolean;
</script>

<style>
  .calendar-item {
    position: relative;
    align-items: center;
    min-height: 32px;
    padding-inline-start: 26px;
    border-radius: var(--lo-radius-small);
  }
  .calendar-item:hover {
    background-color: var(--lo-hover-bg);
  }
  .calendar-item.selected {
    background-color: color-mix(in srgb, var(--calendar-color) 22%, var(--lo-window-bg));
  }
  .calendar-item.selected:hover {
    background-color: color-mix(in srgb, var(--calendar-color) 30%, var(--lo-window-bg));
  }
  .calendar-item.selected::before {
    content: "";
    position: absolute;
    left: 0;
    top: 8px;
    bottom: 8px;
    width: 3px;
    border-radius: 2px;
    background-color: var(--calendar-color);
  }
  .checkbox {
    position: relative;
    display: flex;
    align-items: center;
    padding: 6px;
    cursor: pointer;
  }
  .checkbox input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
  }
  .box {
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: 16px;
    height: 16px;
    border: 1.5px solid var(--calendar-color);
    border-radius: 3px;
    color: lch(from var(--calendar-color) calc((60 - l) * infinity) 0 0);
  }
  .checkbox input:checked + .box {
    background-color: var(--calendar-color);
  }
  .checkbox input:focus-visible + .box {
    outline: 2px solid var(--lo-focus-ring);
    outline-offset: 1px;
  }
  .name {
    flex: 1 1 0;
    min-width: 0;
    padding: 6px 8px 6px 2px;
    border: none;
    background: none;
    color: var(--lo-fg);
    font: inherit;
    text-align: start;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  .selected .name {
    font-weight: 600;
  }
</style>
