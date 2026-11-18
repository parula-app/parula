<vbox flex class="reading-pane lo-card">
  {#if shownMessage}
    <!-- Outside of the {#key}, so that the addon frames stay when the message changes -->
    <AddonPanels message={shownMessage} />
    {#key shownMessage}
      <vbox flex class="message">
        <MessageHeader message={shownMessage} />
        {#if reply}
          {#key reply}
            <MailComposer mail={reply.draft} isInline autofocus={focusReply} />
          {/key}
        {:else}
          <InfoBars message={shownMessage} />
          <hbox class="attachments">
            <AttachmentsUI attachments={shownMessage.attachments} />
          </hbox>
          {#if $shownMessage.event || $shownMessage.invitationMessage}
            <InvitationInMail message={shownMessage} />
          {:else}
            {#if $shownMessage.sml}
              <vbox class="sml">
                <SMLDisplayKinds message={shownMessage} sml={$shownMessage.sml} />
              </vbox>
            {/if}
          {/if}
          <vbox flex class="body">
            <MessageBody message={shownMessage} />
          </vbox>
        {/if}
      </vbox>
    {/key}
  {/if}
</vbox>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { DisplayMode } from "../../../frontend/Mail/Message/MessageBody.svelte";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import type { InlineReply } from "../Composer/InlineReplies";
  import { inlineReplies } from "../Selected";
  import MailComposer from "../Composer/MailComposer.svelte";
  import MessageHeader from "./MessageHeader.svelte";
  import InfoBars from "./InfoBars.svelte";
  import AttachmentsUI from "./AttachmentsUI.svelte";
  import SMLDisplayKinds from "../SML/SMLDisplayKinds.svelte";
  import InvitationInMail from "../../Calendar/Invitation/InvitationInMail.svelte";
  import MessageBody from "../../../frontend/Mail/Message/MessageBody.svelte";
  import AddonPanels from "../../../frontend/Addons/AddonPanels.svelte";
  import { catchErrors, minorError } from "../../../frontend/Util/error";
  import { onDestroy } from "svelte";

  export let message: EMail;

  const readDelaySetting = getLocalStorage<number>("mail.read.after", 0);
  const contentRendering = getLocalStorage<string>("mail.contentRendering", "html");
  $: readDelay = $readDelaySetting.value;
  let shownMessage: EMail | null = null;
  $: if (message != shownMessage) {
    shownMessage = message;
    catchErrors(onMessageChanged);
  }
  $: catchErrors(() => markMessageAsRead(shownMessage, readDelay), minorError);

  let reply: InlineReply | null = null;
  let focusReply = false;
  $: $inlineReplies, shownMessage, updateReply();
  function updateReply() {
    let current = shownMessage ? inlineReplies.find(reply => reply.original == shownMessage) ?? null : null;
    if (current == reply) {
      return;
    }
    reply = current;
    focusReply = !!reply?.isNew;
    if (reply) {
      reply.isNew = false;
    }
  }
  // <copied from="../../../frontend/Mail/Message/MessageHeader.svelte">
  let readTimeout: NodeJS.Timeout;
  function markMessageAsRead(message: EMail, readDelay: number) {
    clearTimeout(readTimeout);
    if (!message || message.isRead) {
      return;
    }
    if (readDelay < 0) {
      return;
    }
    if (readDelay == 0) {
      readDelay = 0.2; // Avoid that normal scrolling marks all msgs as read
    }
    readTimeout = setTimeout(() => {
      message.markRead(true)
        .catch(message.folder.account.errorCallback);
    }, readDelay * 1000);
  }
  onDestroy(() => {
    clearTimeout(readTimeout);
  });
  // </copied>

  // <copied from="../../../frontend/Mail/Message/DisplayModeSwitcher.svelte">
  function onMessageChanged() {
    if (shownMessage && contentRendering.value == DisplayMode.HTMLWithExternal) {
      contentRendering.value = DisplayMode.HTML;
    }
  }
  // </copied>
</script>

<style>
  .reading-pane {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .message {
    min-height: 0;
  }
  .attachments {
    flex-shrink: 0;
    padding: 0 20px 8px 20px;
  }
  .sml {
    flex-shrink: 0;
    padding: 0 20px 8px 20px;
  }
  .body {
    min-height: 120px;
    padding: 4px 8px 8px 20px;
  }
  .body :global(.message-body) {
    min-height: 0;
  }
</style>
