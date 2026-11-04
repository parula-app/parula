<div class="time-ruler" class:primary={isPrimary} style="width: {width}px">
  {#each labels as label, hour}
    <span class="hour-label" style="top: {hour * 60 * pxPerMinute}px">{label}</span>
  {/each}
</div>

<script lang="ts">
  export let pxPerMinute: number;
  export let labels: string[];
  export let isPrimary = true;
  export let width: number;
</script>

<style>
  .time-ruler {
    flex: none;
    box-sizing: border-box;
    position: relative;
  }
  .time-ruler:not(.primary) {
    border-inline-end: 1px solid var(--lo-divider);
  }
  .hour-label {
    position: absolute;
    inset-inline-end: 8px;
    margin-block-start: 3px;
    line-height: 1;
    font-size: var(--lo-font-size-small);
    color: var(--lo-fg-secondary);
    white-space: nowrap;
  }
</style>
