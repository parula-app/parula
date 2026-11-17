<hbox class="status-entry" title={item.tooltip ?? null}>
  {#if item.busy}
    <hbox class="icon busy"><BusyIcon size="12" /></hbox>
  {:else if item.icon}
    <hbox class="icon"><svelte:component this={item.icon} size="12" /></hbox>
  {/if}
  <hbox class="label">{item.label}</hbox>
</hbox>

<script lang="ts">
  import type { StatusBarItem } from "./StatusBar.svelte";
  import BusyIcon from "lucide-svelte/icons/loader-circle";

  export let item: StatusBarItem;
</script>

<style>
  .status-entry {
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .icon {
    align-items: center;
  }
  .busy {
    animation: lo-status-spin 1s linear infinite;
  }
  @keyframes lo-status-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
