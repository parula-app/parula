<RibbonButtonBase {label} {shortLabel} {icon} {tooltip} {shortCutInfo} {disabled} {size} {classes}
  toggle pressed={selected}
  {onClick} {errorCallback}
  bind:buttonEl
  />

<script lang="ts">
  import RibbonButtonBase from "./RibbonButtonBase.svelte";
  import type { RibbonItemSize } from "./RibbonGroup";
  import { showError } from "../../../frontend/Util/error";

  export let label: string;
  export let shortLabel: string = null;
  export let icon: ConstructorOfATypedSvelteComponent = null;
  export let selected = false;
  export let onClick: (event: Event) => void | Promise<void> = null;
  export let disabled: boolean | string = false;
  export let size: RibbonItemSize = "large";
  export let tooltip: string = null;
  export let shortCutInfo: string = null;
  export let classes = "";
  export let errorCallback = showError;
  export let buttonEl: HTMLButtonElement = null;
</script>
