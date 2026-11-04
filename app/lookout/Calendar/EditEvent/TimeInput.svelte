<hbox class="time-combo" class:disabled class:invalid bind:this={comboEl}>
  <input type="text" bind:value={text}
    aria-label={label}
    title={label}
    {disabled}
    on:change={onTextChanged}
    on:keydown={onKeyDown}
    on:focus={() => invalid = false}
    />
  <button class="open" tabindex="-1" {disabled}
    title={$t`Choose a time`}
    aria-label={$t`Choose a time`}
    on:click|stopPropagation={onToggle}>
    <ChevronIcon size={16} />
  </button>
</hbox>
<Popup bind:popupOpen={isOpen} popupAnchor={comboEl} placement="bottom-start" boundaryElSel=".event-form-page">
  <vbox class="time-list lo-card" bind:this={listEl} role="listbox" aria-label={label}>
    {#each options as option}
      <button class="option" role="option"
        class:selected={option.time.getTime() == time.getTime()}
        aria-selected={option.time.getTime() == time.getTime()}
        on:click={() => onSelect(option)}>
        <span class="time">{option.label}</span>
        {#if option.durationLabel}
          <span class="duration">({option.durationLabel})</span>
        {/if}
      </button>
    {/each}
  </vbox>
</Popup>

<script lang="ts">
  import { timeOfDayLabel, parseTime, type TimeOption } from "./TimeOptions";
  import Popup from "../../../frontend/Shared/Popup.svelte";
  import { showError } from "../../../frontend/Util/error";
  import ChevronIcon from "lucide-svelte/icons/chevron-down";
  import { createEventDispatcher, tick } from "svelte";
  import { t } from "../../../l10n/l10n";
  const dispatchEvent = createEventDispatcher<{ change: Date }>();

  export let time: Date;
  export let options: TimeOption[];
  export let label: string;
  export let disabled = false;

  let text = "";
  let isOpen = false;
  let invalid = false;
  let comboEl: HTMLElement;
  let listEl: HTMLElement;

  $: text = time ? timeOfDayLabel(time) : "";

  function onTextChanged(): boolean {
    try {
      let newTime = parseTime(text, time);
      if (newTime.getTime() != time.getTime()) {
        dispatchEvent("change", newTime);
      }
      text = timeOfDayLabel(time);
      return true;
    } catch (ex) {
      invalid = true;
      text = timeOfDayLabel(time);
      showError(ex);
      return false;
    }
  }

  function onSelect(option: TimeOption) {
    isOpen = false;
    dispatchEvent("change", new Date(option.time));
  }

  async function onToggle() {
    isOpen = !isOpen;
    if (isOpen) {
      await tick();
      let selected = listEl?.querySelector<HTMLElement>(".selected");
      if (selected) {
        listEl.scrollTop = selected.offsetTop - listEl.clientHeight / 2 + selected.offsetHeight / 2;
      }
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.altKey && event.key == "ArrowDown") {
      event.preventDefault();
      onToggle();
    } else if (event.key == "Enter") {
      // A dialog submits on Enter, and that cancels the native change event
      if (!onTextChanged()) {
        event.preventDefault();
      }
    } else if (event.key == "Escape" && isOpen) {
      event.stopPropagation();
      isOpen = false;
    } else if (event.key == "ArrowDown" || event.key == "ArrowUp") {
      event.preventDefault();
      let index = options.findIndex(option => option.time >= time);
      if (event.key == "ArrowDown") {
        index = options[index]?.time.getTime() == time.getTime() ? index + 1 : index;
      } else {
        index = index < 0 ? options.length - 1 : index - 1;
      }
      let option = options[index];
      if (option) {
        dispatchEvent("change", new Date(option.time));
      }
    }
  }
</script>

<style>
  .time-combo {
    position: relative;
    align-items: center;
    width: 132px;
    height: 32px;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
  }
  .time-combo:hover:not(.disabled) {
    border-color: var(--lo-border-strong);
  }
  .time-combo:focus-within {
    border-color: var(--lo-accent);
    box-shadow: inset 0 -1px 0 0 var(--lo-accent);
  }
  .time-combo.invalid {
    border-color: var(--lo-danger);
  }
  .time-combo.disabled {
    opacity: 0.5;
  }
  input {
    flex: 1 1 0;
    min-width: 0;
    height: 100%;
    padding: 0 0 0 8px;
    border: none !important;
    background: none;
    color: var(--lo-fg);
    font: inherit;
    box-shadow: none !important;
    outline: none;
  }
  .open {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 100%;
    padding: 0;
    border: none;
    background: none;
    color: var(--lo-fg-secondary);
    cursor: pointer;
  }
  .open:hover:not(:disabled) {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
  }
  .time-list {
    max-height: 280px;
    min-width: 200px;
    padding: 4px 0;
    overflow-y: auto;
    box-shadow: var(--lo-shadow-popup);
  }
  .option {
    flex-shrink: 0;
    display: flex;
    gap: 6px;
    align-items: center;
    height: 30px;
    padding: 0 12px;
    border: none;
    background: none;
    color: var(--lo-fg);
    font: inherit;
    text-align: start;
    white-space: nowrap;
    cursor: pointer;
  }
  .option:hover {
    background-color: var(--lo-hover-bg);
  }
  .option.selected {
    background-color: var(--lo-selected-bg);
  }
  .duration {
    color: var(--lo-fg-secondary);
  }
</style>
