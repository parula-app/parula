<div class="ribbon-item fixed-width ribbon-checkbox look-{look}" data-size="small">
  <Checkbox {label} bind:checked {disabled} {tooltip} on:change />
</div>

<script lang="ts">
  import Checkbox from "../Form/Checkbox.svelte";
  import { itemLook, type RibbonGroupLook, type RibbonItemLook } from "./RibbonGroup";
  import { getContext } from "svelte";
  import { readable, type Readable } from "svelte/store";

  export let label: string;
  export let checked = false;
  export let disabled: boolean | string = false;
  export let tooltip: string = null;

  const groupLook = getContext<Readable<RibbonGroupLook>>("ribbonGroupLook") ?? readable<RibbonGroupLook>({ layout: "classic", stage: 0, collapsed: false });
  let look: RibbonItemLook;
  $: look = itemLook($groupLook.layout, $groupLook.stage, $groupLook.collapsed, "small");
</script>

<style>
  .ribbon-checkbox {
    display: flex;
    align-items: center;
    box-sizing: border-box;
    width: max-content;
    height: var(--lo-ribbon-row-height);
    padding: 0 6px;
    border-radius: var(--lo-radius-small);
    font-size: var(--lo-font-size-small);
    white-space: nowrap;
  }
  .ribbon-checkbox:hover {
    background-color: var(--lo-hover-bg);
  }
  .ribbon-checkbox :global(.lo-checkbox) {
    gap: 6px;
    min-height: 0;
  }
  .look-simplified,
  .look-simplified-icon,
  .look-list {
    height: var(--lo-ribbon-button-height);
    padding: 0 8px;
    font-size: 13px;
  }
</style>
