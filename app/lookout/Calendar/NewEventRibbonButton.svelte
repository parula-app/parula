{#if $shownCalendars.length > 1}
  <RibbonMenuButton {label} {shortLabel} {icon} {size} {tooltip} {shortCutInfo} {disabled}>
    <NewEventCalendarItems {onCreate} />
  </RibbonMenuButton>
{:else}
  <RibbonButton {label} {shortLabel} {icon} {size} {tooltip} {shortCutInfo} {disabled}
    onClick={() => onCreate(null)} />
{/if}

<script lang="ts">
  import type { Calendar } from "../../logic/Calendar/Calendar";
  import type { RibbonItemSize } from "../Shared/Ribbon/RibbonGroup";
  import { shownCalendars } from "../../frontend/Calendar/selected";
  import RibbonButton from "../Shared/Ribbon/RibbonButton.svelte";
  import RibbonMenuButton from "../Shared/Ribbon/RibbonMenuButton.svelte";
  import NewEventCalendarItems from "./NewEventCalendarItems.svelte";

  export let label: string;
  export let shortLabel: string = null;
  export let icon: ConstructorOfATypedSvelteComponent = null;
  export let size: RibbonItemSize = "large";
  export let tooltip: string = null;
  export let shortCutInfo: string = null;
  export let disabled: boolean | string = false;
  export let onCreate: (calendar: Calendar | null) => void;
</script>
