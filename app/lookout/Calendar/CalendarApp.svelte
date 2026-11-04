<vbox flex class="calendar-page" bind:this={pageEl}>
  <CalendarRibbon bind:view bind:dayCount bind:currentView>
    {#if isSearch}
      <CalendarSearchTab organizers={searchOrganizers} hasSelectedCalendar={!!$selectedCalendar} />
    {/if}
  </CalendarRibbon>
  <hbox flex class="panes">
    {#if $folderPaneSetting.value == CalendarFolderPane.Minimized}
      <FolderPaneMinimized name={$currentCalendar?.name ?? $t`Calendar`}
        on:expand={() => { folderPaneSetting.value = CalendarFolderPane.Normal; }} />
    {/if}
    <Splitter name="lookout.calendar.folderPane" hasLeft={showFolderPane}
      initialRightRatio={5} leftMinWidth={230} rightMinWidth={480}>
      <vbox flex class="folder-pane" slot="left" bind:clientHeight={folderPaneHeight}>
        <DateNavigator {range} date={$startDate} {showWeekNumbers} monthCount={folderPaneHeight >= 760 ? 2 : 1}
          on:selectday={event => selectDay(event.detail)} on:selectweek={event => selectWeek(event.detail)}
          on:selectdays={event => selectDays(event.detail.first, event.detail.last)} />
        <hbox class="divider" />
        <CalendarList />
      </vbox>
      <hbox flex class="main-area" slot="right">
        <hbox flex class="reading-pane-layout">
          <SplitterBidirectional horizontal={readingPane == "bottom"}
            hasSecond={readingPane == "right" || readingPane == "bottom"}
            name={readingPane == "bottom" ? "lookout.calendar.readingPane.bottom" : "lookout.calendar.readingPane.right"}
            initialSecondRatio={readingPane == "bottom" ? 1.4 : 0.6}
            firstMinPx={readingPane == "bottom" ? 160 : 300}
            secondMinPx={readingPane == "bottom" ? 200 : 320}>
            <hbox flex class="part list" slot="first"
              class:top={readingPane == "bottom"}
              class:single={readingPane != "right" && readingPane != "bottom"}>
              <vbox flex class="main lo-card">
                {#if tableEvents}
                  <ListView events={tableEvents} />
                {:else if view == "dual"}
                  <DualView bind:start={$startDate} events={visibleEvents} {groups} on:slotmenu={openSlotMenu}>
                    <ViewSelector slot="top-right" bind:view bind:dayCount />
                  </DualView>
                {:else}
                  <DateRange bind:date={$startDate} {range}>
                    <ViewSelector bind:view bind:dayCount />
                  </DateRange>
                  <vbox flex class="grid-area">
                    {#if view == "month" && isSplit}
                      <hbox flex class="month-split">
                        {#each groups as group, g (group.calendar.id)}
                          <vbox flex class="month-column">
                            <div class="month-tab">
                              <CalendarTab calendar={group.calendar} firstColumn={1} span={1}
                                isFirst={g == 0} />
                            </div>
                            <MonthView {range} events={group.events} on:openday={event => openDay(event.detail)} on:slotmenu={openSlotMenu} />
                          </vbox>
                        {/each}
                      </hbox>
                    {:else if view == "month"}
                      <MonthView {range} events={visibleEvents} on:openday={event => openDay(event.detail)} on:slotmenu={openSlotMenu} />
                    {:else if view == "schedule"}
                      <ScheduleView {range} rows={scheduleRows} on:slotmenu={openSlotMenu} />
                    {:else}
                      <DayViewGrid {range} {groups} on:openday={event => openDay(event.detail)} on:slotmenu={openSlotMenu} />
                    {/if}
                    {#if view != "schedule"}
                      <AdjacentEventTabs {range} events={visibleEvents} isRangeEmpty={!$eventsInRange.length} startOffset={view == "month" ? 0 : 56} />
                    {/if}
                  </vbox>
                {/if}
              </vbox>
            </hbox>
            <hbox flex class="part reading" slot="second"
              class:right={readingPane == "right"}
              class:bottom={readingPane == "bottom"}>
              <DisplayEvent event={$selectedEvent} />
            </hbox>
          </SplitterBidirectional>
        </hbox>
      </hbox>
    </Splitter>
  </hbox>

  <SlotMenu bind:this={slotMenu} bind:view bind:dayCount />
  {#if $isGoToDateOpen}
    <GoToDateDialog date={rangeDate} {view}
      on:choose={event => goToDate(event.detail.date, event.detail.view)} on:close={() => $isGoToDateOpen = false} />
  {/if}
  {#if $openCalendarProperties}
    {#key $openCalendarProperties}
      <CalendarPropertiesDialog calendar={$openCalendarProperties.calendar} tab={$openCalendarProperties.tab}
        on:close={() => $openCalendarProperties = null} />
    {/key}
  {/if}
  {#if $openSharedCalendar}
    <OpenCalendarDialog fromAddressBook={$openSharedCalendar.fromAddressBook} on:close={() => $openSharedCalendar = null} />
  {/if}
  {#if $eventPeek}
    {#key $eventPeek}
      <EventPeek event={$eventPeek.event} anchor={$eventPeek.anchor} />
    {/key}
  {/if}
</vbox>

<svelte:window on:keydown={(event) => catchErrors(() => onKeyOnCalendar(event))} />

<script lang="ts">
  import type { Event } from "../../logic/Calendar/Event";
  import { InvitationResponse } from "../../logic/Calendar/Invitation/InvitationStatus";
  import { CalendarRange } from "./CalendarRange";
  import { CalendarActions } from "./CalendarActions";
  import { openEvent } from "../../frontend/Calendar/open";
  import { openComposer } from "../../frontend/Mail/open";
  import { IncomingInvitation } from "../../logic/Calendar/Invitation/IncomingInvitation";
  import { eventPeek, inlineTitle, selectedSlots, updatingCount, CalendarCurrentView, CalendarFolderPane, calendarSearchOptions, listedEvents, allListedEvents, CalendarSearchScope, type CalendarViewType, type SlotSelection } from "./selected";
  import { selectedCalendar, selectedDate, selectedEvent, shownCalendars, shownCalendarEvents, startDate } from "../../frontend/Calendar/selected";
  import { appGlobal } from "../../logic/app";
  import { getToday } from "../../logic/util/date";
  import { getLocalStorage } from "../../frontend/Util/LocalStorage";
  import { getOSName } from "../../frontend/Util/util";
  import { getKeyDigit, isTextField } from "../Util/util";
  import { catchErrors } from "../../frontend/Util/error";
  import { statusBarContent, type StatusBarContent } from "../MainWindow/StatusBar.svelte";
  import CalendarRibbon from "./CalendarRibbon.svelte";
  import DateNavigator from "./DateNavigator.svelte";
  import CalendarList from "./CalendarList.svelte";
  import FolderPaneMinimized from "../Shared/FolderPaneMinimized.svelte";
  import DateRange from "./DateRange.svelte";
  import ViewSelector from "./ViewSelector.svelte";
  import DualView from "./DualView.svelte";
  import DayViewGrid, { type CalendarColumnGroup } from "./DayView/DayViewGrid.svelte";
  import MonthView from "./MonthView/MonthView.svelte";
  import CalendarTab from "./DayView/CalendarTab.svelte";
  import ScheduleView from "./ScheduleView/ScheduleView.svelte";
  import EventPeek from "./DisplayEvent/EventPeek.svelte";
  import DisplayEvent from "./DisplayEvent/DisplayEvent.svelte";
  import type { ReadingPanePosition } from "../Mail/3pane/3Pane.svelte";
  import SlotMenu from "./SlotMenu.svelte";
  import GoToDateDialog, { isGoToDateOpen } from "./GoToDateDialog.svelte";
  import CalendarPropertiesDialog, { openCalendarProperties } from "./CalendarPropertiesDialog.svelte";
  import OpenCalendarDialog, { openSharedCalendar } from "./OpenCalendarDialog.svelte";
  import AdjacentEventTabs from "./AdjacentEventTabs.svelte";
  import ListView from "./ListView/ListView.svelte";
  import CalendarSearchTab from "./ListView/CalendarSearchTab.svelte";
  import { eventOrganizers } from "./ListView/CalendarSearch";
  import Splitter from "../../frontend/Shared/Splitter.svelte";
  import SplitterBidirectional from "../../frontend/Shared/SplitterBidirectional.svelte";
  import { globalSearchTerm } from "../../frontend/AppsBar/selectedApp";
  import type { ArrayColl, Collection } from "svelte-collections";
  import { onDestroy } from "svelte";
  import { get } from "svelte/store";
  import { t } from "../../l10n/l10n";

  const viewSetting = getLocalStorage<CalendarViewType>("lookout.calendar.view", "workweek");
  const currentViewSetting = getLocalStorage<CalendarCurrentView>("lookout.calendar.currentView", CalendarCurrentView.Calendar);
  const dayCountSetting = getLocalStorage<number>("lookout.calendar.dayCount", 1);
  let view = viewSetting.value;
  let currentView = currentViewSetting.value;
  let dayCount = dayCountSetting.value;
  $: viewSetting.value = view;
  $: currentViewSetting.value = currentView;
  $: dayCountSetting.value = dayCount;
  const weekNumbersSetting = getLocalStorage<boolean>("lookout.calendar.weekNumbers", false);
  const showDeclinedSetting = getLocalStorage<boolean>("lookout.calendar.showDeclined", true);
  $: showWeekNumbers = $weekNumbersSetting.value;
  $: showDeclined = $showDeclinedSetting.value;
  const splitViewSetting = getLocalStorage<boolean>("lookout.calendar.splitView", false);
  const readingPaneSetting = getLocalStorage<ReadingPanePosition>("lookout.calendar.readingPane", "off");
  $: readingPane = $readingPaneSetting.value ?? "off";
  $: splitView = $splitViewSetting.value;
  const folderPaneSetting = getLocalStorage<CalendarFolderPane>("lookout.calendar.folderPaneMode", CalendarFolderPane.Normal);
  $: showFolderPane = ($folderPaneSetting.value ?? CalendarFolderPane.Normal) == CalendarFolderPane.Normal;

  let folderPaneHeight = 0;
  let slotMenu: SlotMenu;
  let pageEl: HTMLElement;

  $: if (!$selectedCalendar) {
    $selectedCalendar = appGlobal.calendars.first;
  }
  $: currentCalendar = $selectedCalendar;

  let shownView = view;
  let shownDayCount = dayCount;
  let shownCurrentView = currentView;
  $: view, dayCount, currentView, showView();

  $: rangeDate = view == "dual" ? $selectedDate : $startDate;
  $: range = new CalendarRange(view, rangeDate, view == "day" || view == "schedule" ? dayCount : 1);
  // $: range = new CalendarRange(view, rangeDate, view == "day" || view == "schedule" ? dayCount : 1, $workWeekHours.workDays());

  const withoutDeclined = new Map<Collection<Event>, Collection<Event>>();
  function visible(events: Collection<Event>, showDeclined: boolean): Collection<Event> {
    if (showDeclined) {
      return events;
    }
    let notDeclined = withoutDeclined.get(events);
    if (!notDeclined) {
      notDeclined = events.filterObservable(event => event.myParticipation != InvitationResponse.Decline);
      withoutDeclined.set(events, notDeclined);
    }
    return notDeclined;
  }

  $: visibleEvents = visible(shownCalendarEvents, showDeclined);
  $: isSplit = splitView && view != "schedule" && $shownCalendars.length > 1;
  $: scheduleRows = $shownCalendars.contents.map(calendar => ({ calendar, events: visible(calendar.eventsWithRecurrences, showDeclined) })) as CalendarColumnGroup[];
  let groups: CalendarColumnGroup[] = [];
  $: showGroups(isSplit ? scheduleRows : [{ calendar: null, events: visibleEvents }]);
  function showGroups(shown: CalendarColumnGroup[]) {
    if (shown.length == groups.length && shown.every((group, i) => group.calendar == groups[i].calendar && group.events == groups[i].events)) {
      return;
    }
    groups = shown;
  }

  $: eventsInRange = visibleEvents.filterObservable(isInRange);
  $: range, filterRange();
  function filterRange() {
    eventsInRange.replaceAll(visibleEvents.contents.filter(isInRange));
  }

  function isInRange(event: Event): boolean {
    return event.startTime < range.end && event.endTime > range.start;
  }

  $: searchTerm = $globalSearchTerm?.trim() || null;
  $: isSearch = !!searchTerm;
  let foundEvents: ArrayColl<Event> = null;
  let organizerEvents: ArrayColl<Event> = null;
  $: searchTerm, $calendarSearchOptions, $selectedCalendar, findEvents();
  $: searchResults = searchTerm ? organizerEvents : null;
  $: searchOrganizers = searchTerm ? eventOrganizers($foundEvents.contents) : [];
  let upcomingEvents: ArrayColl<Event> = null;
  $: listEvents = currentView == CalendarCurrentView.List ? listedEvents
    : currentView == CalendarCurrentView.Active ? findUpcomingEvents()
    : null;
  $: tableEvents = searchResults ?? listEvents;
  $: isTable = currentView == CalendarCurrentView.List || currentView == CalendarCurrentView.Active;

  let status: StatusBarContent;
  $: status = {
    left: [ { label: $t`Items: ${tableEvents ? $tableEvents.length : $eventsInRange.length}` } ],
    right: $updatingCount ? [ { label: $t`Updating calendars…`, busy: true } ] : [],
    views: [],
  };
  // <copied from="../Mail/MailApp.svelte">
  $: $statusBarContent = status;
  onDestroy(() => {
    if (get(statusBarContent) == status) {
      statusBarContent.set(null);
    }
  });
  // </copied>

  function showView() {
    if (view == shownView && dayCount == shownDayCount && currentView == shownCurrentView) {
      return;
    }
    if (view == "dual" && shownView != "dual") {
      let shownRange = new CalendarRange(shownView, $startDate, shownView == "day" || shownView == "schedule" ? shownDayCount : 1);
      // let shownRange = new CalendarRange(shownView, $startDate, shownView == "day" || shownView == "schedule" ? shownDayCount : 1, $workWeekHours.workDays());
      if (!shownRange.contains($selectedDate)) {
        $selectedDate = $startDate;
      }
    } else if (shownView == "dual" && view != "dual" && view != "month") {
      $startDate = $selectedDate;
    }
    $eventPeek = null;
    if (isSearch) {
      closeSearch();
    }
    shownView = view;
    shownDayCount = dayCount;
    shownCurrentView = currentView;
  }

  function setView(newView: CalendarViewType) {
    if (newView == "day" || newView == "schedule") {
      dayCount = 1;
    }
    view = newView;
    $eventPeek = null;
    showCalendar();
  }

  function findEvents() {
    if (!searchTerm) {
      return;
    }
    foundEvents ??= allListedEvents.filterObservable(isFound);
    organizerEvents ??= foundEvents.filterObservable(isFromOrganizer);
    foundEvents.replaceAll(allListedEvents.contents.filter(isFound));
    organizerEvents.replaceAll(foundEvents.contents.filter(isFromOrganizer));
  }

  function isFound(event: Event): boolean {
    let options = $calendarSearchOptions;
    return !!searchTerm && event.matchesSearch(searchTerm.toLowerCase()) &&
      (options.scope != CalendarSearchScope.CurrentFolder || !$selectedCalendar || event.calendar == $selectedCalendar) &&
      (!options.isRecurring || !!event.recurrenceRule) &&
      (!options.hasAttachments || event.attachments.hasItems);
  }

  function isFromOrganizer(event: Event): boolean {
    let organizerEMail = $calendarSearchOptions.organizerEMail;
    return !organizerEMail || event.organizer?.emailAddress == organizerEMail;
  }

  function findUpcomingEvents(): ArrayColl<Event> {
    upcomingEvents ??= listedEvents.filterObservable(event => event.isUpcoming());
    upcomingEvents.replaceAll(listedEvents.contents.filter(event => event.isUpcoming()));
    return upcomingEvents;
  }

  // <copied to="CalendarRibbon.svelte">
  function showCalendar() {
    if (isTable) {
      currentView = CalendarCurrentView.Calendar;
    } else if (isSearch) {
      closeSearch();
    }
  }
  // </copied>

  // <copied to="ListView/CalendarSearchTab.svelte, CalendarRibbon.svelte">
  function closeSearch() {
    $globalSearchTerm = null;
    $calendarSearchOptions = { scope: $calendarSearchOptions.scope, isRecurring: false, hasAttachments: false, organizerEMail: null };
  }
  // </copied>

  function goToToday() {
    $startDate = getToday();
    $selectedDate = getToday();
    showCalendar();
  }

  function step(direction: number) {
    $eventPeek = null;
    setRangeDate(CalendarRange.step(view, rangeDate, dayCount, direction));
  }

  function setRangeDate(date: Date) {
    if (view == "dual") {
      $selectedDate = date;
    } else {
      $startDate = date;
    }
  }

  function selectDay(day: Date) {
    $startDate = day;
    $selectedDate = day;
    showCalendar();
  }

  function selectWeek(firstDay: Date) {
    selectDay(firstDay);
    setView("week");
  }

  function selectDays(first: Date, last: Date) {
    selectDay(first);
    view = "day";
    dayCount = Math.round((last.getTime() - first.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  }

  function openDay(day: Date) {
    selectDay(day);
    setView("day");
  }

  function openSlotMenu(event: CustomEvent<{ slots: SlotSelection, mouseEvent: MouseEvent }>) {
    slotMenu.openFor(event.detail.mouseEvent);
  }

  function openGoToDate() {
    $isGoToDateOpen = true;
  }

  function goToDate(date: Date, newView: CalendarViewType) {
    selectDay(date);
    setView(newView);
  }

  async function onKeyOnCalendar(event: KeyboardEvent) {
    let target = event.target as HTMLElement;
    if (event.defaultPrevented || !pageEl?.contains(target) && target != document.body ||
        isTextField(target) || target?.closest?.("dialog")) {
      return;
    }
    let calendarEvent = $selectedEvent;
    let isCtrl = event.ctrlKey || event.metaKey;
    let key = event.key.length == 1 ? event.key.toLowerCase() : event.key;
    let digit = getKeyDigit(event);
    // Ctrl+Alt+
    if (isCtrl && event.altKey && !event.shiftKey) {
      const kViews: CalendarViewType[] = [null, "day", "workweek", "week", "month", "schedule"];
      let newView = kViews[digit ?? 0];
      if (newView) {
        event.preventDefault();
        event.stopPropagation();
        setView(newView);
        return;
      } else if (key == "ArrowRight" || key == "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        step(key == "ArrowRight" ? 1 : -1);
        return;
      }
    }
    // Ctrl+Shift+
    if (isCtrl && event.shiftKey && !event.altKey) {
      if (key == "a") {
        event.preventDefault();
        event.stopPropagation();
        CalendarActions.newEventAtSelection(null);
        return;
      } else if (key == "q") {
        event.preventDefault();
        event.stopPropagation();
        CalendarActions.newEventAtSelection(null, "meeting");
        return;
      }
    }
    // Ctrl+ (or Cmd+)
    if (isCtrl && !event.altKey && !event.shiftKey) {
      if (key == "n") {
        event.preventDefault();
        event.stopPropagation();
        CalendarActions.newEventAtSelection(null);
        return;
      } else if (key == "g") {
        event.preventDefault();
        event.stopPropagation();
        openGoToDate();
        return;
      } else if (key == "f") {
        event.preventDefault();
        event.stopPropagation();
        if (calendarEvent && !calendarEvent.isCancelled) {
          openComposer(await IncomingInvitation.forwardEventByMail(calendarEvent));
        }
        return;
      } else if (key == "ArrowRight" || key == "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        setRangeDate(new Date(rangeDate.getFullYear(), rangeDate.getMonth(), rangeDate.getDate() + (key == "ArrowRight" ? 1 : -1)));
        return;
      }
    }
    // Alt+ (or Option+)
    if (event.altKey && !isCtrl && !event.shiftKey) {
      if (key == "ArrowDown" || key == "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setRangeDate(new Date(rangeDate.getFullYear(), rangeDate.getMonth(), rangeDate.getDate() + (key == "ArrowDown" ? 7 : -7)));
        return;
      } else if (key == "PageDown" || key == "PageUp") {
        event.preventDefault();
        event.stopPropagation();
        $startDate = new Date($startDate.getFullYear(), $startDate.getMonth() + (key == "PageDown" ? 1 : -1), 1);
        return;
      } else if (key == "Home" || key == "End") {
        event.preventDefault();
        event.stopPropagation();
        selectDay(CalendarRange.weekEdge($selectedDate, key == "End"));
        return;
      }
    }
    // Alt+ (Option+ types characters on macOS)
    if (event.altKey && !isCtrl && getOSName() != "macintosh") {
      if (event.shiftKey) {
        if (event.code == "KeyY") {
          event.preventDefault();
          event.stopPropagation();
          goToToday();
          return;
        }
      } else if (digit != null) {
        event.preventDefault();
        event.stopPropagation();
        setView("day");
        dayCount = digit == 0 ? 10 : digit;
        return;
      } else if (key == "-") {
        event.preventDefault();
        event.stopPropagation();
        setView("week");
        return;
      } else if (key == "=") {
        event.preventDefault();
        event.stopPropagation();
        setView("month");
        return;
      }
    }
    // No modifier
    if (!isCtrl && !event.altKey && !event.shiftKey) {
      if (key == "Enter" && !target?.closest?.("button, a")) {
        event.preventDefault();
        event.stopPropagation();
        if (calendarEvent) {
          $eventPeek = null;
          openEvent(calendarEvent, true);
        }
        return;
      } else if (key == "Delete") {
        event.preventDefault();
        event.stopPropagation();
        if (calendarEvent) {
          $eventPeek = null;
          await CalendarActions.deleteDefault(calendarEvent);
        }
        return;
      } else if (key == "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (isSearch) {
          closeSearch();
        }
        $eventPeek = null;
        $inlineTitle = null;
        $selectedSlots = null;
        return;
      }
    }
    if ($selectedSlots && event.key.length == 1 && event.key != " " && !isCtrl && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      $eventPeek = null;
      $inlineTitle = event.key;
    }
  }
</script>

<style>
  .calendar-page {
    min-height: 0;
  }
  .panes {
    min-height: 0;
  }
  .folder-pane {
    min-height: 0;
    overflow-y: auto;
    padding-inline-start: 4px;
  }
  .divider {
    flex: none;
    height: 1px;
    margin: 4px 12px;
    background-color: var(--lo-divider);
  }
  .month-split {
    gap: 8px;
    min-height: 0;
  }
  .month-column {
    min-width: 0;
    min-height: 0;
  }
  .month-tab {
    display: grid;
    grid-template-columns: 1fr;
    padding-inline: 4px;
  }
  .grid-area {
    position: relative;
    min-height: 0;
  }
  .main-area {
    min-width: 0;
    min-height: 0;
  }
  .main {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  /* <copied from="../Mail/3pane/3Pane.svelte"> */
  .reading-pane-layout {
    min-width: 0;
    min-height: 0;
  }
  .reading-pane-layout > :global(.splitter) {
    flex: 1 0 0;
    min-width: 0;
  }
  .part {
    min-width: 0;
    min-height: 0;
    height: 100%;
    box-sizing: border-box;
  }
  .list {
    padding: 0 4px 8px 0;
  }
  .list.single {
    padding-inline-end: 8px;
  }
  .list.top {
    padding: 0 8px 4px 0;
  }
  .reading.right {
    padding: 0 8px 8px 4px;
  }
  .reading.bottom {
    padding: 4px 8px 8px 0;
  }
  .part :global(> *) {
    flex: 1 0 0;
  }
  /* </copied> */
</style>
