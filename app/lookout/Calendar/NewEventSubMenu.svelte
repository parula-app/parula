{#if calendar || $shownCalendars.length <= 1}
  <MenuItem {label} {icon} {shortCutInfo} {tooltip} {disabled}
    onClick={() => onCreate(calendar)} />
{:else}
  <SubMenu {label} {icon} {tooltip} {disabled}>
    <NewEventCalendarItems {onCreate} />
  </SubMenu>
{/if}

<script lang="ts">
  import type { Calendar } from "../../logic/Calendar/Calendar";
  import { shownCalendars } from "../../frontend/Calendar/selected";
  import MenuItem from "../Shared/Menu/MenuItem.svelte";
  import SubMenu from "../Shared/Menu/SubMenu.svelte";
  import NewEventCalendarItems from "./NewEventCalendarItems.svelte";

  export let label: string;
  export let icon: ConstructorOfATypedSvelteComponent = null;
  export let shortCutInfo: string = null;
  export let tooltip: string = null;
  export let disabled: boolean | string = false;
  export let calendar: Calendar | null = null;
  export let onCreate: (calendar: Calendar | null) => void;
</script>
