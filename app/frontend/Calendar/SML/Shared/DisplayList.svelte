<vbox class="options">
  {#each $sortedOptions.each as option, i}
    {#if option.toLocaleDateString() != sortedOptions.getIndex(i - 1)?.toLocaleDateString()}
      <hbox class="date header">
        <vbox>
          {getDateString(option, { weekday: "long", year: "numeric", month: "2-digit", day: "2-digit" })}
        </vbox>
      </hbox>
    {/if}

    <Clickable onClick={() => dispatchEvent("optionclick", option)}>
      <hbox class="option added" class:showEndTime>
        <hbox class="start-time">
          {getTimeString(option)}
        </hbox>
        {#if showEndTime}
          <hbox class="end-separator">
            -
          </hbox>
          <hbox class="end-time">
            {end = new Date(option), end.setMinutes(end.getMinutes() + duration), getTimeString(end)}
          </hbox>
        {/if}
        <hbox flex />
        <slot name="center" {option} />
        <hbox flex />
        <slot name="right" {option} />
      </hbox>
    </Clickable>
  {/each}
</vbox>

<script lang="ts">
  import { getDateString, getTimeString } from "../../../../logic/util/date";
  import { Collection } from "svelte-collections";
  import Clickable from "../../../Shared/Clickable.svelte";
  import { createEventDispatcher } from 'svelte';
  const dispatchEvent = createEventDispatcher<{ optionclick: Date }>();

  export let options: Collection<Date>;
  /** in minutes */
  export let duration: number;
  export let showEndTime = true;

  $: sortedOptions = options.sortBy(date => date);
  let end: Date;
</script>

<style>
  .header {
    margin-inline-start: 8px;
    font-weight: 600;
  }
  .option {
    align-items: center;
    border-radius: var(--border-radius);
    box-shadow: 1px 0px 3px 0px rgba(0, 0, 0, 30%);
    background-color: var(--hover-bg);
    color: var(--hover-fg);
    padding-inline: 8px;
    margin-block: 2px;
    cursor: pointer;
  }
  .start-time {
    font-weight: 600;
    padding-block: 2px;
  }
  .end-separator {
    margin-inline-start: 0.4em;
    margin-inline-end: 0.3em;
  }
  .end-separator,
  .end-time {
    opacity: 50%;
  }
</style>
