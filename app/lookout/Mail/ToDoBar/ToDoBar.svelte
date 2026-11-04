<vbox class="to-do-bar lo-card" aria-label={$t`To-Do Bar`}>
  {#if parts.includes(ToDoBarPart.Calendar)}
    <vbox class="section calendar">
      <hbox class="section-header">
        <span>{$t`Calendar`}</span>
        <hbox flex />
        <button type="button" class="close" title={$t`Remove from the To-Do Bar`} aria-label={$t`Remove from the To-Do Bar`}
          on:click={() => onClosePart(ToDoBarPart.Calendar)}>
          <CloseIcon size={14} />
        </button>
      </hbox>
      <DateNavigator range={new CalendarRange("day", selectedDay)} date={selectedDay}
        on:selectday={event => { selectedDay = event.detail; }}
        on:selectweek={event => { selectedDay = event.detail; }}
        on:selectdays={event => { selectedDay = event.detail.first; }} />
      <vbox class="agenda">
        {#each $agenda as agendaDay (agendaDay.day.getTime())}
          <span class="day-header">{dayLabel(agendaDay.day, $now)}</span>
          {#each agendaDay.events as event (event)}
            <button type="button" class="event" title={event.title}
              style="--calendar-color: {event.calendar?.color ?? 'var(--lo-accent)'};"
              on:click={() => openEvent(event, false)}>
              <span class="event-time">{event.allDay ? $t`All day` : timeLabel(event.startTime)}</span>
              <span class="event-title">{event.title || $t`(no title)`}</span>
              {#if event.location}
                <span class="event-location">{event.location}</span>
              {/if}
            </button>
          {/each}
        {:else}
          <span class="empty">{$t`No upcoming appointments`}</span>
        {/each}
      </vbox>
    </vbox>
  {/if}
  {#if parts.includes(ToDoBarPart.People)}
    <vbox class="section people">
      <hbox class="section-header">
        <span>{$t`People *=> or Persons - Short word, less than 10 characters`}</span>
        <hbox flex />
        <button type="button" class="close" title={$t`Remove from the To-Do Bar`} aria-label={$t`Remove from the To-Do Bar`}
          on:click={() => onClosePart(ToDoBarPart.People)}>
          <CloseIcon size={14} />
        </button>
      </hbox>
      {#each $frequentPeople as person (person)}
        <button type="button" class="person" title={person.emailAddresses.first?.value}
          on:click={() => openPersonFromOtherApp(person)}>
          <PersonCircle name={person.name} picture={person.picture} size={28} />
          <span class="person-name">{person.name}</span>
        </button>
      {:else}
        <span class="empty">{$t`No contacts yet`}</span>
      {/each}
    </vbox>
  {/if}
</vbox>

<script lang="ts" context="module">
  export enum ToDoBarPart {
    Calendar = "calendar",
    People = "people",
  }
</script>

<script lang="ts">
  import type { Person } from "../../../logic/Abstract/Person";
  import type { Event } from "../../../logic/Calendar/Event";
  import { appGlobal } from "../../../logic/app";
  import { shownCalendarEvents } from "../../../frontend/Calendar/selected";
  import { openEvent } from "../../../frontend/Calendar/open";
  import { openPersonFromOtherApp } from "../../../frontend/Contacts/open";
  import { CalendarRange } from "../../Calendar/CalendarRange";
  import { now } from "../../Calendar/selected";
  import DateNavigator from "../../Calendar/DateNavigator.svelte";
  import PersonCircle from "../../Contacts/Person/PersonCircle.svelte";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import { agendaDays } from "./ToDoAgenda";
  import type { Collection } from "svelte-collections";
  import { derived } from "svelte/store";
  import CloseIcon from "lucide-svelte/icons/x";
  import { getDateTimeLocale, t } from "../../../l10n/l10n";

  export let parts: ToDoBarPart[];

  const toDoBar = getLocalStorage<ToDoBarPart[]>("lookout.mail.toDoBar", []);
  function onClosePart(part: ToDoBarPart) {
    $toDoBar.value = ($toDoBar.value ?? []).filter(existing => existing != part);
  }

  let selectedDay = new Date();
  const kAgendaDays = 7;
  const agendaEvents = shownCalendarEvents.filterObservable(isInAgenda);
  $: selectedDay, filterAgenda();
  function filterAgenda() {
    agendaEvents.replaceAll(shownCalendarEvents.contents.filter(isInAgenda));
  }

  function isInAgenda(event: Event): boolean {
    let start = new Date(selectedDay.getFullYear(), selectedDay.getMonth(), selectedDay.getDate());
    let end = new Date(selectedDay.getFullYear(), selectedDay.getMonth(), selectedDay.getDate() + kAgendaDays);
    return event.startTime < end && event.endTime > start;
  }

  $: agenda = derived([...$agendaEvents.contents], events => agendaDays(events, selectedDay, kAgendaDays));

  const peopleByPopularity = appGlobal.persons.sort((a, b) =>
    (b.popularity ?? 0) - (a.popularity ?? 0) || (a.name ?? "").localeCompare(b.name ?? ""));
  $: frequentPeople = derived(topPeople($peopleByPopularity), people => people);

  function topPeople(persons: Collection<Person>): Person[] {
    const kCount = 10;
    let top: Person[] = [];
    for (let person of persons) {
      if (top.length == kCount) {
        break;
      }
      if (person.name && person.emailAddresses.hasItems) {
        top.push(person);
      }
    }
    return top;
  }

  function dayLabel(day: Date, currentMinute: Date): string {
    let today = new Date(currentMinute);
    today.setHours(0, 0, 0, 0);
    let diff = Math.round((day.getTime() - today.getTime()) / (24 * 3600 * 1000));
    if (diff == 0) {
      return $t`Today`;
    } else if (diff == 1) {
      return $t`Tomorrow *=> The day after today`;
    }
    return day.toLocaleDateString(getDateTimeLocale(), { weekday: "long", day: "numeric", month: "long" });
  }

  function timeLabel(time: Date): string {
    return time.toLocaleTimeString(getDateTimeLocale(), { hour: "numeric", minute: "2-digit" });
  }
</script>

<style>
  .to-do-bar {
    flex: 0 0 260px;
    min-height: 0;
    margin-inline-start: 8px;
    overflow-y: auto;
  }
  .section {
    flex-shrink: 0;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--lo-divider);
  }
  .section-header {
    align-items: center;
    padding: 8px 8px 4px 12px;
    font-weight: 600;
  }
  .close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg-secondary);
  }
  .close:hover {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
  }
  .agenda {
    gap: 2px;
    padding: 8px 8px 0 8px;
  }
  .day-header {
    margin-top: 6px;
    padding: 0 4px;
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
    font-weight: 600;
    text-transform: uppercase;
  }
  .event {
    display: flex;
    flex-direction: column;
    align-items: start;
    gap: 1px;
    padding: 4px 8px;
    border: none;
    border-inline-start: 3px solid var(--calendar-color);
    border-radius: var(--lo-radius-small);
    background-color: transparent;
    color: var(--lo-fg);
    font: inherit;
    text-align: start;
  }
  .event:hover {
    background-color: var(--lo-hover-bg);
  }
  .event-time,
  .event-location {
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
  }
  .event-title,
  .event-location {
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .person {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 8px;
    padding: 4px;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg);
    font: inherit;
    text-align: start;
  }
  .person:hover {
    background-color: var(--lo-hover-bg);
  }
  .person-name {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .empty {
    padding: 8px 12px;
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
  }
</style>
