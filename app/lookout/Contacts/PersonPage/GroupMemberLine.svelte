<hbox class="member" on:dblclick={() => ContactActions.edit(person)} title={$person.name}>
  <PersonPicture {person} size={32} />
  <vbox class="text">
    <span class="name">{$person.name || preferredEmail || ""}</span>
    {#if preferredEmail}
      <span class="email">{preferredEmail}</span>
    {/if}
  </vbox>
  <slot />
</hbox>

<script lang="ts">
  import type { Person } from "../../../logic/Abstract/Person";
  import { ContactActions } from "../ContactActions";
  import PersonPicture from "../Person/PersonPicture.svelte";

  export let person: Person;

  $: emailAddresses = person.emailAddresses;
  $: preferredEmail = $emailAddresses.sortBy(entry => entry.preference).first?.value || null;
</script>

<style>
  .member {
    align-items: center;
    gap: 12px;
    min-height: 44px;
    padding: 4px 8px;
    border-radius: var(--lo-radius-small);
  }
  .member:hover {
    background-color: var(--lo-hover-bg);
  }
  .text {
    flex: 1;
    min-width: 0;
  }
  .name,
  .email {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .email {
    font-size: var(--lo-font-size-small);
    color: var(--lo-fg-secondary);
  }
</style>
