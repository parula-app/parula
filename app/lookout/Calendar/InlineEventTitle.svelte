{#if $inlineTitle != null && $selectedSlots}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <hbox class="inline-title" style:--calendar-color={calendar?.color ?? "var(--lo-accent)"}
    on:pointerdown|stopPropagation
    on:click|stopPropagation
    on:dblclick|stopPropagation>
    <input type="text"
      bind:value={$inlineTitle}
      bind:this={inputEl}
      aria-label={$t`Title of the new appointment`}
      on:keydown|stopPropagation={onKeyDown}
      on:blur={onSave} />
    {#if calendar && $shownCalendars.length > 1}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span class="calendar-name" title={calendar.name} on:mousedown|preventDefault>{calendar.name}</span>
    {/if}
  </hbox>
{/if}

<script lang="ts">
  import { CalendarActions } from "./CalendarActions";
  import { inlineTitle, selectedSlots } from "./selected";
  import { selectedCalendar, shownCalendars } from "../../frontend/Calendar/selected";
  import { appGlobal } from "../../logic/app";
  import { tick } from "svelte";
  import { t } from "../../l10n/l10n";

  let inputEl: HTMLInputElement;

  $: calendar = $selectedSlots?.calendar ?? $selectedCalendar ?? appGlobal.calendars.first;

  $: if (inputEl) {
    focusAtEnd();
  }
  async function focusAtEnd() {
    await tick();
    inputEl?.focus();
    inputEl?.setSelectionRange(inputEl.value.length, inputEl.value.length);
  }

  function onKeyDown(keyEvent: KeyboardEvent) {
    if (keyEvent.key == "Enter") {
      keyEvent.preventDefault();
      onSave();
    } else if (keyEvent.key == "Escape") {
      keyEvent.preventDefault();
      $inlineTitle = null;
    }
  }

  function onSave() {
    CalendarActions.commitInlineTitle();
  }
</script>

<style>
  .inline-title {
    position: absolute;
    inset-inline: 2px;
    top: 2px;
    align-items: center;
    box-sizing: border-box;
    height: 20px;
    border: 1px solid var(--calendar-color);
    border-inline-start-width: 4px;
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-pane-bg);
    font-size: var(--lo-font-size-small);
    pointer-events: auto;
    z-index: 6;
  }
  input {
    flex: 1 1 0;
    min-width: 0;
    height: 100%;
    box-sizing: border-box;
    padding: 0 4px;
    border: none;
    background: none;
    color: var(--lo-fg);
    font: inherit;
    font-weight: 600;
    outline: none;
  }
  .calendar-name {
    flex: 0 1 auto;
    max-width: 50%;
    padding-inline-end: 4px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--lo-fg-secondary);
  }
</style>
