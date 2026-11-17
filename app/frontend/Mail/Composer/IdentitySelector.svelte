<hbox class="identity-selector">
  {#if selectedIdentity.isCatchAll}
    <label for="customFrom">{$t`From`}</label>
    <hbox class="before-custom">{beforeCustom}</hbox>
    <input type="email" bind:value={editableCustom}
      name="customFrom" spellcheck="false"
      on:change={() => catchErrors(onCustomEdited)}
      size={editableCustom?.length || 10}
      />
    <hbox class="after-custom">{afterCustom}</hbox>
    <hbox class="account">
      {selectedIdentity.account?.name}
    </hbox>
  {/if}
  {#if $identities.length > 1}
    <select bind:value={selectedIdentity} class:catch-all={selectedIdentity.isCatchAll}>
      {#each $identities.each as identity }
        <option value={identity}>
          {identity.isCatchAll && identity.isEMailAddress(fromAddress) && identity.emailAddress != fromAddress
            ? fromAddress
            : identity.name}
          -
          {identity.account?.name}
        </option>
      {/each}
    </select>
  {/if}
</hbox>

<script lang="ts">
  import { findAllIdentities, type MailIdentity } from "../../../logic/Mail/MailIdentity";
  import { catchErrors } from "../../Util/error";
  import type { Collection } from "svelte-collections";
  import { t } from "../../../l10n/l10n";

  export let selectedIdentity: MailIdentity; /* in/out */
   /** Which identities to select from.
    * Default: all identities of all accounts
    * in */
  export let identities: Collection<MailIdentity> = findAllIdentities();
  /** Allows the user to override the From address with a custom email address.
   * This allows for catch-all email addresses to be used as From: */
  export let fromAddress: string;
  export let fromName: string;

  let beforeCustom: string;
  let afterCustom: string;
  let editableCustom: string;

  $: $selectedIdentity && setIdentity($selectedIdentity)
  function setIdentity(identity: MailIdentity) {
    fromName = identity.realname;
    if (!identity?.isCatchAll) {
      fromAddress = identity.emailAddress;
      return;
    }
    if (!identity.isEMailAddress(fromAddress)) {
      fromAddress = identity.emailAddress;
    }

    let parts = identity.emailAddress.split("*");
    beforeCustom = parts[0];
    afterCustom = parts[1];
    editableCustom = fromAddress.substring(beforeCustom.length, fromAddress.length - afterCustom.length);
  }

  function onCustomEdited() {
    fromAddress = beforeCustom + editableCustom + afterCustom;
  }
</script>

<style>
  .identity-selector {
    align-items: center;
  }
  .identity-selector select {
    border: none;
    color: inherit;
    background-color: transparent;
  }
  label {
    margin-inline-end: 12px;
  }
  input[type=email] {
    min-width: 20vw;
    width: 20%;
  }
  .before-custom,
  .after-custom,
  .account {
    overflow-x: hidden; /* TODO not working. Problem: Mobile, with long domains. */
  }
  select.catch-all {
    width: 20px;
    height: 100%;
  }
  .account {
    margin-inline-start: 16px;
    font-style: italic;
    opacity: 75%;
  }
</style>
