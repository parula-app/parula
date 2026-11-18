<div class="count">
  {#if error}
    {error}
  {:else if words == null}
    Counting…
  {:else if messages.length == 1}
    {words.toLocaleString()} words
  {:else}
    {words.toLocaleString()} words in {messages.length} messages
  {/if}
</div>

<script lang="ts">
  import type { EMail } from "../../../../app/logic/Addons/API/addon-api";

  export let context: typeof mustang.ui.context;

  let words: number | null = null;
  let error = "";

  $: messages = $context.messages ?? [];
  $: count(messages);

  async function count(messages: EMail[]) {
    try {
      words = null;
      let texts = await Promise.all(messages.map(async message => {
        await message.loadBody();
        return await message.text;
      }));
      words = texts.reduce((sum, text) => sum + text.split(/\s+/).filter(word => word).length, 0);
    } catch (ex) {
      error = ex.message;
    }
  }
</script>

<style>
  .count {
    padding: 4px 0;
    color: var(--fg);
    white-space: nowrap;
  }
</style>
