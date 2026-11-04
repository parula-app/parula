<Popup bind:popupOpen popupAnchor={anchor} placement="right-start" boundaryElSel=".calendar-page">
  <vbox class="event-peek lo-card" style="--event-color: {$event.color ?? $calendar?.color ?? "var(--lo-accent)"}"
    on:keydown={onKeyDown} role="dialog" aria-label={look.title} tabindex="-1">
    <hbox class="header">
      <hbox class="calendar-name" flex>
        <span class="dot" />
        <span class="name">{$calendar?.name ?? ""}</span>
      </hbox>
      {#if $event.isIncomingMeeting}
        <button class="icon-button" title={$t`Reply`} on:click={() => catchErrors(() => reply(false))}>
          <ReplyIcon size="16" />
        </button>
        <button class="icon-button" title={$t`Reply All`} on:click={() => catchErrors(() => reply(true))}>
          <ReplyAllIcon size="16" />
        </button>
      {/if}
      <button class="icon-button" title={$t`Open`} on:click={onOpen}>
        <OpenIcon size="16" />
      </button>
      <button class="icon-button" title={deleteLabel} on:click={onDelete}>
        <DeleteIcon size="16" />
      </button>
      <button class="icon-button" title={$t`Close`} on:click={onClose}>
        <CloseIcon size="16" />
      </button>
    </hbox>
    <div class="title" class:muted={look.status == "declined" || look.status == "cancelled"}>{look.title}</div>
    <DetailsGrid {event} />
    {#if $event.isCancelled}
      <hbox class="notice">
        {$t`This meeting has been cancelled by the organizer`}
      </hbox>
      <hbox class="buttons">
        <button class="peek-button" on:click={onDelete}>{$t`Remove from Calendar`}</button>
      </hbox>
    {:else if $event.isIncomingMeeting}
      {#if $event.isMoved}
        <hbox class="notice">
          {$t`The organizer changed the time or place of this meeting. Please respond again.`}
        </hbox>
      {/if}
      <hbox class="email-organizer">
        <Checkbox label={$t`Email organizer *=> Send the response to the meeting invitation to the organizer`} bind:checked={sendReply} />
      </hbox>
      <hbox class="buttons">
        <button class="peek-button accept" class:chosen={$event.myParticipation == InvitationResponse.Accept}
          on:click={() => respond(InvitationResponse.Accept)}>
          <AcceptIcon size="14" /> <span class="label">{$t`Accept *=> Accept the invitation to the meeting`}</span>
        </button>
        <button class="peek-button tentative" class:chosen={$event.myParticipation == InvitationResponse.Tentative}
          on:click={() => respond(InvitationResponse.Tentative)}>
          <TentativeIcon size="14" /> <span class="label">{$t`Tentative *=> Not sure to join this business meeting`}</span>
        </button>
        <button class="peek-button decline" class:chosen={$event.myParticipation == InvitationResponse.Decline}
          on:click={() => respond(InvitationResponse.Decline)}>
          <DeclineIcon size="14" /> <span class="label">{$t`Decline *=> Decline the invitation to the meeting`}</span>
        </button>
      </hbox>
    {:else}
      <hbox class="buttons">
        <button class="peek-button primary" on:click={onOpen}>{$t`Open`}</button>
      </hbox>
    {/if}
  </vbox>
</Popup>

<script lang="ts">
  import { RecurrenceCase, type Event } from "../../../logic/Calendar/Event";
  import { InvitationResponse, type InvitationResponseInMessage } from "../../../logic/Calendar/Invitation/InvitationStatus";
  import { EventLook } from "./EventLook";
  import { CalendarActions } from "../CalendarActions";
  import { openEvent } from "../../../frontend/Calendar/open";
  import { openComposer } from "../../../frontend/Mail/open";
  import { IncomingInvitation } from "../../../logic/Calendar/Invitation/IncomingInvitation";
  import { eventPeek } from "../selected";
  import { catchErrors } from "../../../frontend/Util/error";
  import Popup from "../../../frontend/Shared/Popup.svelte";
  import OpenIcon from "lucide-svelte/icons/square-pen";
  import ReplyIcon from "lucide-svelte/icons/reply";
  import ReplyAllIcon from "lucide-svelte/icons/reply-all";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import CloseIcon from "lucide-svelte/icons/x";
  import AcceptIcon from "lucide-svelte/icons/check";
  import TentativeIcon from "lucide-svelte/icons/circle-help";
  import DeclineIcon from "lucide-svelte/icons/x";
  import DetailsGrid from "./DetailsGrid.svelte";
  import Checkbox from "../../Shared/Form/Checkbox.svelte";
  import { t } from "../../../l10n/l10n";

  export let event: Event;
  export let anchor: HTMLElement;

  let popupOpen = true;
  let sendReply = true;
  $: if (!popupOpen) {
    onClose();
  }

  $: calendar = $event.calendar;
  $: look = new EventLook($event);
  $: isRecurring = $event.recurrenceCase == RecurrenceCase.Instance || $event.recurrenceCase == RecurrenceCase.Exception;
  $: deleteLabel = $event.isCancelled ? $t`Remove from Calendar`
    : $event.isOutgoingMeeting ? $t`Cancel Meeting`
    : isRecurring ? $t`Delete Occurrence`
    : $t`Delete`;

  function onClose() {
    $eventPeek = null;
  }

  function onOpen() {
    onClose();
    catchErrors(() => openEvent(event, true));
  }

  function reply(toAll: boolean) {
    onClose();
    openComposer(IncomingInvitation.replyToEventByMail(event, toAll));
  }

  function onDelete() {
    onClose();
    catchErrors(() => CalendarActions.deleteDefault(event));
  }

  function respond(response: InvitationResponseInMessage) {
    catchErrors(() => event.respondToInvitation(response, sendReply));
  }

  function onKeyDown(keyEvent: KeyboardEvent) {
    if (keyEvent.key == "Escape") {
      onClose();
    }
  }
</script>

<style>
  .event-peek {
    width: 360px;
    max-width: calc(100vw - 32px);
    padding: 12px 16px 16px 16px;
    box-shadow: var(--lo-shadow-popup);
    border-top: 4px solid var(--event-color);
    color: var(--lo-fg);
    outline: none;
  }
  .header {
    align-items: center;
    gap: 2px;
    margin-block-end: 8px;
  }
  .calendar-name {
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: var(--lo-font-size-small);
    color: var(--lo-fg-secondary);
  }
  .dot {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background-color: var(--event-color);
  }
  .name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .icon-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg-secondary);
    cursor: pointer;
  }
  .icon-button:hover {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
  }
  .title {
    font-size: 18px;
    font-weight: 600;
    line-height: 1.3;
    overflow-wrap: anywhere;
    margin-block-end: 12px;
  }
  .title.muted {
    color: var(--lo-fg-secondary);
  }
  .notice {
    margin-block-start: 12px;
    padding: 8px 12px;
    border-radius: var(--lo-radius-small);
    background-color: color-mix(in srgb, var(--lo-warning) 15%, var(--lo-pane-bg));
  }
  .buttons {
    gap: 8px;
    margin-block-start: 16px;
    flex-wrap: wrap;
  }
  .email-organizer {
    margin-block-start: 16px;
  }
  .email-organizer + .buttons {
    margin-block-start: 8px;
  }
  .peek-button {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-pane-bg);
    color: var(--lo-fg);
    font: inherit;
    cursor: pointer;
  }
  .peek-button:hover {
    background-color: var(--lo-hover-bg);
  }
  .peek-button.primary {
    border-color: var(--lo-accent);
    background-color: var(--lo-accent);
    color: var(--lo-accent-fg);
  }
  .peek-button.primary:hover {
    background-color: var(--lo-accent-hover);
  }
  .peek-button .label {
    text-box: trim-both cap alphabetic;
  }
  .peek-button.accept :global(svg) {
    color: var(--lo-success);
  }
  .peek-button.tentative :global(svg) {
    color: var(--lo-accent-text);
  }
  .peek-button.decline :global(svg) {
    color: var(--lo-danger);
  }
  .peek-button.chosen {
    border-color: var(--lo-accent);
    background-color: var(--lo-selected-bg);
    font-weight: 600;
  }
</style>
