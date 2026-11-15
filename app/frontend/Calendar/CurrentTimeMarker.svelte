{#if $now.toDateString() == day.toDateString()}
  <hbox class="current-time-marker" style="top: clamp(5px, {position * 100}%, 100% - 5px)" />
{/if}

<script lang="ts">
  import { now } from "../Util/now";

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
