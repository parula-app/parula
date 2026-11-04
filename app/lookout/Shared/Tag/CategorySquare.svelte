<hbox class="category-square" style:background-color={$tag.color}>
  {#if state == TagState.All}
    <CheckIcon size={12} strokeWidth={3} />
  {:else if state == TagState.Some}
    <PartialIcon size={12} strokeWidth={3} />
  {/if}
</hbox>

<script lang="ts" context="module">
  export enum TagState {
    None = "none",
    Some = "some",
    All = "all",
  }
</script>

<script lang="ts">
  import type { Tag } from "../../../logic/Abstract/Tag";
  import CheckIcon from "lucide-svelte/icons/check";
  import PartialIcon from "lucide-svelte/icons/minus";

  export let tag: Tag;
  export let state: TagState = TagState.None;
</script>

<style>
  .category-square {
    width: 16px;
    height: 16px;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    color: #FFFFFF;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
  }
</style>
