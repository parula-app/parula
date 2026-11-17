<vbox flex class="pane">
  <PersonsToolbar {persons} bind:selectedAddressbook />
  <PersonsList {persons} bind:selected={$selectedPerson} bind:searchTerm={$globalSearchTerm} {doSearch} on:click={() => catchErrors(onPersonSelected)} />
</vbox>
{#if $appGlobal.isMobile}
  <PersonsBarM {selectedAddressbook} />
{/if}

<script lang="ts">
  import { Person } from "../../logic/Abstract/Person";
  import { Addressbook } from "../../logic/Contacts/Addressbook";
  import { selectedPerson } from "./Person/Selected";
  import { globalSearchTerm, goTo } from "../AppsBar/selectedApp";
  import { appGlobal } from "../../logic/app";
  import PersonsList from "./Person/PersonsList.svelte";
  import PersonsToolbar from "./PersonsToolbar.svelte";
  import PersonsBarM from "./PersonsBarM.svelte";
  import { URLPart } from "../../logic/util/blob";
  import { catchErrors } from "../Util/error";
  import { assert, sleep } from "../../logic/util/util";
  import type { Collection } from "svelte-collections";

  export let doSearch = false;

  export let selectedAddressbook: Addressbook | null = null; /** null = show all */

  $: $globalSearchTerm && showAll()
  function showAll() {
    selectedAddressbook = null;
    // This must be above the `$: persons` statement, so that `persons` will be adapted and then the search happens
  }

  $: persons = (selectedAddressbook?.persons ?? appGlobal.persons) as Collection<Person>;

  async function onPersonSelected() {
    await sleep(0.1); // wait for `<PersonsList>` to set `$selectedPerson`
    assert($selectedPerson, "Need person");
    goTo(URLPart`/contacts/person/${$selectedPerson.id}/edit`, { person: $selectedPerson });
  }
</script>

<style>
  .pane {
    border-right: 1px dotted var(--border);
    box-shadow: 2px 0px 6px 0px rgba(0, 0, 0, 10%); /* Also on PersonDetails */
    background-color: var(--leftbar-bg);
    color: var(--leftbar-fg);
  }
</style>
