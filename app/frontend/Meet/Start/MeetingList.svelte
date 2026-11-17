{#if $meetings.hasItems}
  <Scroll>
    <grid>
      {#each $meetings.each as meeting}
        <Clickable onClick={ev => myOnClick(ev, meeting)} {errorCallback}>
          <hbox class="time">
            {getDateTimeString(meeting.startTime)}
          </hbox>
        </Clickable>
        <hbox class="location">
          {#if meeting.isOnline}
            <VideoIcon />
          {:else if meeting.location}
            <PinIcon />
          {/if}
        </hbox>
        <Clickable onClick={ev => myOnClick(ev, meeting)} {errorCallback}>
          <hbox class="title">
            {meeting.title}
          </hbox>
        </Clickable>
      {/each}
    </grid>
  </Scroll>
{:else}
  <slot name="emptyMsg" />
{/if}

<script lang="ts">
  import type { Event as CalendarEvent} from "../../../logic/Calendar/Event";
  import Clickable from "../../Shared/Clickable.svelte";
  import Scroll from "../../Shared/Scroll.svelte";
  import VideoIcon from 'lucide-svelte/icons/video';
  import PinIcon from 'lucide-svelte/icons/map-pin';
  import { showError } from "../../Util/error";
  import { getDateTimeString } from "../../../logic/util/date";
  import type { Collection } from "svelte-collections";

  export let meetings: Collection<CalendarEvent>;
  export let onClick = (meeting: CalendarEvent) => null;
  export let errorCallback = showError;

  let disabled = false;
  async function myOnClick(event: Event, meeting: CalendarEvent) {
    if (!(onClick && typeof(onClick) == "function")) {
      return;
    }
    disabled = true;
    try {
      await onClick(meeting);
    } catch (ex) {
      errorCallback(ex);
    }
  }
</script>

<style>
  grid {
    grid-template-columns: auto auto 1fr;
  }
  .time {
    margin-inline-end: 12px;
  }
  .time,
  .title {
    cursor: pointer;
  }
</style>
