{#if $invitees.hasItems && (!noAvailabilityReason || $isDemo)}
  <vbox class="availability" class:expanded class:enlarged>
    <hbox class="header" class:short-labels={labels == "short"} bind:this={headerE} bind:clientWidth={headerWidth}>
      <IslandSwitcher faint={false}>
        <Button
          tooltip={$t`Free slots`}
          icon={FreeTimesIcon}
          iconSize="16px"
          iconOnly={labels == "none"}
          onClick={() => showView("free")}
          selected={expanded && view == "free"}
          disabled={noAvailabilityReason}
          >
          <hbox slot="label">
            <span class="long">{$t`Free slots`}</span>
            <span class="short">{$t`Free *=> Short for: Free slots, the times when the participants have no appointments`}</span>
          </hbox>
        </Button>
        <Button
          tooltip={$t`Who is free when`}
          icon={ParticipantsIcon}
          iconSize="16px"
          iconOnly={labels == "none"}
          onClick={() => showView("participants")}
          selected={expanded && view == "participants"}
          disabled={noAvailabilityReason}
          >
          <hbox slot="label">
            <span class="long">{$t`Who is free when`}</span>
            <span class="short">{$t`Who *=> Short for: Who is free when`}</span>
          </hbox>
        </Button>
        {#if $isDemo}
          <Button
            label={$t`Poll *=> Ask the participants by email which times suit them`}
            icon={PollIcon}
            iconSize="16px"
            iconOnly={labels == "none"}
            onClick={() => showView("poll")}
            selected={expanded && view == "poll"}
            />
        {/if}
      </IslandSwitcher>
      <hbox flex />
      {#if expanded}
        <RoundButton
          label={enlarged
            ? $t`Shrink *=> Make the availability small again, and show the other fields of the event`
            : $t`Enlarge *=> Let the availability fill the dialog`}
          icon={enlarged ? ShrinkIcon : EnlargeIcon}
          onClick={enlarged ? () => enlarged = false : onEnlarge}
          classes="plain"
          border={false}
          iconSize="16px"
          />
      {/if}
      <Button
        plain
        icon={expanded ? CollapseIcon : ExpandIcon}
        label={expanded ? $t`Collapse` : $t`Expand`}
        onClick={toggleExpanded}
        iconOnly
        iconSize="16px"
        />
    </hbox>
    {#if expanded}
      <vbox class="view">
        {#if view == "free"}
          <FreeSlots {event} {showHours} />
        {:else if view == "participants"}
          <ParticipantsDayView {event} {showHours} />
        {:else}
          <AvailabilityPoll {event} bind:sml={poll} />
        {/if}
      </vbox>
    {/if}
  </vbox>
{/if}

<script lang="ts" context="module">
  import type { Event } from "../../../../logic/Calendar/Event";
  import type { SMLData } from "../../../../logic/Mail/SML/SMLData";

  type AvailabilityView = "free" | "participants" | "poll";

  /** "Enlarge" in the sidebar opens the event in the full window,
   * in a new dialog, which takes over the view and the poll */
  let handover: { event: Event, view: AvailabilityView, poll: SMLData | null } | null = null;
</script>

<script lang="ts">
  import { InvitationResponse } from "../../../../logic/Calendar/Invitation/InvitationStatus";
  import { FreeBusy } from "../../../../logic/Calendar/FreeBusy";
  import { calendarMustangApp, CalendarEventMustangApp } from "../../CalendarMustangApp";
  import { selectedApp } from "../../../AppsBar/selectedApp";
  import { isDemo } from "../../../AppsBar/demo";
  import FreeSlots from "./FreeSlots.svelte";
  import ParticipantsDayView from "./ParticipantsDayView.svelte";
  import AvailabilityPoll from "./AvailabilityPoll.svelte";
  import IslandSwitcher from "../../../Shared/IslandSwitcher.svelte";
  import Button from "../../../Shared/Button.svelte";
  import RoundButton from "../../../Shared/RoundButton.svelte";
  import FreeTimesIcon from "lucide-svelte/icons/calendar-check";
  import ParticipantsIcon from "lucide-svelte/icons/users";
  import PollIcon from "lucide-svelte/icons/calendar-clock";
  import EnlargeIcon from "lucide-svelte/icons/maximize-2";
  import ShrinkIcon from "lucide-svelte/icons/minimize-2";
  import ExpandIcon from "lucide-svelte/icons/chevron-down";
  import CollapseIcon from "lucide-svelte/icons/chevron-up";
  import { tick } from "svelte";
  import { t } from "../../../../l10n/l10n";

  export let event: Event;
  /** Whether the availability is shown, or only the view switcher
   * in/out */
  export let expanded = false;
  /** Whether the availability fills the dialog
   * in/out */
  export let enlarged = false;

  let view: AvailabilityView = "free";
  let poll: SMLData | null = null;
  /** Whether the user expanded or collapsed the availability.
   * Until then, it expands as soon as the availability of an invitee is known. */
  let isExpandedByUser = false;
  if (handover?.event == event) {
    ({ view, poll } = handover);
    handover = null;
    expanded = enlarged = isExpandedByUser = true;
  }

  $: participants = event.participants;
  $: invitees = participants.filterObservable(participant => participant.response != InvitationResponse.Organizer);
  $: showHours = enlarged ? 10 : 5;
  $: isInSidebar = !($selectedApp instanceof CalendarEventMustangApp);

  function onEnlarge() {
    if (isInSidebar) {
      handover = { event, view, poll };
      calendarMustangApp.showEvent(event);
      return;
    }
    enlarged = true;
  }

  // <copied to="../../../../lookout/Calendar/EditEvent/SchedulingAssistant.svelte">
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

  let expandCheckCount = 0;
  $: $invitees, expandIfAvailable();
  async function expandIfAvailable() {
    if (expanded || isExpandedByUser) {
      return;
    }
    let count = ++expandCheckCount;
    let day = new Date(event.startTime);
    day.setHours(0, 0, 0, 0);
    let dayEnd = new Date(day);
    dayEnd.setDate(dayEnd.getDate() + 1);
    try {
      let freeBusy = await FreeBusy.load(event.calendar, invitees.contents, day, dayEnd);
      if (freeBusy.hasInformation && count == expandCheckCount && !isExpandedByUser) {
        expanded = true;
      }
    } catch (ex) {
      // The views show the error
    }
  }

  function showView(newView: AvailabilityView) {
    view = newView;
    expanded = isExpandedByUser = true;
  }

  function toggleExpanded() {
    expanded = !expanded;
    isExpandedByUser = true;
    if (!expanded) {
      enlarged = false;
    }
  }

  /** Whether the view switcher shows the long labels, short labels, or only icons */
  let labels: "long" | "short" | "none" = "long";
  let headerE: HTMLElement;
  let headerWidth = 0;
  let fitCount = 0;
  $: headerWidth, expanded, $invitees, $isDemo, fitLabels();
  async function fitLabels() {
    let count = ++fitCount;
    for (let candidate of ["long", "short", "none"] as const) {
      labels = candidate;
      await tick();
      if (count != fitCount || !headerE || headerE.scrollWidth <= headerE.clientWidth) {
        return;
      }
    }
  }
</script>

<style>
  .availability.expanded {
    flex: 1 0 auto;
  }
  .availability.enlarged {
    flex: 1 1 0;
    min-height: 0;
  }
  .header {
    contain: inline-size;
    align-items: center;
    gap: 12px;
  }
  .header :global(.island) {
    flex-shrink: 0;
    white-space: nowrap;
  }
  .short,
  .short-labels .long {
    display: none;
  }
  .short-labels .short {
    display: inline;
  }
  .view {
    flex: 1 0 300px;
    margin-block-start: 6px;
    padding: 8px;
    border: 1px dotted var(--border);
    border-radius: var(--border-radius);
  }
  .enlarged .view {
    flex: 1 1 0;
    min-height: 0;
  }
</style>
