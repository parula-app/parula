<vbox flex class="header">
  <Stack>
    <hbox class="title-background" style="--header-color: {newCalendar.color}" />
    <hbox class="window-title-bar">
      <hbox class="buttons">
        {#if !isFullWindow}
          <RoundButton
            label={$t`Expand dialog size to full window`}
            icon={ExpandDialogIcon}
            onClick={onExpandToWindow}
            classes="plain expand"
            border={false}
            iconSize="16px"
            />
        {/if}
        {#if $event.recurrenceCase == RecurrenceCase.Instance}
          <ButtonMenu bind:isMenuOpen={isDeleteSeriesOpen}>
            <RoundButton
              slot="control"
              label={$t`Delete event`}
              icon={DeleteIcon}
              onClick={() => isDeleteSeriesOpen = !isDeleteSeriesOpen}
              classes="plain delete"
              border={false}
              iconSize="16px"
              />

            {#if !event.isIncomingMeeting}
              <MenuItem
                label={$t`Delete only this instance`}
                onClick={onDelete}
                classes="font-normal" />
              {#if $event.seriesStatus == "middle"}
                <MenuItem
                  label={$t`Delete remainder of series`}
                  onClick={onDeleteRemainder}
                  classes="font-normal" />
              {/if}
            {/if}
            <MenuItem
              label={$t`Delete entire series`}
              onClick={onDeleteAll}
              classes="font-normal" />
          </ButtonMenu>
        {:else}
          <RoundButton
            label={$t`Delete event`}
            icon={DeleteIcon}
            onClick={onDelete}
            disabled={!event.dbID && !event.parentEvent}
            classes="plain delete"
            border={false}
            iconSize="16px"
            />
        {/if}
      </hbox>
      <!--<hbox class="account-icon">
        <hbox class="account-icon-dummy">
          <Button icon={AccountIcon} />
        </hbox>
      </hbox>-->
      <hbox class="account-selector">
        <!-- Moving events has too many bugs. #1277 and many others. Fix them first.
        <AccountDropDown
          selectedAccount={newCalendar}
          accounts={appGlobal.calendars}
          filterByWorkspace={false}
          on:select={(event) => catchErrors(() => onChangeCalendar(event.detail))} />
        -->
        {newCalendar.name}
      </hbox>
      <hbox flex class="spacer" />
      <hbox class="buttons">
        {#if isFullWindow}
          <RoundButton
            label={$t`Shrink dialog to sidebar`}
            icon={ShrinkDialogIcon}
            onClick={onShrink}
            classes="plain"
            border={false}
            iconSize="16px"
            />
        {/if}
        {#if canSaveSingle || canSaveSeries}
          <RoundButton
            label={$t`Revert`}
            icon={RevertIcon}
            onClick={onCancel}
            classes="plain save-or-close"
            iconSize="16px"
            />
          {#if canSaveSeries}
            <ButtonMenu bind:isMenuOpen={isSaveSeriesOpen}>
              <RoundButton
                slot="control"
                label={willSend ? $t`Send invitation` : $t`Save`}
                icon={willSend ? SendIcon : SaveIcon}
                onClick={() => isSaveSeriesOpen = !isSaveSeriesOpen}
                classes="plain save-or-close"
                filled={true}
                iconSize="16px"
                />

              {#if canSaveSingle}
                <MenuItem
                  label={$t`Change only this instance`}
                  onClick={onSaveException}
                  classes="font-normal" />
              {/if}
              {#if $event.seriesStatus == "middle"}
                <MenuItem
                  label={$t`Change remainder of series`}
                  onClick={onChangeRemainder}
                  classes="font-normal" />
              {/if}
              <MenuItem
                label={$t`Change entire series`}
                onClick={onChangeAll}
                classes="font-normal" />
            </ButtonMenu>
          {:else}
            <RoundButton
              label={willSend ? $t`Send invitation` : $t`Save`}
              icon={willSend ? SendIcon : SaveIcon}
              onClick={onSave}
              classes="plain save-or-close"
              filled={true}
              iconSize="16px"
              />
          {/if}
        {:else}
          <RoundButton
            label={$t`Cancel`}
            icon={CloseIcon}
            onClick={onCancel}
            classes="plain save-or-close"
            iconSize="16px"
            />
        {/if}
      </hbox>
    </hbox>
  </Stack>
</vbox>

<script lang="ts">
  import { type Event, RecurrenceCase } from "../../../logic/Calendar/Event";
  import { Calendar } from "../../../logic/Calendar/Calendar";
  import { Account } from "../../../logic/Abstract/Account";
  import { CalendarEventMustangApp, calendarMustangApp } from "../CalendarMustangApp";
  import { selectedEvent, selectedCalendar } from "../selected";
  import { openApp, selectedApp, goBack } from "../../AppsBar/selectedApp";
  import { appGlobal } from "../../../logic/app";
  import Stack from "../../Shared/Stack.svelte";
  import AccountDropDown from "../../Shared/AccountDropDown.svelte";
  import ButtonMenu from "../../Shared/Menu/ButtonMenu.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import Button from "../../Shared/Button.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import AccountIcon from "lucide-svelte/icons/user-round";
  import ExpandDialogIcon from "lucide-svelte/icons/chevrons-left";
  import ShrinkDialogIcon from "lucide-svelte/icons/chevrons-right";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import SaveIcon from "lucide-svelte/icons/check";
  import SendIcon from "lucide-svelte/icons/send";
  import CloseIcon from "lucide-svelte/icons/x";
  import RevertIcon from "lucide-svelte/icons/undo-2";
  import { catchErrors } from "../../Util/error";
  import { t } from "../../../l10n/l10n";

  export let event: Event;

  let newCalendar = event.calendar; // Don't listen to $event #730
  $: hasMinimalProps = event && $event.title && $event.startTime && $event.endTime &&
      event.startTime.getTime() <= event.endTime.getTime();
  $: hasMinimalPropsChanged = hasMinimalProps && $event.hasChanged();
  $: parentEvent = $event.parentEvent;
  $: canSaveSeries = hasMinimalPropsChanged && $event.recurrenceCase == RecurrenceCase.Instance ||
    $parentEvent?.hasChanged();
  $: canSaveSingle = hasMinimalPropsChanged || // Single changed
    hasMinimalProps && event.recurrenceRule && !event.parentEvent || // Change single event into series
    newCalendar != event.calendar;
  $: participants = event.participants;
  $: willSend = $participants.hasItems && !$event.isIncomingMeeting;
  $: isFullWindow = $selectedApp instanceof CalendarEventMustangApp;
  let isSaveSeriesOpen = false;
  let isDeleteSeriesOpen = false;

  $: updateEvent(event) // #730
  let prevEventID = event.id;
  function updateEvent(event: Event) {
    if (event.id == prevEventID) {
      return;
    }
    prevEventID = event.id;

    // Runs when a different event loaded
    newCalendar = event.calendar;
  };

  function confirmAndChangeRecurrenceRule(): boolean {
    let master = event.parentEvent || event;
    if (!master.recurrenceRule && master.unedited?.recurrenceRule) {
      if (!confirm($t`Are you sure you want to remove this unfortunate series of events?`)) {
        return false;
      }
    } else if (master.recurrenceRule && master.unedited?.recurrenceRule &&
        !master.unedited.recurrenceRule.timesMatch(master.recurrenceRule)) {
      if (!confirm($t`This change will remove all exceptions and exclusions for this series.`)) {
        return false;
      }
    }
    return true;
  }

  function onCancel() {
    event.cancelEditing();
    event.parentEvent?.cancelEditing(); // master, when recurrence was changed
    onClose(true);
  }

  async function onSave() {
    event.parentEvent?.cancelEditing();
    await saveEvent(event);
    onClose();
  }

  async function saveEvent(event: Event) {
    if (event.calendar != newCalendar && event.calendar && newCalendar) {
      // `moveToCalendar()` does the save and delete as well
      event = await event.moveToCalendar(newCalendar);
    } else {
      if (!event.calendar.events.contains(event)) {
        event.calendar.events.add(event);
      }
      await event.save();
    }
  }

  async function onChangeAll() {
    if (!confirmAndChangeRecurrenceRule()) {
      return;
    }
    let master = event.parentEvent;
    master.startEditing(); // #701
    master.copyEditableFieldsFrom(event);
    await master.save();
    master.finishEditing(); // #701
    onClose();
  }

  async function onChangeRemainder() {
    let master = event.calendar.newEvent();
    master.startEditing();
    master.copyEditableFieldsFrom(event);
    master.calUID = null;
    if (event.parentEvent.recurrenceRule) {
      let { frequency, interval, week, weekdays } = event.parentEvent.recurrenceRule;
      master.newRecurrenceRule(frequency, interval, week, weekdays);
    }
    await saveEvent(master);
    master.finishEditing();
    event.cancelEditing();
    event.parentEvent.cancelEditing();
    await event.truncateRecurrence();
    onClose();
  }

  async function onSaveException() {
    event.parentEvent?.cancelEditing();
    await saveEvent(event);
    onClose();
  }

  // <copied to="../DisplayEvent/DialogHeader.svelte">
  async function onDelete() {
    if (event.seriesStatus == "only") {
      await event.parentEvent.deleteIt();
    } else {
      event.parentEvent?.cancelEditing();
      await event.deleteIt();
    }
    onClose(true);
  }

  async function onDeleteAll() {
    if (!confirm($t`Are you sure you want to remove this unfortunate series of events?`)) {
      return;
    }
    let master = event.parentEvent;
    await master.deleteIt();
    onClose(true);
  }

  async function onDeleteRemainder() {
    event.cancelEditing();
    event.parentEvent.cancelEditing();
    await event.truncateRecurrence();
    onClose(true);
  }

  function onChangeCalendar(aCalendar: Account) {
    newCalendar = aCalendar as Calendar
    $selectedCalendar = newCalendar;
    // Will be applied during save
  }

  function onExpandToWindow() {
    calendarMustangApp.showEvent(event);
  }

  function onShrink() {
    // Only moves the dialog into the sidebar, where the user keeps editing
    calendarMustangApp.closeEvent(event);
    goBack();
  }

  /** @param deselect The user is done with the event, so drop it from the sidebar as
   * well. Not for `onSave()`, which leaves it there as display-only. */
  function onClose(deselect = false) {
    event.finishEditing();
    calendarMustangApp.closeEvent(event);
    if (deselect || !isFullWindow) {
      // Make sidebar disappear, see CalendarApp.svelte.
      // Clears our `event` prop, so this must come after the last use of it. #1365
      $selectedEvent = null;
    }
    if (isFullWindow) {
      goBack();
    }
  }
  // </copied>
</script>

<style>
  .header {
    height: 48px;
    color: white;
    margin-block-end: 8px;
    flex: none;
  }
  .title-background {
    background: var(--header-color);
    /* background image, in the account color
    background:
      linear-gradient(var(--header-color), var(--header-color)),
      linear-gradient(rgba(0, 0, 0, 0.2), rgba(0, 0, 0, 0.2)),
      url("../../asset/header-background.jpeg");
    background-blend-mode: multiply;
    background-repeat: repeat-x; */
  }
  /*  background-image: url("../../asset/header-background.jpeg");*/
  .buttons :global(button) {
    color: white;
  }
  .buttons :global(button.save-or-close) {
    border-color: white;
  }
  .buttons :global(.save-or-close path) {
    stroke-width: 3px;
  }

  .account-icon {
    margin-inline-start: 32px;
    margin-inline-end: 8px;
    align-self: end;
    position: relative;
    left: 0;
    top: 10px;
  }
  .account-selector {
    align-items: end;
    margin-inline-start: 6px;
    margin-block-end: 4px;
  }
  .account-icon-dummy {
    height: 24px;
    width: 24px;
    align-items: center;
    justify-content: center;
  }
  .account-icon-dummy :global(button:not(.add-specificity)) {
    background-color: white;
  }
  @container (max-width: 400px) {
    .account-icon {
      display: none;
    }
    .account-selector {
      max-width: 50px;
    }
    .buttons :global(.expand) {
      margin-inline-start: -4px;
    }
  }
  .buttons {
    align-items: center;
    padding: 8px;
  }
  .buttons :global(button) {
    margin-inline-start: 8px;
  }
  .buttons :global(button.delete) {
    background-color: lightsalmon;
  }
  .buttons :global(.menu .menuitem),
  .buttons :global(.menu .label) {
    color: unset;
  }
</style>
