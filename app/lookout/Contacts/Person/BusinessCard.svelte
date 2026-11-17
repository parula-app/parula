<!-- svelte-ignore a11y-click-events-have-key-events -->
<div class="business-card" role="option" tabindex="-1"
  class:selected={isSelected}
  aria-selected={isSelected}
  on:click
  on:dblclick={() => ContactActions.edit(contact)}
  on:contextmenu>
  <vbox class="picture">
    <PersonPicture person={contact} size={72} />
  </vbox>
  <vbox class="text">
    <span class="name">{$contact.name || $t`(No name)`}</span>
    {#if person}
      {#if person.company}<span>{person.company}</span>{/if}
      {#if person.position}<span>{person.position}</span>{/if}
      {#each businessCardLines(person) as line}
        <span class="detail">{line}</span>
      {/each}
    {:else}
      <span class="detail">{$t`Contact group`}</span>
    {/if}
  </vbox>
</div>

<script lang="ts">
  import type { Contact } from "../../../logic/Abstract/Contact";
  import { Person } from "../../../logic/Abstract/Person";
  import { ContactActions } from "../ContactActions";
  import { businessCardLines } from "./ContactColumns";
  import PersonPicture from "./PersonPicture.svelte";
  import { t } from "../../../l10n/l10n";

  export let contact: Contact;
  export let isSelected = false;

  $: person = $contact instanceof Person ? $contact : null;
</script>

<style>
  .business-card {
    display: flex;
    gap: 12px;
    min-width: 0;
    padding: 12px;
    border: 1px solid var(--lo-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-pane-bg);
    box-shadow: var(--lo-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.08));
    cursor: default;
    overflow: hidden;
  }
  .business-card:hover {
    border-color: var(--lo-border-strong);
  }
  .business-card.selected {
    border-color: var(--lo-accent);
    box-shadow: 0 0 0 1px var(--lo-accent);
  }
  .picture {
    flex: none;
    align-items: center;
    justify-content: center;
    width: 96px;
    border-inline-end: 1px solid var(--lo-divider);
    padding-inline-end: 12px;
  }
  .text {
    min-width: 0;
    gap: 1px;
    font-size: 13px;
  }
  .text > span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .name {
    margin-block-end: 2px;
    font-size: 16px;
    font-weight: 600;
    color: var(--lo-accent-text);
  }
  .detail {
    color: var(--lo-fg-secondary);
  }
</style>
