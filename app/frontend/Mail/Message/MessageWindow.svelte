<SecondaryWindow title={$message.subject ?? ""}>
  <MessageDisplay {message} />
</SecondaryWindow>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { selectedMessage, selectedMessages } from "../Selected";
  import { AppWindow } from "../../MainWindow/AppWindow";
  import SecondaryWindow from "../../MainWindow/SecondaryWindow.svelte";
  import MessageDisplay from "./MessageDisplay.svelte";
  import { ArrayColl, CollectionObserver } from "svelte-collections";
  import { onDestroy } from "svelte";

  export let message: EMail;

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
</script>
