<vbox class="details">
  <hbox class="row">
    <ClockIcon size="16" />
    <span>{when}</span>
  </hbox>
  {#if recurrence}
    <hbox class="row">
      <RecurrenceIcon size="16" />
      <span>{recurrence}</span>
    </hbox>
  {/if}
  {#if $event.location}
    <hbox class="row">
      <LocationIcon size="16" />
      <span class="wrap">{$event.location}</span>
    </hbox>
  {/if}
  {#if $event.isOnline && $event.onlineMeetingURL}
    <hbox class="row">
      <OnlineMeetingIcon size="16" />
      <button class="join" on:click={onJoin}>{$t`Join`}</button>
    </hbox>
  {/if}
  {#if organizer}
    <hbox class="row person">
      <PersonCircle name={organizer.name || organizer.emailAddress} colorKey={organizer.emailAddress} size={24} />
      <vbox class="person-text">
        <span class="person-name">{organizer.name || organizer.emailAddress}</span>
        <span class="secondary">{$t`Organizer *=> The person who invited to this meeting`}</span>
      </vbox>
    </hbox>
  {/if}
  {#if attendeeSummary}
    <hbox class="row">
      <AttendeesIcon size="16" />
      <span>{attendeeSummary}</span>
    </hbox>
  {/if}
</vbox>

<script lang="ts">
  import { RecurrenceCase, type Event } from "../../../logic/Calendar/Event";
  import { responseCounts, eventWhenText } from "../EditEvent/EventFormInfo";
  import { EventTable } from "../ListView/EventTable";
  import { openExternalURL } from "../../../logic/util/os-integration";
  import { catchErrors } from "../../../frontend/Util/error";
  import PersonCircle from "../../Contacts/Person/PersonCircle.svelte";
  import ClockIcon from "lucide-svelte/icons/clock-8";
  import RecurrenceIcon from "lucide-svelte/icons/repeat";
  import LocationIcon from "lucide-svelte/icons/map-pin";
  import OnlineMeetingIcon from "lucide-svelte/icons/video";
  import AttendeesIcon from "lucide-svelte/icons/users-round";
  import { derived } from "svelte/store";
  import { getDateTimeLocale, plural, t } from "../../../l10n/l10n";

  export let event: Event;

  $: isRecurring = $event.recurrenceCase == RecurrenceCase.Instance || $event.recurrenceCase == RecurrenceCase.Exception;
  $: when = eventWhenText($event, getDateTimeLocale());
  $: recurrence = isRecurring || $event.recurrenceRule ? EventTable.recurrenceLabel($event.parentEvent ?? $event) : "";
  $: eventParticipants = event.participants;
  $: participants = derived($eventParticipants.contents, () => eventParticipants.contents);
  $: organizer = $participants.length ? $event.organizer : null;
  $: attendeeSummary = $participants.length ? summarizeResponses() : "";

  function summarizeResponses(): string {
    let counts = responseCounts($event);
    let parts = [
      counts.accepted ? $t`${counts.accepted} accepted` : null,
      counts.tentative ? $t`${counts.tentative} tentative` : null,
      counts.declined ? $t`${counts.declined} declined` : null,
      counts.none ? $t`${counts.none} didn't respond` : null,
    ].filter(Boolean);
    let total = counts.accepted + counts.tentative + counts.declined + counts.none;
    return total + " " + $plural(total, { one: "attendee", other: "attendees" }) + (parts.length ? ": " + parts.join(", ") : "");
  }

  function onJoin() {
    catchErrors(() => openExternalURL(event.onlineMeetingURL));
  }
</script>

<style>
  .details {
    gap: 10px;
  }
  .row {
    align-items: flex-start;
    gap: 12px;
    min-width: 0;
  }
  .row > :global(svg) {
    flex: none;
    margin-block-start: 2px;
    color: var(--lo-fg-secondary);
  }
  .wrap {
    overflow-wrap: anywhere;
  }
  .person {
    align-items: center;
    gap: 8px;
  }
  .person-text {
    min-width: 0;
  }
  .person-name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .secondary {
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
  }
  .join {
    height: 28px;
    padding: 0 12px;
    border: 1px solid var(--lo-accent);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-accent);
    color: var(--lo-accent-fg);
    font: inherit;
    cursor: pointer;
  }
  .join:hover {
    background-color: var(--lo-accent-hover);
  }
</style>
