<vbox flex class="calendar-app">
  <hbox flex>
    {#if $isCalendarListOpen}
      <CalendarList />
    {/if}
    <Splitter
      initialRightRatio={0.25}
      rightMinWidth={250}
      hasRight={!appGlobal.isMobile}
      >
      <vbox flex class="main" slot="left" class:mobile={$appGlobal.isMobile}>
        <MainView events={shownCalendarEvents} bind:start={$startDate} dateInterval={$dateIntervalSetting.value}>
          <hbox slot="top-left">
            {#if !$appGlobal.isMobile}
              <TitleBarLeft />
            {/if}
          </hbox>
          <TitleBarRight bind:dateInterval={$dateIntervalSetting.value} slot="top-right" />
        </MainView>
      </vbox>
      <vbox flex class="sidebar" slot="right">
        {#if $selectedEvent && !appGlobal.isMobile}
          <ShowEvent event={$selectedEvent} />
        {:else}
          <!--<TaskList />-->
        {/if}
      </vbox>
    </Splitter>
  </hbox>
  {#if $appGlobal.isMobile}
    <CalendarViewBarM />
  {/if}
</vbox>

<svelte:window on:keydown={(event) => catchErrors(() => onKeyOnCalendar(event))} />

<script lang="ts">
  import { isCalendarListOpen, selectedCalendar, selectedEvent, shownCalendarEvents, startDate, type DateInterval } from "./selected";
  import { appGlobal } from "../../logic/app";
  import CalendarList from "./CalendarList.svelte";
  import MainView from "./MainView.svelte";
  import CalendarViewBarM from "./MonthView/CalenderViewBarM.svelte";
  import TitleBarLeft from "./TitleBarLeft.svelte";
  import TitleBarRight from "./TitleBarRight.svelte";
  import ShowEvent from "./DisplayEvent/ShowEvent.svelte";
  import Splitter from "../Shared/Splitter.svelte";
  import { onKeyOnCalendar } from "./CalendarKeyboard";
  import { getLocalStorage } from "../Util/LocalStorage";
  import { catchErrors } from "../Util/error";

  $: if (!$selectedCalendar) { $selectedCalendar = appGlobal.calendars.first; }

  let dateIntervalSetting = getLocalStorage("calendar.view", 2 as DateInterval);
</script>

<style>
  .main {
    margin: 0px 16px 16px 16px;
  }
  .main :global(.range-header) {
    height: 58px;
    align-items: center;
  }
  .main.mobile {
    margin-inline-end: 0px;
  }
  .main.mobile :global(.range-header) {
    height: 36px;
  }
</style>
