<hbox class="event-proposal font-small" flex
  on:click
  on:dblclick
  {title}>
  <hbox class="time" bind:this={timeE} bind:clientWidth={timeWidth}>
    <span class:compact={timeFit == "compact"} class:hidden={timeFit == "hidden"}>{timeFit == "full" ? startTime : getTimeStringWithoutAMPM(start)}</span>
  </hbox>
  {#if title}
    <hbox class="title">{title}</hbox>
  {/if}
  <hbox class="end">
    <slot name="end" />
    <Toolbar border>
      <slot name="buttons" />
    </Toolbar>
  </hbox>
</hbox>

<script lang="ts">
  import { getTimeStringWithoutAMPM } from "../../../../logic/util/date";
  import { getDateTimeLocale } from "../../../../l10n/l10n";
  import Toolbar from "../../../Shared/Toolbar/Toolbar.svelte";
  import { tick } from "svelte";

  export let start: Date;
  export let end: Date;
  export let title: string | null = null;

  $: startTime = start.toLocaleString(getDateTimeLocale(), { hour: "numeric", minute: "2-digit" });

  /** Whether the time leaves out AM/PM, uses a smaller font, or hides, so that it fits next to the buttons.
   * The hour labels show the time, too. */
  let timeFit: "full" | "without-ampm" | "compact" | "hidden" = "full";
  let timeE: HTMLElement;
  let timeWidth = 0;
  let fitCount = 0;
  $: timeWidth, startTime, fitTime();
  async function fitTime() {
    let count = ++fitCount;
    for (let candidate of ["full", "without-ampm", "compact", "hidden"] as const) {
      timeFit = candidate;
      await tick();
      if (count != fitCount || !timeE || timeE.scrollWidth <= timeE.clientWidth) {
        return;
      }
    }
  }
</script>

<style>
  .event-proposal {
    height: calc(100% - 4px); /** minus margin for drop shadow */
    width: calc(100% - 4px);
    position: absolute;
    overflow: hidden;
    flex-wrap: wrap;

    margin: 1px 2px 1px 2px; /** for drop shadow */
    box-shadow: 1px 0px 3px 0px rgba(0, 0, 0, 30%);
    border-radius: 5px;
    container: event-proposal / size;
  }
  .time {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    font-weight: 600;
    white-space: nowrap;
  }
  .compact {
    font-size: 10px;
    line-height: 12px;
  }
  .hidden {
    visibility: hidden;
  }
  .time,
  .title {
    margin-inline-start: 4px;
    margin-block-start: 5px;
  }

  .end {
    margin: 4px;
    align-self: start;
  }
  .event-proposal .end :global(.toolbar) {
    margin-inline-start: 4px;
    padding: 0;
  }
  @container event-proposal (height < 32px) {
    .time,
    .title,
    .end {
      margin-block: auto;
    }
  }
  @container event-proposal (height < 14px) {
    .time {
      visibility: hidden;
    }
  }
  .event-proposal :global(button .label) {
    white-space: nowrap;
  }
</style>
