<!-- Mimics `MailApp`, which switches between the list views,
  with both of them binding the same `selectedMessages` store -->
{#if $view == "vertical"}
  <VerticalMessageList {messages}
    bind:selectedMessage={$selectedMessage}
    bind:selectedMessages={$selectedMessages} />
{:else}
  <TableMessageList {messages}
    bind:selectedMessage={$selectedMessage}
    bind:selectedMessages={$selectedMessages} />
{/if}

<script lang="ts">
  import type { EMail } from "../../../../logic/Mail/EMail";
  import { selectedMessage, selectedMessages } from "../../../../frontend/Mail/Selected";
  import TableMessageList from "../../../../frontend/Mail/3pane/TableMessageList.svelte";
  import VerticalMessageList from "../../../../frontend/Mail/Vertical/VerticalMessageList.svelte";
  import type { Collection } from "svelte-collections";
  import type { Readable } from "svelte/store";

  export let messages: Collection<EMail>;
  export let view: Readable<string>;
</script>
