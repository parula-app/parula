<Clickable onClick={onPopupToggle}>
  <hbox class="person"
    class:selected={popupOpen}
    class:no-pic={!$person.person?.picture}
    title={person.name + "\n" + person.emailAddress}
    bind:this={popupAnchor}>
    <slot name="before-avatar" />
    {#if $person.person?.picture}
      <PersonPicture person={$person.person} size={24} />
    {/if}
    <vbox flex class="right">
      <hbox flex class="name">{$person.name || $person.emailAddress}</hbox>
    </vbox>
    <slot name="after-name" />
  </hbox>
</Clickable>
<Popup bind:popupOpen {popupAnchor} placement="bottom-start" boundaryElSel=".mail-composer-window">
  <PersonPopup personUID={person}
    {onRemovePerson}
    on:close={onPopupClose}
    {disabled}
    >
    <slot name="person-popup-bottom" slot="bottom" personUID={person} />
    <slot name="person-popup-buttons" slot="buttons" personUID={person} />
  </PersonPopup>
</Popup>
<vbox class="context-menu" class:open>
  <slot name="context-menu" {person} />
</vbox>

<script lang="ts">
  import type { PersonUID } from "../../../logic/Abstract/PersonUID";
  import PersonPopup from "./PersonPopup.svelte";
  import PersonPicture from "../Person/PersonPicture.svelte";
  import Popup from "../../Shared/Popup.svelte";
  import Clickable from "../../Shared/Clickable.svelte";
  import { createEventDispatcher } from 'svelte';
  const dispatchEvent = createEventDispatcher<{ focusNext: void }>();

  export let person: PersonUID;
  export let disabled = false;
  export let onRemovePerson: (person: PersonUID) => void | Promise<void>;

  // Popup
  let popupOpen = false;
  let popupAnchor: HTMLElement;

  function onPopupToggle(event: MouseEvent) {
    popupOpen = !popupOpen;
  }

  function onPopupClose() {
    popupOpen = false;
    dispatchEvent("focusNext");
  }
</script>

<style>
  .person {
    background-color: var(--main-bg);
    color: var(--main-fg);
    border-radius: 100px;
    box-shadow: -1px 0px 5px 0.5px rgb(0, 0, 0, 7%);
    align-items: center;
    padding-inline-end: 12px;
    height: 24px;
  }
  .person:not(.selected):hover {
    background-color: var(--hover-bg);
    color: var(--hover-fg);
  }
  .person.selected {
    background-color: var(--selected-bg);
    color: var(--selected-fg);
  }
  .person :global(.avatar) {
    margin: 0px;
    margin-inline-end: 6px;
  }
  .no-pic {
    padding-inline-start: 14px;
  }
  .name {
    align-items: center;
    white-space: nowrap;
  }

  .popup {
    z-index: 100;
  }
  .context-menu:not(.open) {
    display: none;
  }
</style>
