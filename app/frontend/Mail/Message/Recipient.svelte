<Clickable onClick={onOpen}>
  <hbox class="recipient"
    bind:this={anchor}
    class:is-contact={recipient.findPerson()}
    >
    <div class="name" title={recipient.name + "\n" + recipient.emailAddress}>
      {personDisplayName(recipient)}
    </div>
    {#if !recipient.findPerson()}
      {#if recipient.emailAddress}
        <div class="domain" title={recipient.emailAddress}>
          @{getBaseDomainFromHost(getDomainForEmailAddress(recipient.emailAddress))}
        </div>
      {:else}
        <hbox class="invalid">{$t`Invalid address`}</hbox>
      {/if}
    {/if}
  </hbox>
</Clickable>

<Menu bind:isMenuOpen={isPopupOpen} {anchor} placement="bottom-start">
  {#if existingPersons?.hasItems}
    <MenuLabel label={$t`Add ${recipient.emailAddress} to existing contact`} />
    {#each existingPersons.each as otherPerson}
      <MenuItem
        label="{otherPerson.name} - {otherPerson.emailAddresses.first?.value ?? otherPerson.chatAccounts.first?.value ?? otherPerson.name}"
        onClick={() => addToPerson(otherPerson)} />
    {/each}
  {/if}

  <MenuLabel label={$t`Add ${recipient.emailAddress} to addressbook`} />
  {#each appGlobal.addressbooks.each as addressbook}
    <MenuItem
      label={$t`Add to ${addressbook.name}`}
      onClick={() => addToAddressbook(addressbook)} />
  {/each}

  <MenuLabel label={$t`Other actions`} />
  <MenuItem
    label={recipient.name ? $t`Copy name and email address` : $t`Copy email address`}
    onClick={copyToClipboard} />
</Menu>

<script lang="ts">
  import { type PersonUID, findPersonsWithName, personDisplayName } from "../../../logic/Abstract/PersonUID";
  import { ContactEntry, Person } from "../../../logic/Abstract/Person";
  import { Addressbook } from "../../../logic/Contacts/Addressbook";
  import { openPersonFromOtherApp } from "../../Contacts/open";
  import { getBaseDomainFromHost, getDomainForEmailAddress } from "../../../logic/util/netUtil";
  import { appGlobal } from "../../../logic/app";
  import Menu from "../../Shared/Menu/Menu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuLabel from "../../Shared/Menu/MenuLabel.svelte";
  import Clickable from "../../Shared/Clickable.svelte";
  import { ArrayColl } from "svelte-collections";
  import { t } from "../../../l10n/l10n";

  export let recipient: PersonUID;

  let anchor: HTMLDivElement;
  let isPopupOpen: boolean;
  let existingPersons: ArrayColl<Person>;

  function onOpen(event: Event) {
    let person = recipient.findPerson(); // based on email address
    if (person) {
      openPersonFromOtherApp(person);
      return;
    }
    if (recipient.isProxyAddress) {
      return;
    }
    existingPersons = recipient.name ? findPersonsWithName(recipient.name) : null;
    isPopupOpen = true;
  }

  async function addToAddressbook(addressbook: Addressbook) {
    let person = recipient.createPerson(addressbook);
    await person.save();
    recipient = recipient;
  }

  async function addToPerson(otherPerson: Person) {
    otherPerson.emailAddresses.add(new ContactEntry(recipient.emailAddress));
    if (recipient.encryptionPublicKey) {
      otherPerson.addEncryptionPublicKey(recipient.encryptionPublicKey);
    }
    recipient.person = otherPerson;
    await otherPerson.save();
  }

  async function copyToClipboard() {
    let text = recipient.emailAddress;
    if (recipient.name) {
      text = recipient.name + " <" + recipient.emailAddress + ">";
    }
    await navigator.clipboard.writeText(text);
  }
</script>

<style>
  :global(.app-object):has(.name) {
    display: block;
  }
  .recipient {
    cursor: pointer;
  }
  .recipient.is-contact:hover {
    color: var(--link-hover-fg);
  }
  .name {
    display: inline;
  }
  .domain,
  .invalid {
    display: inline;
    font-weight: normal;
    font-style: italic;
    margin-inline-start: 6px;
  }
</style>
