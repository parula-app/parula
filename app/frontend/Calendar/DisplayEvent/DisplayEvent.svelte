<vbox class="event-display" flex>
  <DialogHeader {event} />
  <hbox class="title-row">
    <hbox class="title selectable font-normal">
      {$event.title ?? ""}
    </hbox>
  </hbox>
  <vbox class="details-grid">
    <DetailsGrid {event} />
  </vbox>
  {#if $tags.hasItems}
    <hbox class="tags">
      <TagSelector tags={$tags} canAdd={false} />
    </hbox>
  {/if}
  {#if $attachments.hasItems}
    <vbox class="attachments">
      <Attachments {attachments} />
    </vbox>
  {/if}
  {#if $event.hasDescription}
    <Paper>
      <WebView html={$event.descriptionHTML} title="" {headHTML} />
    </Paper>
  {/if}
</vbox>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import cssContent from "../../Mail/Message/content.css?inline";
  import cssBody from "../../Mail/Message/content-body.css?inline";
  import DialogHeader from "./DialogHeader.svelte";
  import DetailsGrid from "./DetailsGrid.svelte";
  import Attachments from "../../Mail/Message/AttachmentsUI.svelte";
  import TagSelector from "../../Shared/Tag/TagSelector.svelte";
  import Paper from "../../Shared/Paper.svelte";
  import WebView from "../../Shared/WebView.svelte";

  export let event: Event;

  $: attachments = $event.attachments;
  $: tags = event.tags;

  let headHTML = `<style>\n${cssBody}\n${cssContent}\n</style>`;
</script>

<style>
  .title-row {
    margin-block-start: 12px;
    margin-inline: 16px;
  }
  .title {
    font-weight: bold;
    margin-inline-end: 8px;
  }
  .buttons {
    align-items: start;
    gap: 8px;
  }
  .details-grid {
    margin: 20px 16px;
  }
  .attachments,
  .tags {
    margin: 0px 12px 12px 12px;
  }
</style>
