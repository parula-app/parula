{#if $message.isReplied}
  <hbox class="replied font-small" class:found={!!reply}>
    <Button plain
      icon={RepliedIcon} iconSize="14px"
      label={reply?.sent
        ? $t`You replied to this message on ${reply.sent.toLocaleString(getDateTimeLocale(), { dateStyle: "medium", timeStyle: "short" })}`
        : $t`You replied to this message`}
      tooltip={reply
        ? $t`Open your reply`
        : isSearching ? null : $t`Your reply was not found in your folders`}
      onClick={reply ? onOpenReply : null} />
  </hbox>
{/if}

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { openEMailMessage } from "../open";
  import Button from "../../Shared/Button.svelte";
  import RepliedIcon from "lucide-svelte/icons/reply";
  import { catchErrors, minorError } from "../../Util/error";
  import { getDateTimeLocale, t } from "../../../l10n/l10n";

  export let message: EMail;

  let reply: EMail | null = null;
  let isSearching = false;
  $: isReplied = $message.isReplied;
  $: catchErrors(() => findReply(message, isReplied), minorError);
  async function findReply(original: EMail, isReplied: boolean) {
    reply = null;
    if (!isReplied) {
      return;
    }
    isSearching = true;
    try {
      let found = await original.findMyReply();
      if (original == message) {
        reply = found;
      }
    } finally {
      if (original == message) {
        isSearching = false;
      }
    }
  }

  async function onOpenReply() {
    await openEMailMessage(reply);
  }
</script>

<style>
  .replied {
    align-items: center;
    min-height: 24px;
    color: grey;
  }
  .replied :global(button) {
    padding: 2px 8px;
    color: inherit;
    font-size: inherit;
  }
  .replied:not(.found) :global(button:hover) {
    background-color: transparent;
    color: inherit;
  }
</style>
