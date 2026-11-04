<button type="button" class="connect" class:with-label={withLabel}
  disabled={isConnecting}
  title={$t`Connect to ${$account.name}`}
  aria-label={$t`Connect to ${$account.name}`}
  on:click|stopPropagation={onConnect}>
  <ConnectIcon size={16} />
  {#if withLabel}
    <span>{isConnecting ? $t`Connecting… *=> Logging in to the account` : $t`Connect *=> Log in to this account`}</span>
  {/if}
</button>

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { showError } from "../../../frontend/Util/error";
  import ConnectIcon from "lucide-svelte/icons/plug";
  import { t } from "../../../l10n/l10n";

  export let account: MailAccount;
  export let withLabel = false;

  let isConnecting = false;
  async function onConnect() {
    isConnecting = true;
    try {
      await account.loginAndStartup(true);
    } catch (ex) {
      showError(ex);
    } finally {
      isConnecting = false;
    }
  }
</script>

<style>
  .connect {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-accent-text);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .connect.with-label {
    width: auto;
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--lo-border-strong);
    background-color: var(--lo-pane-bg);
    color: var(--lo-fg);
  }
  .connect.with-label :global(svg) {
    color: var(--lo-accent-text);
  }
  .connect:hover {
    background-color: var(--lo-hover-bg);
  }
  .connect:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
