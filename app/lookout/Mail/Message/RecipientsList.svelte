<span class="recipient-names">
  {#each shown as recipient, index (recipient)}
    {@const name = displayName(recipient)}
    <span class="entry" class:with-address={withAddress}><button type="button" class="name" title={recipient.emailAddress}
      class:address-only={withAddress && recipient.emailAddress && name == recipient.emailAddress}
      on:click|stopPropagation={event => openMenu(recipient, event)}
      on:contextmenu|preventDefault|stopPropagation={event => openMenu(recipient, event)}
      >{#if withAddress && recipient.emailAddress && name == recipient.emailAddress}<EMailAddress emailAddress={recipient.emailAddress} isUnknown={!recipient.findPerson()} />{:else}{name}{/if}</button
      >{#if withAddress && recipient.emailAddress && name != recipient.emailAddress}<span class="address"><EMailAddress emailAddress={recipient.emailAddress} isUnknown={!recipient.findPerson()} withBrackets /></span>{/if}{#if index < shown.length - 1 || hiddenCount};{/if}</span>{" "}
  {/each}
  {#if hiddenCount}
    <button type="button" class="more" on:click={() => { isExpanded = true; }}>{$t`+${hiddenCount} more`}</button>
  {/if}
</span>
<Menu bind:isMenuOpen anchor={menuAnchor} placement="bottom-start">
  <MenuItem label={$t`Send Email`} icon={SendIcon} onClick={() => MessageActions.writeMailTo(menuRecipient, message.folder)} />
  <MenuItem label={$t`Copy`} icon={CopyIcon} onClick={() => navigator.clipboard.writeText(clipboardText(menuRecipient))} />
  <MenuDivider />
  <MenuItem label={menuRecipient?.findPerson() ? $t`Open Contact Card` : $t`Add to Contacts`}
    icon={ContactIcon} onClick={() => openPersonFromOtherApp(menuRecipient.createPerson(appGlobal.personalAddressbook))} />
</Menu>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { type PersonUID, personDisplayName } from "../../../logic/Abstract/PersonUID";
  import { MessageActions } from "../MessageActions";
  import EMailAddress from "./EMailAddress.svelte";
  import Menu from "../../Shared/Menu/Menu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import SendIcon from "lucide-svelte/icons/send";
  import CopyIcon from "lucide-svelte/icons/copy";
  import ContactIcon from "lucide-svelte/icons/contact-round";
  import type { Collection } from "svelte-collections";
  import { t } from "../../../l10n/l10n";
  import { appGlobal } from "../../../logic/app";
  import { openPersonFromOtherApp } from "../../../frontend/Contacts/open";

  export let recipients: Collection<PersonUID>;
  export let message: EMail;
  export let withAddress = false;
  export let maxShown = 8;

  let isExpanded = false;
  let isMenuOpen = false;
  let menuAnchor: HTMLElement = null;
  let menuRecipient: PersonUID = null;
  $: shown = isExpanded ? $recipients.contents : $recipients.contents.slice(0, maxShown);
  $: hiddenCount = $recipients.length - shown.length;

  function openMenu(recipient: PersonUID, event: MouseEvent) {
    menuRecipient = recipient;
    menuAnchor = event.currentTarget as HTMLElement;
    isMenuOpen = true;
  }

  function displayName(recipient: PersonUID): string {
    if (!recipient.findPerson()) {
      return personDisplayName(recipient);
    }
    return recipient.name || recipient.emailAddress;
  }

  /* <copied to="../Composer/MailAutocomplete.svelte"> */
  function clipboardText(recipient: PersonUID): string {
    return recipient.name && recipient.name != recipient.emailAddress
      ? `${recipient.name} <${recipient.emailAddress}>`
      : recipient.emailAddress;
  }
  /* </copied> */
</script>

<style>
  .recipient-names {
    min-width: 0;
  }
  .name,
  .more {
    display: inline;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .name:hover {
    text-decoration: underline;
  }
  .more {
    color: var(--lo-accent-text);
  }
  .more:hover {
    text-decoration: underline;
  }
  .address {
    margin-inline-start: 4px;
    color: var(--lo-fg-secondary);
  }
  .entry {
    white-space: nowrap;
  }
  /* If space is short, cuts off the name and the start of the email address, but not the base domain */
  .entry.with-address {
    display: inline-flex;
    max-width: 100%;
    min-width: 0;
  }
  .with-address .name {
    flex: 0 1 auto;
    min-width: 1em;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .with-address .name.address-only {
    display: flex;
  }
  .with-address .address {
    /* The parts of the email address shrink together with the name */
    display: contents;
  }
  .with-address .name:not(.address-only) {
    margin-inline-end: 4px;
  }
</style>
