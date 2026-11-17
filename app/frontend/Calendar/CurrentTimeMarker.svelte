{#if $now.toDateString() == day.toDateString()}
  <hbox class="current-time-marker" style="top: clamp(5px, {position * 100}%, 100% - 5px)" />
{/if}

<script lang="ts" context="module">
  import { k1MinuteMS } from "../../logic/util/date";
  import { readable } from "svelte/store";

  /** The current time, updated every minute */
  export const now = readable(new Date(), set => {
    let timeout: ReturnType<typeof setTimeout>;
    function update() {
      let time = new Date();
      timeout = setTimeout(update, k1MinuteMS - time.getSeconds() * 1000 - time.getMilliseconds());
      time.setSeconds(0, 0);
      set(time);
    }
    update();
    return () => clearTimeout(timeout);
  });
</script>

<script lang="ts">
  export let day: Date;
  export let startHour = 0;
  export let endHour = 24;

  $: hours = $now.getHours() + $now.getMinutes() / 60;
  $: position = Math.min(Math.max((hours - startHour) / (endHour - startHour), 0), 1);
</script>

<style>
  .current-time-marker {
    position: absolute;
    z-index: 1;
    pointer-events: none;

    inset-inline: 0px;
    margin-block-start: -1px;
    border-top: 2px solid red;
    opacity: 70%;
  }
  .current-time-marker::before {
    content: "";
    position: absolute;
    inset-inline-start: 0px;
    top: -6px;
    border-block: 5px solid transparent;
    border-inline-start: 8px solid red;
  }
</style>
