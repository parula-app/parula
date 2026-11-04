<Popup bind:popupOpen popupAnchor={anchor} placement="bottom" boundaryElSel="body">
  <vbox class="addon-popup">
    <AddonFrame addon={item.addon} entry={item.contribution.popup} {context} groups={item.groups}
      maxHeight={400} onEscape={() => popupOpen = false} />
  </vbox>
</Popup>

<script lang="ts">
  import type { AddonUIItem } from "../../logic/Addons/AddonUI";
  import AddonFrame from "./AddonFrame.svelte";
  import Popup from "../Shared/Popup.svelte";

  /** Shows the `popup` UI module of an addon's button or menu item */

  /** Doesn't change */
  export let item: AddonUIItem;
  /** The objects of the click, for `mustang.ui.context`, e.g. `{ messages }` */
  export let context: Record<string, object>;
  export let popupOpen = false;
  /** Element, or an object with `getBoundingClientRect()` */
  export let anchor: any;
  export let onClose: () => void = () => {};

  const addon = item.addon;
  $: popupOpen || onClose();
  $: $addon.sandbox || (popupOpen = false);
</script>

<style>
  .addon-popup {
    width: 320px;
    padding: 8px 12px;
    background-color: var(--bg);
    color: var(--fg);
    border-radius: 4px;
    box-shadow:
      rgba(0, 0, 0, 0.05) 0px 1px 3px,
      rgba(0, 0, 0, 0.05) 0px 20px 25px -5px,
      rgba(0, 0, 0, 0.04) 0px 10px 10px -5px;
  }
  :global(.lookout-window) .addon-popup {
    background-color: var(--lo-pane-bg);
    color: var(--lo-fg);
    border: 1px solid var(--lo-border);
    border-radius: var(--lo-radius-small);
  }
</style>
