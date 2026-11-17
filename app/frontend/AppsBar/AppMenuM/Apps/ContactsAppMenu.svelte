{#if $selectedPerson}
  <BasicButton onClick={() => goTo(URLPart`/contacts/person/${$selectedPerson.id}/edit`, { person: $selectedPerson })}>
    <PersonPicture person={$selectedPerson} placeholder="icon" size={24} slot="icon" />
  </BasicButton>
  <CombinedButton
    icon1={$selectedPerson.picture ?? contactsIcon}
    icon2={HistoryIcon}
    page={URLPart`/contacts/person/${$selectedPerson.id}/history`}
    params={{ person: $selectedPerson }} />
{:else}
  <hbox class="dummy">
    <BasicButton icon={HistoryIcon} /> <!-- let entire column occupy the normal width, for page alignment -->
  </hbox>
  <hbox class="empty" />
{/if}
<!--<AccountButton account={appGlobal.addressbooks.get(0)} page={acc => `/contacts/account/${acc.id}/persons`} defaultIcon={AccountIcon} />-->
<AppButton app={contactsMustangApp} page="/contacts/" />
<BasicButton icon={SearchIcon} page="/contacts/search" />
<BasicButton icon={PlusIcon} onClick={onCreatePerson} />

<script lang="ts">
  import { contactsMustangApp } from "../../../Contacts/ContactsMustangApp";
  import { selectedPerson } from "../../../Contacts/Person/Selected";
  import { goTo } from "../../selectedApp";
  import { appGlobal } from "../../../../logic/app";
  import AppButton from "../AppButton.svelte";
  import CombinedButton from "../CombinedButton.svelte";
  import BasicButton from "../BasicButton.svelte";
  import PersonPicture from "../../../Contacts/Person/PersonPicture.svelte";
  import SearchIcon from "lucide-svelte/icons/search";
  import PlusIcon from "lucide-svelte/icons/plus";
  import contactsIcon from '../../../asset/icon/appBar/contacts.svg?raw';
  import HistoryIcon from "lucide-svelte/icons/history";
  import { URLPart } from "../../../../logic/util/blob";
  import { assert } from "../../../../logic/util/util";

  function onCreatePerson() {
    let addressbook = appGlobal.addressbooks.first; // TODO selectedAddressbook?
    assert(addressbook, "Need an addressbook first");
    let contact = addressbook.newPerson();
    $selectedPerson = contact;
    goTo(URLPart`/contacts/person/${contact.id}/edit`, { person: contact });
  }
</script>

<style>
  .dummy {
    visibility: hidden;
  }
</style>
