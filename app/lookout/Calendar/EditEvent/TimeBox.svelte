{#if showSummary && isSeriesMaster}
  <span class="row-label">{$t`Recurrence *=> Repetition of the event`}</span>
  <vbox class="recurrence-summary">
    <span>{summary}</span>
    {#if !readOnly}
      <button class="link-button" on:click={onEditRecurrence}>
        <RecurrenceIcon size={14} /> {$t`Edit Recurrence`}
      </button>
    {/if}
  </vbox>
{:else}
  <span class="row-label">{$t`Start time`}</span>
  <hbox class="time-row">
    <DateField required date={$event.startTime} label={$t`Start date`} disabled={readOnly}
      on:change={ev => editor.setStartDate(ev.detail)} />
    {#if !$event.allDay}
      <TimeInput time={$event.startTime} options={startOptions} label={$t`Start time`} disabled={readOnly}
        on:change={ev => editor.setStart(ev.detail)} />
    {/if}
    {#if !readOnly}
      <Checkbox label={$t`All day`} checked={$event.allDay} on:change={ev => onAllDayChanged(ev.detail)} classes="all-day" />
    {/if}
    {#if showTimezone}
      <hbox class="timezone lo-secondary" title={$t`Time zone of this event`}>
        <TimezoneIcon size={14} /> {$event.timezone}
      </hbox>
    {/if}
  </hbox>
  <span class="row-label">{$t`End time`}</span>
  <hbox class="time-row">
    <DateField required date={lastDay} label={$t`End date`} disabled={readOnly}
      on:change={ev => editor.setEndDate(ev.detail)} />
    {#if !$event.allDay}
      <TimeInput time={$event.endTime} options={endOptions} label={$t`End time`} disabled={readOnly}
        on:change={ev => editor.setEnd(ev.detail)} />
    {/if}
    {#if showRecurrenceLink && !readOnly}
      <button class="link-button" on:click={onEditRecurrence}>
        <RecurrenceIcon size={14} />
        {isRecurring ? $t`Edit Recurrence` : $t`Make Recurring`}
      </button>
    {/if}
  </hbox>
{/if}

<script lang="ts">
  import Checkbox from "../../Shared/Form/Checkbox.svelte";
  import type { Event } from "../../../logic/Calendar/Event";
  import type { EventEditFlow } from "./EventEditFlow";
  import { EventTimeEditor } from "./EventTimeEditor";
  import { startTimeOptions, endTimeOptions } from "./TimeOptions";
  import TimeInput from "./TimeInput.svelte";
  import DateField from "../../Shared/Form/DateField.svelte";
  import { isSameTimezone } from "../../../logic/util/date";
  import RecurrenceIcon from "lucide-svelte/icons/repeat-2";
  import TimezoneIcon from "lucide-svelte/icons/globe";
  import { t } from "../../../l10n/l10n";

  export let event: Event;
  export let editor: EventTimeEditor;
  export let flow: EventEditFlow = null;
  export let readOnly = false;
  export let showSummary = true;
  export let showRecurrenceLink = true;
  export let onEditRecurrence: () => void;

  $: parentEvent = $event.parentEvent;
  $: isSeriesMaster = !!$event.recurrenceRule && !$event.parentEvent;
  $: isRecurring = isSeriesMaster || !!$parentEvent?.recurrenceRule;
  $: summary = $event && flow ? flow.pattern.summary(event) : "";
  $: startOptions = startTimeOptions($event.startTime);
  $: lastDay = EventTimeEditor.lastDay($event);
  $: endOptions = endTimeOptions($event.startTime, $event.endTime);
  $: showTimezone = !$event.allDay && !isSameTimezone($event.timezone, $event.startTime);

  function onAllDayChanged(checked: boolean) {
    if (checked) {
      editor.setAllDay(true);
    } else {
      editor.setTimed();
    }
  }
</script>

<style>
  .row-label {
    color: var(--lo-fg-secondary);
    justify-self: end;
    white-space: nowrap;
  }
  .time-row {
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .time-row :global(.all-day) {
    margin-inline-start: 12px;
    white-space: nowrap;
  }
  .timezone {
    align-items: center;
    gap: 4px;
    margin-inline-start: 12px;
    font-size: var(--lo-font-size-small);
  }
  .link-button {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-inline-start: 6px;
    padding: 4px 6px;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-accent-text);
    font: inherit;
    cursor: pointer;
    white-space: nowrap;
  }
  .link-button:hover {
    background-color: var(--lo-hover-bg);
    text-decoration: underline;
  }
  .recurrence-summary {
    align-items: start;
    gap: 2px;
  }
  .recurrence-summary .link-button {
    margin-inline-start: -6px;
  }
</style>
