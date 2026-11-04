<div class="cells"
  on:dblclick={() => ContactActions.edit(contact)}
  on:contextmenu>
  {#each columns as column}
    {#if column == ContactColumn.FullName}
      <hbox class="cell name">
        <PersonPicture person={contact} size={24} />
        <span class="text">
          {#if $contact.name}
            {$contact.name}
          {:else}
            <span class="lo-secondary">{$t`(No name)`}</span>
          {/if}
        </span>
      </hbox>
    {:else}
      <hbox class="cell"><span class="text">{$contact && contactColumnValue(column, contact)}</span></hbox>
    {/if}
  {/each}
</div>

<script lang="ts">
  import type { Contact } from "../../../logic/Abstract/Contact";
  import { ContactActions } from "../ContactActions";
  import { ContactColumn, contactColumnValue } from "./ContactColumns";
  import PersonPicture from "./PersonPicture.svelte";
  import { t } from "../../../l10n/l10n";

  export let contact: Contact;
  export let columns: ContactColumn[];
</script>

<style>
  .cells {
    display: contents;
  }
  .cell {
    align-items: center;
    height: 36px;
    padding: 0 12px;
    border-block-end: 1px solid var(--lo-divider);
    cursor: default;
  }
  .cell.name {
    gap: 8px;
  }
  .text {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .cell:not(.name) {
    color: var(--lo-fg-secondary);
  }
  :global(.row:hover) > .cells > .cell {
    background-color: var(--lo-hover-bg);
  }
  :global(.row.selected) > .cells > .cell {
    background-color: var(--lo-selected-bg);
    color: var(--lo-fg);
  }
  :global(.row.selected:hover) > .cells > .cell {
    background-color: var(--lo-selected-hover-bg);
  }
</style>
