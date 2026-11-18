<vbox class="autocomplete-list" role="listbox" id={id} aria-label={$t`Suggested contacts`}
  style:top="{top}px" style:left="{left}px" style:width="{width}px"
  bind:this={listEl}>
  <hbox class="heading">{$t`Suggested contacts`}</hbox>
  {#each suggestions as suggestion, index (suggestion.emailAddress + "|" + suggestion.name)}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <hbox class="suggestion" role="option" id="{id}-{index}"
      aria-selected={index == highlighted}
      class:highlighted={index == highlighted}
      on:mousedown|preventDefault
      on:mousemove={() => highlighted = index}
      on:click={() => dispatch("select", suggestion)}>
      <PersonCircle name={suggestion.name || suggestion.emailAddress}
        picture={suggestion.person?.picture} colorKey={suggestion.emailAddress} size={32} />
      <vbox class="text">
        <span class="name">{suggestion.name || suggestion.emailAddress}</span>
        <span class="address">{suggestion.emailAddress}</span>
      </vbox>
    </hbox>
  {/each}
</vbox>
<AppWindowEvents on:resize={place} />

<script lang="ts">
  import type { PersonUID } from "../../../logic/Abstract/PersonUID";
  import PersonCircle from "../../Contacts/Person/PersonCircle.svelte";
  import { t } from "../../../l10n/l10n";
  import { createEventDispatcher } from "svelte";
  import { AppWindow } from "../../../frontend/MainWindow/AppWindow";
  import AppWindowEvents from "../../../frontend/MainWindow/AppWindowEvents.svelte";

  const appWindow = AppWindow.current();

  export let suggestions: PersonUID[];
  export let highlighted = 0;
  export let anchor: HTMLElement;
  export let id: string;

  const dispatch = createEventDispatcher<{ select: PersonUID }>();

  let listEl: HTMLElement;
  let top = 0;
  let left = 0;
  let width = 360;

  $: suggestions, place();
  function place() {
    if (!anchor) {
      return;
    }
    let rect = anchor.getBoundingClientRect();
    width = Math.max(320, Math.min(rect.width, 480));
    left = Math.min(rect.left, appWindow.window.innerWidth - width - 8);
    top = rect.bottom + 2;
  }

  export function contains(node: Node): boolean {
    return !!listEl?.contains(node);
  }
</script>

<style>
  .autocomplete-list {
    position: fixed;
    z-index: 30;
    max-height: 360px;
    overflow-y: auto;
    padding: 4px 0;
    border: 1px solid var(--lo-border);
    border-radius: var(--lo-radius);
    background-color: var(--lo-pane-bg);
    box-shadow: var(--lo-shadow-popup);
  }
  .heading {
    padding: 6px 12px 4px 12px;
    font-size: var(--lo-font-size-small);
    font-weight: 600;
    color: var(--lo-fg-secondary);
  }
  .suggestion {
    align-items: center;
    gap: 10px;
    padding: 6px 12px;
    cursor: default;
  }
  .suggestion.highlighted {
    background-color: var(--lo-hover-bg);
  }
  .text {
    min-width: 0;
  }
  .name,
  .address {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .address {
    font-size: var(--lo-font-size-small);
    color: var(--lo-fg-secondary);
  }
</style>
