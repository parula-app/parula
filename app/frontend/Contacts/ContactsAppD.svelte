<Splitter name="persons-list" initialRightRatio={4}>
  <vbox flex class="left-pane" slot="left">
    <PersonsToolbar {persons} bind:selectedAddressbook />
    <PersonsActionToolbar bind:selectedAddressbook {selectedPersons} />
    <PersonsList {persons} bind:selected={$selectedPerson} searchTerm={$globalSearchTerm} bind:selectedPersons />
  </vbox>
  <vbox flex class="right-pane" slot="right">
    {#if $selectedPerson && $selectedPerson instanceof Person}
      <Scroll>
        <PersonDetails person={$selectedPerson} />
      </Scroll>
    {/if}
  </vbox>
</Splitter>

<svelte:window on:keydown={(event) => catchErrors(() => onKeyOnContacts(event, selectedAddressbook))} />

<script lang="ts">
  import { Person } from "../../logic/Abstract/Person";
  import type { PersonOrGroup } from "./Person/PersonOrGroup";
  import type { Addressbook } from "../../logic/Contacts/Addressbook";
  import { selectedPerson } from "./Person/Selected";
  import { selectedWorkspace } from "../MainWindow/Selected";
  import { globalSearchTerm } from "../AppsBar/selectedApp";
  import { appGlobal } from "../../logic/app";
  import { onKeyOnContacts } from "./ContactsKeyboard";
  import { catchErrors } from "../Util/error";
  import PersonsList from "./Person/PersonsList.svelte";
  import PersonDetails from "./PersonPage/PersonDetails.svelte";
  import PersonsToolbar from "./PersonsToolbar.svelte";
  import PersonsActionToolbar from "./PersonsActionToolbar.svelte";
  import Scroll from "../Shared/Scroll.svelte";
  import Splitter from "../Shared/Splitter.svelte";
  import type { ArrayColl, Collection } from "svelte-collections";

  let selectedAddressbook: Addressbook | null = null; /** null = show all */

  $: $globalSearchTerm && showAll()
  function showAll() {
    selectedAddressbook = null;
    // This must be above the `$: persons` statement, so that `persons` will be adapted and then the search happens
  }

  $: persons = (selectedAddressbook?.persons ?? ($selectedWorkspace
    ? appGlobal.persons.filterObservable(p => p.addressbook.workspace == $selectedWorkspace)
    : appGlobal.persons)) as Collection<Person>;
  let selectedPersons: ArrayColl<PersonOrGroup>;
</script>

<style>
  .left-pane {
    border-right: 1px dotted var(--border);
    box-shadow: 2px 0px 6px 0px rgba(0, 0, 0, 10%); /* Also on PersonDetails */
    background-color: var(--leftbar-bg);
    color: var(--leftbar-fg);
  }
</style>
