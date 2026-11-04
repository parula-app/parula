<vbox class="person-page" flex>
  <hbox class="header">
    {$t`Meetings with ${person?.name}`}
  </hbox>
  <ListView events={filteredEvents} />
</vbox>
<SearchBarM />

<script lang="ts">
  import { Person } from "../../../logic/Abstract/Person";
  import type { Event } from "../../../logic/Calendar/Event";
  import { appGlobal } from "../../../logic/app";
  import ListView from "./ListView.svelte";
  import SearchBarM from "./SearchBarM.svelte";
  import { t } from "../../../l10n/l10n";

  export let person: Person;

  let events = appGlobal.calendarEvents.filterObservable(event => event.startTime.getTime() > Date.now());
  let personEvents = events.filterObservable(isWithPerson);
  $: filteredEvents = person ? findEvents() : events;

  function findEvents() {
    personEvents.replaceAll(events.contents.filter(isWithPerson));
    return personEvents;
  }

  function isWithPerson(event: Event): boolean {
    return !!person && event.participants?.some(p => p.matchesPerson(person));
  }
</script>

<style>
  .person-page {
    padding: 16px 16px 8px 16px;
  }
  .header {
    align-items: center;
    justify-content: center;
  }
</style>
