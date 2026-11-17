<div class="address-cards" role="listbox" aria-label={$t`Cards *=> List of contacts shown as address cards`} aria-multiselectable="true">
  {#each $persons.each as contact (contact.id)}
    <AddressCard {contact} isSelected={$selectedPersons.contains(contact)}
      on:click={event => select(event, contact)}
      on:contextmenu={event => contextMenu.openFor(event, contact, selectedPersons)} />
  {:else}
    <div class="empty">{emptyText}</div>
  {/each}
</div>

<PersonMenu bind:this={contextMenu} />

<script lang="ts">
  import type { Contact } from "../../../logic/Abstract/Contact";
  import AddressCard from "./AddressCard.svelte";
  import PersonMenu from "../PersonPage/PersonMenu.svelte";
  import type { ArrayColl, Collection } from "svelte-collections";
  import { t } from "../../../l10n/l10n";

  export let persons: Collection<Contact>;
  export let selected: Contact;
  export let selectedPersons: ArrayColl<Contact>;
  export let emptyText: string;

  let contextMenu: PersonMenu;

  $: selected = $selectedPersons.first ?? null;

  // <copied from="BusinessCardView.svelte">
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
</script>

<style>
  .address-cards {
    flex: 1 1 0;
    min-height: 0;
    padding: 12px 16px;
    column-width: 260px;
    column-gap: 24px;
    column-fill: auto;
    overflow-x: auto;
    overflow-y: hidden;
  }
  .empty {
    padding: 32px 16px;
    color: var(--lo-fg-secondary);
  }
</style>
