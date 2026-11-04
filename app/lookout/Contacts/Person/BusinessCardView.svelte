<div class="business-cards" role="listbox" aria-label={$t`Business Cards`} aria-multiselectable="true">
  {#each $persons.each as contact (contact.id)}
    <BusinessCard {contact} isSelected={$selectedPersons.contains(contact)}
      on:click={event => select(event, contact)}
      on:contextmenu={event => onContextMenu(event, contact)} />
  {:else}
    <vbox class="empty">{emptyText}</vbox>
  {/each}
</div>

<PersonMenu bind:this={contextMenu} />

<script lang="ts">
  import type { Contact } from "../../../logic/Abstract/Contact";
  import BusinessCard from "./BusinessCard.svelte";
  import PersonMenu from "../PersonPage/PersonMenu.svelte";
  import type { ArrayColl, Collection } from "svelte-collections";
  import { t } from "../../../l10n/l10n";

  export let persons: Collection<Contact>;
  export let selected: Contact;
  export let selectedPersons: ArrayColl<Contact>;
  export let emptyText: string;

  let contextMenu: PersonMenu;

  $: selected = $selectedPersons.first ?? null;

  // <copied to="CardView.svelte">
  function select(event: MouseEvent, contact: Contact) {
    if (event.ctrlKey || event.metaKey) {
      if (selectedPersons.contains(contact)) {
        selectedPersons.remove(contact);
      } else {
        selectedPersons.add(contact);
      }
      return;
    }
    selectedPersons.replaceAll([contact]);
  }
  // </copied>

  function onContextMenu(event: MouseEvent, contact: Contact) {
    contextMenu.openFor(event, contact, selectedPersons);
  }
</script>

<style>
  .business-cards {
    flex: 1 1 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    grid-auto-rows: 180px;
    align-content: start;
    gap: 16px;
    min-height: 0;
    padding: 16px;
    overflow-y: auto;
  }
  .empty {
    grid-column: 1 / -1;
    align-items: center;
    padding: 32px 16px;
    color: var(--lo-fg-secondary);
  }
</style>
