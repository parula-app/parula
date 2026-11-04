<vbox flex class="tracking">
  <hbox class="summary">
    <InfoIcon size={16} />
    <span>{summary}</span>
  </hbox>
  <vbox flex class="table-scroll">
    <table>
      <thead>
        <tr>
          {#each columns as column}
            <th aria-sort={sortColumn == column.id ? (ascending ? "ascending" : "descending") : "none"}>
              <button class="column-header" on:click={() => onSort(column.id)}>
                {column.label}
                {#if sortColumn == column.id}
                  <svelte:component this={ascending ? AscendingIcon : DescendingIcon} size={12} />
                {/if}
              </button>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as participant (participant)}
          <tr>
            <td>
              <hbox class="name">
                <ParticipantConfirmIcon {participant} />
                <span>{participant.name || participant.emailAddress}</span>
                {#if participant.name && participant.emailAddress}
                  <span class="lo-secondary">{participant.emailAddress}</span>
                {/if}
              </hbox>
            </td>
            <td>{attendanceLabel(participant)}</td>
            <td>{responseLabel(participant)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </vbox>
</vbox>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { responseSummary, attendanceLabel, responseLabel, sortForTracking, type TrackingColumn } from "./EventFormInfo";
  import ParticipantConfirmIcon from "./ParticipantConfirmIcon.svelte";
  import InfoIcon from "lucide-svelte/icons/info";
  import AscendingIcon from "lucide-svelte/icons/chevron-up";
  import DescendingIcon from "lucide-svelte/icons/chevron-down";
  import { derived } from "svelte/store";
  import { t } from "../../../l10n/l10n";

  export let event: Event;

  let sortColumn: TrackingColumn = null;
  let ascending = true;

  $: eventParticipants = event.participants;
  $: participants = derived($eventParticipants.contents, () => eventParticipants.contents);
  $: summary = $participants && responseSummary(event);
  $: rows = sortForTracking($participants, sortColumn, ascending);
  $: columns = [
    { id: "name" as TrackingColumn, label: $t`Name` },
    { id: "attendance" as TrackingColumn, label: $t`Attendance *=> Role of the attendee: organizer or required attendee` },
    { id: "response" as TrackingColumn, label: $t`Response *=> Answer of the attendee to the invitation` },
  ];

  function onSort(column: TrackingColumn) {
    ascending = sortColumn == column ? !ascending : true;
    sortColumn = column;
  }
</script>

<style>
  .tracking {
    min-height: 0;
    padding: 12px 24px;
  }
  .summary {
    flex-shrink: 0;
    align-items: center;
    gap: 8px;
    margin-block-end: 12px;
    font-size: var(--lo-font-size-small);
  }
  .summary :global(svg) {
    color: var(--lo-accent-text);
  }
  .table-scroll {
    min-height: 0;
    overflow: auto;
    border: 1px solid var(--lo-border);
    border-radius: var(--lo-radius-small);
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th {
    position: sticky;
    top: 0;
    padding: 0;
    border-block-end: 1px solid var(--lo-border);
    background-color: var(--lo-pane-alt-bg);
    color: var(--lo-fg-secondary);
    font-weight: normal;
    text-align: start;
  }
  .column-header {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .column-header:hover {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
  }
  td {
    padding: 6px 12px;
    border-block-end: 1px solid var(--lo-divider);
  }
  .name {
    align-items: center;
    gap: 8px;
    min-height: 20px;
  }
</style>
