{#each namedReceivedRanges as range}
  <MenuItem label={receivedRangeLabel(range)} checkable checked={range == selected}
    onClick={() => select(range == selected ? ReceivedRange.Any : range)} />
{/each}

<script lang="ts">
  import { ReceivedRange, namedReceivedRanges, receivedRangeLabel } from "./SearchRanges";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import { createEventDispatcher } from "svelte";

  export let selected: ReceivedRange;

  const dispatch = createEventDispatcher<{ select: ReceivedRange }>();

  function select(range: ReceivedRange) {
    selected = range;
    dispatch("select", range);
  }
</script>
