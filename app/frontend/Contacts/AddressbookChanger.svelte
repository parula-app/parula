<AccountDropDown
  selectedAccount={selectedAddressbook}
  accounts={addressbooks}
  filterByWorkspace={false}
  icon={AddressbookIcon}
  {withLabel}
  on:select={(ev) => catchErrors(() => onChangeAddressbook(ev.detail as Addressbook))}
  />

<script lang="ts">
  import type { Addressbook } from "../../logic/Contacts/Addressbook";
  import type { Person } from "../../logic/Abstract/Person";
  import { newPerson, selectedPerson } from "./Person/Selected";
  import { appGlobal } from "../../logic/app";
  import { selectedWorkspace } from "../MainWindow/Selected";
  import AccountDropDown from "../Shared/AccountDropDown.svelte";
  import AddressbookIcon from "lucide-svelte/icons/book-user";
  import { catchErrors } from "../Util/error";

  export let person: Person;
  export let withLabel = false;

  $: selectedAddressbook = person?.addressbook;
  $: addressbooks = appGlobal.addressbooks.filter(acc => acc.workspace == $selectedWorkspace || !$selectedWorkspace);

  async function onChangeAddressbook(newAddressbook: Addressbook) {
    console.log("Selected addressbook", newAddressbook?.name, "old", person?.addressbook?.name);
    if (person == $newPerson) {
      let oldPerson = person;
      person = newAddressbook.newPerson();
      person.addressbook = newAddressbook;
      person.copyFrom(oldPerson);
      $selectedPerson = $newPerson = person;
    } else {
      $selectedPerson = await person.moveToAddressbook(newAddressbook);
    }
  }
</script>
