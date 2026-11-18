{#if $autoResponder && isReplyingNow($autoResponder)}
  <hbox class="automatic-replies-bar" role="status">
    <AutomaticRepliesIcon size={16} />
    <span class="title">{$t`Automatic Replies`}</span>
    <hbox flex class="text">{$t`Automatic replies are being sent for this account`}</hbox>
    <DialogButton label={$t`Turn off *=> Stop sending automatic replies`} onClick={onTurnOff} />
  </hbox>
{/if}

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { loadAutomaticReplies, isReplyingNow } from "./AutomaticReplies";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import AutomaticRepliesIcon from "lucide-svelte/icons/message-square-reply";
  import { t } from "../../../l10n/l10n";

  export let account: MailAccount;

  $: autoResponder = $account?.autoResponder;
  $: isLoggedIn = $account?.isLoggedIn;
  $: if (isLoggedIn) {
    loadAutomaticReplies(account)
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
  .automatic-replies-bar {
    flex-shrink: 0;
    align-items: center;
    gap: 8px;
    min-height: 34px;
    margin: 0 8px 6px 8px;
    padding: 0 4px 0 12px;
    border: 1px solid var(--lo-infobar-border);
    border-radius: var(--lo-radius);
    background-color: var(--lo-infobar-bg);
    color: var(--lo-fg);
  }
  .automatic-replies-bar :global(svg) {
    flex-shrink: 0;
  }
  .title {
    font-weight: 600;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .text {
    min-width: 0;
  }
</style>
