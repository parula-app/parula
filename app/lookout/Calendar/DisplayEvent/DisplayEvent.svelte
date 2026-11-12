<vbox flex class="event-reading-pane lo-card">
  {#if event}
    <vbox class="header" style="--event-color: {$event.color ?? $calendar?.color ?? "var(--lo-accent)"}">
      <hbox class="calendar-name">
        <span class="dot" />
        <span>{$calendar?.name ?? ""}</span>
      </hbox>
      <h2 class="title" class:muted={look.status == "declined" || look.status == "cancelled"}>{look.title}</h2>
      {#if $event.isCancelled}
        <hbox class="notice">{$t`This meeting has been cancelled by the organizer`}</hbox>
        <hbox class="buttons">
          <ResponseButton label={$t`Remove from Calendar`} icon={DeleteIcon}
            onClick={() => CalendarActions.deleteOccurrence(event)} />
        </hbox>
      {:else if $event.isIncomingMeeting}
        {#if $event.isMoved}
          <hbox class="notice">{$t`The organizer changed the time or place of this meeting. Please respond again.`}</hbox>
        {/if}
        <hbox class="buttons">
          <RespondButtons response={$event.myParticipation}
            onRespond={(response, sendReply) => event.respondToInvitation(response, sendReply)}
            onReplyToOrganizer={() => openComposer(IncomingInvitation.replyToEventByMail(event, false))}
            onReplyToAll={() => openComposer(IncomingInvitation.replyToEventByMail(event, true))}
            onForward={async () => openComposer(await IncomingInvitation.forwardEventByMail(event))} />
        </hbox>
      {/if}
    </vbox>
    <vbox class="details">
      <DetailsGrid {event} />
    </vbox>
    {#if $event.hasDescription}
      <vbox flex class="body">
        <WebView html={$event.descriptionHTML} title="" {headHTML} />
      </vbox>
    {/if}
  {:else}
    <vbox flex class="empty">
      <CalendarIcon size="48" strokeWidth={1} />
      <span>{$t`Select an item to read`}</span>
    </vbox>
  {/if}
</vbox>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { EventLook } from "./EventLook";
  import { CalendarActions } from "../CalendarActions";
  import DetailsGrid from "./DetailsGrid.svelte";
  import ResponseButton from "../Invitation/ResponseButton.svelte";
  import RespondButtons from "../Invitation/RespondButtons.svelte";
  import { IncomingInvitation } from "../../../logic/Calendar/Invitation/IncomingInvitation";
  import { openComposer } from "../../../frontend/Mail/open";
  import WebView from "../../../frontend/Shared/WebView.svelte";
  import cssContent from "../../../frontend/Mail/Message/content.css?inline";
  import cssBody from "../../../frontend/Mail/Message/content-body.css?inline";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import CalendarIcon from "lucide-svelte/icons/calendar";
  import { t } from "../../../l10n/l10n";

  export let event: Event | null;

  $: calendar = $event?.calendar;
  $: look = event ? new EventLook($event) : null;

  // <copied from="../../../frontend/Calendar/Invitation/InvitationInCalendar.svelte">
  let headHTML = `<style>\n${cssBody}\n${cssContent}\n</style>`;
  // </copied>
</script>

<style>
  .event-reading-pane {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .header {
    gap: 8px;
    padding: 16px 20px 12px 20px;
    border-block-end: 1px solid var(--lo-divider);
  }
  .calendar-name {
    align-items: center;
    gap: 6px;
    font-size: var(--lo-font-size-small);
    color: var(--lo-fg-secondary);
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background-color: var(--event-color);
  }
  .title {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .title.muted {
    color: var(--lo-fg-secondary);
  }
  .notice {
    padding: 8px 12px;
    border-radius: var(--lo-radius-small);
    background-color: color-mix(in srgb, var(--lo-warning) 15%, var(--lo-pane-bg));
  }
  .buttons {
    gap: 8px;
    flex-wrap: wrap;
  }
  .details {
    padding: 12px 20px;
  }
  .body {
    min-height: 0;
    padding: 0 20px 12px 20px;
    border-block-start: 1px solid var(--lo-divider);
  }
  .body > :global(*) {
    flex: 1 0 0;
  }
  .empty {
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--lo-fg-secondary);
  }
</style>
