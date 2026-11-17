<vbox flex class="scheduling-assistant">
  <hbox class="header">
    {#if $participants.hasItems}
      <SendButton label={sendLabel} disabled={sendDisabled} onClick={onSend} />
    {/if}
    <grid class="fields">
      <TimeBox {event} editor={timeEditor} {flow} showSummary={false} />
    </grid>
  </hbox>
  <hbox class="view-tabs">
    <DialogTabs tabs={viewTabs} bind:selected={view} />
    {#if view == "poll"}
      <DialogButton label={$t`Use calendar`} icon={CalendarIcon} classes="plain" pressed={useCalendar}
        onClick={() => { useCalendar = !useCalendar; }} />
    {/if}
  </hbox>
  {#if view == "free"}
    <vbox flex class="view">
      <FreeSlots {event} showHours={10} />
    </vbox>
  {:else if view == "participants"}
    <AvailabilityGrid {event} {timeEditor} />
  {:else}
    <vbox flex class="view">
      <AvailabilityPoll {event} bind:sml={poll}>
        <svelte:fragment slot="editor" let:sml>
          {#if useCalendar}
            <SMLCalendar>
              <EditPollTimes {event} {sml} />
            </SMLCalendar>
          {:else}
            <PollEdit {sml} showDuration={false} />
          {/if}
        </svelte:fragment>
      </AvailabilityPoll>
    </vbox>
  {/if}
</vbox>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import type { SMLData } from "../../../logic/Mail/SML/SMLData";
  import { FreeBusy } from "../../../logic/Calendar/FreeBusy";
  import type { EventEditFlow } from "./EventEditFlow";
  import type { EventTimeEditor } from "./EventTimeEditor";
  import SendButton from "./SendButton.svelte";
  import TimeBox from "./TimeBox.svelte";
  import AvailabilityGrid from "./AvailabilityGrid.svelte";
  import FreeSlots from "../../../frontend/Calendar/EditEvent/Availability/FreeSlots.svelte";
  import AvailabilityPoll from "../../../frontend/Calendar/EditEvent/Availability/AvailabilityPoll.svelte";
  import EditPollTimes from "../../../frontend/Calendar/EditEvent/Availability/EditPollTimes.svelte";
  import PollEdit from "../SML/Shared/PollEdit.svelte";
  import SMLCalendar from "../SML/Shared/SMLCalendar.svelte";
  import DialogTabs from "../../Shared/Dialog/DialogTabs.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import { isDemo } from "../../../frontend/AppsBar/demo";
  import CalendarIcon from "lucide-svelte/icons/calendar";
  import { t } from "../../../l10n/l10n";

  export let event: Event;
  export let flow: EventEditFlow;
  export let timeEditor: EventTimeEditor;
  export let sendLabel: string;
  export let sendDisabled: string | false = false;
  export let onSend: () => Promise<void>;

  $: viewTabs = [
    { id: "free", label: $t`Free slots`, disabled: noAvailabilityReason },
    { id: "participants", label: $t`Who is free when`, disabled: noAvailabilityReason },
    ...($isDemo ? [{ id: "poll", label: $t`Poll *=> Ask the participants by email which times suit them` }] : []),
  ];
  let view = "free";
  let poll: SMLData | null = null;
  let useCalendar = true;
  $: participants = event.participants;

  // <copied from="../../../frontend/Calendar/EditEvent/Availability/Availability.svelte">
  let noAvailabilityReason: string | false = false;
  $: event.calendar, $participants, checkAvailability();
  async function checkAvailability() {
    let isSupported = true;
    try {
      isSupported = await FreeBusy.isSupported(event.calendar, event.participants.contents);
    } catch (ex) {
      // The views show the error
    }
    noAvailabilityReason = isSupported ? false : $t`This calendar doesn't provide the availability of other people`;
    if (!isSupported && $isDemo) {
      view = "poll";
    }
  }
  // </copied>
</script>

<style>
  .scheduling-assistant {
    min-height: 0;
  }
  .header {
    flex-shrink: 0;
    align-items: start;
    gap: 16px;
    padding: 12px 24px 12px 24px;
  }
  .fields {
    grid-template-columns: max-content 1fr;
    align-items: center;
    column-gap: 12px;
    row-gap: 8px;
  }
  .fields :global(.row-label) {
    min-width: 80px;
    text-align: end;
  }
  .view-tabs {
    flex-shrink: 0;
    align-items: end;
    margin: 0 24px 8px 24px;
    border-block-end: 1px solid var(--lo-border);
  }
  .view-tabs :global(.dialog-tabs) {
    flex: 1;
    border-block-end: none;
  }
  .view-tabs :global(.dialog-button) {
    height: 28px;
    margin-block-end: 2px;
  }
  .view {
    min-height: 0;
    margin: 0 24px 12px 24px;
  }
  .view :global(.sml-calendar) {
    flex: 1 0 0;
    height: auto;
    min-height: 200px;
  }
  .view :global(.edit-poll-times) {
    min-height: 200px;
  }
</style>
