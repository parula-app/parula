{#if $items.hasItems}
  <vbox class="addon-panels">
    {#each $items.each as item (item)}
      <AddonFrame addon={item.addon} entry={item.contribution.entry} {context} groups={item.groups}
        maxHeight={item.contribution.maxHeight ?? 400} />
    {/each}
  </vbox>
{/if}

<script lang="ts">
  import type { EMail } from "../../logic/Mail/EMail";
  import { addonUIItems } from "../../logic/Addons/AddonUI";
  import AddonFrame from "./AddonFrame.svelte";

  /** The panels of the running addons for the message that the user reads.
   * The frames stay when the message changes. Then they get the new message, and lose the previous one. */

  export let message: EMail;

  const items = addonUIItems.filterObservable(item => item.place == "message-panel");

  let context: { message?: EMail } = {};
  $: setMessage(message);
  function setMessage(message: EMail) {
    if (message == context.message) {
      return;
    }
    context = { message };
  }
</script>

<style>
  .addon-panels {
    flex-shrink: 0;
    margin-inline-start: 8px;
    margin-block-end: 8px;
  }
  :global(.lookout-window) .addon-panels {
    margin: 0;
    padding: 4px 20px 8px 20px;
  }
</style>
