<vbox flex class="background">
  <Scroll bind:this={scroller}>
    <vbox class="messages">
      {#each $sortedMessages.each as message, i}
        <DateSeparator {message} previousMessage={sortedMessages.getIndex(i - 1)} />
        <slot name="message" {message} previousMessage={sortedMessages.getIndex(i - 1)} />
      {/each}
    </vbox>
  </Scroll>
</vbox>

<script lang="ts">
  import type { Message } from "../../../logic/Abstract/Message";
  import DateSeparator from "./DateSeparator.svelte";
  import Scroll from "../../Shared/Scroll.svelte";
  import type { Collection } from "svelte-collections";
  import { catchErrors } from "../../Util/error";
  import { tick } from "svelte";

  export let messages: Collection<Message>;

  $: sortedMessages = messages.sortBy(msg => msg.sent.getTime());

  let scroller: Scroll;
  $: $messages && scroller && catchErrors(scrollDown);
  async function scrollDown() {
    await tick(); // wait for message to be added to HTML
    scroller.scrollDown();
  }
</script>

<style>
.background {
  box-shadow: 2px 0px 6px 0px rgba(0, 0, 0, 10%) inset;
}
.messages {
  padding-block-end: 14px;
}
</style>
