{#if $visible.hasItems}
  <hbox class="attachment-list">
    {#each $visible.each as attachment (attachment)}
      <AttachmentUI {attachment} {isComposing}
        canSaveAll={!isComposing && $visible.length > 1}
        on:remove={() => attachments.remove(attachment)}
        on:saveAll={() => { isSavingAll = true; }} />
    {/each}
  </hbox>
{/if}
{#if isSavingAll}
  <SaveAllAttachmentsDialog attachments={$visible.contents} on:close={() => { isSavingAll = false; }} />
{/if}

<script lang="ts">
  import type { Attachment } from "../../../logic/Abstract/Attachment";
  import AttachmentUI from "./AttachmentUI.svelte";
  import SaveAllAttachmentsDialog from "./SaveAllAttachmentsDialog.svelte";
  import type { ArrayColl } from "svelte-collections";

  export let attachments: ArrayColl<Attachment>;
  export let isComposing = false;

  let isSavingAll = false;
  $: visible = attachments.filterObservable(attachment => !attachment.hidden);
</script>

<style>
  .attachment-list {
    flex-wrap: wrap;
    gap: 8px;
    max-height: 104px;
    overflow-y: auto;
  }
</style>
