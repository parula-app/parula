<vbox flex class="addressbook-pane">
  <vbox class="scroll nav-list">
    <AddressbookItem
      label={$t`All contacts`}
      icon={AllContactsIcon}
      count={$allContacts.length}
      isSelected={!selectedAddressbook}
      indented={false}
      on:click={() => selectedAddressbook = null} />

    {#each sections as section (section.mainAccount ?? section)}
      {@const sectionID = section.mainAccount?.id ?? "local"}
      <AddressbookSectionHeader account={section.mainAccount}
        collapsed={collapsedSections.has(sectionID)}
        on:click={() => toggleSection(sectionID)} />
      {#if !collapsedSections.has(sectionID)}
        {#each section.addressbooks as addressbook (addressbook.id)}
          <AddressbookItem {addressbook}
            isSelected={selectedAddressbook == addressbook}
            on:click={() => selectedAddressbook = addressbook} />
        {/each}
      {/if}
    {/each}

    {#if $searchOnlyAddressbooks.hasItems}
      <CollapsibleHeader label={$t`Directory *=> Address book on the server with all people of the organization`}
        collapsed={collapsedSections.has("directory")}
        on:click={() => toggleSection("directory")} />
      {#if !collapsedSections.has("directory")}
        {#each $searchOnlyAddressbooks.each as addressbook (addressbook.id)}
          <AddressbookItem {addressbook}
            icon={DirectoryIcon}
            isSelected={selectedAddressbook == addressbook}
            on:click={() => selectedAddressbook = addressbook} />
        {/each}
      {/if}
    {/if}
  </vbox>
</vbox>

<script lang="ts">
  import type { Contact } from "../../logic/Abstract/Contact";
  import type { Addressbook } from "../../logic/Contacts/Addressbook";
  import { AddressbookSections } from "./AddressbookSections";
  import { appGlobal } from "../../logic/app";
  import AddressbookItem from "./AddressbookItem.svelte";
  import AddressbookSectionHeader from "./AddressbookSectionHeader.svelte";
  import AllContactsIcon from "lucide-svelte/icons/contact-round";
  import DirectoryIcon from "lucide-svelte/icons/building-2";
  import CollapsibleHeader from "../Shared/CollapsibleHeader.svelte";
  import { mergeColls, type Collection } from "svelte-collections";
  import { t } from "../../l10n/l10n";

  export let selectedAddressbook: Addressbook | null;

  const allContacts = mergeColls(appGlobal.addressbooks.map(addressbook => addressbook.contacts)) as Collection<Contact>;
  let addressbooks = appGlobal.addressbooks;
  let searchOnlyAddressbooks = appGlobal.searchOnlyAddressbooks;
  $: sections = new AddressbookSections($addressbooks.contents).sections;

  let collapsedSections = new Set<string>();
  function toggleSection(id: string) {
    if (collapsedSections.has(id)) {
      collapsedSections.delete(id);
    } else {
      collapsedSections.add(id);
    }
    collapsedSections = collapsedSections;
  }
</script>

<style>
  .addressbook-pane {
    min-height: 0;
    padding: 4px 0 8px 4px;
  }
  .scroll {
    overflow-y: auto;
    min-height: 0;
    flex: 1 0 0;
  }
</style>
