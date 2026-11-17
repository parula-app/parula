<div class="ribbon-item fixed-width ribbon-button-row look-{look}" data-size="small" role="group" aria-label={label}>
  <slot />
</div>

<script lang="ts">
  import type { RibbonGroupLook, RibbonItemLook } from "./RibbonGroup";
  import { getContext, setContext } from "svelte";
  import { readable, type Readable } from "svelte/store";

  export let label: string;

  setContext("ribbonButtonRow", true);
  const groupLook = getContext<Readable<RibbonGroupLook>>("ribbonGroupLook") ?? readable<RibbonGroupLook>({ layout: "classic", stage: 0, collapsed: false });
  let look: RibbonItemLook;
  $: look = buttonRowLook($groupLook);

  // <copied from="RibbonButtonBase.svelte">
  function buttonRowLook(group: RibbonGroupLook): RibbonItemLook {
    if (group.layout == "simplified") {
      return group.collapsed ? "list" : "simplified-icon";
    }
    return "small-icon";
  }
  // </copied>
</script>

<style>
  .ribbon-button-row {
    display: flex;
    flex-direction: row;
    align-items: center;
    width: max-content;
  }
  .ribbon-button-row.look-small-icon :global(.ribbon-button) {
    width: var(--lo-ribbon-row-button-width);
  }
  .ribbon-button-row.look-list {
    flex-direction: column;
    align-items: stretch;
    width: 100%;
  }
</style>
