<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<hbox flex class="message-with-thread" class:mobile={$appGlobal.isMobile}>
  <!--<ThreadPane {message} horizontal={$appGlobal.isMobile} />-->
  <vbox flex class="message-display"
    on:keydown={event => catchErrors(() => onKeyOnList(event))}
    tabindex={0}
    >
    <MessageHeader bind:message />
    <MessageAttachments attachments={message.attachments} />
    <SMLDisplayKinds {message} sml={message.sml} />
    <vbox class="body" flex>
      <Paper>
        <MessageBody {message} />
      </Paper>
    </vbox>
    {#if $appGlobal.isMobile}
      <MessageDisplayBarM bind:message />
    {/if}
  </vbox>
</hbox>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { onKeyOnList } from "./MessageKeyboard";
  import { appGlobal } from "../../../logic/app";
  import MessageHeader from "./MessageHeader.svelte";
  import MessageAttachments from "./AttachmentsUI.svelte";
  import MessageBody from "./MessageBody.svelte";
  import SMLDisplayKinds from "../SML/SMLDisplayKinds.svelte";
  import MessageDisplayBarM from "./MessageDisplayBarM.svelte";
  import Paper from "../../Shared/Paper.svelte";
  import ThreadPane from "../Thread/ThreadPane.svelte";
  import { catchErrors } from "../../Util/error";

  export let message: EMail;
</script>

<style>
  .message-with-thread {
    background-color: var(--leftbar-bg);
  }
  /* On mobile, the thread bar lies across the top of the message */
  .message-with-thread.mobile {
    flex-direction: column;
  }
  .message-display {
    background-color: var(--leftbar-bg);
    color: var(--leftbar-fg);
    min-width: 0;
  }
  .body {
    margin-inline-start: 8px;
    margin-block-end: 2px;
  }
  @media (max-width: 600px)  {
    .body {
      margin-inline-start: 4px;
      margin-inline-end: 1px;
      margin-block-end: 1px;
    }
  }
</style>
