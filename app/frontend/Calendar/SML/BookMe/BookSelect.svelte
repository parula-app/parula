<vbox class="book-select" flex>
  <Splitter>
    <Scroll slot="left">
      <vbox class="list">
        <DisplayList {options} duration={bookMe.duration} showEndTime={true}
          on:optionclick={(ev) => focusOption = ev.detail}>
          <BookSelectButtons time={option} {bookMe} bind:myReaction bind:selectedTime {isOrganizer} slot="right" let:option />
        </DisplayList>
        {#if isOrganizer}
          <hbox flex />
          <hbox class="organizer">
            {$t`You proposed these meeting times`}
          </hbox>
        {/if}
      </vbox>
    </Scroll>
    <PollCalendar {options} duration={bookMe.duration} {focusOption} showDays={1} slot="right">
      <BookSelectButtons time={start} {bookMe} bind:myReaction bind:selectedTime {isOrganizer} slot="event-buttons" let:start />
    </PollCalendar>
  </Splitter>
</vbox>

<script lang="ts">
  import { type TSMLBookMe, type TSMLAction } from "../../../../logic/Mail/SML/TSML";
  import PollCalendar from "../Shared/PollCalendar.svelte";
  import BookSelectButtons from "./BookSelectButtons.svelte";
  import DisplayList from "../Shared/DisplayList.svelte";
  import { syncArrayColl } from "../../../../logic/util/collections";
  import Splitter from "../../../Shared/Splitter.svelte";
  import Scroll from "../../../Shared/Scroll.svelte";
  import { t } from "../../../../l10n/l10n";

  export let bookMe: TSMLBookMe;
  export let myReaction: TSMLAction;
  export let selectedTime: Date;
  export let isOrganizer = false;

  $: options = syncArrayColl(bookMe.options, date => date.getTime());

  $: focusOption = $options.first;
</script>

<style>
  .book-select {
    margin: 16px;
  }
  .list {
    align-self: center;
    height: 100%;
    width: 300px;
    margin-inline: 32px;
  }
  .organizer {
    align-self: center;
    opacity: 70%;
  }
</style>
