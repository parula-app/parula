<hbox flex
  class="chatroomevent"
  class:incoming={!message.outgoing}
  class:outgoing={message.outgoing}
  >
  <vbox class="right">
    <hbox class="text selectable font-smallest">{@html sanitizeHTMLWithoutStyleTag(message.html)}</hbox>
  </vbox>
</hbox>

<script lang="ts">
  import type { ChatRoomEvent } from "../../../logic/Chat/RoomEvent";
  import { sanitizeHTMLWithoutStyleTag } from "../../../logic/util/convertHTML";

  export let message: ChatRoomEvent;
</script>

<style>
  .chatroomevent {
    margin: 8px 32px 0 20px;
    color: var(--fg);
  }
  .incoming {
    align-self: flex-start;
  }
  .outgoing {
    align-self: flex-end;
  }

  .text {
    contain: paint; /* Prevent CSS on remote content from rendering outside the area */
  }
  .text :global(.person) {
    color: var(--link-fg);
  }
</style>
