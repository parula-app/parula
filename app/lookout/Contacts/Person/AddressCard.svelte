<!-- svelte-ignore a11y-click-events-have-key-events -->
<div class="address-card" role="option" tabindex="-1"
  class:selected={isSelected}
  aria-selected={isSelected}
  on:click
  on:dblclick={() => ContactActions.edit(contact)}
  on:contextmenu>
  <div class="card-name">{$contact.name || $t`(No name)`}</div>
  {#if person}
    <div class="fields">
      {#each addressCardFields(person) as field}
        <span class="label">{field.label}</span>
        <span class="value">{field.value}</span>
      {/each}
    </div>
  {:else}
    <div class="fields"><span class="label">{$t`Contact group`}</span></div>
  {/if}
</div>

<script lang="ts">
  import type { Contact } from "../../../logic/Abstract/Contact";
  import { Person } from "../../../logic/Abstract/Person";
  import { ContactActions } from "../ContactActions";
  import { addressCardFields } from "./ContactColumns";
  import { t } from "../../../l10n/l10n";

  export let contact: Contact;
  export let isSelected = false;

  $: person = $contact instanceof Person ? $contact : null;
</script>

<style>
  .address-card {
    break-inside: avoid;
    margin-block-end: 14px;
    cursor: default;
  }
  .card-name {
    padding: 2px 6px;
    border-block-start: 2px solid var(--lo-border-strong);
    background-color: var(--lo-pane-alt-bg);
    font-weight: 600;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .address-card:hover .card-name {
    background-color: var(--lo-hover-bg);
  }
  .address-card.selected .card-name {
    border-block-start-color: var(--lo-accent);
    background-color: var(--lo-selected-bg);
  }
  .fields {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    column-gap: 8px;
    padding: 2px 6px;
    font-size: 13px;
  }
  .label {
    color: var(--lo-fg-secondary);
  }
  .value {
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
</style>
