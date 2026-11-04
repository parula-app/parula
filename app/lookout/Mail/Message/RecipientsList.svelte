<span class="recipient-names">
  {#each shown as recipient, index (recipient)}
    <span class="entry"><button type="button" class="name" title={recipient.emailAddress}
      on:click|stopPropagation={event => openMenu(recipient, event)}
      on:contextmenu|preventDefault|stopPropagation={event => openMenu(recipient, event)}
      >{displayName(recipient)}</button>{#if withAddress && recipient.name && recipient.emailAddress}<span class="address">&lt;{recipient.emailAddress}&gt;</span>{/if}{#if index < shown.length - 1 || hiddenCount};{/if}</span>{" "}
  {/each}
  {#if hiddenCount}
    <button type="button" class="more" on:click={() => { isExpanded = true; }}>{$t`+${hiddenCount} more`}</button>
  {/if}
</span>
<Menu bind:isMenuOpen anchor={menuAnchor} placement="bottom-start">
  <MenuItem label={$t`Send Email`} icon={SendIcon} onClick={() => MessageActions.writeMailTo(menuRecipient)} />
  <MenuItem label={$t`Copy`} icon={CopyIcon} onClick={() => navigator.clipboard.writeText(clipboardText(menuRecipient))} />
  <MenuDivider />
  <MenuItem label={menuRecipient?.findPerson() ? $t`Open Contact Card` : $t`Add to Contacts`}
    icon={ContactIcon} onClick={() => openPersonFromOtherApp(menuRecipient.createPerson(appGlobal.personalAddressbook))} />
</Menu>

<script lang="ts">
  import type { PersonUID } from "../../../logic/Abstract/PersonUID";
  import { MessageActions } from "../MessageActions";
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

  /* <copied to="../Composer/MailAutocomplete.svelte"> */
  function displayName(recipient: PersonUID): string {
    return recipient.name || recipient.emailAddress;
  }

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
</style>
