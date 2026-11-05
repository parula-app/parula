<!-- A `FastList` with one-cell rows, with or without a header.
  Without a header, the header slot stays empty, like in `VerticalMessageList`. -->
<FastList {items}>
  <svelte:fragment slot="header">
    {#if withHeader}
      <div class="header-cell">Name</div>
    {/if}
  </svelte:fragment>
  <div class="cell" slot="row" let:item>{item}</div>
</FastList>

<script lang="ts">
  import FastList from "../../../frontend/Shared/FastList.svelte";
  import type { Collection } from "svelte-collections";

  export let items: Collection<string>;
  export let withHeader = false;
</script>
