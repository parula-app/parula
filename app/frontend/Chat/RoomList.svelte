<vbox class="chat-rooms" flex>
  <PersonsList persons={rooms} bind:selected={selectedRoom} {doSearch}
    sortBy={room => -room.lastMessage?.sent}>
    <hbox slot="top-right" class="last-time" let:person={room}>
      {#if room instanceof ChatRoom && room.lastMessage}
        {getDateTimeString(room.lastMessage.sent)}
      {/if}
    </hbox>
    <hbox slot="second-row" flex class="last-msg font-smallest" let:person={room}>
      {#if room instanceof ChatRoom && room.lastMessage}
        {room.lastMessage.text?.substring(0, 50)}
      {/if}
    </hbox>
  </PersonsList>
</vbox>

<script lang="ts">
  import { ChatRoom } from "../../logic/Chat/ChatRoom";
  import PersonsList from "../Contacts/Person/PersonsList.svelte";
  import { getDateTimeString } from "../../logic/util/date";
  import type { Collection } from "svelte-collections";

  export let rooms: Collection<ChatRoom>;
  export let selectedRoom: ChatRoom;
  export let doSearch = false;
</script>

<style>
  .chat-rooms :global(.first-row) {
    margin-block-start: 3px;
  }
  .chat-rooms :global(.person .name) {
    font-size: medium;
  }
  .last-time {
    opacity: 50%;
    font-size: x-small;
    margin-block-start: 3px;
    margin-inline-start: 8px;
  }
  .last-msg {
    opacity: 50%;
    margin-inline-start: 1px;
    margin-block-end: 2px;
    max-height: 1.8em;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
