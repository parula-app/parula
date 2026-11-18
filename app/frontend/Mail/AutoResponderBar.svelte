{#if $autoResponder?.isReplyingNow()}
  <hbox class="auto-responder-bar" role="status">
    <AutoResponderIcon size={16} />
    <span class="title">{$t`Automatic Replies`}</span>
    <hbox flex class="text">{$t`Automatic replies are being sent for this account`}</hbox>
    <Button label={$t`Turn off *=> Stop sending automatic replies`} onClick={onTurnOff} />
  </hbox>
{/if}

<script lang="ts">
  import type { MailAccount } from "../../logic/Mail/MailAccount";
  import Button from "../Shared/Button.svelte";
  import AutoResponderIcon from "lucide-svelte/icons/message-square-reply";
  import { t } from "../../l10n/l10n";

  export let account: MailAccount;

  $: autoResponder = $account?.autoResponder;
  $: isLoggedIn = $account?.isLoggedIn;
  $: if (isLoggedIn) {
    autoResponder.loadForStatus()
      .catch(console.error);
  }

  async function onTurnOff() {
    autoResponder.isOn = false;
    try {
      await autoResponder.save();
    } catch (ex) {
      autoResponder.isOn = true;
      throw ex;
    }
  }
</script>

<style>
  .auto-responder-bar {
    flex-shrink: 0;
    align-items: center;
    gap: 8px;
    padding: 4px 8px 4px 16px;
    background-color: var(--offset-bg);
    color: var(--offset-fg);
  }
  .auto-responder-bar :global(svg) {
    flex-shrink: 0;
  }
  .title {
    display: none;
  }
  .text {
    min-width: 0;
  }
  /* Lookout: Like Outlook's info bar */
  :global(.lookout-window) .auto-responder-bar {
    min-height: 34px;
    margin: 0 8px 6px 8px;
    padding: 0 4px 0 12px;
    border: 1px solid var(--lo-infobar-border);
    border-radius: var(--lo-radius);
    background-color: var(--lo-infobar-bg);
    color: var(--lo-fg);
  }
  :global(.lookout-window) .title {
    display: initial;
    font-weight: 600;
    text-transform: uppercase;
    white-space: nowrap;
  }
  :global(.lookout-window) .auto-responder-bar :global(button) {
    min-width: 88px;
    height: 32px;
    padding: 0 12px;
    border-radius: var(--lo-radius-small);
  }
</style>
