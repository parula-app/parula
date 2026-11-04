<PersonsAutocomplete persons={addresses} {onAddPerson} {placeholder} {tabindex} {autofocus}>
  <slot name="end" slot="end" />
  <hbox class="addressbooks" slot="person-popup-bottom" let:person class:top-border={person?.person?.emailAddresses.length > 1}>
    {#if person?.person}
      <AddressbookChanger person={person.person} />
    {/if}
  </hbox>
 <slot name="person-popup-buttons" slot="person-popup-buttons" let:person {person} />
</PersonsAutocomplete>

<script lang="ts">
  import type { PersonUID } from "../../../logic/Abstract/PersonUID";
  import PersonsAutocomplete from "../../Contacts/PersonAutocomplete/PersonsAutocomplete.svelte";
  import AddressbookChanger from "../../Contacts/AddressbookChanger.svelte";
  import { showError } from "../../Util/error";
  import type { ArrayColl } from "svelte-collections";

  /** E.g. to, cc or bcc list
   * in/out */
  export let addresses: ArrayColl<PersonUID>;
  export let placeholder: string;
  export let tabindex = null;
  export let autofocus = false;

  function onAddPerson(recipient: PersonUID) {
    // <copied from="PersonsAutocomplete.onAddPersonDefault()">
    if (!recipient || addresses.contains(recipient)) {
      return;
    }
    addresses.add(recipient);
    // </copied>

    // Get the certificate now, so that we can show whether we can encrypt
    recipient.fetchEncryptionKeys()
      .catch(showError);
  }
</script>

<style>
  .addressbooks {
    padding: 12px;
    max-width: 280px;
  }
  .addressbooks.top-border {
    border-top: 1px solid var(--border);
  }
  .addressbooks:not(.top-border) {
    margin-block-start: -6px;
    padding-block-start: 0px;
  }
</style>
