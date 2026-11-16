<hbox class="range-header window-drag">
  <slot name="top-left" />
  <hbox flex />
  <slot name="top-right" />
</hbox>

{#if $globalSearchTerm}
  <vbox class="search">
    <hbox>
      <SearchField bind:searchTerm={$globalSearchTerm} />
    </hbox>
    <hbox class="result-count font-normal">
      {$t`Found ${filteredEvents.length} events`}
    </hbox>
  </vbox>
{/if}

<ListView events={filteredEvents} />

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import ListView from "./ListView.svelte";
  import SearchField from "../../Shared/SearchField.svelte";
  import type { Collection } from "svelte-collections";
  import { globalSearchTerm } from "../../AppsBar/selectedApp";
  import { t } from "../../../l10n/l10n";

  export let events: Collection<Event>;

  let futureEvents = events.filterObservable(event => event.startTime.getTime() > Date.now());
  $: filteredEvents = $globalSearchTerm
    ? futureEvents.filterObservable(event => event.matchesSearch($globalSearchTerm))
    : futureEvents;
</script>

<style>
  .search {
    margin-block-start: 24px;
    margin-block-end: 18px;
    margin-inline-start: 12px;
  }
  .result-count {
    margin-block-start: 8px;
    margin-inline-start: 4px;
    opacity: 80%;
  }
</style>
