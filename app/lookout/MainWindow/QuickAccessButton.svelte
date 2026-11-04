<button type="button" class="quick-access-button"
  disabled={!!disabled || running}
  title={tooltip}
  aria-label={command.label}
  data-keytip-qat={command.id}
  on:click={onClick}>
  <svelte:component this={command.icon} size={16} />
</button>

<script lang="ts">
  import type { QuickAccessCommand } from "../Shared/QuickAccess/QuickAccess";
  import { showError } from "../../frontend/Util/error";
  import { readable } from "svelte/store";

  export let command: QuickAccessCommand;

  $: disabledStore = command.disabled ?? readable(false);
  $: disabled = $disabledStore;
  $: tooltip = typeof disabled == "string"
    ? disabled
    : command.label + (command.shortCutInfo ? ` (${command.shortCutInfo})` : "");

  let running = false;
  async function onClick() {
    running = true;
    try {
      await command.run();
    } catch (ex) {
      showError(ex);
    } finally {
      running = false;
    }
  }
</script>

<style>
  .quick-access-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-accent-text);
  }
  .quick-access-button:hover:not(:disabled) {
    background-color: var(--lo-hover-bg);
  }
  .quick-access-button:active:not(:disabled) {
    background-color: var(--lo-pressed-bg);
  }
  .quick-access-button:disabled {
    color: var(--lo-fg-disabled);
  }
</style>
