<hbox class="contact-item"
  on:dblclick={() => ContactActions.edit(person)}
  on:contextmenu
  title={$person.name}>
  <PersonPicture {person} size={40} />
  <vbox class="text">
    <hbox class="name">
      {#if $person.name}
        {$person.name}
      {:else}
        <span class="lo-secondary">{$t`(No name)`}</span>
      {/if}
    </hbox>
    {#if secondLine}
      <hbox class="second-line">{secondLine}</hbox>
    {/if}
  </vbox>
</hbox>

<script lang="ts">
  import type { Contact } from "../../../logic/Abstract/Contact";
  import { Person, type ContactEntry } from "../../../logic/Abstract/Person";
  import { ContactActions } from "../ContactActions";
  import PersonPicture from "./PersonPicture.svelte";
  import { ArrayColl } from "svelte-collections";
  import { t } from "../../../l10n/l10n";

  export let person: Contact;

  $: asPerson = person instanceof Person ? person : null;
  $: emailAddresses = asPerson?.emailAddresses ?? new ArrayColl<ContactEntry>();
  $: preferredEmail = $emailAddresses.sortBy(entry => entry.preference).first?.value || null;
  $: secondLine = asPerson
    ? preferredEmail || $asPerson.company || $asPerson.position
    : $t`Contact group`;
</script>

<style>
  .contact-item {
    position: relative;
    align-items: center;
    box-sizing: border-box;
    height: 56px;
    border-block-end: 1px solid var(--lo-divider);
    cursor: default;
  }
  .contact-item:hover {
    background-color: var(--lo-hover-bg);
  }
  :global(.row.selected) > .contact-item {
    background-color: var(--lo-selected-bg);
  }
  :global(.row.selected) > .contact-item:hover {
    background-color: var(--lo-selected-hover-bg);
  }
  :global(.row.selected) > .contact-item::before {
    content: "";
    position: absolute;
    inset-inline-start: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background-color: var(--lo-accent);
  }
  .text {
    flex: 1;
    min-width: 0;
    margin-inline-start: 12px;
  }
  .name {
    font-size: 15px;
  }
  .name,
  .second-line {
    display: block;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .second-line {
    font-size: var(--lo-font-size-small);
    color: var(--lo-fg-secondary);
  }
</style>
