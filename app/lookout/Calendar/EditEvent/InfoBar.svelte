{#if messages.length}
  <vbox class="info-bar">
    {#each messages as message}
      <hbox class="message {message.kind}">
        <span class="icon">
          {#if message.kind == "warning"}
            <WarningIcon size={16} />
          {:else if message.kind == "cancelled"}
            <CancelledIcon size={16} />
          {:else if message.kind == "recurrence"}
            <RecurrenceIcon size={16} />
          {:else}
            <InfoIcon size={16} />
          {/if}
        </span>
        <span class="text">{message.text}</span>
      </hbox>
    {/each}
  </vbox>
{/if}

<script lang="ts">
  import type { InfoMessage } from "./EventFormInfo";
  import InfoIcon from "lucide-svelte/icons/info";
  import WarningIcon from "lucide-svelte/icons/triangle-alert";
  import CancelledIcon from "lucide-svelte/icons/calendar-x-2";
  import RecurrenceIcon from "lucide-svelte/icons/repeat-2";

  export let messages: InfoMessage[];
</script>

<style>
  .info-bar {
    flex-shrink: 0;
    gap: 2px;
    margin: 4px 24px 4px 24px;
  }
  .message {
    align-items: center;
    gap: 8px;
    min-height: 24px;
    font-size: var(--lo-font-size-small);
    color: var(--lo-fg);
  }
  .icon {
    display: flex;
    color: var(--lo-accent-text);
  }
  .warning .icon {
    color: var(--lo-warning);
  }
  .cancelled .icon {
    color: var(--lo-danger);
  }
  .cancelled .text {
    font-weight: 600;
  }
</style>
