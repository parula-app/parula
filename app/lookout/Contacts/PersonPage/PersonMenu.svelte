<ContextMenu bind:this={contextMenu}>
  {#if contacts.length == 1}
    <MenuItem
      label={$t`Open`}
      icon={OpenIcon}
      shortCutInfo={$t`Enter *=> RETURN key`}
      onClick={() => ContactActions.edit(contacts[0])} />
    <MenuDivider />
  {/if}
  {#if person}
    <MenuItem
      label={$t`Copy`}
      tooltip={$t`Copy the contact information to the clipboard`}
      icon={CopyIcon}
      onClick={() => navigator.clipboard.writeText(person.toPlaintext())} />
  {/if}
  <MenuItem
    label={$t`E-mail Message`}
    icon={MailIcon}
    disabled={!hasEmailAddress && $t`The contact has no email address`}
    onClick={() => ContactActions.writeMail(contacts)} />
  <NewEventSubMenu
    label={$t`Meeting`}
    icon={MeetingIcon}
    disabled={!hasEmailAddress && $t`The contact has no email address`}
    onCreate={calendar => ContactActions.newMeeting(contacts, calendar)} />
  {#if person}
    <SubMenu label={$t`Call`} icon={CallIcon} disabled={!phoneNumbers.length && $t`The contact has no phone number`}>
      {#each phoneNumbers as entry}
        <MenuItem label={`${entry.value} (${entry.purposeLabel || $t`Phone`})`} icon={CallIcon}
          onClick={() => ContactActions.call(entry.value)} />
      {/each}
    </SubMenu>
  {/if}
  <MenuDivider />
  <MenuItem
    label={$t`Delete`}
    icon={DeleteIcon}
    shortCutInfo={$t`Del *=> Delete key`}
    onClick={() => ContactActions.deleteContacts(contacts)} />
  <SubMenu label={$t`Move`} icon={MoveIcon}>
    {#each sections as section}
      <MenuLabel label={section.mainAccount?.name ?? $t`My Contacts`} />
      {#each section.addressbooks as addressbook (addressbook.id)}
        <MenuItem label={addressbook.name} icon={AddressbookIcon}
          disabled={isIn(addressbook)}
          onClick={() => Promise.all(contacts.map(contact => contact.moveToAddressbook(addressbook)))} />
      {/each}
    {/each}
    {#if person}
      <MenuDivider />
      <SubMenu label={$t`Copy to Folder *=> Copy the selected contacts to another address book`} icon={CopyIcon}>
        {#each sections as section}
          <MenuLabel label={section.mainAccount?.name ?? $t`My Contacts`} />
          {#each section.addressbooks as addressbook (addressbook.id)}
            <MenuItem label={addressbook.name} icon={AddressbookIcon}
              disabled={isIn(addressbook)}
              onClick={() => ContactActions.copyTo(contacts, addressbook)} />
          {/each}
        {/each}
      </SubMenu>
    {/if}
  </SubMenu>
</ContextMenu>

<script lang="ts">
  import type { Contact } from "../../../logic/Abstract/Contact";
  import type { Addressbook } from "../../../logic/Contacts/Addressbook";
  import { Person } from "../../../logic/Abstract/Person";
  import { appGlobal } from "../../../logic/app";
  import { ContactActions } from "../ContactActions";
  import { AddressbookSections } from "../AddressbookSections";
  import ContextMenu from "../../Shared/Menu/ContextMenu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import NewEventSubMenu from "../../Calendar/NewEventSubMenu.svelte";
  import MenuLabel from "../../Shared/Menu/MenuLabel.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import SubMenu from "../../Shared/Menu/SubMenu.svelte";
  import OpenIcon from "lucide-svelte/icons/square-pen";
  import MailIcon from "lucide-svelte/icons/mail";
  import MeetingIcon from "lucide-svelte/icons/calendar-plus";
  import CallIcon from "lucide-svelte/icons/phone";
  import CopyIcon from "lucide-svelte/icons/copy";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import MoveIcon from "lucide-svelte/icons/folder-input";
  import AddressbookIcon from "lucide-svelte/icons/book-user";
  import type { ArrayColl } from "svelte-collections";
  import { t } from "../../../l10n/l10n";

  const addressbooks = appGlobal.addressbooks;

  let contextMenu: ContextMenu;
  let contacts: Contact[] = [];

  $: hasEmailAddress = ContactActions.hasEmailAddress(contacts);
  $: person = contacts.length == 1 && contacts[0] instanceof Person ? contacts[0] as Person : null;
  $: phoneNumbers = person ? person.phoneNumbers.contents : [];
  $: sections = new AddressbookSections($addressbooks.contents).sections;

  function isIn(addressbook: Addressbook): boolean {
    return contacts.every(contact => contact.addressbook == addressbook);
  }

  export function openFor(event: MouseEvent, contact: Contact, selectedContacts: ArrayColl<Contact>) {
    event.preventDefault();
    if (!selectedContacts.contains(contact)) {
      selectedContacts.clear();
      selectedContacts.add(contact);
    }
    contacts = selectedContacts.contents;
    contextMenu.onContextMenu(event);
  }
</script>
