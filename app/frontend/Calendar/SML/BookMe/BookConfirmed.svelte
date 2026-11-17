<hbox class="book-confirmed" flex bind:offsetWidth={width}>
  <vbox class="appointment">
    <hbox flex />
    {#if both}
      <CheckIcon />
      <vbox class="objective font-small">
        {$t`Confirmed meeting`}
      </vbox>
    {:else}
      <SendIcon />
      <vbox class="objective font-small">
        {$t`Requested meeting`}
      </vbox>
    {/if}
    <!--
    <vbox class="time font-large">
      {getDateString(time)}
    </vbox>
    <vbox class="time font-large">
      {getTimeString(time)}
    </vbox>
    <vbox class="duration font-small">
      {getDurationString(bookMe.duration * 60000)}
    </vbox>
    -->
    <hbox class="title selectable">
      {event.title ?? ""}
    </hbox>
    <vbox class="details-grid">
      <DetailsGrid {event} />
    </vbox>
    <hbox flex />
  </vbox>
  {#if width > 600}
    <EventInDayView {event} />
  {/if}
</hbox>

<script lang="ts">
  import { type TSMLBookMe, type TSMLAction, TSMLBookMeState } from "../../../../logic/Mail/SML/TSML";
  import { Event } from "../../../../logic/Calendar/Event";
  import DetailsGrid from "../../DisplayEvent/DetailsGrid.svelte";
  import EventInDayView from "../../DisplayEvent/EventInDayView.svelte";
  import SendIcon from "lucide-svelte/icons/send";
  import CheckIcon from "lucide-svelte/icons/check-check";
  import { assert } from "../../../../logic/util/util";
  import { getDateString, getDurationString, getTimeString } from "../../../../logic/util/date";
  import { t } from "../../../../l10n/l10n";

  export let bookMe: TSMLBookMe;
  export let time: Date;
  export let myReaction: TSMLAction;
  export let both: boolean;

  assert(time, "Book confirmed needs time");
  assert(!both && bookMe.state == TSMLBookMeState.UserConfirmed || both && bookMe.state == TSMLBookMeState.BothConfirmed, "Book confirmed is in invalid state " + bookMe.state);
  let width: number;

  $: event = getEvent(time);
  function getEvent(time: Date) {
    let event = new Event();
    event.startTime = time;
    event.durationMinutes = bookMe.duration;
    event.title = bookMe.name;
    return event;
  }
</script>

<style>
  .appointment {
    flex: 2 0 0;
    margin: 32px;
    align-items: center;
  }
  .objective {
    margin-block-start: 8px;
    margin-block-end: 32px;
  }
</style>
