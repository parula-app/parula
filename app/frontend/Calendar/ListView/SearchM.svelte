<vbox class="search-page" flex>
  <ListView events={filteredEvents} />

  {#if $globalSearchTerm}
    <hbox class="result-count font-normal">
      {$t`Found ${filteredEvents.length} events`}
    </hbox>
  {/if}

  <SearchField bind:searchTerm={$globalSearchTerm} placeholder={$t`Search for an appointment`} autofocus />
</vbox>
<SearchBarM />

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { appGlobal } from "../../../logic/app";
  import { globalSearchTerm } from "../../AppsBar/selectedApp";
  import ListView from "./ListView.svelte";
  import SearchField from "../../Shared/SearchField.svelte";
  import SearchBarM from "./SearchBarM.svelte";
  import { t } from "../../../l10n/l10n";

  export let searchTerm: string;

  $: searchTerm && setSearchTerm()
  function setSearchTerm() {
    $globalSearchTerm = searchTerm;
  }

  let events = appGlobal.calendarEvents.filterObservable(event => event.startTime.getTime() > Date.now());
  let foundEvents = events.filterObservable(isFound);
  $: filteredEvents = $globalSearchTerm ? findEvents() : events;

  function findEvents() {
    foundEvents.replaceAll(events.contents.filter(isFound));
    return foundEvents;
  }

  function isFound(event: Event): boolean {
    return !!$globalSearchTerm && event.matchesSearch($globalSearchTerm);
  }
</script>

<style>
  .search-page {
    padding: 16px 16px 8px 16px;
  }
  .result-count {
    margin: 8px;
  }
</style>
