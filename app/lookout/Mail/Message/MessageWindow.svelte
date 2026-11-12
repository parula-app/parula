<SecondaryWindow title={$message.subject ?? ""}>
  <vbox flex class="message-window" bind:this={pageEl}>
    <MessageDisplay {message} />
  </vbox>
  <MessageKeys messages={[message]} {pageEl} />
  <MessagePrint />
  <!-- <copied from="../MailApp.svelte"> -->
  {#if $openColorCategories}
    <ColorCategoriesDialog items={$openColorCategories} on:close={() => $openColorCategories = null} />
  {/if}
  <!-- </copied> -->
</SecondaryWindow>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { selectedMessage, selectedMessages } from "../../../frontend/Mail/Selected";
  import { openColorCategories } from "../Selected";
  import { AppWindow } from "../../../frontend/MainWindow/AppWindow";
  import SecondaryWindow from "../../MainWindow/SecondaryWindow.svelte";
  import MessageDisplay from "./MessageDisplay.svelte";
  import MessageKeys from "./MessageKeys.svelte";
  import MessagePrint from "./MessagePrint.svelte";
  import ColorCategoriesDialog from "../../Shared/Tag/ColorCategoriesDialog.svelte";
  import { ArrayColl, CollectionObserver } from "svelte-collections";
  import { onDestroy } from "svelte";

  export let message: EMail;

  let pageEl: HTMLElement;

  // <copied from="../../../frontend/Mail/Message/MessageWindow.svelte">
  const appWindow = AppWindow.current();
  $selectedMessage = message;
  $selectedMessages = new ArrayColl([message]);

  /** Closes the window when the message was deleted or moved */
  class RemovalObserver extends CollectionObserver<EMail> {
    added(messages: EMail[]) {}
    removed(messages: EMail[]) {
      if (messages.includes(message)) {
        appWindow.close();
      }
    }
  }
  let removalObserver = new RemovalObserver();
  let folderMessages = message.folder?.messages;
  folderMessages?.registerObserver(removalObserver);
  onDestroy(() => {
    folderMessages?.unregisterObserver(removalObserver);
  });
  // </copied>
</script>

<style>
  .message-window {
    min-height: 0;
    padding: 0 8px 8px 8px;
  }
</style>
