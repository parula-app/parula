<hbox class="persons-toolbar">
  <vbox class="dropdown">
    <AccountDropDown
      bind:selectedAccount={selectedAddressbook}
      accounts={appGlobal.addressbooks}
      showAllOption={true}
      filterByWorkspace={true}
      icon={AddressbookIcon}
      iconSize="20px"
      />
  </vbox>
  <hbox flex />
  <hbox class="buttons">
    <RoundButton
      label={$t`Sync from server`}
      icon={SyncIcon}
      iconSize="12px" padding="4px" classes="sync small" border={false}
      onClick={sync}
      disabled={!$selectedAddressbook?.canSync}
      />
    <RoundButton
      label={$t`New contact`}
      icon={NewContactIcon}
      iconSize="22px" padding="9px" classes="large create"
      onClick={addPerson}
      />
  </hbox>
</hbox>
{#if $newPerson}
  <hbox class="new-person" class:selected={$selectedPerson == $newPerson}>
    <PersonLine person={$newPerson} {pictureSize}>
      <SparklesIcon size={pictureSize} slot="icon" />
    </PersonLine>
  </hbox>
{/if}

<script lang="ts">
  import type { Person } from "../../logic/Abstract/Person";
  import { newPerson, selectedPerson } from "./Person/Selected";
  import { createNewPerson } from "./person";
  import type { Addressbook } from "../../logic/Contacts/Addressbook";
  import { appGlobal } from "../../logic/app";
  import PersonLine from "./Person/PersonLine.svelte";
  import AccountDropDown from "../Shared/AccountDropDown.svelte";
  import RoundButton from "../Shared/RoundButton.svelte";
  import NewContactIcon from "lucide-svelte/icons/plus";
  import SyncIcon from "lucide-svelte/icons/refresh-cw";
  import AddressbookIcon from "lucide-svelte/icons/book-user";
  import SparklesIcon from "lucide-svelte/icons/sparkles";
  import { assert } from "../../logic/util/util";
  import type { Collection } from "svelte-collections";
  import { t } from "../../l10n/l10n";

  /** in */
  export let persons: Collection<Person>;
  /** in/out */
  export let selectedAddressbook: Addressbook;

  let pictureSize = appGlobal.isMobile ? 32 : 20;

  function addPerson() {
    createNewPerson(selectedAddressbook);
  }

  async function sync() {
    let ab = $selectedAddressbook;
    assert(ab?.canSync, "Cannot sync " + ab.protocol);
    if (!ab.isLoggedIn) {
      await ab.login(true);
    }
    await ab.listContacts();
  }
</script>

<style>
  .persons-toolbar {
    margin: 10px 12px 10px 16px;
    align-items: end;
  }
  .dropdown {
    margin-block: auto; /* v-center */
    margin-inline-start: 4px;
  }
  .dropdown :global(.icon) {
    margin-inline-end: 4px;
  }
  .buttons {
    align-items: end;
  }
  .buttons :global(.button) {
    margin-left: 6px;
  }
  .buttons :global(.button.disabled) {
    opacity: 10%;
  }
  .new-person {
    margin-block-end: 10px;
  }
  .new-person.selected {
    background-color: var(--selected-bg);
  }
</style>
