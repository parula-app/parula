<vbox flex class="event-form-page" on:keydown={keyEvent => catchErrors(() => onKey(keyEvent))}>
  {#key ribbonKey}
    <EventFormRibbon {event} {flow} {editor} bind:openedTool {schedulingLabel} {trackingLabel}
      {onSave} {onDelete} bind:showEmojis bind:isSchedulingSelected bind:isTrackingSelected />
  {/key}
  <vbox flex class="form-card lo-card">
    <hbox class="title-row">
      <h1>
        <span class="title">{$event.title || $t`Untitled *=> Placeholder for an event without a title`}</span>
        <span class="kind">– {kindLabel}</span>
      </h1>
      <hbox class="calendar-name lo-secondary" title={$t`Calendar`}>
        <span class="dot" style:background-color={$calendar?.color ?? "var(--lo-accent)"} />
        {$calendar?.name ?? ""}
      </hbox>
      <hbox flex />
      {#if showsEditor}
        <UndoRedoButtons {editor} />
      {/if}
      <button class="close" title={$t`Close`} aria-label={$t`Close`} on:click={onCloseRequest}>
        <CloseIcon size={18} />
      </button>
    </hbox>
    {#if isIncoming}
      <InvitationInCalendar {event} {flow} {messages} />
    {:else if showScheduling}
      <SchedulingAssistant {event} {flow} {timeEditor} {sendLabel} {sendDisabled} onSend={onSave} />
    {:else if showTracking}
      <TrackingView {event} />
    {:else}
      <EventForm {event} {flow} {timeEditor} {messages} bind:editor bind:showEmojis
        {sendLabel} {sendDisabled} onSend={onSave} />
    {/if}
  </vbox>
</vbox>

{#if $openRecurrence == event}
  <RecurrenceDialog {event} {flow} {timeEditor} on:close={onRecurrenceClosed} />
{/if}
{#if seriesChoice}
  <SeriesChoiceDialog title={seriesChoice.title} okLabel={seriesChoice.okLabel}
    choices={seriesChoice.choices} onChoose={seriesChoice.onChoose}
    on:close={() => seriesChoice = null} />
{/if}
{#if showSaveChanges}
  <SaveChangesDialog title={kindLabel} question={saveChangesText.question}
    saveLabel={saveChangesText.save} discardLabel={saveChangesText.discard}
    saveDisabled={flow.missingPropsReason ?? false}
    onSave={onSaveFromClose}
    onDiscard={onDiscard}
    on:close={() => showSaveChanges = false} />
{/if}
{#if attendeesPicks}
  <SelectNamesDialog title={$t`Select Attendees and Resources`} persons={attendeesPicks} label={$t`Required *=> Attendees who must attend the meeting`}
    on:ok={() => flow.setAttendees(attendeesPicks.contents)} on:close={() => $openSelectAttendees = null} />
{/if}
{#if $openSignatures == event}
  <SignaturesDialog identity={event.calendar?.inviteAs} on:close={() => $openSignatures = null} />
{/if}
<EditorToolDialogs {editor} bind:openedTool />

<script lang="ts" context="module">
  import type { Event } from "../../../logic/Calendar/Event";
  import { writable } from "svelte/store";

  export const openSelectAttendees = writable<Event | null>(null);
</script>

<script lang="ts">
  import type { PersonUID } from "../../../logic/Abstract/PersonUID";
  import { UserError } from "../../../logic/util/util";
  import { EventEditFlow, type SeriesChoice } from "./EventEditFlow";
  import { EventTimeEditor } from "./EventTimeEditor";
  import { eventTabLabel, eventInfoMessages, type InfoMessage } from "./EventFormInfo";
  import EventFormRibbon from "./EventFormRibbon.svelte";
  import EventForm from "./EventForm.svelte";
  import InvitationInCalendar from "../Invitation/InvitationInCalendar.svelte";
  import TrackingView from "./TrackingView.svelte";
  import RecurrenceDialog, { openRecurrence } from "./RecurrenceDialog.svelte";
  import SeriesChoiceDialog from "./SeriesChoiceDialog.svelte";
  import SaveChangesDialog from "./SaveChangesDialog.svelte";
  import SchedulingAssistant from "./SchedulingAssistant.svelte";
  import SelectNamesDialog from "../../Mail/Composer/SelectNamesDialog.svelte";
  import SignaturesDialog, { openSignatures } from "../../Mail/Composer/SignaturesDialog.svelte";
  import { EditorTool } from "../../Shared/Editor/EditorTool";
  import EditorToolDialogs from "../../Shared/Editor/EditorToolDialogs.svelte";
  import UndoRedoButtons from "../../Shared/Editor/UndoRedoButtons.svelte";
  import { shownCalendarEvents } from "../../../frontend/Calendar/selected";
  import { catchErrors } from "../../../frontend/Util/error";
  import { getOSName } from "../../../frontend/Util/util";
  import CloseIcon from "lucide-svelte/icons/x";
  import type { Editor } from "@tiptap/core";
  import { onMount } from "svelte";
  import { ArrayColl } from "svelte-collections";
  import { openComposer } from "../../../frontend/Mail/open";
  import { IncomingInvitation } from "../../../logic/Calendar/Invitation/IncomingInvitation";
  import { t } from "../../../l10n/l10n";

  export let event: Event;

  event.startEditing();
  const flow = new EventEditFlow(event);
  const timeEditor = new EventTimeEditor(event);
  const schedulingLabel = $t`Scheduling Assistant`;
  const trackingLabel = $t`Tracking *=> Ribbon tab with the responses of the attendees`;

  let editor: Editor = null;
  let openedTool: EditorTool | null = null;
  let showEmojis = false;
  let isSchedulingSelected = false;
  let isTrackingSelected = false;
  let showSaveChanges = false;
  let seriesChoice: {
    title: string,
    okLabel: string,
    choices: SeriesChoice[],
    onChoose: (choice: SeriesChoice) => Promise<void>,
  } = null;

  $: participants = event.participants;
  $: parentEvent = $event.parentEvent;
  $: calendar = $event.calendar;
  $: isMeeting = $participants.hasItems;
  $: isIncoming = $event.isIncomingMeeting;
  $: isSaved = $event && flow.isSaved;
  $: isSent = isMeeting && $event.isOutgoingMeeting && isSaved;
  $: ribbonKey = `${isMeeting}-${isSent}-${isIncoming}`;
  $: kindLabel = $event && $participants && eventTabLabel(event);
  $: isSent, isIncoming, isSchedulingSelected = isTrackingSelected = false;
  $: showScheduling = !isIncoming && isSchedulingSelected;
  $: showTracking = isSent && isTrackingSelected;
  $: showsEditor = !isIncoming && !showScheduling && !showTracking;
  $: $event, $participants, $parentEvent, $shownCalendarEvents, updateState(editor);
  $: sendLabel = isSaved ? $t`Send Update` : $t`Send`;
  $: sendDisabled = saveDisabled || (isSaved && !hasChanges ? $t`There are no changes to send` : false);
  $: saveChangesText = changesText(isMeeting, isSaved);

  let messages: InfoMessage[] = [];
  let hasChanges = false;
  let saveDisabled: string | false = false;
  function updateState(_editor: Editor) {
    messages = eventInfoMessages(event, shownCalendarEvents.contents, new Date(), flow.pattern);
    hasChanges = flow.hasChanges;
    saveDisabled = flow.missingPropsReason ?? false;
  }

  onMount(() => {
    if (event.isNew && event.recurrenceRule && !event.parentEvent) {
      $openRecurrence = event;
    }
  });

  function changesText(isMeeting: boolean, isSaved: boolean) {
    if (isMeeting && !isSaved) {
      return { question: $t`This meeting invitation has not been sent yet. Do you want to send it now?`, save: $t`Send`, discard: $t`Don't Send` };
    } else if (isMeeting) {
      return { question: $t`Do you want to send an update with your changes to the attendees?`, save: $t`Send Update`, discard: $t`Discard Changes` };
    }
    return { question: $t`Do you want to save changes?`, save: $t`Save`, discard: $t`Don't Save` };
  }

  async function onSave() {
    let reason = flow.missingPropsReason;
    if (reason) {
      throw new UserError(reason);
    }
    if (flow.needsSeriesChoice) {
      seriesChoice = {
        title: flow.isMeeting ? $t`Recurring Meeting` : $t`Recurring Appointment`,
        okLabel: flow.willSend ? $t`Send` : $t`Save`,
        choices: flow.seriesChoices(),
        onChoose: choice => flow.saveWith(choice),
      };
      return;
    }
    if (!flow.hasChanges || !flow.canSaveSingle) {
      flow.cancel();
      return;
    }
    await flow.save();
  }

  async function onSaveFromClose() {
    showSaveChanges = false;
    await onSave();
  }

  function onDiscard() {
    showSaveChanges = false;
    flow.cancel();
  }

  async function onDelete() {
    if (event.isNew && !event.parentEvent) {
      flow.cancel();
    } else if (event.isOutgoingMeeting && !event.isCancelled && flow.isSaved) {
      await flow.cancelMeeting();
    } else {
      await flow.deleteIt();
    }
  }

  let attendeesPicks: ArrayColl<PersonUID> = null;
  $: pickAttendees($openSelectAttendees);
  function pickAttendees(pickedEvent: Event | null) {
    attendeesPicks = pickedEvent == event ? new ArrayColl<PersonUID>(flow.attendees) : null;
  }

  function onRecurrenceClosed() {
    $openRecurrence = null;
    event.notifyObservers();
  }

  function onCloseRequest() {
    if (!isIncoming && flow.hasChanges) {
      showSaveChanges = true;
      return;
    }
    flow.cancel();
  }

  async function onKey(keyEvent: KeyboardEvent) {
    if (keyEvent.defaultPrevented || $openRecurrence == event || showSaveChanges || seriesChoice || attendeesPicks || openedTool || $openSignatures == event) {
      return;
    }
    let key = keyEvent.key.toLowerCase();
    if (keyEvent.key == "Escape") {
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      onCloseRequest();
      return;
    }
    // Alt+ (Option+S types a character on macOS)
    if (keyEvent.altKey && !keyEvent.ctrlKey && getOSName() != "macintosh") {
      if (keyEvent.code == "KeyS" && !isIncoming) {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        await onSave();
        return;
      }
    }
    // Ctrl+
    if (keyEvent.ctrlKey && !keyEvent.altKey) {
      if (key == "g" && !isIncoming) {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        $openRecurrence = event;
        return;
      } else if (key == "d" && !event.parentEvent) {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        await onDelete();
        return;
      } else if (key == "f" && flow.isSaved) {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        openComposer(await IncomingInvitation.forwardEventByMail(event));
        return;
      }
    }
    if (showsEditor && editor) {
      onKeyOnEditor(keyEvent);
    }
  }

  // <copied from="../../Mail/Composer/MailComposer.svelte">
  function onKeyOnEditor(event: KeyboardEvent) {
    let isCtrl = event.ctrlKey || event.metaKey;
    // Ctrl+ (or Cmd+)
    if (isCtrl && !event.altKey && !event.shiftKey) {
      if (event.code == "KeyK") {
        event.preventDefault();
        event.stopPropagation();
        openedTool = EditorTool.Link;
        return;
      } else if (event.code == "KeyH") {
        event.preventDefault();
        event.stopPropagation();
        openedTool = EditorTool.Replace;
        return;
      }
    }
    // No modifier
    if (!isCtrl && !event.altKey && !event.shiftKey) {
      if (event.key == "F4") {
        event.preventDefault();
        event.stopPropagation();
        openedTool = EditorTool.Find;
        return;
      }
    }
  }
  // </copied>
</script>

<style>
  .event-form-page {
    min-height: 0;
  }
  .form-card {
    min-height: 0;
    margin: 0 8px 8px 8px;
    overflow: hidden;
  }
  .form-card :global(.container),
  .form-card :global(.container > .content) {
    min-height: 0;
  }
  .title-row {
    flex-shrink: 0;
    align-items: center;
    gap: 16px;
    padding: 10px 12px 2px 24px;
  }
  h1 {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-size: var(--lo-font-size-large);
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .kind {
    margin-inline-start: 4px;
    font-weight: normal;
    color: var(--lo-fg-secondary);
  }
  .calendar-name {
    flex-shrink: 0;
    align-items: center;
    gap: 6px;
    font-size: var(--lo-font-size-small);
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg-secondary);
    cursor: pointer;
  }
  .close:hover {
    background-color: var(--lo-danger);
    color: var(--lo-danger-fg);
  }
</style>
